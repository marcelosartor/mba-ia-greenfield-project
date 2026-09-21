// Runs before dotenv (which never overrides existing variables): automated
// tests use their own BullMQ key prefix so they never compete for jobs with the
// worker running in the Compose stack.
process.env.QUEUE_PREFIX = process.env.QUEUE_PREFIX_TEST || 'streamtube-test';
