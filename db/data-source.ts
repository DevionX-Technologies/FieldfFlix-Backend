import * as dotenv from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';

dotenv.config();

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST,
  port: +process.env.DB_PORT,
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE ?? 'fieldflicks-dev',
  entities: ['dist/**/*.entity.js'],
  migrations: ['dist/db/migrations/*.js'],
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
