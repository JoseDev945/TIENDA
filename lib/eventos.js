// Avisos en vivo (mensajes nuevos, reacciones, "N viendo ahora").
//
// En Vercel puede haber varias copias del servidor a la vez y no comparten memoria.
// Por eso los avisos pasan por la base de datos: quien escribe guarda una fila en "events",
// y cada copia que tenga gente conectada revisa esa tabla una vez por segundo y reparte lo nuevo.
import crypto from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { all, one, run, HttpError } from './db.js';
import { currentUser, roomAccess, hooks } from './tienda.js';

const TICK_MS = 1000;        // cada cuánto se revisa si hay avisos nuevos
const LOOKBACK = 40;         // margen por si dos avisos se guardan en desorden
const STREAM_MS = Number(process.env.SEGUNDOS_CONEXION_VIVA || 270) * 1000; // Vercel corta las conexiones a los 300 s; se cierra antes y el navegador reconecta solo
const INSTANCE = crypto.randomBytes(8).toString('hex');
const encoder = new TextEncoder();

const clients = new Set();
let timer = null;
let ticking = false;
let again = false;
let cursor = 0;
let seen = new Set();
let presenceDirty = false;
let lastPresence = 0;
let lastPing = 0;
let lastTotals = {};
let lastCounts = '{}';

async function presenceSync() {
  presenceDirty = false;
  lastPresence = Date.now();
  const counts = {};
  for (const c of clients) if (c.room && c.room[0] === 'l') counts[c.room] = (counts[c.room] || 0) + 1;
  const rooms = Object.keys(counts);
  await run('DELETE FROM presence WHERE instance = $1 AND NOT (room = ANY($2::text[]))', [INSTANCE, rooms]);
  // Si cambió cuánta gente tengo conectada, se avisa a las demás copias para que actualicen su contador.
  const snapshot = JSON.stringify(counts);
  const changed = snapshot !== lastCounts;
  const touched = [...new Set([...rooms, ...Object.keys(JSON.parse(lastCounts))])];
  lastCounts = snapshot;
  const announce = () => (changed
    ? run('INSERT INTO events(room, user_id, type, data, created_at) VALUES(NULL, NULL, $1, $2::jsonb, $3)', ['_presence', JSON.stringify({ instance: INSTANCE, rooms: touched }), Date.now()])
    : null);
  if (!rooms.length) { lastTotals = {}; await announce(); return; }
  const now = Date.now();
  await run(`INSERT INTO presence(instance, room, n, at)
    SELECT $1, t.room, t.n, $4 FROM unnest($2::text[], $3::int[]) AS t(room, n)
    ON CONFLICT(instance, room) DO UPDATE SET n = EXCLUDED.n, at = EXCLUDED.at`, [INSTANCE, rooms, rooms.map((r) => counts[r]), now]);
  await announce();
  const totals = {};
  for (const r of await all('SELECT room, SUM(n)::int AS n FROM presence WHERE room = ANY($1::text[]) AND at > $2 GROUP BY room', [rooms, now - 30_000])) totals[r.room] = r.n;
  for (const c of clients) {
    if (c.room && totals[c.room] != null && (totals[c.room] !== lastTotals[c.room] || !c.gotPresence)) {
      c.gotPresence = true;
      c.send('presence', { room: c.room, count: totals[c.room] });
    }
  }
  lastTotals = totals;
}

async function tick() {
  if (ticking) { again = true; return; }
  ticking = true;
  try {
    if (!clients.size) {
      clearInterval(timer);
      timer = null;
      await presenceSync();
      return;
    }
    const rows = await all('SELECT id, room, user_id, type, data FROM events WHERE id > $1 ORDER BY id LIMIT 500', [Math.max(0, cursor - LOOKBACK)]);
    for (const e of rows) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      if (e.id > cursor) cursor = e.id;
      if (e.type === '_presence') {
        if (e.data.instance !== INSTANCE) for (const c of clients) if (e.data.rooms.includes(c.room)) presenceDirty = true;
        continue;
      }
      for (const c of clients) {
        if (e.id <= c.since) continue;
        if ((e.room && e.room === c.room) || (e.user_id && e.user_id === c.userId)) c.send(e.type, e.data);
      }
    }
    if (seen.size > 2000) seen = new Set([...seen].filter((id) => id > cursor - LOOKBACK));
    const now = Date.now();
    if (presenceDirty || now - lastPresence > 10_000) await presenceSync();
    if (now - lastPing > 20_000) { lastPing = now; for (const c of clients) c.raw(': ping\n\n'); }
  } catch (e) {
    console.error('Avisos en vivo:', e.message);
  } finally {
    ticking = false;
    if (again) { again = false; setImmediate(tick); }
  }
}

// Cuando el mismo servidor guarda un aviso (en tu computadora), se reparte al momento.
hooks.kick = () => { if (timer) setImmediate(tick); };

function drop(client) {
  if (!clients.delete(client)) return;
  clearTimeout(client.timer);
  presenceDirty = true;
  if (!timer) return;
  // En Vercel, al irse el último visitante la función puede detenerse enseguida:
  // waitUntil le pide que espere a que se actualice el contador de "viendo ahora".
  const pending = tick();
  try { waitUntil(pending); } catch { /* fuera de Vercel no hace falta */ }
}

export async function handleEvents(request) {
  try {
    const url = new URL(request.url);
    const user = await currentUser(request);
    let room = url.searchParams.get('room') || null;
    if (room) { try { await roomAccess(room, user); } catch { room = null; } }

    // Si nadie estaba conectado a esta copia, se empieza a contar desde el último aviso que existe.
    if (!timer) {
      cursor = (await one('SELECT COALESCE(MAX(id), 0) AS id FROM events')).id;
      seen = new Set();
    }

    let controller;
    const client = {
      room,
      userId: user ? user.id : null,
      since: cursor,
      gotPresence: false,
      raw(text) { try { controller.enqueue(encoder.encode(text)); } catch { drop(client); } },
      send(event, data) { client.raw(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); },
    };
    const stream = new ReadableStream({
      start(c) { controller = c; },
      cancel() { drop(client); },
    });
    request.signal.addEventListener('abort', () => drop(client));
    client.timer = setTimeout(() => { drop(client); try { controller.close(); } catch { /* ya cerrada */ } }, STREAM_MS);

    clients.add(client);
    client.raw('retry: 1500\n\n');
    client.send('ready', { room });
    presenceDirty = true;
    if (!timer) timer = setInterval(tick, TICK_MS);
    setImmediate(tick);

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        'X-Accel-Buffering': 'no',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    return new Response(JSON.stringify({ error: status === 500 ? 'No se pudo abrir la conexión en vivo.' : e.message }), {
      status, headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}
