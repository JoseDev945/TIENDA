// El servidor de la tienda: cuentas, publicaciones, chat, privados y moderación.
// Recibe una petición web (Request) y devuelve una respuesta (Response), así funciona
// igual en Vercel y en tu computadora.
import crypto from 'node:crypto';
import config from '../config.js';
import { all, one, run, fail, HttpError } from './db.js';
import * as files from './archivos.js';

export const CATEGORIES = [
  'Vehículos', 'Inmuebles', 'Celulares', 'Electrónica', 'Videojuegos', 'Hogar y muebles',
  'Ropa y accesorios', 'Deportes', 'Herramientas', 'Juguetes y bebés', 'Mascotas', 'Servicios', 'Otros',
];
const CONDITIONS = ['nuevo', 'como_nuevo', 'buen_estado', 'usado'];
const RESERVED = new Set([
  'admin', 'administrador', 'administrator', 'moderador', 'mod', 'soporte', 'support', 'sistema',
  'system', 'oficial', 'staff', 'ayuda', 'root', 'null', 'undefined', 'anonimo', 'eliminado',
]);
const USER_COLORS = 12;

// La otra mitad (lib/eventos.js) se engancha aquí para entregar los avisos sin esperar.
export const hooks = { kick: null };

// ───────────────────────────── Utilidades ─────────────────────────────
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const normalize = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const cleanText = (v, max) => (typeof v === 'string' ? v.replace(/\u0000/g, '').replace(/\r\n/g, '\n').trim().slice(0, max) : '');
const oneLine = (v, max) => cleanText(v, max * 2).replace(/\s+/g, ' ').slice(0, max);
const likeArg = (s) => '%' + s.replace(/[\\%_]/g, '\\$&') + '%';
const intParam = (v) => { const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 2147483647) fail(404, 'No existe.'); return n; };

function extraAdmins() {
  const fromEnv = String(process.env.ADMINS || '').split(',');
  return [...(Array.isArray(config.admins) ? config.admins : []), ...fromEnv].map((n) => String(n).trim().toLowerCase()).filter(Boolean);
}
export const isAdmin = (user) => !!user && (user.is_admin || extraAdmins().includes(user.ukey));

function newAccessCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += alphabet[crypto.randomInt(alphabet.length)];
    if (i === 3 || i === 7) out += '-';
  }
  return out;
}
const codeHash = (code) => sha256('codigo:' + String(code).toUpperCase().replace(/[^A-Z0-9]/g, ''));

// Límite de frecuencia (anti-spam). Se lleva en la base de datos para que valga entre todas las instancias.
async function limit(key, max, windowMs, message) {
  const now = Date.now();
  const r = await one(`
    INSERT INTO limits(key, n, reset) VALUES($1, 1, $2)
    ON CONFLICT(key) DO UPDATE SET
      n = CASE WHEN limits.reset < $3 THEN 1 ELSE limits.n + 1 END,
      reset = CASE WHEN limits.reset < $3 THEN $2 ELSE limits.reset END
    RETURNING n`, [key, now + windowMs, now]);
  if (r.n > max) fail(429, message || 'Vas muy rápido. Espera un momento y vuelve a intentarlo.');
}

