import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { applyDnsOverrideIfConfigured } from './dns-override';

applyDnsOverrideIfConfigured();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Mode B — Compliance Dashboard UI is a separate origin and sends
  // credentials (Authorization header) cross-origin, so it needs an explicit
  // allow-list (not '*') plus credentials: true.
  const dashboardOrigins = (
    process.env.COMPLIANCE_DASHBOARD_ORIGINS || 'http://localhost:3002'
  )
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: dashboardOrigins,
    credentials: true,
  });

  const config = new DocumentBuilder()
    .setTitle('Sync2Books Compliance API')
    .setDescription('Unified compliance abstraction layer for eTIMS (OSCU).')
    .setVersion('1.0.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
