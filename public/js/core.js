// Piezas base que usa toda la tienda: crear elementos, hablar con el servidor,
// avisos, ventanas, sesión y eventos en vivo.

export const state = {
  me: null,
  site: { name: 'Tienda', currency: '$', locale: 'es-PA', categories: [], maxFileMB: 100, maxImageMB: 15, uploads: 'local' },
  unread: { dms: 0, listings: 0 },
};

export const CONDITIONS = { nuevo: 'Nuevo', como_nuevo: 'Como nuevo', buen_estado: 'Buen estado', usado: 'Usado' };

// ───────── DOM ─────────
const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'hidden', 'multiple', 'required', 'autofocus', 'open', 'muted', 'controls', 'loop', 'playsInline', 'draggable']);

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (PROPS.has(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const k of kids) {
    if (k == null || k === false || k === '') continue;
    if (Array.isArray(k)) add(el, k);
    else el.append(k);
  }
}

const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  bookmark: '<path d="M6 4h12v17l-6-4-6 4z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  clip: '<path d="m21 12-8.5 8.5a5 5 0 0 1-7-7L14 5a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 8"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><path d="M9 9.5h.01M15 9.5h.01"/>',
  send: '<path d="m21 3-9.5 9.5"/><path d="M21 3 14.5 21l-3-8.5L3 9.5z"/>',
  reply: '<path d="M9 8 4 13l5 5"/><path d="M4 13h9a7 7 0 0 1 7 7"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  flag: '<path d="M5 21V4h11l-2 4 2 4H5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  download: '<path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-8 8"/>',
  shield: '<path d="M12 3 5 6v6c0 4.500 3 7.500 7 9 4-1.500 7-4.500 7-9V6z"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  logout: '<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l4 4-4 4M19 12H9"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  play: '<path d="M8 5v14l11-7z" fill="currentColor"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3"/>',
};
const SVGNS = 'http://www.w3.org/2000/svg';
export function icon(name, size = 20) {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('class', 'icon');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name] || '';
  return s;
}

// ───────── Servidor ─────────
export async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('No hay conexión con la tienda. Revisa tu internet.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* respuesta vacía */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || 'No se pudo completar. Inténtalo de nuevo.');
    err.status = res.status;
    throw err;
  }
  return data;
}

// ───────── Bus de eventos ─────────
const listeners = new Map();
export const bus = {
  on(ev, fn) {
    if (!listeners.has(ev)) listeners.set(ev, new Set());
    listeners.get(ev).add(fn);
    return () => listeners.get(ev).delete(fn);
  },
  emit(ev, data) {
    for (const fn of [...(listeners.get(ev) || [])]) {
      try { fn(data); } catch (e) { console.error(e); }
    }
  },
};

// ───────── Navegación ─────────
export function go(path, { replace = false } = {}) {
  history[replace ? 'replaceState' : 'pushState'](null, '', path);
  bus.emit('route');
}

// ───────── Formato ─────────
export function fmtPrice(price) {
  if (price == null) return 'A convenir';
  if (price === 0) return 'Gratis';
  const cents = Math.round(price * 100) % 100 !== 0;
  const opts = { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2, useGrouping: 'always' };
  let text;
  try { text = price.toLocaleString(state.site.locale || 'es-PA', opts); } catch { text = price.toLocaleString('es', { ...opts, useGrouping: true }); }
  return state.site.currency + text;
}
export function timeAgo(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'ahora';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  if (d === 1) return 'ayer';
  if (d < 30) return `hace ${d} días`;
  return new Date(ts).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
}
export const fmtClock = (ts) => new Date(ts).toLocaleTimeString('es', { hour: 'numeric', minute: '2-digit' });
export function fmtDay(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return 'Hoy';
  if (d.toDateString() === yesterday.toDateString()) return 'Ayer';
  return d.toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });
}
export function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
}

export function avatar(user, size = 36) {
  const style = { width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.44) + 'px' };
  if (user.avatar) return h('img', { class: 'avatar', src: user.avatar, alt: '', loading: 'lazy', style });
  return h('span', { class: `avatar ub-${user.color}`, 'aria-hidden': 'true', style }, (user.username[0] || '?').toUpperCase());
}

export async function copyText(text, done = 'Copiado') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea', { value: text, style: { position: 'fixed', opacity: '0' } });
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(done);
}

// ───────── Avisos ─────────
let toastBox;
export function toast(message, { error = false, action, onAction, ms = 3800 } = {}) {
  if (!toastBox) { toastBox = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(toastBox); }
  const t = h('div', { class: 'toast' + (error ? ' is-error' : '') }, h('span', null, message));
  if (action) t.append(h('button', { class: 'toast-action', onclick: () => { t.remove(); onAction(); } }, action));
  toastBox.append(t);
  setTimeout(() => t.remove(), ms);
}
export const toastError = (e) => toast(e.message || String(e), { error: true });

