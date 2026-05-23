import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { GlobalResponseInterceptor } from './interceptors/global-response.interceptor';
import { initializeSwagger } from './utils/swagger';
import { ValidationPipe } from '@nestjs/common';
import { AppLogger } from './logger.service';
import { GlobalExceptionFilter } from './filters/global-exception.filter';

async function bootstrap() {
  const appLogger = new AppLogger();
  const app = await NestFactory.create(AppModule, {
    logger: appLogger,
  });

  const httpAdapter = app.get(HttpAdapterHost);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      frameguard: { action: 'deny' },
      hsts: { maxAge: 31536000, includeSubDomains: true }, // Strict-Transport-Security for 1 year
      xssFilter: true, // Enable XSS filter
      referrerPolicy: { policy: 'no-referrer' }, // Limit the amount of referrer information sent with requests
    }),
  );

  app.enableCors(); // Enable CORS

  app.use(
    (
      req: { method: string; originalUrl?: string; url?: string },
      _res: unknown,
      next: () => void,
    ) => {
      appLogger.log(`→ ${req.method} ${req.originalUrl ?? req.url ?? ''}`);
      next();
    },
  );

  // Apply Global Interceptor for success responses
  app.useGlobalInterceptors(new GlobalResponseInterceptor());

  // Global exception filter
  app.useGlobalFilters(new GlobalExceptionFilter(httpAdapter));

  // Use the ValidationPipe globally with whitelist set to true.
  app.useGlobalPipes(new ValidationPipe({}));

  // Initialize Swagger
  initializeSwagger(app);

  // Access ConfigService to get the port number from the config
  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') ?? 3000;
  await app.listen(port, '0.0.0.0');
  console.log(
    `Listening on 0.0.0.0:${port} (LAN devices use http://<this-pc-ip>:${port})`,
  );
  console.log(`Swagger UI is running at http://localhost:${port}`);
}
bootstrap();
