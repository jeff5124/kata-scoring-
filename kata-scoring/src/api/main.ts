import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors();
  // WEB_DIR : pages du site exporté (web/out), servies à la même adresse que l'API (déploiement en un seul service).
  const webDir = process.env.WEB_DIR ? resolve(process.env.WEB_DIR) : null;
  if (webDir) {
    if (!existsSync(webDir)) throw new Error(`WEB_DIR introuvable : ${webDir}`);
    app.useStaticAssets(webDir, { index: 'index.html', redirect: true });
  }
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  console.log(`API kata-scoring prête sur le port ${port}`);
}

void bootstrap();