// ───────── Ventanas ─────────
export function openDialog(build, { wide = false, onClose } = {}) {
  const dlg = h('dialog', { class: 'dialog' + (wide ? ' is-wide' : '') });
  const close = () => dlg.close();
  const box = h('div', { class: 'dialog-box' },
    h('button', { class: 'icon-btn dialog-x', type: 'button', 'aria-label': 'Cerrar', onclick: close }, icon('x')));
  box.append(build(close, dlg));
  dlg.append(box);
  document.body.append(dlg);
  dlg.addEventListener('close', () => { dlg.remove(); if (onClose) onClose(); });
  dlg.addEventListener('mousedown', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.showModal();
  return dlg;
}

export function confirmDialog({ title, text, ok = 'Aceptar', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    openDialog((close) => h('div', { class: 'dialog-body' },
      h('h2', null, title),
      text && h('p', { class: 'muted' }, text),
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancelar'),
        h('button', { class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), type: 'button', onclick: () => { result = true; close(); } }, ok))),
    { onClose: () => resolve(result) });
  });
}

export function reportDialog(target, what) {
  openDialog((close) => {
    const reason = h('textarea', { rows: 3, maxlength: 500, placeholder: 'Cuéntanos qué pasa (opcional)' });
    return h('form', {
      class: 'dialog-body',
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          await api('POST', '/api/reports', { target, reason: reason.value });
          close();
          toast('Reporte enviado. Gracias por avisar.');
        } catch (err) { toastError(err); }
      },
    },
    h('h2', null, 'Reportar ' + what),
    h('p', { class: 'muted' }, 'Un moderador lo revisará. Quien publicó no sabrá que fuiste tú.'),
    reason,
    h('div', { class: 'dialog-actions' },
      h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancelar'),
      h('button', { class: 'btn btn-primary' }, 'Enviar reporte')));
  });
}

// ───────── Sesión ─────────
function applyMe(data) {
  state.me = data.user;
  state.unread = data.unread || { dms: 0, listings: 0 };
  if (data.site) state.site = data.site;
}
export async function loadMe() {
  applyMe(await api('GET', '/api/me'));
  bus.emit('unread');
}
export async function refreshUnread() {
  if (!state.me) return;
  try { const d = await api('GET', '/api/me'); state.unread = d.unread; bus.emit('unread'); } catch { /* se reintenta luego */ }
}
export async function logout() {
  await api('POST', '/api/logout');
  state.me = null;
  state.unread = { dms: 0, listings: 0 };
  bus.emit('auth');
}

export function showAccessCode(code, { fresh = true } = {}) {
  return new Promise((resolve) => {
    openDialog((close) => h('div', { class: 'dialog-body code-step' },
      h('h2', null, fresh ? `Listo, ya eres ${state.me.username}` : 'Tu nuevo código de acceso'),
      h('p', null, 'Tu usuario no tiene contraseña. Este código es la única forma de entrar con tu usuario desde otro teléfono o computadora.'),
      h('div', { class: 'code-box' },
        h('code', null, code),
        h('button', { class: 'btn', type: 'button', onclick: () => copyText(code, 'Código copiado') }, icon('copy', 18), 'Copiar')),
      h('p', { class: 'muted' }, 'Guárdalo en un lugar seguro: no se vuelve a mostrar. Si lo pierdes, puedes generar otro desde tu perfil mientras sigas con la sesión abierta aquí.'),
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: close }, 'Ya lo guardé'))),
    { onClose: resolve });
  });
}

