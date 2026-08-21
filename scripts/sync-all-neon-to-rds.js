#!/usr/bin/env node
/**
 * Copy application data from Neon (source of truth) into AWS RDS.
 *
 * Skips PostGIS system table `spatial_ref_sys` and TypeORM `migrations`
 * (RDS already has the schema + migration history).
 *
 *   NEON_DATABASE_URL=... RDS_DATABASE_URL=... node scripts/sync-all-neon-to-rds.js
 */
const { Client } = require('pg');

const SKIP_TABLES = new Set(['spatial_ref_sys', 'migrations']);

function clientFromUrlOrParts(url, parts) {
  if (url) {
    return new Client({
      connectionString: url.includes('sslmode=')
        ? url
        : `${url}${url.includes('?') ? '&' : '?'}sslmode=require`,
      ssl: { rejectUnauthorized: false },
    });
  }
  return new Client({ ...parts, ssl: { rejectUnauthorized: false } });
}

function serializeValue(val, udtName) {
  if (val == null) return null;
  if (udtName === 'geometry' || udtName === 'geography') {
    return typeof val === 'string'
      ? val
      : Buffer.isBuffer(val)
        ? val.toString('hex')
        : val;
  }
  if (udtName === 'json' || udtName === 'jsonb') {
    if (typeof val === 'string') return val;
    return JSON.stringify(val);
  }
  if (
    typeof val === 'object' &&
    !(val instanceof Date) &&
    !Buffer.isBuffer(val) &&
    !Array.isArray(val)
  ) {
    return JSON.stringify(val);
  }
  return val;
}

async function tableColumns(client, table) {
  const { rows } = await client.query(
    `SELECT column_name, udt_name, is_identity, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table],
  );
  return rows;
}

async function main() {
  const neon = clientFromUrlOrParts(process.env.NEON_DATABASE_URL, {
    host: process.env.NEON_DB_HOST,
    port: 5432,
    user: process.env.NEON_DB_USER,
    password: process.env.NEON_DB_PASSWORD,
    database: process.env.NEON_DB_DATABASE || 'neondb',
  });

  const rdsUrl = process.env.RDS_DATABASE_URL;
  const rds = clientFromUrlOrParts(rdsUrl, {
    host: process.env.RDS_DB_HOST || process.env.DB_HOST,
    port: parseInt(
      process.env.RDS_DB_PORT || process.env.DB_PORT || '5432',
      10,
    ),
    user: process.env.RDS_DB_USER || process.env.DB_USER,
    password: process.env.RDS_DB_PASSWORD || process.env.DB_PASSWORD,
    database: process.env.RDS_DB_DATABASE || process.env.DB_DATABASE,
  });

  await neon.connect();
  await rds.connect();
  console.log('Connected to Neon and RDS');

  const { rows: srcTables } = await neon.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  const { rows: destTables } = await rds.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `);
  const destTableSet = new Set(destTables.map((r) => r.table_name));

  await rds.query("SET session_replication_role = 'replica'");
  await rds.query('BEGIN');

  const summary = [];
  try {
    const copyTables = srcTables
      .map((r) => r.table_name)
      .filter((t) => !SKIP_TABLES.has(t) && destTableSet.has(t));

    // Truncate every target table up front. Doing it per-table with CASCADE
    // would wipe already-copied children when a parent is truncated later.
    if (copyTables.length > 0) {
      const list = copyTables.map((t) => `"${t}"`).join(', ');
      await rds.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
      console.log(`truncated ${copyTables.length} tables`);
    }

    for (const table of copyTables) {
      const srcCols = await tableColumns(neon, table);
      const destCols = await tableColumns(rds, table);
      const destByName = new Map(destCols.map((c) => [c.column_name, c]));
      const cols = srcCols
        .map((c) => c.column_name)
        .filter((name) => destByName.has(name));
      if (cols.length === 0) {
        console.log(`skip ${table} (no shared columns)`);
        continue;
      }

      const selectList = cols
        .map((name) => {
          const udt = destByName.get(name).udt_name;
          if (udt === 'geometry' || udt === 'geography') {
            return `encode(ST_AsEWKB("${name}"), 'hex') AS "${name}"`;
          }
          return `"${name}"`;
        })
        .join(', ');

      const { rows } = await neon.query(`SELECT ${selectList} FROM "${table}"`);

      if (rows.length === 0) {
        console.log(`copied ${table}: 0 rows`);
        summary.push({ table, copied: 0 });
        continue;
      }

      const placeholders = cols.map((_, i) => {
        const udt = destByName.get(cols[i]).udt_name;
        if (udt === 'geometry' || udt === 'geography')
          return `ST_GeomFromEWKB(decode($${i + 1}, 'hex'))`;
        if (udt === 'json' || udt === 'jsonb') return `$${i + 1}::${udt}`;
        return `$${i + 1}`;
      });
      const insertSql = `INSERT INTO "${table}" ("${cols.join('", "')}") VALUES (${placeholders.join(', ')})`;

      for (const row of rows) {
        const values = cols.map((name) =>
          serializeValue(row[name], destByName.get(name).udt_name),
        );
        await rds.query(insertSql, values);
      }

      console.log(`copied ${table}: ${rows.length} rows`);
      summary.push({ table, copied: rows.length });
    }

    // Restore serial / identity sequences so later inserts don't collide.
    await rds.query(`
      DO $$
      DECLARE r record;
      BEGIN
        FOR r IN
          SELECT n.nspname AS nsp, c.relname AS tbl, a.attname AS col, s.relname AS seq
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_attribute a ON a.attrelid = c.oid
          JOIN pg_depend d ON d.refobjid = c.oid AND d.refobjsubid = a.attnum
          JOIN pg_class s ON s.oid = d.objid AND s.relkind = 'S'
          WHERE n.nspname = 'public' AND a.attnum > 0 AND NOT a.attisdropped
        LOOP
          BEGIN
            EXECUTE format(
              'SELECT setval(%L, COALESCE((SELECT MAX(%I)::bigint FROM %I.%I), 1), true)',
              r.nsp || '.' || r.seq, r.col, r.nsp, r.tbl
            );
          EXCEPTION WHEN OTHERS THEN
            NULL;
          END;
        END LOOP;
      END $$;
    `);

    await rds.query('COMMIT');
  } catch (err) {
    await rds.query('ROLLBACK');
    throw err;
  } finally {
    try {
      await rds.query("SET session_replication_role = 'origin'");
    } catch (_) {
      /* ignore */
    }
  }

  console.log('\n--- RDS vs Neon counts ---');
  for (const { table, copied } of summary) {
    const neonN = await neon.query(`SELECT COUNT(*)::int AS n FROM "${table}"`);
    const rdsN = await rds.query(`SELECT COUNT(*)::int AS n FROM "${table}"`);
    const mark = neonN.rows[0].n === rdsN.rows[0].n ? 'ok' : 'MISMATCH';
    console.log(
      `${mark.padEnd(8)} ${table.padEnd(34)} neon=${neonN.rows[0].n} rds=${rdsN.rows[0].n} copied=${copied}`,
    );
  }

  await neon.end();
  await rds.end();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
