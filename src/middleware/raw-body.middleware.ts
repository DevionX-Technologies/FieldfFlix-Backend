import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as bodyParser from 'body-parser';

@Injectable()
export class RawBodyMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RawBodyMiddleware.name);

  use(req: Request, res: Response, next: NextFunction) {
    // Only capture raw body for webhook endpoints
    if (req.path.includes('/webhooks/')) {
      this.logger.debug(`Processing webhook request for path: ${req.path}`);

      bodyParser.raw({
        type: 'application/json',
        limit: '1mb',
      })(req, res, () => {
        if (req.body || Buffer.isBuffer(req.body)) {
          // Store raw body as string for signature verification
          const rawBodyString = req.body.toString('utf8');
          (req as any).rawBody = rawBodyString;

          this.logger.debug('Raw body captured for webhook', {
            path: req.path,
            bodyLength: rawBodyString.length,
            bodyType: typeof req.body,
            isBuffer: Buffer.isBuffer(req.body),
            contentType: req.headers['content-type'],
            hasSignature: !!req.headers['mux-signature'],
          });
        } else {
          this.logger.error('Invalid body format in webhook request', {
            path: req.path,
            bodyType: typeof req.body,
            isBuffer: Buffer.isBuffer(req.body),
            bodyContent: req.body ? req.body.toString() : 'null',
            contentType: req.headers['content-type'],
          });
          // Try to convert anyway
          (req as any).rawBody = req.body ? JSON.stringify(req.body) : '';
        }
        next();
      });
    } else {
      next();
    }
  }
}
