/**
 * YML-DOM server — Express HTTP JSON-RPC + Socket.IO real-time sync
 */

import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { handleRpc } from './rpc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../../public');
const PORT = Number(process.env.PORT) || 3847;

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(PUBLIC_DIR));

/** HTTP JSON-RPC endpoint */
app.post('/rpc', (req, res) => {
  const sessionId =
    req.headers['x-session-id']?.toString() ||
    req.body?.params?.sessionId ||
    'default';
  const response = handleRpc(req.body, { sessionId });
  res.json(response);
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'yml-dom', port: PORT });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
});

io.on('connection', (socket) => {
  const sessionId =
    socket.handshake.query.sessionId?.toString() ||
    socket.id;

  socket.join(sessionId);
  socket.emit('connected', { sessionId, socketId: socket.id });

  /** JSON-RPC over WebSocket */
  socket.on('rpc', (request, ack) => {
    const response = handleRpc(request, { sessionId });

    // Broadcast pushUpdate when state changes
    if (
      request?.method === 'updateState' &&
      response.result &&
      !response.error
    ) {
      const push = {
        jsonrpc: '2.0',
        method: 'pushUpdate',
        params: {
          target: response.result.target,
          newHtml: response.result.newHtml,
          newLdJson: response.result.newLdJson,
          state: response.result.state,
          itemId: response.result.itemId,
        },
      };
      io.to(sessionId).emit('pushUpdate', push);
    }

    if (typeof ack === 'function') ack(response);
    else socket.emit('rpc:response', response);
  });

  socket.on('join', (room) => {
    if (typeof room === 'string' && room.length < 128) {
      socket.join(room);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`YML-DOM listening on http://localhost:${PORT}`);
  console.log(`  JSON-RPC  POST /rpc`);
  console.log(`  Socket.IO ws://localhost:${PORT}`);
  console.log(`  Demo      http://localhost:${PORT}/`);
});
