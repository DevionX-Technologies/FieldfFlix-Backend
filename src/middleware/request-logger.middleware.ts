import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { AppLogger } from 'src/logger.service';

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  constructor(private readonly logger: AppLogger) {}

  use(req: Request, res: Response, next: NextFunction) {
    const start = Date.now();
    const { method, originalUrl, query, body } = req;
    res.on('finish', () => {
      const duration = Date.now() - start;
      const q =
        Object.keys(query).length > 0 ? ` ?${JSON.stringify(query)}` : '';
      const hasBody =
        body && typeof body === 'object' && Object.keys(body).length > 0;
      const b = hasBody ? ` body=${JSON.stringify(body)}` : '';
      const safeB = b.length > 120 ? `${b.slice(0, 117)}...` : b;
      this.logger.log(
        `[HTTP] ${method} ${originalUrl}${q} -> ${res.statusCode} (${duration}ms)${safeB}`,
      );
    });

    next();
  }
}
