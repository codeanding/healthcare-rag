import 'reflect-metadata';
import './load-env';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@aws-lambda-powertools/logger';
import { AppModule } from './app.module';

const logger = new Logger({ serviceName: 'healthcare-rag-api' });

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  logger.info('api listening', { port });
}

bootstrap().catch((err) => {
  logger.error('bootstrap failed', { err });
  process.exit(1);
});
