// Servidor para probar la tienda en tu computadora:  npm start  (o doble clic en iniciar.bat)
// En Vercel este archivo no se usa: allí los archivos de "public" los sirve Vercel y la API vive en "api/".
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import config from './config.js';
import { handle } from './lib/tienda.js';
import { databaseUrl } from './lib/db.js';
import { handleEvents } from './lib/eventos.js';
import { mode as storageMode } from './lib/archivos.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || config.puerto) || 3000;

if (!databaseUrl()) {
  console.error('\n  Falta la dirección de la base de datos (DATABASE_URL).');
  console.error('  Crea un archivo llamado .env junto a este, con una línea así:');
  console.error('    DATABASE_URL=postgresql://usuario:clave@...neon.tech/neondb?sslmode=require');
  console.error('  La encuentras en Vercel > tu proyecto > Storage > tu base de datos Neon.\n');
  process.exit(1);
}

// Las mismas cabeceras de seguridad que vercel.json pone en producción.
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const SECURITY = Object.fromEntries(vercel.headers[0].headers.map((h) => [h.key, h.value]));
// Solo para pruebas con un almacén de archivos alternativo: se le da permiso en la política de contenido.
if (process.env.VERCEL_BLOB_API_URL) {
  const extra = new URL(process.env.VERCEL_BLOB_API_URL).origin;
  SECURITY['Content-Security-Policy'] = SECURITY['Content-Security-Policy'].replace(/(img-src|media-src|connect-src) 'self'/g, `$1 'self' ${extra}`);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
};

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { rel = '/'; }
  let file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC + path.sep) || !path.extname(rel)) file = path.join(PUBLIC, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('No existe'); return; }
    const ext = path.extname(file);
    res.writeHead(200, {
      ...SECURITY,
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': ext === '.woff2' ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const isApi = url.pathname.startsWith('/api/');
  if (!isApi && !url.pathname.startsWith('/media/')) { serveStatic(req, res, url.pathname); return; }

  // Convierte la petición de Node en una petición web estándar, que es lo que entiende la tienda.
  const abort = new AbortController();
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (k === 'x-forwarded-for' || v === undefined) continue;
    headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  }
  const init = { method: req.method, headers, signal: abort.signal };
  if (req.method !== 'GET' && req.method !== 'HEAD') { init.body = Readable.toWeb(req); init.duplex = 'half'; }
  let reader = null;
  res.on('close', () => { abort.abort(); if (reader) reader.cancel().catch(() => {}); });
  try {
    const request = new Request(url, init);
    const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    const response = url.pathname === '/api/events' ? await handleEvents(request) : await handle(request, { ip });
    const out = { ...(isApi ? SECURITY : {}) };
    response.headers.forEach((v, k) => { if (k !== 'set-cookie') out[k] = v; });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) out['set-cookie'] = cookies;
    res.writeHead(response.status, out);
    if (!response.body) { res.end(); return; }
    reader = response.body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!res.write(value)) await new Promise((r) => res.once('drain', r));
    }
    res.end();
  } catch (e) {
    if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: 'Algo falló en el servidor.' })); }
    else res.destroy();
    if (e && e.name !== 'AbortError') console.error(e);
  }
});
server.requestTimeout = 30 * 60_000;

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`\n  El puerto ${PORT} ya está ocupado. ¿La tienda ya está abierta en otra ventana?\n`);
  else console.error(e);
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ${config.nombre} está funcionando (modo prueba, en tu computadora).\n`);
  console.log(`  En esta computadora:   http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) if (n.family === 'IPv4' && !n.internal) console.log(`  En tu misma red wifi:  http://${n.address}:${PORT}`);
  }
  console.log(`\n  Archivos: ${storageMode() === 'blob' ? 'Vercel Blob' : 'carpeta data/uploads de esta computadora'}`);
  console.log('  Para apagarla, cierra esta ventana o pulsa Ctrl + C.\n');
  if (process.env.ABRIR_NAVEGADOR && process.platform === 'win32') exec(`start "" "http://localhost:${PORT}"`);
});

// La limpieza diaria que en Vercel hace el "cron".
const clean = () => handle(new Request(`http://localhost:${PORT}/api/cron/limpieza`, {
  headers: process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {},
})).catch(() => {});
setInterval(clean, 6 * 3600_000).unref();

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
