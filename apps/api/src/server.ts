import { createServer } from 'node:http';
import { Server as SocketIoServer } from 'socket.io';
import { createApp } from './app.js';
import { config } from './config.js';

const app = createApp();
const httpServer = createServer(app);

// Realtime room/vote handlers are added in later tasks; the server is wired up now
// so the socket transport is available to build on.
export const io = new SocketIoServer(httpServer, {
  cors: { origin: config.corsOrigin },
});

httpServer.listen(config.port, () => {
  console.info(`Planning Poker API listening on http://localhost:${config.port}`);
});
