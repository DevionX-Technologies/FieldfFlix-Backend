import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { mkdirSync, writeFileSync } from 'fs';

export function initializeSwagger(nestApp: INestApplication): void {
  // Configure Swagger UI with the DocumentBuilder and setup.
  const config = new DocumentBuilder()
    .setTitle('fieldflicks API')
    .setDescription('API documentation for fieldflicks backend')
    .setVersion('1.0')
    .addBearerAuth(
      {
        // Provide instructions for using the bearer token.
        description: `[just text field] Please enter token in following format: Bearer <JWT>`,
        name: 'Authorization',
        bearerFormat: 'JWT',
        scheme: 'bearer',
        type: 'http',
        in: 'Header',
      },
      'access-token',
    )
    .build();

  const swaggerPath = process.env.SWAGGER_PATH || 'api';

  const document = SwaggerModule.createDocument(nestApp, config);

  if (process.env.ENVIRONMENT === 'local') {
    // Create the .postman folder if it doesn't exist
    mkdirSync('backend-api', { recursive: true });

    // Write the Swagger JSON file to the .postman folder
    writeFileSync('backend-api/swagger-spec.json', JSON.stringify(document));
  }

  SwaggerModule.setup(swaggerPath, nestApp, document, {
    customSiteTitle: 'fieldflicks API',
    swaggerOptions: {
      operationSorter: 'alpha',
      tagSorter: 'alpha',
    },
  });
}
