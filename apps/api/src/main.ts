import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { parseCorsOrigins, type Env } from './config/env';

/** Request body ceiling. CSV uploads use multipart with their own limit (Sprint 3). */
const JSON_BODY_LIMIT = '1mb';

async function bootstrap(): Promise<void> {
  // Body parsing is configured explicitly so the size limit is ours, not the default.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  const apiPrefix = config.get('API_PREFIX', { infer: true });
  const port = config.get('PORT', { infer: true });

  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));
  app.use(cookieParser());
  app.use(helmet());
  // Behind Nginx, so client IPs (used for throttling and audit) come from
  // X-Forwarded-For rather than the proxy's own address.
  app.set('trust proxy', 1);
  app.enableCors({
    origin: parseCorsOrigins(config.get('CORS_ORIGINS', { infer: true })),
    credentials: true,
  });
  app.setGlobalPrefix(apiPrefix);
  // DTO validation is per-route via ZodValidationPipe (ADR-0003) rather than a global pipe.
  app.enableShutdownHooks();

  await app.listen(port, '0.0.0.0');

  Logger.log(`API listening on http://0.0.0.0:${port}/${apiPrefix}`, 'Bootstrap');
}

void bootstrap();
