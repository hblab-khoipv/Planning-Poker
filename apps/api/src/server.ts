import { createServer } from 'node:http';
import { Server as SocketIoServer } from 'socket.io';
import { createApp } from './app.js';
import { config } from './config.js';
import { getPool } from './db/pool.js';
import { attachRealtime } from './realtime/index.js';
import type { RealtimeServer } from './realtime/channel.js';

const app = createApp();
const httpServer = createServer(app);

// `credentials` matters as much here as it does for REST: the handshake is an ordinary HTTP
// request, and the NextAuth session cookie riding along with it is how the socket layer
// recognises a signed-in participant (see realtime/identity.ts).
export const io: RealtimeServer = new SocketIoServer(httpServer, {
  cors: { origin: config.corsOrigin, credentials: true },
});

attachRealtime(io, getPool());

httpServer.listen(config.port, () => {
  console.info(`Planning Poker API listening on http://localhost:${config.port}`);
});
