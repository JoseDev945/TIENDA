// Dónde se guardan fotos, videos y archivos.
//  - En Vercel: en Vercel Blob. El navegador sube el archivo directo a Blob y el servidor solo lo verifica.
//  - En tu computadora, si no hay token de Blob: en la carpeta data/uploads.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { del, head, list } from '@vercel/blob';
import { handleUpload } from '@vercel/blob/client';
import config from '../config.js';
import { fail } from './db.js';

// El token de Blob se llama BLOB_READ_WRITE_TOKEN (o con un prefijo delante, si se eligió uno al crear el almacén).
function token() {
  const env = process.env;
  if (env.BLOB_READ_WRITE_TOKEN) return env.BLOB_READ_WRITE_TOKEN;
  const key = Object.keys(env).find((k) => k.endsWith('READ_WRITE_TOKEN') && String(env[k]).startsWith('vercel_blob_rw_'));
  return key ? env[key] : '';
}
export const mode = () => (token() ? 'blob' : process.env.VERCEL ? 'none' : 'local');

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const localDir = () => path.join(process.env.DATA_DIR || path.join(ROOT, 'data'), 'uploads');
const maxBytes = () => config.maxArchivoMB * 1024 * 1024;
const maxImageBytes = () => config.maxImagenMB * 1024 * 1024;
const newId = () => crypto.randomBytes(12).toString('base64url');
const cleanName = (raw) => String(raw || '').replace(/[\\/\u0000-\u001f"<>|:*?]/g, '_').slice(-120) || 'archivo';
const dimension = (v) => { const n = parseInt(v, 10); return n > 0 && n < 30000 ? n : null; };

// Decide qué es un archivo mirando sus primeros bytes, no su nombre.
export function sniff(buf, declared, name) {
  const ascii = (a, b) => buf.subarray(a, b).toString('latin1');
  const lower = String(name || '').toLowerCase();
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ['image', 'image/jpeg'];
  if (buf.length >= 8 && buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return ['image', 'image/png'];
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return ['image', 'image/gif'];
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return ['image', 'image/webp'];
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return ['audio', 'audio/wav'];
  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (brand === 'avif' || brand === 'avis') return ['image', 'image/avif'];
    if (brand === 'M4A ' || brand === 'M4B ') return ['audio', 'audio/mp4'];
    if (/^(heic|heix|hevc|mif1|msf1)$/.test(brand)) return ['file', 'application/octet-stream'];
    if (brand === 'qt  ') return ['video', 'video/quicktime'];
    return ['video', 'video/mp4'];
  }
  if (buf.length >= 4 && buf.subarray(0, 4).toString('hex') === '1a45dfa3') {
    return /^audio\//.test(declared) ? ['audio', 'audio/webm'] : ['video', 'video/webm'];
  }
  if (ascii(0, 4) === 'OggS') return /^video\//.test(declared) || lower.endsWith('.ogv') ? ['video', 'video/ogg'] : ['audio', 'audio/ogg'];
  if (ascii(0, 4) === 'fLaC') return ['audio', 'audio/flac'];
  if (ascii(0, 3) === 'ID3' || (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0 && /\.mp3$|^audio\/mpeg$/.test(lower + declared))) {
    return ['audio', 'audio/mpeg'];
  }
  return ['file', 'application/octet-stream'];
}

export function downloadUrl(url) {
  if (url.startsWith('/media/')) return url + '?dl';
  return url + (url.includes('?') ? '&' : '?') + 'download=1';
}

// ───────── Vercel Blob ─────────

// Paso 1: el navegador pide permiso para subir. Solo se da a usuarios con sesión y dentro de su propia carpeta.
export async function blobToken(request, user, body) {
  if (mode() !== 'blob') fail(503, 'El almacenamiento de archivos no está conectado. Falta crear el almacén Blob en Vercel con la opción del token de lectura y escritura (BLOB_READ_WRITE_TOKEN).');
  try {
    return await handleUpload({
      request,
      body,
      token: token(),
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith(`u/${user.id}/`)) throw new Error('Ruta no permitida.');
        return {
          maximumSizeInBytes: maxBytes(),
          addRandomSuffix: true,
          // Nada de páginas web: solo fotos, videos, audios y "archivo genérico" (que se entrega como descarga).
          allowedContentTypes: ['image/*', 'video/*', 'audio/*', 'application/octet-stream'],
          tokenPayload: String(user.id),
        };
      },
    });
  } catch (e) {
    fail(400, 'No se pudo preparar la subida: ' + e.message);
  }
}

async function firstBytes(url) {
  const r = await fetch(url, { headers: { Range: 'bytes=0-63' } });
  if (!r.ok || !r.body) return Buffer.alloc(0);
  const reader = r.body.getReader();
  let buf = Buffer.alloc(0);
  while (buf.length < 64) {
    const { value, done } = await reader.read();
    if (done) break;
    buf = Buffer.concat([buf, value]);
  }
  reader.cancel().catch(() => {});
  return buf.subarray(0, 64);
}

