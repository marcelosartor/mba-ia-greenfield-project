import { registerAs } from '@nestjs/config';

export default registerAs('redis', () => ({
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  // Namespaces the BullMQ keys; tests use their own so they never compete
  // with the worker running in the Compose stack.
  queuePrefix: process.env.QUEUE_PREFIX || 'bull',
}));
