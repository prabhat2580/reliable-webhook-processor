import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker/worker.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Worker Bootstrap');
  const workerId = process.env.WORKER_ID || 'worker-unknown';
  logger.log(`Initializing Standalone Worker Node: ${workerId}`);

  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  logger.log(`Standalone Worker Node active and listening for events.`);
}
bootstrap();
