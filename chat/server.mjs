// RooRoom chat push server.
//
// A browser connects to /ws?ticket=<signed ticket>. The ticket is minted by the web app for the
// signed-in user, lives 60 seconds and is checked here with a timing-safe HMAC compare.
// The client then joins threads; membership is checked AS THAT USER under Row Level Security.
// When a message row is inserted, Postgres NOTIFY tells us, and we push {thread_id, message_id}
// to that thread's joined members. Message bodies are encrypted by the web app; this server
// never sees plaintext, it only says "there is something new, go fetch it".
import http from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import pg from 'pg';
import { WebSocketServer } from 'ws';

const PORT = 8080;
const SECRET = process.env.CHAT_TICKET_SECRET ?? '';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** thread_id -> Set<ws> */
const rooms = new Map();

function verifyTicket(ticket) {
  if (typeof ticket !== 'string' || !SECRET) return null;
  const [payload, sig] = ticket.split('.');
  if (!payload || !sig) return null;
  const expect = createHmac('sha256', SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { u, e } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof u !== 'string' || !UUID.test(u) || typeof e !== 'number' || e < Date.now()) return null;
    return u;
  } catch {
    return null;
  }
}

async function isMember(userId, threadId) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN READ ONLY');
    await c.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const r = await c.query('SELECT is_thread_member($1) AS ok', [threadId]);
    await c.query('COMMIT');
    return r.rows[0]?.ok === true;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('[chat] membership check failed', e.message);
    return false;
  } finally {
    c.release();
  }
}

function leaveAll(ws) {
  for (const t of ws.threads) {
    const set = rooms.get(t);
    if (set) {
      set.delete(ws);
      if (set.size === 0) rooms.delete(t);
    }
  }
  ws.threads.clear();
}

const server = http.createServer((req, res) => {
  if (req.url === '/ws/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://chat');
  if (!url.pathname.startsWith('/ws')) return socket.destroy();
  const userId = verifyTicket(url.searchParams.get('ticket'));
  if (!userId) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.userId = userId;
    ws.threads = new Set();
    ws.alive = true;
    wss.emit('connection', ws);
  });
});

wss.on('connection', (ws) => {
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg?.type === 'ping') return ws.send(JSON.stringify({ type: 'pong' }));
    if (msg?.type === 'join' && typeof msg.thread_id === 'string' && UUID.test(msg.thread_id)) {
      if (ws.threads.size >= 50) return ws.send(JSON.stringify({ type: 'error', error: 'too many threads' }));
      const ok = await isMember(ws.userId, msg.thread_id);
      if (!ok) return ws.send(JSON.stringify({ type: 'denied', thread_id: msg.thread_id }));
      if (!rooms.has(msg.thread_id)) rooms.set(msg.thread_id, new Set());
      rooms.get(msg.thread_id).add(ws);
      ws.threads.add(msg.thread_id);
      ws.send(JSON.stringify({ type: 'joined', thread_id: msg.thread_id }));
    }
    if (msg?.type === 'leave' && typeof msg.thread_id === 'string') {
      rooms.get(msg.thread_id)?.delete(ws);
      ws.threads.delete(msg.thread_id);
    }
  });
  ws.on('close', () => leaveAll(ws));
  ws.send(JSON.stringify({ type: 'ready' }));
});

// Heartbeat: drop dead sockets every 25 s.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { leaveAll(ws); ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
}, 25_000);

// LISTEN on a dedicated connection, reconnecting if the database restarts.
async function listen() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  client.on('error', (e) => console.error('[chat] listener error', e.message));
  client.on('end', () => setTimeout(listen, 2000));
  try {
    await client.connect();
    await client.query('LISTEN rooroom_chat');
    console.log('[chat] listening for new messages');
  } catch (e) {
    console.error('[chat] could not listen, retrying', e.message);
    setTimeout(listen, 2000);
    return;
  }
  client.on('notification', (n) => {
    let p;
    try { p = JSON.parse(n.payload ?? '{}'); } catch { return; }
    const set = rooms.get(p.thread_id);
    if (!set) return;
    const out = JSON.stringify({ type: 'message', thread_id: p.thread_id, message_id: p.message_id });
    for (const ws of set) if (ws.readyState === ws.OPEN) ws.send(out);
  });
}

listen();
server.listen(PORT, () => console.log(`[chat] on :${PORT}`));