let authOpen = null;
// Abre la ventana para crear usuario o entrar. Resuelve true si la persona quedó con sesión.
export function requireAuth() {
  if (state.me) return Promise.resolve(true);
  if (authOpen) return authOpen;
  authOpen = new Promise((resolve) => {
    let ok = false;
    openDialog((close) => {
      const body = h('div', { class: 'dialog-body auth' });

      const showRegister = () => {
        const input = h('input', { type: 'text', maxlength: 20, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'tu_nombre', 'aria-label': 'Nombre de usuario', autofocus: true });
        const hint = h('p', { class: 'field-hint' }, 'De 3 a 20 caracteres: letras, números, punto, guion y guion bajo.');
        const submit = h('button', { class: 'btn btn-primary btn-block', disabled: true }, 'Crear usuario');
        let timer;
        let seq = 0;
        input.addEventListener('input', () => {
          clearTimeout(timer);
          submit.disabled = true;
          const value = input.value.trim();
          const my = ++seq;
          if (!value) { hint.className = 'field-hint'; hint.textContent = 'De 3 a 20 caracteres: letras, números, punto, guion y guion bajo.'; return; }
          timer = setTimeout(async () => {
            try {
              const r = await api('GET', '/api/username-check?u=' + encodeURIComponent(value));
              if (my !== seq) return;
              hint.className = 'field-hint ' + (r.available ? 'is-ok' : 'is-bad');
              hint.textContent = r.available ? `"${value}" está libre.` : r.reason;
              submit.disabled = !r.available;
            } catch { /* se valida al enviar */ submit.disabled = false; }
          }, 250);
        });
        body.replaceChildren(
          h('h2', null, 'Elige tu nombre de usuario'),
          h('p', { class: 'muted' }, 'Es lo único que necesitas para publicar y chatear. Será tuyo y de nadie más.'),
          h('form', {
            onsubmit: async (e) => {
              e.preventDefault();
              submit.disabled = true;
              try {
                const data = await api('POST', '/api/register', { username: input.value.trim() });
                applyMe(data);
                ok = true;
                close();
                await showAccessCode(data.accessCode);
              } catch (err) {
                hint.className = 'field-hint is-bad';
                hint.textContent = err.message;
              }
            },
          },
          h('label', { class: 'at-input' }, h('span', { 'aria-hidden': 'true' }, '@'), input),
          hint,
          submit),
          h('button', { class: 'link-btn', type: 'button', onclick: showLogin }, 'Ya tengo un usuario'));
        setTimeout(() => input.focus(), 30);
      };

      const showLogin = () => {
        const user = h('input', { type: 'text', maxlength: 20, autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', placeholder: 'tu_nombre', 'aria-label': 'Nombre de usuario', required: true });
        const code = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'XXXX-XXXX-XXXX', 'aria-label': 'Código de acceso', required: true });
        const error = h('p', { class: 'field-hint is-bad', hidden: true });
        body.replaceChildren(
          h('h2', null, 'Entra con tu usuario'),
          h('p', { class: 'muted' }, 'Escribe tu nombre de usuario y el código de acceso que guardaste al crearlo.'),
          h('form', {
            onsubmit: async (e) => {
              e.preventDefault();
              try {
                applyMe(await api('POST', '/api/login', { username: user.value, code: code.value }));
                ok = true;
                close();
              } catch (err) { error.hidden = false; error.textContent = err.message; }
            },
          },
          h('label', { class: 'at-input' }, h('span', { 'aria-hidden': 'true' }, '@'), user),
          h('label', { class: 'field' }, h('span', null, 'Código de acceso'), code),
          error,
          h('button', { class: 'btn btn-primary btn-block' }, 'Entrar')),
          h('button', { class: 'link-btn', type: 'button', onclick: showRegister }, 'No tengo usuario, quiero crear uno'));
        setTimeout(() => user.focus(), 30);
      };

      showRegister();
      return body;
    }, {
      onClose: () => {
        authOpen = null;
        if (ok) bus.emit('auth');
        resolve(ok);
      },
    });
  });
  return authOpen;
}

// ───────── Eventos en vivo ─────────
// La conexión en vivo solo se abre en las pantallas con chat y mientras la pestaña está a la vista:
// cada conexión abierta mantiene ocupado al servidor.
let es = null;
let esRoom = null;
let opened = false;

function openStream() {
  if (es) { es.close(); es = null; }
  if (!esRoom || document.visibilityState !== 'visible') return;
  es = new EventSource('/api/events?room=' + encodeURIComponent(esRoom));
  // El servidor corta la conexión cada pocos minutos y el navegador reconecta solo.
  // Al reconectar, el chat se pone al día por si se perdió algo en el camino.
  es.addEventListener('ready', () => { if (opened) bus.emit('resync'); opened = true; });
  for (const ev of ['message', 'message-delete', 'reactions', 'presence', 'listing', 'notify']) {
    es.addEventListener(ev, (e) => bus.emit(ev, JSON.parse(e.data)));
  }
}
export function connectEvents(room = null, { force = false } = {}) {
  if (esRoom === room && !force) return;
  esRoom = room;
  opened = false;
  openStream();
}
export const currentRoom = () => esRoom;

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { openStream(); refreshUnread(); } else if (es) { es.close(); es = null; }
});
// Fuera del chat, el contador de mensajes sin leer se refresca cada minuto.
setInterval(() => { if (document.visibilityState === 'visible' && !es) refreshUnread(); }, 60_000);
