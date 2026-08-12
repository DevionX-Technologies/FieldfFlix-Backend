import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddStreakAndAccuracyToUserPoints1763100000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add streak tracking columns
    await queryRunner.addColumn(
      'user_points',
      new TableColumn({
        name: 'current_streak',
        type: 'integer',
        default: 0,
        isNullable: false,
      }),
    );

    await queryRunner.addColumn(
      'user_points',
      new TableColumn({
        name: 'longest_streak',
        type: 'integer',
        default: 0,
        isNullable: false,
      }),
    );

    await queryRunner.addColumn(
      'user_points',
      new TableColumn({
        name: 'last_activity_date',
        type: 'date',
        isNullable: true,
      }),
    );

    // Add accuracy tracking columns
    await queryRunner.addColumn(
      'user_points',
      new TableColumn({
        name: 'total_sessions',
        type: 'integer',
        default: 0,
        isNullable: false,
      }),
    );

    await queryRunner.addColumn(
      'user_points',
      new TableColumn({
        name: 'successful_sessions',
        type: 'integer',
        default: 0,
        isNullable: false,
      }),
    );

    await queryRunner.addColumn(
      'user_points',
      new TableColumn({
        name: 'accuracy_percent',
        type: 'numeric',
        precision: 5,
        scale: 2,
        default: 0,
        isNullable: false,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('user_points', 'accuracy_percent');
    await queryRunner.dropColumn('user_points', 'successful_sessions');
    await queryRunner.dropColumn('user_points', 'total_sessions');
    await queryRunner.dropColumn('user_points', 'last_activity_date');
    await queryRunner.dropColumn('user_points', 'longest_streak');
    await queryRunner.dropColumn('user_points', 'current_streak');
  }
}
