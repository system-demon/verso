/**
 * Twinseed server — Express HTTP JSON-RPC + Socket.IO
 * Serves presentational HTML and linked-data (JSON-LD) from the same tree
 */

import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { handleRpc } from './rpc.js';
import { jsonDiagramText, plantUmlUrl } from './diagram.js';
import { renderYaml, toDocument } from '../parser/yamlDom.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../../public');
const LIVE_DIR = path.resolve(__dirname, '../../live');
const EXEMPLAR_DIR = path.resolve(__dirname, '../../exemplar');
const PORT = Number(process.env.PORT) || 3847;

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(PUBLIC_DIR));
app.use('/live', express.static(LIVE_DIR));
app.use('/exemplar', express.static(EXEMPLAR_DIR));

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
  res.json({ ok: true, service: 'twinseed', port: PORT });
});

/**
 * Render inline YAML from the request body.
 * Raw YAML:  POST /render  (Content-Type: text/plain or text/yaml)
 * JSON:      { "yaml": "...", "data": {...}, "strict": true }
 * Query:     ?format=json (default) | html | doc   ?strict=1
 */
app.post(
  '/render',
  express.text({ type: ['text/*', 'application/yaml', 'application/x-yaml'], limit: '1mb' }),
  (req, res) => {
    try {
      let source;
      let data = {};
      let strict;

      if (typeof req.body === 'string') {
        source = req.body;
      } else if (req.body && typeof req.body.yaml === 'string') {
        source = req.body.yaml;
        data = req.body.data ?? {};
        strict = req.body.strict === true ? true : undefined;
      } else {
        return res.status(400).json({
          error: 'POST raw YAML (Content-Type: text/yaml) or JSON { "yaml": "...", "data": {} }',
        });
      }

      if (req.query.strict === '1' || req.query.strict === 'true') strict = true;

      const result = renderYaml(source, { params: data, strict });
      const format = req.query.format ?? 'json';
      if (format === 'html') return res.type('html').send(result.html);
      if (format === 'doc') return res.type('html').send(toDocument(result));
      return res.json({
        html: result.html,
        ldJson: result.ldJson,
        contentMap: result.contentMap,
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  },
);

/**
 * Diagram the JSON-LD graph via the public PlantUML server (network-dependent).
 * Same body contract as /render. Query: ?format=uml (diagram source) | svg (default)
 */
app.post(
  '/diagram',
  express.text({ type: ['text/*', 'application/yaml', 'application/x-yaml'], limit: '1mb' }),
  async (req, res) => {
    try {
      let source;
      let data = {};
      let profile;

      if (typeof req.body === 'string') {
        source = req.body;
      } else if (req.body && typeof req.body.yaml === 'string') {
        source = req.body.yaml;
        data = req.body.data ?? {};
        profile = req.body.profile;
      } else {
        return res.status(400).json({
          error: 'POST raw YAML (Content-Type: text/yaml) or JSON { "yaml": "...", "data": {} }',
        });
      }

      const result = renderYaml(source, { params: data, profile });
      const uml = jsonDiagramText(result.ldJson);

      if (req.query.format === 'uml') return res.type('text/plain').send(uml);

      const upstream = await fetch(plantUmlUrl(uml, 'svg'), {
        signal: AbortSignal.timeout(10_000),
      });
      if (!upstream.ok) {
        return res
          .status(502)
          .json({ error: `PlantUML server returned ${upstream.status}` });
      }
      const svg = await upstream.text();
      return res.type('image/svg+xml').send(svg);
    } catch (err) {
      const status = err.name === 'TimeoutError' || err.name === 'AbortError' ? 504 : 400;
      return res.status(status).json({ error: err.message });
    }
  },
);

const httpServer = createServer(app);

/** Clean 400 for malformed JSON bodies (e.g. YAML posted as application/json) */
app.use((err, _req, res, next) => {
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({
      error:
        'Invalid JSON body. Send valid JSON, or raw YAML with Content-Type: text/yaml.',
    });
  }
  next(err);
});
const io = new Server(httpServer, {
  cors: { origin: '*' },
});

/** Collaborative editor rooms: room name → current YAML draft (in-memory only). */
const docRooms = new Map();
const DOC_ROOM_LIMIT = 200;
const DOC_ROOM_NAME_MAX = 64;
const DOC_YAML_MAX = 256_000;

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

  /** Collaborative document channel (live/editor.html) */
  socket.on('doc:join', (room, ack) => {
    if (typeof room !== 'string' || !room || room.length >= DOC_ROOM_NAME_MAX) return;
    socket.join(room);
    if (docRooms.has(room)) {
      const payload = { yaml: docRooms.get(room), origin: 'server' };
      if (typeof ack === 'function') ack(payload);
      else socket.emit('doc:state', payload);
    } else if (typeof ack === 'function') {
      ack(null);
    }
  });

  socket.on('doc:update', (msg) => {
    if (
      !msg ||
      typeof msg !== 'object' ||
      typeof msg.room !== 'string' ||
      !msg.room ||
      msg.room.length >= DOC_ROOM_NAME_MAX ||
      typeof msg.yaml !== 'string' ||
      msg.yaml.length >= DOC_YAML_MAX
    ) {
      return;
    }
    docRooms.set(msg.room, msg.yaml);
    if (docRooms.size > DOC_ROOM_LIMIT) {
      docRooms.delete(docRooms.keys().next().value);
    }
    socket.to(msg.room).emit('doc:update', { yaml: msg.yaml, origin: socket.id });
  });
});

httpServer.listen(PORT, () => {
  console.log(`Twinseed listening on http://localhost:${PORT}`);
  console.log(`  JSON-RPC  POST /rpc`);
  console.log(`  Inline    POST /render (raw YAML or { yaml, data })`);
  console.log(`  Socket.IO ws://localhost:${PORT}`);
  console.log(`  Demo      http://localhost:${PORT}/`);
  console.log(`  Live      http://localhost:${PORT}/live/  (live/)`);
  console.log(`  Editor    http://localhost:${PORT}/live/editor.html`);
  console.log(`  Exemplar  http://localhost:${PORT}/exemplar/canvas.html`);
  console.log(`  Diagram   POST /diagram (graph via PlantUML; ?format=uml for source)`);
});