// Paso 2: el navegador avisa que terminó. El servidor comprueba que el archivo existe en nuestro almacén,
// que lo subió este usuario, cuánto pesa y qué es en realidad.
export async function blobRegister(user, body) {
  if (mode() !== 'blob') fail(503, 'El almacenamiento de archivos no está conectado.');
  let u;
  try { u = new URL(String(body.url || '')); } catch { fail(400, 'Archivo no válido.'); }
  if (!process.env.VERCEL_BLOB_API_URL) {
    const store = (token().split('_')[3] || '').toLowerCase();
    const okHost = u.protocol === 'https:' && u.hostname.endsWith('.blob.vercel-storage.com') && (!store || u.hostname.startsWith(store + '.'));
    if (!okHost) fail(400, 'Archivo no válido.');
  }
  let pathname = '';
  try { pathname = decodeURIComponent(u.pathname); } catch { /* ruta ilegible */ }
  if (!pathname.startsWith(`/u/${user.id}/`)) fail(400, 'Archivo no válido.');

  let meta;
  try { meta = await head(u.href, { token: token() }); } catch { fail(400, 'No encontramos el archivo subido. Vuelve a intentarlo.'); }
  const reject = async (status, message) => { await del(meta.url, { token: token() }).catch(() => {}); fail(status, message); };
  if (meta.size > maxBytes()) await reject(413, `El archivo pesa demasiado (máximo ${config.maxArchivoMB} MB).`);
  if (meta.size === 0) await reject(400, 'El archivo está vacío.');
  const name = cleanName(body.name);
  const [kind, mime] = sniff(await firstBytes(meta.url), String(meta.contentType || ''), name);
  if (kind === 'image' && meta.size > maxImageBytes()) await reject(413, `La imagen pesa demasiado (máximo ${config.maxImagenMB} MB).`);
  const visual = kind === 'image' || kind === 'video';
  return { id: newId(), kind, mime, name, size: meta.size, w: visual ? dimension(body.w) : null, h: visual ? dimension(body.h) : null, url: meta.url };
}

// Archivos que están en Blob pero no en la base de datos (subidas que nunca se registraron).
export async function blobOrphans(cursor, isKnown) {
  if (mode() !== 'blob') return { deleted: 0, cursor: null };
  const page = await list({ prefix: 'u/', limit: 1000, cursor: cursor || undefined, token: token() });
  const old = page.blobs.filter((b) => Date.now() - new Date(b.uploadedAt).getTime() > 24 * 3600_000);
  const known = await isKnown(old.map((b) => b.url));
  const orphans = old.filter((b) => !known.has(b.url)).map((b) => b.url);
  if (orphans.length) await del(orphans, { token: token() });
  return { deleted: orphans.length, cursor: page.hasMore ? page.cursor : null };
}

// ───────── Carpeta local ─────────

export async function localSave(request, user) {
  if (mode() !== 'local') fail(400, 'En este servidor los archivos se suben directo al almacenamiento.');
  const tooBig = `El archivo pesa demasiado (máximo ${config.maxArchivoMB} MB).`;
  if (Number(request.headers.get('content-length') || 0) > maxBytes()) fail(413, tooBig);
  if (!request.body) fail(400, 'El archivo está vacío.');
  const dir = localDir();
  fs.mkdirSync(dir, { recursive: true });
  const id = newId();
  const tmp = path.join(dir, 'tmp-' + id);
  const out = fs.createWriteStream(tmp);
  let size = 0;
  let headBuf = Buffer.alloc(0);
  try {
    for await (const chunk of request.body) {
      size += chunk.length;
      if (size > maxBytes()) fail(413, tooBig);
      if (headBuf.length < 64) headBuf = Buffer.concat([headBuf, chunk]).subarray(0, 64);
      if (!out.write(chunk)) await once(out, 'drain');
    }
    await new Promise((resolve, reject) => { out.on('error', reject); out.end(resolve); });
    if (size === 0) fail(400, 'El archivo está vacío.');
    let name = '';
    try { name = decodeURIComponent(request.headers.get('x-filename') || ''); } catch { /* nombre ilegible */ }
    name = cleanName(name);
    const [kind, mime] = sniff(headBuf, request.headers.get('content-type') || '', name);
    if (kind === 'image' && size > maxImageBytes()) fail(413, `La imagen pesa demasiado (máximo ${config.maxImagenMB} MB).`);
    const visual = kind === 'image' || kind === 'video';
    await fs.promises.rename(tmp, path.join(dir, id));
    return {
      id, kind, mime, name, size, url: '/media/' + id,
      w: visual ? dimension(request.headers.get('x-width')) : null,
      h: visual ? dimension(request.headers.get('x-height')) : null,
    };
  } catch (e) {
    out.destroy();
    fs.rm(tmp, { force: true }, () => {});
    throw e;
  }
}

export function localServe(request, url, upload) {
  const id = url.pathname.slice('/media/'.length);
  const file = path.join(localDir(), id);
  let stat = null;
  try { stat = upload && /^[\w-]{16}$/.test(id) ? fs.statSync(file) : null; } catch { stat = null; }
  if (!stat) return new Response('No existe', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  const download = upload.kind === 'file' || url.searchParams.has('dl');
  const headers = {
    'Content-Type': upload.mime,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(upload.name)}`,
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'X-Content-Type-Options': 'nosniff',
  };
  let start = 0;
  let end = stat.size - 1;
  let status = 200;
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '');
  if (range && (range[1] || range[2])) {
    if (range[1]) { start = Number(range[1]); if (range[2]) end = Math.min(Number(range[2]), end); }
    else start = Math.max(0, stat.size - Number(range[2]));
    if (start > end || start >= stat.size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
  }
  headers['Content-Length'] = String(end - start + 1);
  if (request.method === 'HEAD') return new Response(null, { status, headers });
  return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), { status, headers });
}

// ───────── Borrado (sirve para los dos) ─────────
export async function removeFiles(uploads) {
  const remote = [];
  for (const u of uploads) {
    if (u.url.startsWith('/media/')) fs.rm(path.join(localDir(), u.id), { force: true }, () => {});
    else remote.push(u.url);
  }
  if (remote.length && mode() === 'blob') {
    for (let i = 0; i < remote.length; i += 100) {
      await del(remote.slice(i, i + 100), { token: token() }).catch((e) => console.error('No se pudo borrar de Blob:', e.message));
    }
  }
}
