// El chat: se usa igual en cada publicación y en los mensajes privados.
import { h, icon, api, bus, state, avatar, fmtClock, fmtDay, toastError, requireAuth, confirmDialog, reportDialog, refreshUnread } from './core.js';
import { emojiPicker, closeEmojiPicker, QUICK } from './emoji.js';
import { renderAttachments, createUploader, pendingTile } from './media.js';

const JUMBO = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s)+$/u;
const URL_RX = /https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g;

function renderText(text) {
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of text.matchAll(URL_RX)) {
    frag.append(text.slice(last, m.index));
    frag.append(h('a', { href: m[0], target: '_blank', rel: 'noopener noreferrer nofollow' }, m[0]));
    last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}

export async function react(target, emoji) {
  if (!(await requireAuth())) return;
  try {
    const r = await api('POST', '/api/react', { target, emoji });
    bus.emit('reactions', r);
  } catch (e) { toastError(e); }
}

export function renderReactions(box, target, reactions) {
  const entries = Object.entries(reactions || {});
  box.replaceChildren(...entries.map(([emoji, users]) => {
    const on = !!state.me && users.includes(state.me.id);
    return h('button', {
      type: 'button', class: 'rx' + (on ? ' is-on' : ''), 'aria-pressed': String(on),
      title: on ? 'Quitar tu reacción' : 'Reaccionar igual',
      onclick: () => react(target, emoji),
    }, h('span', { class: 'rx-e' }, emoji), h('span', { class: 'rx-n' }, String(users.length)));
  }));
  box.hidden = entries.length === 0;
}

const dayKey = (ts) => new Date(ts).toDateString();

