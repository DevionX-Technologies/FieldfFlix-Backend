import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { AppLogger } from 'src/logger.service';

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  constructor(private readonly logger: AppLogger) {}

  use(req: Request, res: Response, next: NextFunction) {
    const { method, originalUrl, query, body } = req;
    const { statusCode } = res;
    const contentLength = res.get('content-length') || 0;

    // Determine if the environment is development
    const isDevelopment = process.env.ENVIRONMENT !== 'production';

    // Define color codes
    const colors = {
      reset: '\x1b[0m',
      magenta: '\x1b[35m',
      green: '\x1b[32m',
    };

    // Conditionally apply color codes
    const color = (colorCode: string, text: string) =>
      isDevelopment ? `${colorCode}${text}${colors.reset}` : text;

    // Construct the log message
    const logMessage = `
        ${color(colors.magenta, '-------------------------Log Request Start:---------------------')}
        ${color(colors.green, 'Method:')} ${method}
        ${color(colors.green, 'Path:')} ${originalUrl}
        ${color(colors.green, 'Query Params:')} ${JSON.stringify(query, null, 2)}
        ${color(colors.green, 'Body:')} ${JSON.stringify(body, null, 2)}
        ${color(colors.green, 'Status:')} ${statusCode}
        ${color(colors.green, 'Response Size:')} ${contentLength} bytes
        ${color(colors.magenta, '-------------------------Log Request Ends:---------------------')}
      `;

    // Log the message
    this.logger.log(logMessage);

    next();
  }
}
