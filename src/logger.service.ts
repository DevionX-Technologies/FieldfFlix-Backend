import { Injectable, LoggerService } from '@nestjs/common';
import * as winston from 'winston';
import 'winston-daily-rotate-file';

@Injectable()
export class AppLogger implements LoggerService {
  private readonly logger: winston.Logger;

  constructor() {
    const isDevelopment = process.env.ENVIRONMENT !== 'production';

    const logFormat = winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.errors({ stack: true }), // Capture stack trace
      winston.format.printf(({ timestamp, level, message, stack }) => {
        let logMessage = `${timestamp} [${level}] ${message}`;
        if (stack) {
          logMessage += `\nStack trace: ${stack}`;
        }
        return logMessage;
      }),
    );

    const transports = [];

    // Console transport
    transports.push(
      new winston.transports.Console({
        format: isDevelopment
          ? winston.format.combine(
              winston.format.colorize({ all: true }),
              logFormat,
            )
          : logFormat,
      }),
    );

    transports.push(
      new winston.transports.DailyRotateFile({
        filename: 'logs/application-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '14d',
        format: logFormat,
      }),
    );

    this.logger = winston.createLogger({
      level: isDevelopment ? 'debug' : 'info',
      transports: transports,
    });
  }

  log(message: string) {
    this.logger.info(message);
  }

  error(message: string, trace?: string) {
    this.logger.error(message, { stack: trace });
  }

  warn(message: string) {
    this.logger.warn(message);
  }

  debug(message: string) {
    this.logger.debug(message);
  }

  verbose(message: string) {
    this.logger.verbose(message);
  }
}
