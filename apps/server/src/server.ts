import { createApp } from './app.js';

const host = '127.0.0.1';
const port = Number(process.env.PORT ?? 8787);
const desktopSecret = process.env.FORGEFLOW_DESKTOP_SECRET;

if (!Number.isInteger(port) || port < (desktopSecret ? 0 : 1) || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

let app: ReturnType<typeof createApp> | undefined;
try {
  app = createApp(undefined, {
    desktopSecret, instanceId: process.env.FORGEFLOW_DESKTOP_INSTANCE, webDist: process.env.FORGEFLOW_WEB_DIST,
  });
  app.addHook('onClose', async () => { if (process.connected) process.disconnect(); });
  await app.listen({ host, port });
  const address = app.server.address();
  if (address && typeof address !== 'string') process.send?.({ type: 'ready', port: address.port, instanceId: process.env.FORGEFLOW_DESKTOP_INSTANCE });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app?.close(); });
  process.on('message', (message) => {
    if (desktopSecret && message && typeof message === 'object' && 'type' in message && message.type === 'shutdown') void app?.close();
  });
} catch (error) {
  if (app) {
    app.log.error(error);
    await app.close();
  } else {
    console.error('Server startup failed:', error);
  }
  process.exitCode = 1;
}
