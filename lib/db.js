// Conexión a la base de datos (Neon / Postgres) y creación de tablas.
import pg from 'pg';
import { attachDatabasePool } from '@vercel/functions';

const { Pool, types } = pg;
types.setTypeParser(20, Number); // BIGINT y COUNT(*) llegan como número, no como texto

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const fail = (status, message) => { throw new HttpError(status, message); };

let pool = null;
let schemaReady = null;

// Neon crea DATABASE_URL al conectarse al proyecto. Si al conectarlo se eligió un prefijo
// (por ejemplo STORAGE_), la variable se llama STORAGE_DATABASE_URL: también se reconoce.
export function databaseUrl() {
  const env = process.env;
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (env.POSTGRES_URL) return env.POSTGRES_URL;
  const key = Object.keys(env).find((k) => /_(DATABASE|POSTGRES)_URL$/.test(k) && /^postgres(ql)?:\/\//.test(env[k]));
  return key ? env[key] : '';
}

function getPool() {
  if (pool) return pool;
  const url = databaseUrl();
  if (!url) fail(503, 'La tienda todavía no está conectada a su base de datos. Falta la variable DATABASE_URL (se crea al conectar Neon al proyecto en Vercel).');
  pool = new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 5000, connectionTimeoutMillis: 10000 });
  // Una conexión en reposo que se corta no debe tumbar el servidor: la siguiente consulta abre otra.
  pool.on('error', () => {});
  try { attachDatabasePool(pool); } catch { /* fuera de Vercel no hace falta */ }
  return pool;
}

const SCHEMA = `
BEGIN;
SELECT pg_advisory_xact_lock(727274001);
CREATE TABLE IF NOT EXISTS users(
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  ukey TEXT NOT NULL UNIQUE,
  color INT NOT NULL DEFAULT 0,
  avatar TEXT,
  avatar_url TEXT,
  bio TEXT NOT NULL DEFAULT '',
  code_hash TEXT NOT NULL,
  banned BOOLEAN NOT NULL DEFAULT FALSE,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY,
  user_id INT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS uploads(
  id TEXT PRIMARY KEY,
  user_id INT NOT NULL,
  kind TEXT NOT NULL,
  mime TEXT NOT NULL,
  name TEXT NOT NULL,
  size BIGINT NOT NULL,
  w INT, h INT,
  url TEXT NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS uploads_stale ON uploads(created_at) WHERE used = FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS uploads_url ON uploads(url);
CREATE TABLE IF NOT EXISTS listings(
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'venta',
  title TEXT NOT NULL,
  price BIGINT,
  category TEXT NOT NULL,
  condition TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  media JSONB NOT NULL DEFAULT '[]',
  search TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'activa',
  owner_read INT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS listings_recent ON listings(status, created_at DESC);
CREATE INDEX IF NOT EXISTS listings_user ON listings(user_id);
CREATE TABLE IF NOT EXISTS messages(
  id SERIAL PRIMARY KEY,
  room TEXT NOT NULL,
  user_id INT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  attachments JSONB NOT NULL DEFAULT '[]',
  reply_to INT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_room ON messages(room, id);
CREATE TABLE IF NOT EXISTS reactions(
  target TEXT NOT NULL,
  user_id INT NOT NULL,
  emoji TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY(target, user_id, emoji)
);
CREATE TABLE IF NOT EXISTS saved(
  user_id INT NOT NULL,
  listing_id INT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY(user_id, listing_id)
);
CREATE TABLE IF NOT EXISTS dms(
  id SERIAL PRIMARY KEY,
  a INT NOT NULL,
  b INT NOT NULL,
  listing_id INT,
  a_read INT NOT NULL DEFAULT 0,
  b_read INT NOT NULL DEFAULT 0,
  last_at BIGINT,
  created_at BIGINT NOT NULL,
  UNIQUE(a, b)
);
CREATE INDEX IF NOT EXISTS dms_b ON dms(b);
CREATE TABLE IF NOT EXISTS reports(
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL,
  target TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL
);
-- Cola de avisos en vivo: cada instancia del servidor la lee una vez por segundo.
CREATE TABLE IF NOT EXISTS events(
  id BIGSERIAL PRIMARY KEY,
  room TEXT,
  user_id INT,
  type TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS limits(
  key TEXT PRIMARY KEY,
  n INT NOT NULL,
  reset BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS presence(
  instance TEXT NOT NULL,
  room TEXT NOT NULL,
  n INT NOT NULL,
  at BIGINT NOT NULL,
  PRIMARY KEY(instance, room)
);
COMMIT;
`;

// Las tablas se crean solas la primera vez. "presence" es la última, así que si existe están todas.
async function ready() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const p = getPool();
      const r = await p.query("SELECT to_regclass('public.presence') AS t");
      if (!r.rows[0].t) await p.query(SCHEMA);
    })().catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

const brokenConnection = (e) => /Connection terminated|ECONNRESET|EPIPE|Client has encountered a connection error|57P01/.test(String(e && (e.code || '')) + ' ' + String(e && e.message));

export async function query(text, params) {
  await ready();
  try {
    return await pool.query(text, params);
  } catch (e) {
    // Tras una pausa del servidor, la primera conexión puede estar muerta: se reintenta una vez.
    if (brokenConnection(e)) return pool.query(text, params);
    throw e;
  }
}
export const all = async (text, params) => (await query(text, params)).rows;
export const one = async (text, params) => (await query(text, params)).rows[0] || null;
export const run = query;

export async function closePool() {
  if (pool) { const p = pool; pool = null; schemaReady = null; await p.end(); }
}