export function createChat({ room, canModerate = false, ownerId = null, trackRead = false, emptyTitle, emptyText, placeholder = 'Escribe un mensaje' }) {
  const msgs = [];
  const nodes = new Map();
  let hasMore = false;
  let stick = true;
  let replyTo = null;
  const offs = [];

  const list = h('div', { class: 'chat-list', role: 'log', 'aria-live': 'polite' });
  const moreBtn = h('button', { class: 'btn btn-small chat-more', type: 'button', hidden: true, onclick: loadOlder }, 'Ver mensajes anteriores');
  const empty = h('div', { class: 'chat-empty', hidden: true }, h('strong', null, emptyTitle), h('span', null, emptyText));
  const scroller = h('div', { class: 'chat-scroll' }, moreBtn, empty, list);
  const jump = h('button', { class: 'chat-jump', type: 'button', hidden: true, onclick: toBottom }, icon('down', 16), 'Mensajes nuevos');
  const composer = buildComposer();
  const el = h('div', { class: 'chat' }, h('div', { class: 'chat-body' }, scroller, jump), composer.el);

  function toBottom() { scroller.scrollTop = scroller.scrollHeight; stick = true; jump.hidden = true; }
  scroller.addEventListener('scroll', () => {
    stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
    if (stick) jump.hidden = true;
  });
  const ro = new ResizeObserver(() => { if (stick) scroller.scrollTop = scroller.scrollHeight; });
  ro.observe(list);

  const sameGroup = (prev, m) => !!prev && prev.user.id === m.user.id && !m.replyTo
    && m.createdAt - prev.createdAt < 5 * 60_000 && dayKey(prev.createdAt) === dayKey(m.createdAt);

  function toolBtn(name, label, onclick) {
    return h('button', { type: 'button', class: 'tool', title: label, 'aria-label': label, onclick }, icon(name, 18));
  }

  function renderMsg(m, prev) {
    const compact = sameGroup(prev, m);
    const mine = !!state.me && m.user.id === state.me.id;
    const target = 'm' + m.id;
    const rx = h('div', { class: 'msg-rx' });
    renderReactions(rx, target, m.reactions);
    const profile = '/usuario/' + encodeURIComponent(m.user.username);

    let reply = null;
    if (m.replyTo) {
      reply = m.replyTo.deleted
        ? h('div', { class: 'msg-reply' }, icon('reply', 14), h('em', null, 'Mensaje eliminado'))
        : h('button', { type: 'button', class: 'msg-reply', onclick: () => flash(m.replyTo.id) },
          icon('reply', 14), h('strong', null, m.replyTo.username), h('span', null, m.replyTo.excerpt));
    }

    const node = h('article', { class: 'msg' + (compact ? ' is-compact' : '') + (mine ? ' is-mine' : ''), dataset: { id: m.id } },
      compact
        ? h('time', { class: 'msg-gutter' }, fmtClock(m.createdAt))
        : h('a', { class: 'msg-gutter', href: profile, tabindex: '-1', 'aria-hidden': 'true' }, avatar(m.user, 40)),
      h('div', { class: 'msg-main' },
        !compact && h('header', { class: 'msg-head' },
          h('a', { class: 'msg-user uc-' + m.user.color, href: profile }, m.user.username),
          m.user.id === ownerId && h('span', { class: 'badge' }, 'Vendedor'),
          h('time', { datetime: new Date(m.createdAt).toISOString() }, fmtClock(m.createdAt))),
        reply,
        m.body ? h('div', { class: 'msg-body' + (m.body.length <= 24 && JUMBO.test(m.body) ? ' is-jumbo' : '') }, renderText(m.body)) : null,
        m.attachments.length ? h('div', { class: 'msg-att' }, renderAttachments(m.attachments)) : null,
        rx),
      h('div', { class: 'msg-tools' },
        QUICK.slice(0, 3).map((e) => h('button', { type: 'button', class: 'tool tool-emoji', title: 'Reaccionar con ' + e, 'aria-label': 'Reaccionar con ' + e, onclick: () => react(target, e) }, e)),
        toolBtn('smile', 'Más reacciones', (ev) => emojiPicker(ev.currentTarget, (e) => react(target, e))),
        toolBtn('reply', 'Responder', () => composer.setReply(m)),
        (mine || canModerate || (state.me && state.me.admin)) && toolBtn('trash', 'Borrar mensaje', () => del(m)),
        !mine && toolBtn('flag', 'Reportar', async () => { if (await requireAuth()) reportDialog(target, 'mensaje'); })));
    // En pantallas táctiles no hay "pasar el ratón": un toque muestra las herramientas.
    node.addEventListener('click', (e) => {
      if (!matchMedia('(hover: none)').matches || e.target.closest('a, button, video, audio')) return;
      const was = node.classList.contains('is-active');
      list.querySelectorAll('.msg.is-active').forEach((n) => n.classList.remove('is-active'));
      if (!was) node.classList.add('is-active');
    });
    return node;
  }

  function flash(id) {
    const n = nodes.get(id);
    if (!n) return;
    n.scrollIntoView({ block: 'center', behavior: 'smooth' });
    n.classList.remove('is-flash');
    void n.offsetWidth;
    n.classList.add('is-flash');
  }

  const daySep = (ts) => h('div', { class: 'day-sep', role: 'separator' }, h('span', null, fmtDay(ts)));

  function renderAll() {
    nodes.clear();
    const frag = document.createDocumentFragment();
    msgs.forEach((m, i) => {
      const prev = msgs[i - 1];
      if (!prev || dayKey(prev.createdAt) !== dayKey(m.createdAt)) frag.append(daySep(m.createdAt));
      const node = renderMsg(m, prev);
      nodes.set(m.id, node);
      frag.append(node);
    });
    list.replaceChildren(frag);
    empty.hidden = msgs.length > 0;
    moreBtn.hidden = !hasMore;
  }

  function append(m, own) {
    if (m.room !== room || nodes.has(m.id)) return;
    const prev = msgs[msgs.length - 1];
    msgs.push(m);
    if (!prev || dayKey(prev.createdAt) !== dayKey(m.createdAt)) list.append(daySep(m.createdAt));
    const node = renderMsg(m, prev);
    nodes.set(m.id, node);
    list.append(node);
    empty.hidden = true;
    if (stick || own) toBottom(); else jump.hidden = false;
    if (trackRead && !own && state.me && document.visibilityState === 'visible') {
      api('POST', `/api/rooms/${room}/read`).then((r) => { state.unread = r.unread; bus.emit('unread'); }).catch(() => {});
    }
  }

  function removeMsg(id) {
    const i = msgs.findIndex((x) => x.id === id);
    if (i < 0) return;
    msgs.splice(i, 1);
    nodes.get(id).remove();
    nodes.delete(id);
    const next = msgs[i];
    if (next && nodes.get(next.id).classList.contains('is-compact')) {
      const fresh = renderMsg(next, msgs[i - 1]);
      nodes.get(next.id).replaceWith(fresh);
      nodes.set(next.id, fresh);
    }
    for (const sep of list.querySelectorAll('.day-sep')) {
      if (!sep.nextElementSibling || sep.nextElementSibling.classList.contains('day-sep')) sep.remove();
    }
    empty.hidden = msgs.length > 0;
    if (replyTo && replyTo.id === id) composer.setReply(null);
  }

  async function del(m) {
    const ok = await confirmDialog({ title: '¿Borrar este mensaje?', text: 'Se borra para todos, junto con sus archivos. No se puede deshacer.', ok: 'Borrar', danger: true });
    if (!ok) return;
    try { await api('DELETE', '/api/messages/' + m.id); removeMsg(m.id); } catch (e) { toastError(e); }
  }

  async function load() {
    try {
      const d = await api('GET', `/api/rooms/${room}/messages`);
      hasMore = d.hasMore;
      msgs.length = 0;
      msgs.push(...d.messages);
      renderAll();
      toBottom();
      if (trackRead) refreshUnread();
    } catch (e) {
      empty.hidden = false;
      empty.replaceChildren(h('strong', null, 'No se pudo cargar el chat'), h('span', null, e.message));
    }
  }

  async function loadOlder() {
    if (!msgs.length) return;
    moreBtn.disabled = true;
    try {
      const d = await api('GET', `/api/rooms/${room}/messages?before=${msgs[0].id}`);
      hasMore = d.hasMore;
      const before = scroller.scrollHeight;
      const top = scroller.scrollTop;
      msgs.unshift(...d.messages);
      stick = false;
      renderAll();
      scroller.scrollTop = top + (scroller.scrollHeight - before);
    } catch (e) { toastError(e); }
    moreBtn.disabled = false;
  }

  // Al reconectar se compara con lo último del servidor: se añaden los mensajes nuevos,
  // se quitan los borrados y se actualizan las reacciones, sin redibujar lo que ya estaba.
  async function resync() {
    try {
      const d = await api('GET', `/api/rooms/${room}/messages`);
      if (!d.messages.length) { msgs.slice().forEach((m) => removeMsg(m.id)); return; }
      const fresh = new Map(d.messages.map((m) => [m.id, m]));
      const firstId = d.messages[0].id;
      for (const m of msgs.slice()) {
        if (m.id < firstId) continue;
        const f = fresh.get(m.id);
        if (!f) { removeMsg(m.id); continue; }
        if (JSON.stringify(f.reactions) !== JSON.stringify(m.reactions)) {
          m.reactions = f.reactions;
          renderReactions(nodes.get(m.id).querySelector('.msg-rx'), 'm' + m.id, f.reactions);
        }
      }
      const lastId = msgs.length ? msgs[msgs.length - 1].id : 0;
      d.messages.filter((m) => m.id > lastId).forEach((m) => append(m, !!state.me && m.user.id === state.me.id));
    } catch { /* se reintenta en la próxima reconexión */ }
  }

  offs.push(
    bus.on('message', (m) => append(m, !!state.me && m.user.id === state.me.id)),
    bus.on('message-delete', (d) => { if (d.room === room) removeMsg(d.id); }),
    bus.on('reactions', (d) => {
      if (d.target[0] !== 'm') return;
      const id = Number(d.target.slice(1));
      const m = msgs.find((x) => x.id === id);
      const node = nodes.get(id);
      if (!m || !node) return;
      m.reactions = d.reactions;
      renderReactions(node.querySelector('.msg-rx'), d.target, d.reactions);
    }),
    bus.on('resync', resync),
  );

  // ───────── Compositor ─────────
  function buildComposer() {
    if (!state.me) {
      return {
        setReply: () => requireAuth(),
        el: h('div', { class: 'composer-gate' },
          h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => requireAuth() }, 'Crea tu usuario para participar'),
          h('span', { class: 'muted' }, 'Solo necesitas elegir un nombre.')),
      };
    }
    if (state.me.banned) {
      return { setReply() {}, el: h('div', { class: 'composer-gate' }, h('span', { class: 'muted' }, 'Tu cuenta está suspendida y no puede escribir.')) };
    }

    const ta = h('textarea', { rows: 1, maxlength: 2000, placeholder, 'aria-label': 'Mensaje' });
    const tiles = h('div', { class: 'composer-tiles', hidden: true });
    const replyBar = h('div', { class: 'composer-reply', hidden: true });
    const sendBtn = h('button', { class: 'composer-send', type: 'submit', 'aria-label': 'Enviar', title: 'Enviar', disabled: true }, icon('send', 18));
    const fileInput = h('input', { type: 'file', multiple: true, hidden: true });
    const tileMap = new Map();

    const uploader = createUploader({
      max: 10,
      onError: toastError,
      onChange: (what, item) => {
        if (what === 'list') {
          tileMap.clear();
          tiles.replaceChildren(...uploader.items.map((it) => {
            const t = pendingTile(it, { onRemove: () => uploader.remove(it) });
            tileMap.set(it.key, t);
            return t;
          }));
          tiles.hidden = uploader.items.length === 0;
        } else if (tileMap.has(item.key)) tileMap.get(item.key).update();
        refresh();
      },
    });
    fileInput.addEventListener('change', () => { uploader.addFiles([...fileInput.files]); fileInput.value = ''; });

    function refresh() { sendBtn.disabled = uploader.busy || (!ta.value.trim() && uploader.items.length === 0); }
    function autosize() { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; }
    function setReply(m) {
      replyTo = m;
      replyBar.hidden = !m;
      if (m) {
        replyBar.replaceChildren(
          icon('reply', 16),
          h('span', null, 'Respondiendo a ', h('strong', null, m.user.username)),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Cancelar respuesta', onclick: () => setReply(null) }, icon('x', 16)));
        ta.focus();
      }
    }

    let sending = false;
    async function send() {
      const body = ta.value.trim();
      if (sending || uploader.busy || (!body && !uploader.ids.length)) return;
      sending = true;
      sendBtn.disabled = true;
      try {
        const m = await api('POST', `/api/rooms/${room}/messages`, { body, attachments: uploader.ids, replyTo: replyTo ? replyTo.id : null });
        ta.value = '';
        autosize();
        uploader.clear();
        setReply(null);
        append(m, true);
      } catch (e) { toastError(e); }
      sending = false;
      refresh();
      if (!matchMedia('(pointer: coarse)').matches) ta.focus();
    }

    ta.addEventListener('input', () => { autosize(); refresh(); });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); send(); }
    });
    ta.addEventListener('paste', (e) => {
      const files = [...(e.clipboardData ? e.clipboardData.files : [])];
      if (files.length) { e.preventDefault(); uploader.addFiles(files); }
    });

    const form = h('form', { class: 'composer', onsubmit: (e) => { e.preventDefault(); send(); } },
      replyBar,
      tiles,
      h('div', { class: 'composer-row' },
        h('button', { type: 'button', class: 'icon-btn', title: 'Adjuntar fotos, videos o archivos', 'aria-label': 'Adjuntar fotos, videos o archivos', onclick: () => fileInput.click() }, icon('clip')),
        ta,
        h('button', {
          type: 'button', class: 'icon-btn', title: 'Emojis', 'aria-label': 'Emojis',
          onclick: (ev) => emojiPicker(ev.currentTarget, (e) => {
            const s = ta.selectionStart ?? ta.value.length;
            ta.setRangeText(e, s, ta.selectionEnd ?? s, 'end');
            autosize();
            refresh();
          }, { keepOpen: true }),
        }, icon('smile')),
        sendBtn),
      fileInput);

    return { el: form, setReply, addFiles: (f) => uploader.addFiles(f) };
  }

  // Arrastrar y soltar archivos sobre el chat.
  if (composer.addFiles) {
    let depth = 0;
    el.addEventListener('dragenter', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { depth++; el.classList.add('is-drop'); } });
    el.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) el.classList.remove('is-drop'); });
    el.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
    el.addEventListener('drop', (e) => {
      depth = 0;
      el.classList.remove('is-drop');
      if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); composer.addFiles([...e.dataTransfer.files]); }
    });
  }

  load();

  return {
    el,
    destroy() {
      offs.forEach((off) => off());
      ro.disconnect();
      closeEmojiPicker();
    },
  };
}
