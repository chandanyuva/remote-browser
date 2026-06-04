import express from 'express';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { BrowserManager } from './browserManager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 3001;
const manager = new BrowserManager({
  screencastQuality: Number(process.env.SCREENCAST_QUALITY) || 75,
  headless: process.env.HEADLESS !== 'false'
});

const app = express();
const server = createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 5e6,
  cors: { origin: true, credentials: true }
});

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, session: manager.state });
});

app.use(express.static(join(__dirname, '..', 'dist')));
app.get('*path', (_request, response) => {
  response.sendFile(join(__dirname, '..', 'dist', 'index.html'));
});

io.on('connection', (socket) => {
  socket.emit('session-state', manager.state);

  socket.on('session-create', async ({ url } = {}) => {
    await handle(socket, async () => {
      let sessionReady = false;
      let pendingFrame = null;
      const state = await manager.create(
        socket.id,
        url,
        (frame, metadata) => {
          const payload = { image: frame, metadata };
          if (sessionReady) socket.emit('frame', payload);
          else pendingFrame = payload;
        },
        (status) => socket.emit('page-status', status)
      );
      io.emit('session-state', state);
      sessionReady = true;
      if (pendingFrame) socket.emit('frame', pendingFrame);
    });
  });

  socket.on('navigate', async ({ url } = {}) => {
    await handle(socket, () =>
      manager.navigate(socket.id, url, (status) => socket.emit('page-status', status))
    );
  });

  socket.on('mouse-click', ({ x, y } = {}) => handle(socket, () => manager.click(socket.id, x, y)));
  socket.on('mouse-wheel', ({ deltaX, deltaY } = {}) =>
    handle(socket, () => manager.wheel(socket.id, deltaX, deltaY))
  );
  socket.on('mouse-move', ({ x, y } = {}) =>
    handle(socket, async () => {
      const cursor = await manager.move(socket.id, x, y);
      socket.emit('cursor-style', cursor);
    })
  );
  socket.on('keydown', ({ key } = {}) => handle(socket, () => manager.keyDown(socket.id, key)));
  socket.on('keyup', ({ key } = {}) => handle(socket, () => manager.keyUp(socket.id, key)));

  socket.on('session-close', async () => {
    await manager.close(socket.id);
    io.emit('session-state', manager.state);
  });

  socket.on('disconnect', async () => {
    if (manager.ownerId === socket.id) {
      await manager.close(socket.id);
      io.emit('session-state', manager.state);
    }
  });
});

async function handle(socket, action) {
  try {
    await action();
  } catch (error) {
    socket.emit('error-message', error instanceof Error ? error.message : 'Unexpected error');
  }
}

server.listen(port, () => {
  console.log(`Router Relay backend listening on http://localhost:${port}`);
});

async function shutdown() {
  await manager.close();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
