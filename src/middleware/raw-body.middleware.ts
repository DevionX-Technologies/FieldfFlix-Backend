import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as bodyParser from 'body-parser';

@Injectable()
export class RawBodyMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RawBodyMiddleware.name);

  use(req: Request, res: Response, next: NextFunction) {
    // Only capture raw body for webhook endpoints
    if (req.path.includes('/webhooks/') || req.path.includes('/mux/')) {
      this.logger.debug(`Processing webhook request for path: ${req.path}`);

      if ((req as any).rawBody) {
        return next();
      }

      bodyParser.raw({
        type: 'application/json',
        limit: '10mb',
      })(req, res, () => {
        if (req.body || Buffer.isBuffer(req.body)) {
          // Store raw body as string for signature verification
          const rawBodyString = Buffer.isBuffer(req.body)
            ? req.body.toString('utf8')
            : String(req.body);
          (req as any).rawBody = rawBodyString;

          this.logger.debug('Raw body captured for webhook', {
            path: req.path,
            bodyLength: rawBodyString.length,
            contentType: req.headers['content-type'],
            hasSignature: !!req.headers['mux-signature'],
          });
        } else {
          (req as any).rawBody = req.body ? JSON.stringify(req.body) : '';
        }
        next();
      });
    } else {
      next();
    }
  }
}
