import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule, HttpExceptionFilter } from '@cepage/api';
import { resolveCorsOrigin } from '@cepage/config';
import { WORKFLOW_COPILOT_MAX_JSON_BODY_BYTES } from '@cepage/shared-core';
import { json, urlencoded } from 'express';
import type { ValidationError } from 'class-validator';

function formatValidationErrors(errors: ValidationError[]): Array<{
  field: string;
  messages: string[];
}> {
  return errors.map((e) => ({
    field: e.property,
    messages: Object.values(e.constraints ?? {}),
  }));
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  app.use(json({ limit: WORKFLOW_COPILOT_MAX_JSON_BODY_BYTES }));
  app.use(urlencoded({ extended: true, limit: WORKFLOW_COPILOT_MAX_JSON_BODY_BYTES }));
  const port = Number(process.env.API_PORT ?? process.env.PORT ?? 31947);

  app.enableCors({
    origin: resolveCorsOrigin(),
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      exceptionFactory: (errors: ValidationError[]) =>
        new BadRequestException({
          message: 'VALIDATION_FAILED',
          errors: formatValidationErrors(errors),
        }),
    }),
  );

  await app.listen(port);
}
bootstrap();
