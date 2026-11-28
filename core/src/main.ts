import 'dotenv/config';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

import { AppModule } from './app.module';

async function bootstrap() {
  for (const key of ['JWT_SECRET', 'FILES_SECRET', 'DATABASE_URL']) {
    if (!process.env[key] || process.env[key]!.startsWith('change-me')) {
      throw new Error(`${key} manquant ou laissé par défaut dans .env`);
    }
  }

  const app = await NestFactory.create(AppModule);

  // Sécurité : en-têtes HTTP
  app.use(helmet());

  // CORS : seulement pour l'aperçu web de l'app ; l'app mobile et l'agent n'en ont pas besoin.
  const origins = (process.env.CORS_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  app.enableCors({ origin: origins.length ? origins : false, credentials: true });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();

  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('ORION Core')
      .setDescription('Relais entre l’app ORION et les agents PC')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api', app, () => SwaggerModule.createDocument(app, config));
  }

  await app.listen(process.env.PORT || 3001, '0.0.0.0');
}
bootstrap();
