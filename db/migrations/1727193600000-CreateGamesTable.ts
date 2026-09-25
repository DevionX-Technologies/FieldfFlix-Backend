import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateGamesTable1727193600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'games',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'tournamentId',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'fixtureRef',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'recordingId',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'courtNumber',
            type: 'int',
            isNullable: true,
          },
          {
            name: 'cameraId',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'round',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'teamA',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'teamB',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'score',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'status',
            type: 'varchar',
            length: '50',
            default: "'scheduled'",
          },
          {
            name: 'scheduledAt',
            type: 'timestamptz',
            isNullable: true,
          },
          {
            name: 'startedAt',
            type: 'timestamptz',
            isNullable: true,
          },
          {
            name: 'endedAt',
            type: 'timestamptz',
            isNullable: true,
          },
          {
            name: 'metadata',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'createdBy',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'createdAt',
            type: 'timestamptz',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updatedAt',
            type: 'timestamptz',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'games',
      new TableIndex({
        name: 'idx_games_tournament_id',
        columnNames: ['tournamentId'],
      }),
    );

    await queryRunner.createIndex(
      'games',
      new TableIndex({
        name: 'idx_games_recording_id',
        columnNames: ['recordingId'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('games', 'idx_games_recording_id');
    await queryRunner.dropIndex('games', 'idx_games_tournament_id');
    await queryRunner.dropTable('games');
  }
}