function parseCookies(request) {
  const out = {};
  for (const part of String(request.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
function sessionCookie(request, token, maxAge) {
  const https = request.headers.get('x-forwarded-proto') === 'https' || new URL(request.url).protocol === 'https:';
  return `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${https ? '; Secure' : ''}`;
}
async function startSession(ctx, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await run('INSERT INTO sessions(token_hash, user_id, created_at) VALUES($1,$2,$3)', [sha256(token), userId, Date.now()]);
  ctx.headers.append('Set-Cookie', sessionCookie(ctx.request, token, 60 * 60 * 24 * 365));
}
export async function currentUser(request) {
  const sid = parseCookies(request).sid;
  if (!sid) return null;
  return one('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1', [sha256(sid)]);
}

function json(status, data, headers) {
  const h = headers || new Headers();
  h.set('Content-Type', 'application/json; charset=utf-8');
  h.set('Cache-Control', 'no-store');
  h.set('X-Content-Type-Options', 'nosniff');
  return new Response(JSON.stringify(data), { status, headers: h });
}

// ───────────────────────────── Avisos en vivo ─────────────────────────────
// Cada aviso se guarda en la tabla "events"; las conexiones en vivo los recogen de ahí.
async function emit(room, userId, type, data) {
  await run('INSERT INTO events(room, user_id, type, data, created_at) VALUES($1,$2,$3,$4::jsonb,$5)', [room, userId, type, JSON.stringify(data), Date.now()]);
  if (hooks.kick) hooks.kick();
}

// ───────────────────────────── Salida de datos ─────────────────────────────
const pubUser = (id, username, color, avatar) => (username == null
  ? { id: 0, username: 'eliminado', color: 0, avatar: null }
  : { id, username, color, avatar: avatar || null });
const userOut = (u) => pubUser(u.id, u.username, u.color, u.avatar_url);
const uploadOut = (u) => ({ id: u.id, kind: u.kind, mime: u.mime, name: u.name, size: u.size, w: u.w, h: u.h, url: u.url, download: files.downloadUrl(u.url) });

async function uploadsMap(ids) {
  const map = new Map();
  const unique = [...new Set(ids)].filter((id) => typeof id === 'string');
  if (unique.length) for (const u of await all('SELECT * FROM uploads WHERE id = ANY($1::text[])', [unique])) map.set(u.id, u);
  return map;
}
async function reactionsMap(targets) {
  const out = {};
  if (!targets.length) return out;
  const rows = await all('SELECT target, emoji, user_id FROM reactions WHERE target = ANY($1::text[]) ORDER BY created_at', [targets]);
  for (const r of rows) ((out[r.target] ||= {})[r.emoji] ||= []).push(r.user_id);
  return out;
}

function excerpt(body, attachments) {
  if (body) return body.replace(/\s+/g, ' ').slice(0, 120);
  const n = (attachments || []).length;
  return n ? (n === 1 ? 'Archivo adjunto' : n + ' archivos adjuntos') : '';
}

const MESSAGE_SQL = 'SELECT m.*, u.username, u.color, u.avatar_url FROM messages m LEFT JOIN users u ON u.id = m.user_id';

async function messagesOut(rows) {
  if (!rows.length) return [];
  const replyIds = [...new Set(rows.map((m) => m.reply_to).filter(Boolean))];
  const [ups, rx, replies] = await Promise.all([
    uploadsMap(rows.flatMap((m) => m.attachments)),
    reactionsMap(rows.map((m) => 'm' + m.id)),
    replyIds.length
      ? all('SELECT m.id, m.room, m.body, m.attachments, u.username FROM messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.id = ANY($1::int[])', [replyIds])
      : [],
  ]);
  const replyMap = new Map(replies.map((r) => [r.id, r]));
  return rows.map((m) => {
    let replyTo = null;
    if (m.reply_to) {
      const r = replyMap.get(m.reply_to);
      replyTo = r && r.room === m.room
        ? { id: r.id, username: r.username || 'eliminado', excerpt: excerpt(r.body, r.attachments) }
        : { id: m.reply_to, deleted: true };
    }
    return {
      id: m.id,
      room: m.room,
      user: pubUser(m.user_id, m.username, m.color, m.avatar_url),
      body: m.body,
      attachments: m.attachments.map((id) => ups.get(id)).filter(Boolean).map(uploadOut),
      replyTo,
      createdAt: m.created_at,
      reactions: rx['m' + m.id] || {},
    };
  });
}

// $1 es siempre el id de quien mira (o null si no tiene sesión).
const LISTING_SQL = `
  SELECT l.*, u.username AS s_username, u.color AS s_color, u.avatar_url AS s_avatar,
    (SELECT COUNT(*) FROM messages m WHERE m.room = 'l' || l.id::text) AS message_count,
    EXISTS(SELECT 1 FROM saved s WHERE s.user_id = $1::int AND s.listing_id = l.id) AS saved,
    CASE WHEN l.user_id = $1::int
      THEN (SELECT COUNT(*) FROM messages m WHERE m.room = 'l' || l.id::text AND m.id > l.owner_read AND m.user_id <> l.user_id)
      ELSE 0 END AS unread
  FROM listings l JOIN users u ON u.id = l.user_id`;

async function listingsOut(rows, me, full) {
  if (!rows.length) return [];
  const [ups, rx] = await Promise.all([
    uploadsMap(rows.flatMap((l) => (full ? l.media : l.media.slice(0, 1)))),
    full ? reactionsMap(rows.map((l) => 'l' + l.id)) : {},
  ]);
  return rows.map((l) => {
    const media = (full ? l.media : l.media.slice(0, 1)).map((id) => ups.get(id)).filter(Boolean).map(uploadOut);
    const out = {
      id: l.id,
      kind: l.kind,
      title: l.title,
      price: l.price == null ? null : l.price / 100,
      category: l.category,
      condition: l.condition,
      location: l.location,
      status: l.status,
      createdAt: l.created_at,
      seller: pubUser(l.user_id, l.s_username, l.s_color, l.s_avatar),
      cover: media[0] || null,
      mediaCount: l.media.length,
      messageCount: l.message_count,
      saved: !!l.saved,
    };
    if (me && me.id === l.user_id) out.unread = l.unread;
    if (full) {
      out.description = l.description;
      out.media = media;
      out.updatedAt = l.updated_at;
      out.reactions = rx['l' + l.id] || {};
      out.canEdit = !!me && me.id === l.user_id;
      out.canModerate = !!me && (me.id === l.user_id || isAdmin(me));
    }
    return out;
  });
}
async function listingFull(id, me) {
  const rows = await all(LISTING_SQL + " WHERE l.id = $2 AND l.status <> 'eliminada'", [me ? me.id : null, id]);
  if (!rows.length) fail(404, 'Esta publicación ya no existe.');
  return (await listingsOut(rows, me, true))[0];
}

async function unreadFor(user) {
  const r = await one(`
    SELECT
      (SELECT COUNT(*) FROM dms d WHERE
        (d.a = $1 AND EXISTS(SELECT 1 FROM messages m WHERE m.room = 'd' || d.id::text AND m.id > d.a_read AND m.user_id <> $1))
        OR (d.b = $1 AND EXISTS(SELECT 1 FROM messages m WHERE m.room = 'd' || d.id::text AND m.id > d.b_read AND m.user_id <> $1))) AS dms,
      (SELECT COUNT(*) FROM listings l WHERE l.user_id = $1 AND l.status <> 'eliminada'
        AND EXISTS(SELECT 1 FROM messages m WHERE m.room = 'l' || l.id::text AND m.id > l.owner_read AND m.user_id <> $1)) AS listings`,
  [user.id]);
  return { dms: r.dms, listings: r.listings };
}

async function meOut(user) {
  return {
    user: user ? { ...userOut(user), bio: user.bio, admin: isAdmin(user), banned: !!user.banned } : null,
    unread: user ? await unreadFor(user) : { dms: 0, listings: 0 },
  };
}

// ───────────────────────────── Archivos ─────────────────────────────
async function storeUpload(user, f) {
  try {
    await run('INSERT INTO uploads(id, user_id, kind, mime, name, size, w, h, url, created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [f.id, user.id, f.kind, f.mime, f.name, f.size, f.w, f.h, f.url, Date.now()]);
  } catch (e) {
    if (e.code === '23505') fail(400, 'Ese archivo ya estaba registrado.');
    throw e;
  }
  return uploadOut(f);
}

async function removeUploads(ids) {
  const list = [...new Set(ids)].filter((id) => typeof id === 'string');
  if (!list.length) return;
  const rows = await all('DELETE FROM uploads WHERE id = ANY($1::text[]) RETURNING id, url', [list]);
  await files.removeFiles(rows);
}

// Comprueba que los archivos sean del usuario y no estén ya usados en otro sitio.
async function claimUploads(ids, user, already, max, kinds) {
  if (!Array.isArray(ids)) fail(400, 'Lista de archivos no válida.');
  if (ids.length > max) fail(400, `Máximo ${max} archivos.`);
  if (ids.some((id) => typeof id !== 'string')) fail(400, 'Archivo no válido.');
  const unique = [...new Set(ids)];
  const map = await uploadsMap(unique);
  for (const id of unique) {
    const u = map.get(id);
    if (!u) fail(400, 'Uno de los archivos ya no existe. Vuelve a subirlo.');
    if (kinds && !kinds.includes(u.kind)) fail(400, 'Aquí solo se pueden poner fotos y videos.');
    if (!already.includes(id) && (u.user_id !== user.id || u.used)) fail(400, 'Archivo no válido.');
  }
  return unique;
}
const markUsed = (ids) => (ids.length ? run('UPDATE uploads SET used = TRUE WHERE id = ANY($1::text[])', [ids]) : null);

// ───────────────────────────── Salas de chat ─────────────────────────────
// 'l12' = chat de la publicación 12, 'd5' = conversación privada 5.
export async function roomAccess(room, user) {
  const m = /^([ld])(\d{1,9})$/.exec(String(room));
  if (!m) fail(404, 'Ese chat no existe.');
  const id = Number(m[2]);
  if (m[1] === 'l') {
    const listing = await one("SELECT id, user_id, title, status FROM listings WHERE id = $1 AND status <> 'eliminada'", [id]);
    if (!listing) fail(404, 'Esta publicación ya no existe.');
    return { type: 'l', listing, canModerate: !!user && (user.id === listing.user_id || isAdmin(user)) };
  }
  const thread = user ? await one('SELECT * FROM dms WHERE id = $1 AND (a = $2 OR b = $2)', [id, user.id]) : null;
  if (!thread) fail(404, 'Esa conversación no existe.');
  return { type: 'd', thread, canModerate: false };
}

async function markRead(room, acc, user, lastId) {
  if (lastId == null) lastId = (await one('SELECT COALESCE(MAX(id), 0) AS id FROM messages WHERE room = $1', [room])).id;
  if (acc.type === 'l') {
    if (acc.listing.user_id === user.id) await run('UPDATE listings SET owner_read = GREATEST(owner_read, $1) WHERE id = $2', [lastId, acc.listing.id]);
  } else {
    const col = acc.thread.a === user.id ? 'a_read' : 'b_read';
    await run(`UPDATE dms SET ${col} = GREATEST(${col}, $1) WHERE id = $2`, [lastId, acc.thread.id]);
  }
}

// ───────────────────────────── Rutas ─────────────────────────────
const routes = [];
function route(method, pattern, handler, opts = {}) {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, rx, keys, handler, opts });
}
const AUTH = { auth: true };
const ADMIN = { auth: true, admin: true };

// ── Sesión y cuentas ──
function validUsername(raw) {
  const username = typeof raw === 'string' ? raw.trim() : '';
  if (username.length < 3 || username.length > 20) return { error: 'Debe tener entre 3 y 20 caracteres.' };
  if (!/^[A-Za-z0-9._-]+$/.test(username)) return { error: 'Solo letras sin tilde, números, punto, guion y guion bajo. Sin espacios.' };
  if (!/^[A-Za-z0-9]/.test(username) || !/[A-Za-z0-9]$/.test(username)) return { error: 'Debe empezar y terminar con una letra o un número.' };
  const ukey = username.toLowerCase();
  if (RESERVED.has(ukey) || ukey === normalize(config.nombre)) return { error: 'Ese nombre está reservado.' };
  return { username, ukey };
}

route('GET', '/api/me', async ({ user }) => ({
  ...(await meOut(user)),
  site: {
    name: config.nombre, currency: config.simboloMoneda, locale: config.formatoRegional, categories: CATEGORIES,
    maxFileMB: config.maxArchivoMB, maxImageMB: config.maxImagenMB, uploads: files.mode(),
  },
}));

route('GET', '/api/username-check', async ({ url }) => {
  const v = validUsername(url.searchParams.get('u'));
  if (v.error) return { available: false, reason: v.error };
  if (await one('SELECT 1 FROM users WHERE ukey = $1', [v.ukey])) return { available: false, reason: 'Ese nombre ya está en uso.' };
  return { available: true };
});

route('POST', '/api/register', async (ctx) => {
  await limit('registro:' + ctx.ip, 10, 3600_000, 'Se crearon demasiadas cuentas desde esta conexión. Inténtalo más tarde.');
  const v = validUsername(ctx.body.username);
  if (v.error) fail(400, v.error);
  const code = newAccessCode();
  let user;
  try {
    // La primera cuenta que se crea queda como administradora.
    user = await one(`INSERT INTO users(username, ukey, color, code_hash, is_admin, created_at)
      VALUES($1, $2, $3, $4, NOT EXISTS(SELECT 1 FROM users), $5) RETURNING *`,
    [v.username, v.ukey, crypto.randomInt(USER_COLORS), codeHash(code), Date.now()]);
  } catch (e) {
    if (e.code === '23505') fail(409, 'Ese nombre ya está en uso. Prueba con otro.');
    throw e;
  }
  await startSession(ctx, user.id);
  return { ...(await meOut(user)), accessCode: code };
});

route('POST', '/api/login', async (ctx) => {
  await limit('entrar:' + ctx.ip, 10, 10 * 60_000, 'Demasiados intentos. Espera 10 minutos.');
  const user = await one('SELECT * FROM users WHERE ukey = $1', [String(ctx.body.username || '').trim().toLowerCase()]);
  const given = Buffer.from(codeHash(ctx.body.code || ''));
  const real = Buffer.from(user ? user.code_hash : codeHash('x'));
  if (!user || !crypto.timingSafeEqual(given, real)) fail(401, 'El usuario o el código de acceso no coinciden.');
  if (user.banned) fail(403, 'Esta cuenta está suspendida.');
  await startSession(ctx, user.id);
  return meOut(user);
});

route('POST', '/api/logout', async (ctx) => {
  const sid = parseCookies(ctx.request).sid;
  if (sid) await run('DELETE FROM sessions WHERE token_hash = $1', [sha256(sid)]);
  ctx.headers.append('Set-Cookie', sessionCookie(ctx.request, '', 0));
  return { ok: true };
});

route('POST', '/api/me/access-code', async (ctx) => {
  await limit('codigo:' + ctx.user.id, 5, 3600_000);
  const code = newAccessCode();
  await run('UPDATE users SET code_hash = $1 WHERE id = $2', [codeHash(code), ctx.user.id]);
  // El código nuevo cierra la sesión en los demás dispositivos.
  await run('DELETE FROM sessions WHERE user_id = $1', [ctx.user.id]);
  await startSession(ctx, ctx.user.id);
  return { accessCode: code };
}, AUTH);

route('PATCH', '/api/me', async ({ user, body }) => {
  if (typeof body.bio === 'string') await run('UPDATE users SET bio = $1 WHERE id = $2', [cleanText(body.bio, 300), user.id]);
  if (body.avatar !== undefined) {
    let avatar = null;
    let avatarUrl = null;
    if (body.avatar) {
      const [id] = await claimUploads([body.avatar], user, [], 1, ['image']);
      await markUsed([id]);
      avatar = id;
      avatarUrl = (await one('SELECT url FROM uploads WHERE id = $1', [id])).url;
    }
    await run('UPDATE users SET avatar = $1, avatar_url = $2 WHERE id = $3', [avatar, avatarUrl, user.id]);
    if (user.avatar && user.avatar !== avatar) await removeUploads([user.avatar]);
  }
  return meOut(await one('SELECT * FROM users WHERE id = $1', [user.id]));
}, AUTH);

route('GET', '/api/users/:username', async ({ params, user }) => {
  let name = '';
  try { name = decodeURIComponent(params.username).toLowerCase(); } catch { /* nombre ilegible */ }
  const u = await one(`SELECT u.*,
      (SELECT COUNT(*) FROM listings l WHERE l.user_id = u.id AND l.status = 'activa') AS active,
      (SELECT COUNT(*) FROM listings l WHERE l.user_id = u.id AND l.status = 'vendida') AS sold
    FROM users u WHERE u.ukey = $1`, [name]);
  if (!u) fail(404, 'Ese usuario no existe.');
  return {
    user: { ...userOut(u), bio: u.bio, createdAt: u.created_at, banned: !!u.banned, admin: isAdmin(u) },
    active: u.active,
    sold: u.sold,
    isMe: !!user && user.id === u.id,
  };
});

// ── Archivos ──
// En Vercel (Blob): el navegador pide permiso, sube directo y luego registra el archivo.
route('POST', '/api/uploads/token', async ({ request, user, body }) => {
  if (body.type === 'blob.generate-client-token') await limit('subida:' + user.id, 60, 10 * 60_000, 'Subiste muchos archivos seguidos. Espera unos minutos.');
  return files.blobToken(request, user, body);
}, AUTH);
route('POST', '/api/uploads/register', async ({ user, body }) => storeUpload(user, await files.blobRegister(user, body)), AUTH);
// En tu computadora: el archivo llega entero al servidor.
route('POST', '/api/uploads', async ({ request, user }) => {
  await limit('subida:' + user.id, 60, 10 * 60_000, 'Subiste muchos archivos seguidos. Espera unos minutos.');
  return storeUpload(user, await files.localSave(request, user));
}, { auth: true, raw: true });

// ── Publicaciones ──
async function parseListing(body, user, existing) {
  const kind = body.kind === 'busco' ? 'busco' : 'venta';
  const title = oneLine(body.title, 100);
  if (title.length < 3) fail(400, 'Escribe un título de al menos 3 letras.');
  let price = null;
  if (body.price !== null && body.price !== undefined && body.price !== '') {
    const n = Number(body.price);
    if (!Number.isFinite(n) || n < 0 || n > 999_999_999) fail(400, 'El precio no es válido.');
    price = Math.round(n * 100);
  }
  if (!CATEGORIES.includes(body.category)) fail(400, 'Elige una categoría.');
  const condition = CONDITIONS.includes(body.condition) ? body.condition : '';
  const location = oneLine(body.location, 80);
  const description = cleanText(body.description, 5000);
  const already = existing ? existing.media : [];
  const media = await claimUploads(body.media || [], user, already, 10, ['image', 'video']);
  if (kind === 'venta' && media.length === 0) fail(400, 'Agrega al menos una foto de lo que vendes.');
  const search = normalize([title, description, body.category, location].join(' '));
  return { kind, title, price, category: body.category, condition, location, description, media, search, already };
}

route('GET', '/api/listings', async ({ url, user }) => {
  const p = url.searchParams;
  const args = [user ? user.id : null];
  const arg = (v) => { args.push(v); return '$' + args.length; };
  const where = ['u.banned = FALSE'];
  if (p.get('user')) {
    where.push(`u.ukey = ${arg(p.get('user').toLowerCase())}`, "l.status <> 'eliminada'");
  } else if (p.get('saved') && user) {
    where.push('EXISTS(SELECT 1 FROM saved sv WHERE sv.user_id = $1::int AND sv.listing_id = l.id)', "l.status <> 'eliminada'");
  } else {
    where.push("l.status = 'activa'");
  }
  for (const word of normalize(p.get('q') || '').split(/\s+/).filter(Boolean).slice(0, 6)) where.push(`l.search LIKE ${arg(likeArg(word))}`);
  if (CATEGORIES.includes(p.get('cat'))) where.push(`l.category = ${arg(p.get('cat'))}`);
  if (p.get('kind') === 'venta' || p.get('kind') === 'busco') where.push(`l.kind = ${arg(p.get('kind'))}`);
  const min = parseFloat(p.get('min'));
  const max = parseFloat(p.get('max'));
  if (Number.isFinite(min) && Math.abs(min) < 1e12) where.push(`l.price >= ${arg(Math.round(min * 100))}`);
  if (Number.isFinite(max) && Math.abs(max) < 1e12) where.push(`l.price <= ${arg(Math.round(max * 100))}`);
  if (p.get('loc')) where.push(`l.search LIKE ${arg(likeArg(normalize(p.get('loc'))))}`);
  const order = {
    precio_asc: 'l.price ASC NULLS LAST, l.id DESC',
    precio_desc: 'l.price DESC NULLS LAST, l.id DESC',
  }[p.get('sort')] || 'l.created_at DESC, l.id DESC';
  const size = 24;
  const offset = Math.min(Math.max(0, parseInt(p.get('offset'), 10) || 0), 100000);
  const rows = await all(`${LISTING_SQL} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${size + 1} OFFSET ${offset}`, args);
  return { items: await listingsOut(rows.slice(0, size), user, false), hasMore: rows.length > size };
});

route('POST', '/api/listings', async ({ user, body }) => {
  await limit('publicar:' + user.id, 15, 3600_000, 'Publicaste muchas cosas seguidas. Espera un rato.');
  const d = await parseListing(body, user, null);
  const now = Date.now();
  const row = await one(`INSERT INTO listings(user_id, kind, title, price, category, condition, location, description, media, search, created_at, updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$11) RETURNING id`,
  [user.id, d.kind, d.title, d.price, d.category, d.condition, d.location, d.description, JSON.stringify(d.media), d.search, now]);
  await markUsed(d.media);
  return listingFull(row.id, user);
}, AUTH);

async function ownListing(params, user) {
  const l = await one("SELECT * FROM listings WHERE id = $1 AND status <> 'eliminada'", [intParam(params.id)]);
  if (!l) fail(404, 'Esta publicación ya no existe.');
  if (l.user_id !== user.id && !isAdmin(user)) fail(403, 'Solo quien publicó puede hacer esto.');
  return l;
}

route('GET', '/api/listings/:id', ({ params, user }) => listingFull(intParam(params.id), user));

route('PATCH', '/api/listings/:id', async ({ params, user, body }) => {
  const l = await ownListing(params, user);
  if (body.status !== undefined) {
    if (body.status !== 'activa' && body.status !== 'vendida') fail(400, 'Estado no válido.');
    await run('UPDATE listings SET status = $1, updated_at = $2 WHERE id = $3', [body.status, Date.now(), l.id]);
  } else {
    if (l.user_id !== user.id) fail(403, 'Solo quien publicó puede editar.');
    const d = await parseListing(body, user, l);
    await run(`UPDATE listings SET kind=$1, title=$2, price=$3, category=$4, condition=$5, location=$6, description=$7, media=$8::jsonb, search=$9, updated_at=$10 WHERE id=$11`,
      [d.kind, d.title, d.price, d.category, d.condition, d.location, d.description, JSON.stringify(d.media), d.search, Date.now(), l.id]);
    await markUsed(d.media);
    await removeUploads(d.already.filter((m) => !d.media.includes(m)));
  }
  const out = await listingFull(l.id, user);
  await emit('l' + l.id, null, 'listing', { id: l.id, status: out.status });
  return out;
}, AUTH);

async function deleteListing(l) {
  const room = 'l' + l.id;
  const msgs = await all('DELETE FROM messages WHERE room = $1 RETURNING id, attachments', [room]);
  const targets = [room, ...msgs.map((m) => 'm' + m.id)];
  await run('DELETE FROM reactions WHERE target = ANY($1::text[])', [targets]);
  await run('DELETE FROM saved WHERE listing_id = $1', [l.id]);
  await run("UPDATE listings SET status = 'eliminada', media = '[]'::jsonb, updated_at = $1 WHERE id = $2", [Date.now(), l.id]);
  await removeUploads([...l.media, ...msgs.flatMap((m) => m.attachments)]);
  await emit(room, null, 'listing', { id: l.id, status: 'eliminada' });
}

route('DELETE', '/api/listings/:id', async ({ params, user }) => {
  await deleteListing(await ownListing(params, user));
  return { ok: true };
}, AUTH);

route('POST', '/api/listings/:id/save', async ({ params, user }) => {
  const id = intParam(params.id);
  if (!(await one("SELECT 1 FROM listings WHERE id = $1 AND status <> 'eliminada'", [id]))) fail(404, 'Esta publicación ya no existe.');
  const removed = await one('DELETE FROM saved WHERE user_id = $1 AND listing_id = $2 RETURNING 1 AS x', [user.id, id]);
  if (removed) return { saved: false };
  await run('INSERT INTO saved(user_id, listing_id, created_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [user.id, id, Date.now()]);
  return { saved: true };
}, AUTH);

// ── Chat (publicaciones y privados comparten el mismo código) ──
route('GET', '/api/rooms/:room/messages', async ({ params, url, user }) => {
  const room = params.room;
  const acc = await roomAccess(room, user);
  const before = parseInt(url.searchParams.get('before'), 10);
  const older = Number.isInteger(before) && before > 0 && before < 2147483647;
  const size = 50;
  const rows = older
    ? await all(`${MESSAGE_SQL} WHERE m.room = $1 AND m.id < $2 ORDER BY m.id DESC LIMIT ${size + 1}`, [room, before])
    : await all(`${MESSAGE_SQL} WHERE m.room = $1 ORDER BY m.id DESC LIMIT ${size + 1}`, [room]);
  const page = rows.slice(0, size).reverse();
  if (user && !older) await markRead(room, acc, user, page.length ? page[page.length - 1].id : 0);
  return { messages: await messagesOut(page), hasMore: rows.length > size };
});

route('POST', '/api/rooms/:room/messages', async ({ params, user, body }) => {
  const room = params.room;
  const acc = await roomAccess(room, user);
  await limit('mensaje:' + user.id, 10, 10_000, 'Estás enviando mensajes muy rápido. Espera unos segundos.');
  const text = cleanText(body.body, 2000);
  const attachments = await claimUploads(body.attachments || [], user, [], 10);
  if (!text && attachments.length === 0) fail(400, 'Escribe algo o adjunta un archivo.');
  let replyTo = null;
  const replyId = Number(body.replyTo);
  if (Number.isInteger(replyId) && replyId > 0 && replyId < 2147483647) {
    const r = await one('SELECT id FROM messages WHERE id = $1 AND room = $2', [replyId, room]);
    if (r) replyTo = r.id;
  }
  const now = Date.now();
  const { id } = await one('INSERT INTO messages(room, user_id, body, attachments, reply_to, created_at) VALUES($1,$2,$3,$4::jsonb,$5,$6) RETURNING id',
    [room, user.id, text, JSON.stringify(attachments), replyTo, now]);
  await markUsed(attachments);
  const [out] = await messagesOut(await all(`${MESSAGE_SQL} WHERE m.id = $1`, [id]));
  await emit(room, null, 'message', out);
  await markRead(room, acc, user, id);

  const preview = { room, from: out.user, excerpt: excerpt(text, attachments) };
  if (acc.type === 'd') {
    await run('UPDATE dms SET last_at = $1 WHERE id = $2', [now, acc.thread.id]);
    const other = acc.thread.a === user.id ? acc.thread.b : acc.thread.a;
    await emit(null, other, 'notify', { ...preview, type: 'dm', threadId: acc.thread.id });
  } else if (acc.listing.user_id !== user.id) {
    await emit(null, acc.listing.user_id, 'notify', { ...preview, type: 'listing', listingId: acc.listing.id, title: acc.listing.title });
  }
  return out;
}, AUTH);

route('POST', '/api/rooms/:room/read', async ({ params, user }) => {
  await markRead(params.room, await roomAccess(params.room, user), user, null);
  return { unread: await unreadFor(user) };
}, AUTH);

route('DELETE', '/api/messages/:id', async ({ params, user }) => {
  const m = await one('SELECT * FROM messages WHERE id = $1', [intParam(params.id)]);
  if (!m) return { ok: true };
  const acc = await roomAccess(m.room, user);
  if (m.user_id !== user.id && !acc.canModerate && !isAdmin(user)) fail(403, 'No puedes borrar este mensaje.');
  await run('DELETE FROM messages WHERE id = $1', [m.id]);
  await run('DELETE FROM reactions WHERE target = $1', ['m' + m.id]);
  await removeUploads(m.attachments);
  await emit(m.room, null, 'message-delete', { room: m.room, id: m.id });
  return { ok: true };
}, AUTH);

route('POST', '/api/react', async ({ user, body }) => {
  await limit('reaccion:' + user.id, 40, 60_000);
  const target = String(body.target || '');
  const emoji = String(body.emoji || '');
  if (emoji.length > 24 || !/^(?:\p{Extended_Pictographic}|\p{Regional_Indicator})/u.test(emoji) || /[\s<>&"'a-zA-Z0-9]/.test(emoji)) fail(400, 'Esa reacción no es válida.');
  const t = /^([lm])(\d{1,9})$/.exec(target);
  if (!t) fail(400, 'No se puede reaccionar a eso.');
  let room = target;
  if (t[1] === 'm') {
    const m = await one('SELECT room FROM messages WHERE id = $1', [Number(t[2])]);
    if (!m) fail(404, 'Ese mensaje ya no existe.');
    room = m.room;
  }
  await roomAccess(room, user);
  const removed = await one('DELETE FROM reactions WHERE target = $1 AND user_id = $2 AND emoji = $3 RETURNING 1 AS x', [target, user.id, emoji]);
  if (!removed) {
    const kinds = await all('SELECT DISTINCT emoji FROM reactions WHERE target = $1', [target]);
    if (kinds.length >= 20 && !kinds.some((k) => k.emoji === emoji)) fail(400, 'Este mensaje ya tiene muchas reacciones distintas.');
    await run('INSERT INTO reactions(target, user_id, emoji, created_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [target, user.id, emoji, Date.now()]);
  }
  const reactions = (await reactionsMap([target]))[target] || {};
  await emit(room, null, 'reactions', { room, target, reactions });
  return { target, reactions };
}, AUTH);

// ── Mensajes privados ──
const THREAD_SQL = `
  SELECT d.*, o.username AS o_username, o.color AS o_color, o.avatar_url AS o_avatar,
    lm.id AS lm_id, lm.body AS lm_body, lm.attachments AS lm_attachments, lm.user_id AS lm_user, lm.created_at AS lm_at,
    l.title AS l_title, l.price AS l_price, l.status AS l_status, l.kind AS l_kind, l.media AS l_media
  FROM dms d
  JOIN users o ON o.id = CASE WHEN d.a = $1 THEN d.b ELSE d.a END
  LEFT JOIN LATERAL (SELECT * FROM messages m WHERE m.room = 'd' || d.id::text ORDER BY m.id DESC LIMIT 1) lm ON TRUE
  LEFT JOIN listings l ON l.id = d.listing_id AND l.status <> 'eliminada'
  WHERE (d.a = $1 OR d.b = $1)`;

async function threadsOut(rows, me) {
  const covers = await uploadsMap(rows.map((t) => (t.l_media || [])[0]).filter(Boolean));
  return rows.map((t) => {
    const read = t.a === me.id ? t.a_read : t.b_read;
    const cover = t.l_media && covers.get(t.l_media[0]);
    return {
      id: t.id,
      room: 'd' + t.id,
      other: pubUser(t.a === me.id ? t.b : t.a, t.o_username, t.o_color, t.o_avatar),
      listing: t.l_title == null ? null : {
        id: t.listing_id, title: t.l_title, price: t.l_price == null ? null : t.l_price / 100, status: t.l_status, kind: t.l_kind,
        cover: cover ? uploadOut(cover) : null,
      },
      last: t.lm_id ? { excerpt: excerpt(t.lm_body, t.lm_attachments), mine: t.lm_user === me.id, createdAt: t.lm_at } : null,
      unread: !!t.lm_id && t.lm_id > read && t.lm_user !== me.id,
    };
  });
}
async function threadOut(id, me) {
  const rows = await all(THREAD_SQL + ' AND d.id = $2', [me.id, id]);
  if (!rows.length) fail(404, 'Esa conversación no existe.');
  return (await threadsOut(rows, me))[0];
}

route('GET', '/api/dms', async ({ user }) => ({
  threads: await threadsOut(await all(THREAD_SQL + ' AND d.last_at IS NOT NULL ORDER BY d.last_at DESC LIMIT 200', [user.id]), user),
}), AUTH);

route('GET', '/api/dms/:id', ({ params, user }) => threadOut(intParam(params.id), user), AUTH);

route('POST', '/api/dms', async ({ user, body }) => {
  const other = await one('SELECT id FROM users WHERE ukey = $1', [String(body.username || '').toLowerCase()]);
  if (!other) fail(404, 'Ese usuario no existe.');
  if (other.id === user.id) fail(400, 'No puedes escribirte a ti mismo.');
  const a = Math.min(user.id, other.id);
  const b = Math.max(user.id, other.id);
  const lid = Number(body.listingId);
  const listing = Number.isInteger(lid) && lid > 0 && lid < 2147483647
    ? await one("SELECT id FROM listings WHERE id = $1 AND status <> 'eliminada'", [lid]) : null;
  let t = await one('SELECT * FROM dms WHERE a = $1 AND b = $2', [a, b]);
  if (!t) {
    await limit('privado-nuevo:' + user.id, 30, 3600_000, 'Abriste muchas conversaciones nuevas. Espera un rato.');
    await run('INSERT INTO dms(a, b, listing_id, created_at) VALUES($1,$2,$3,$4) ON CONFLICT(a, b) DO NOTHING', [a, b, listing ? listing.id : null, Date.now()]);
    t = await one('SELECT * FROM dms WHERE a = $1 AND b = $2', [a, b]);
  } else if (listing && t.listing_id !== listing.id) {
    await run('UPDATE dms SET listing_id = $1 WHERE id = $2', [listing.id, t.id]);
  }
  return threadOut(t.id, user);
}, AUTH);

// ── Reportes y moderación ──
route('POST', '/api/reports', async ({ user, body }) => {
  await limit('reporte:' + user.id, 20, 3600_000);
  const target = String(body.target || '');
  if (!/^[lmu]\d{1,9}$/.test(target)) fail(400, 'No se puede reportar eso.');
  await run('INSERT INTO reports(user_id, target, reason, created_at) VALUES($1,$2,$3,$4)', [user.id, target, cleanText(body.reason, 500), Date.now()]);
  return { ok: true };
}, AUTH);

route('GET', '/api/admin/reports', async () => {
  const rows = await all(`SELECT r.*, u.username, u.color, u.avatar_url FROM reports r LEFT JOIN users u ON u.id = r.user_id
    WHERE r.resolved = FALSE ORDER BY r.id DESC LIMIT 200`);
  const idsOf = (letter) => rows.filter((r) => r.target[0] === letter).map((r) => Number(r.target.slice(1)));
  const [ls, ms, us] = await Promise.all([
    all(`SELECT l.id, l.title, u.id AS uid, u.username, u.color, u.avatar_url FROM listings l JOIN users u ON u.id = l.user_id
      WHERE l.id = ANY($1::int[]) AND l.status <> 'eliminada'`, [idsOf('l')]),
    all(`SELECT m.id, m.room, m.body, m.attachments, u.id AS uid, u.username, u.color, u.avatar_url FROM messages m JOIN users u ON u.id = m.user_id
      WHERE m.id = ANY($1::int[])`, [idsOf('m')]),
    all('SELECT id, id AS uid, username, color, avatar_url, banned FROM users WHERE id = ANY($1::int[])', [idsOf('u')]),
  ]);
  const found = { l: new Map(ls.map((x) => [x.id, x])), m: new Map(ms.map((x) => [x.id, x])), u: new Map(us.map((x) => [x.id, x])) };
  return {
    reports: rows.map((r) => {
      const kind = r.target[0];
      const x = found[kind].get(Number(r.target.slice(1)));
      const out = { id: r.id, target: r.target, reason: r.reason, createdAt: r.created_at, reporter: pubUser(r.user_id, r.username, r.color, r.avatar_url), gone: !x };
      if (!x) return out;
      out.author = pubUser(x.uid, x.username, x.color, x.avatar_url);
      if (kind === 'l') Object.assign(out, { summary: x.title, link: '/p/' + x.id });
      else if (kind === 'm') Object.assign(out, { summary: excerpt(x.body, x.attachments), link: x.room[0] === 'l' ? '/p/' + x.room.slice(1) : null });
      else Object.assign(out, { summary: 'Usuario ' + x.username, link: '/usuario/' + x.username, authorBanned: !!x.banned });
      return out;
    }),
  };
}, ADMIN);

route('POST', '/api/admin/reports/:id/resolve', async ({ params }) => {
  await run('UPDATE reports SET resolved = TRUE WHERE id = $1', [intParam(params.id)]);
  return { ok: true };
}, ADMIN);

route('POST', '/api/admin/users/:id/ban', async ({ params, body, user }) => {
  const u = await one('SELECT * FROM users WHERE id = $1', [intParam(params.id)]);
  if (!u) fail(404, 'Ese usuario no existe.');
  if (u.id === user.id || isAdmin(u)) fail(400, 'No puedes suspender a un administrador.');
  const banned = !!body.banned;
  await run('UPDATE users SET banned = $1 WHERE id = $2', [banned, u.id]);
  if (banned) await run('DELETE FROM sessions WHERE user_id = $1', [u.id]);
  return { ok: true, banned };
}, ADMIN);

// ── Limpieza diaria (la llama Vercel Cron; en tu computadora, el servidor local) ──
route('GET', '/api/cron/limpieza', async ({ request }) => {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) fail(401, 'No autorizado.');
  if (!secret) await limit('limpieza', 6, 3600_000);
  const now = Date.now();
  // Archivos que se subieron y nunca se llegaron a publicar.
  const stale = await all('DELETE FROM uploads WHERE used = FALSE AND created_at < $1 RETURNING id, url', [now - 24 * 3600_000]);
  await files.removeFiles(stale);
  await run('DELETE FROM events WHERE created_at < $1', [now - 10 * 60_000]);
  await run('DELETE FROM presence WHERE at < $1', [now - 5 * 60_000]);
  await run('DELETE FROM limits WHERE reset < $1', [now]);
  // Archivos huérfanos en Blob: se revisan por tandas y se recuerda por dónde se iba.
  let orphans = 0;
  if (files.mode() === 'blob') {
    let cursor = ((await one("SELECT value FROM meta WHERE key = 'blob-cursor'")) || {}).value || null;
    for (let i = 0; i < 5; i++) {
      const r = await files.blobOrphans(cursor, async (urls) => new Set(
        urls.length ? (await all('SELECT url FROM uploads WHERE url = ANY($1::text[])', [urls])).map((x) => x.url) : []));
      orphans += r.deleted;
      cursor = r.cursor;
      if (!cursor) break;
    }
    await run("INSERT INTO meta(key, value) VALUES('blob-cursor', $1) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value", [cursor || '']);
  }
  return { ok: true, sinPublicar: stale.length, huerfanos: orphans };
});

// ───────────────────────────── Entrada ─────────────────────────────
function clientIp(request, extra) {
  // En Vercel, la dirección real del visitante viene en X-Forwarded-For.
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd && (process.env.VERCEL || !extra.ip)) return fwd.split(',')[0].trim();
  return extra.ip || 'desconocida';
}

async function dispatch(request, url, extra) {
  if (request.method !== 'GET' && request.method !== 'HEAD' && request.headers.get('origin')) {
    let originHost = '';
    try { originHost = new URL(request.headers.get('origin')).host; } catch { /* origen ilegible */ }
    const hosts = [request.headers.get('x-forwarded-host'), request.headers.get('host'), url.host].filter(Boolean);
    if (!hosts.includes(originHost)) fail(403, 'Solicitud no permitida desde otro sitio.');
  }
  for (const r of routes) {
    if (r.method !== request.method) continue;
    const m = r.rx.exec(url.pathname);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => { params[k] = m[i + 1]; });
    const user = await currentUser(request);
    if (r.opts.auth && !user) fail(401, 'Crea tu usuario o entra para hacer esto.');
    if (r.opts.auth && user.banned) fail(403, 'Tu cuenta está suspendida.');
    if (r.opts.admin && !isAdmin(user)) fail(403, 'Solo para administradores.');
    let body = {};
    if (!r.opts.raw && request.method !== 'GET' && request.method !== 'DELETE') {
      const text = await request.text();
      if (text.length > 200 * 1024) fail(413, 'La solicitud es demasiado grande.');
      if (text) {
        try { body = JSON.parse(text); } catch { fail(400, 'Datos no válidos.'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Datos no válidos.');
      }
    }
    const ctx = { request, url, params, user, body, ip: clientIp(request, extra), headers: new Headers() };
    const result = await r.handler(ctx);
    return json(200, result ?? { ok: true }, ctx.headers);
  }
  fail(404, 'No existe.');
}

export async function handle(request, extra = {}) {
  try {
    const url = new URL(request.url);
    // En Vercel todas las rutas /api/... se redirigen a una sola función (ver vercel.json).
    // Si la dirección llega ya cambiada, la ruta original viene en "__ruta".
    const original = url.searchParams.get('__ruta');
    if (original != null) {
      if (url.pathname === '/api' || url.pathname === '/api/index') url.pathname = '/api/' + original.replace(/,/g, '/');
      url.searchParams.delete('__ruta');
    }
    if (url.pathname.startsWith('/media/')) {
      const id = url.pathname.slice('/media/'.length);
      const upload = /^[\w-]{16}$/.test(id) ? await one('SELECT * FROM uploads WHERE id = $1', [id]) : null;
      return files.localServe(request, url, upload);
    }
    return await dispatch(request, url, extra);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    return json(status, { error: status === 500 ? 'Algo falló en el servidor. Inténtalo de nuevo.' : e.message });
  }
}
