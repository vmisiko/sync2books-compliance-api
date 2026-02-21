import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { AppModule } from './app.module';

async function generate(): Promise<void> {
  // Ensure sqljs DB directory exists when running locally.
  mkdirSync(resolve(process.cwd(), 'data'), { recursive: true });
  const app = await NestFactory.create(AppModule, { logger: false });

  const config = new DocumentBuilder()
    .setTitle('Sync2Books Compliance API')
    .setDescription('Unified compliance abstraction layer for eTIMS (OSCU).')
    .setVersion('1.0.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  const outPath = resolve(process.cwd(), '.docs', 'openapi.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(document, null, 2), 'utf-8');

  await app.close();
}

void generate();
