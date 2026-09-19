import { createApp } from './app.js';

const host = '127.0.0.1';
const port = Number(process.env.PORT ?? 8787);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

let app: ReturnType<typeof createApp> | undefined;
try {
  app = createApp();
  await app.listen({ host, port });
} catch (error) {
  if (app) {
    app.log.error(error);
    await app.close();
  } else {
    console.error('Server startup failed:', error);
  }
  process.exitCode = 1;
}
