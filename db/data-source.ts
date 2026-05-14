import * as dotenv from 'dotenv';
import * as path from 'path';
import { DataSource, DataSourceOptions } from 'typeorm';

dotenv.config();

/**
 * When this file is executed via ts-node (`*.ts`), load entities from `src` so class identity
 * matches `@InjectRepository()` in services. When executed from `dist/db/data-source.js` (prod
 * / `nest build`), load compiled `*.entity.js` under `dist`.
 */
function entityGlobs(): string[] {
  const fromSourceTree =
    __filename.endsWith('.ts') || __filename.endsWith('.tsx');
  if (fromSourceTree) {
    return [path.join(__dirname, '..', 'src', '**', '*.entity.ts')];
  }
  return [path.join(__dirname, '..', '**', '*.entity.js')];
}

function migrationGlobs(): string[] {
  const fromSourceTree =
    __filename.endsWith('.ts') || __filename.endsWith('.tsx');
  if (fromSourceTree) {
    return [path.join(__dirname, 'migrations', '*.ts')];
  }
  return [path.join(__dirname, 'migrations', '*.js')];
}

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST,
  port: +process.env.DB_PORT,
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE ?? 'fieldflicks-dev',
  entities: entityGlobs(),
  migrations: migrationGlobs(),
  // ...(process.env.ENVIRONMENT !== 'development'
  //   ? { ssl: { rejectUnauthorized: false } }
  //   : {}),
  ssl: { rejectUnauthorized: false },
  logging: process.env.ENVIRONMENT === 'development',
  synchronize: false,
  extra: {
    options: '-c timezone=Asia/Kolkata',
  },
};
const dataSource = new DataSource(dataSourceOptions);

export default dataSource;
