import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker/worker.module';

async function bootstrap() {
  // Application context, not an HTTP application: the worker only consumes
  // the queue. Shutdown hooks let BullMQ finish the running jobs on SIGTERM.
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
}
void bootstrap();
