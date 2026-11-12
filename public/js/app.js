// Pantallas de la tienda y navegación entre ellas.
import {
  state, h, icon, api, bus, go, toast, toastError, openDialog, confirmDialog, reportDialog, requireAuth, loadMe, logout,
  refreshUnread, showAccessCode, connectEvents, currentRoom, fmtPrice, timeAgo, avatar, copyText, CONDITIONS,
} from './core.js';
import { createChat, react, renderReactions } from './chat.js';
import { emojiPicker, closeEmojiPicker } from './emoji.js';
import { lightbox, createUploader, pendingTile, uploadFile } from './media.js';

const header = h('header', { class: 'top' });
const view = h('main', { id: 'view' });
document.getElementById('app').append(header, view);

let cleanups = [];
const onLeave = (fn) => cleanups.push(fn);
const userPath = (u) => '/usuario/' + encodeURIComponent(u.username);

// Hace algo que necesita sesión; si la persona no tiene usuario, primero se lo pide.
async function withAuth(fn) {
  const was = !!state.me;
  if (!(await requireAuth())) return;
  const path = location.pathname;
  try { await fn(); } catch (e) { toastError(e); }
  if (!was && location.pathname === path) bus.emit('route');
}

// ───────────────────────── Cabecera ─────────────────────────
function toggleTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('tema', root.dataset.theme); } catch { /* sin almacenamiento */ }
}

function renderHeader() {
  const me = state.me;
  const input = h('input', {
    type: 'search', name: 'q', placeholder: `Buscar en ${state.site.name}`, 'aria-label': 'Buscar publicaciones',
    value: location.pathname === '/' ? new URLSearchParams(location.search).get('q') || '' : '',
  });
  const total = state.unread.dms;
  let menu = null;
  if (me) {
    const pop = h('div', { class: 'menu', hidden: true },
      h('a', { href: userPath(me) }, icon('user', 18), 'Mi perfil y publicaciones',
        state.unread.listings > 0 && h('span', { class: 'pill' }, String(state.unread.listings))),
      h('a', { href: '/guardados' }, icon('bookmark', 18), 'Guardados'),
      me.admin && h('a', { href: '/moderacion' }, icon('shield', 18), 'Moderación'),
      h('button', { type: 'button', onclick: async () => { await logout(); go('/'); } }, icon('logout', 18), 'Salir'));
    const btn = h('button', { class: 'avatar-btn', type: 'button', 'aria-label': 'Tu cuenta', 'aria-haspopup': 'true' },
      avatar(me, 36), state.unread.listings > 0 && h('span', { class: 'dot' }));
    const close = (e) => { if (!menu.contains(e.target)) { pop.hidden = true; document.removeEventListener('click', close, true); } };
    btn.addEventListener('click', () => {
      pop.hidden = !pop.hidden;
      if (!pop.hidden) setTimeout(() => document.addEventListener('click', close, true));
    });
    pop.addEventListener('click', () => { pop.hidden = true; });
    menu = h('div', { class: 'menu-wrap' }, btn, pop);
  }
  header.replaceChildren(
    h('a', { class: 'logo', href: '/', 'aria-label': state.site.name + ', inicio' }, h('span', { class: 'logo-tag', 'aria-hidden': 'true' }), h('span', null, state.site.name)),
    h('form', {
      class: 'top-search', role: 'search',
      onsubmit: (e) => { e.preventDefault(); const v = input.value.trim(); go('/' + (v ? '?q=' + encodeURIComponent(v) : '')); },
    }, icon('search', 18), input),
    h('nav', { class: 'top-actions', 'aria-label': 'Acciones' },
      h('a', {
        class: 'btn btn-primary top-sell', href: '/vender',
        onclick: (e) => { if (!state.me) { e.preventDefault(); e.stopPropagation(); requireAuth().then((ok) => ok && go('/vender')); } },
      }, icon('plus', 18), h('span', null, 'Vender')),
      me && h('a', { class: 'icon-btn', href: '/mensajes', 'aria-label': 'Mensajes privados', title: 'Mensajes privados' },
        icon('mail'), total > 0 && h('span', { class: 'count' }, total > 9 ? '9+' : String(total))),
      h('button', { class: 'icon-btn theme-btn', type: 'button', 'aria-label': 'Cambiar entre modo claro y oscuro', title: 'Modo claro / oscuro', onclick: toggleTheme },
        h('span', { class: 'only-light' }, icon('moon')), h('span', { class: 'only-dark' }, icon('sun'))),
      me ? menu : h('button', { class: 'btn', type: 'button', onclick: () => requireAuth() }, 'Entrar')));
}

// ───────────────────────── Piezas compartidas ─────────────────────────
function card(l) {
  const media = l.cover
    ? (l.cover.kind === 'video'
      ? h('video', { src: l.cover.url + '#t=0.1', muted: true, preload: 'metadata', playsInline: true })
      : h('img', { src: l.cover.url, alt: '', loading: 'lazy' }))
    : h('div', { class: 'card-noimg' }, 'Se busca');
  return h('a', { class: 'card' + (l.status === 'vendida' ? ' is-sold' : ''), href: '/p/' + l.id },
    h('div', { class: 'card-media' },
      media,
      l.cover && l.cover.kind === 'video' && h('span', { class: 'card-play' }, icon('play', 16)),
      l.kind === 'busco' && l.cover && h('span', { class: 'card-kind' }, 'Se busca'),
      l.status === 'vendida' && h('span', { class: 'stamp' }, l.kind === 'busco' ? 'Conseguido' : 'Vendido'),
      (l.price != null || l.kind === 'venta') && h('span', { class: 'tag' }, fmtPrice(l.price))),
    h('div', { class: 'card-title' }, l.title),
    h('div', { class: 'card-meta' },
      h('span', { class: 'card-where' }, l.location || l.category),
      l.unread > 0
        ? h('span', { class: 'pill' }, l.unread === 1 ? '1 nuevo' : l.unread + ' nuevos')
        : l.messageCount > 0 && h('span', { class: 'card-chat', title: 'Mensajes en el chat' }, icon('chat', 14), String(l.messageCount))));
}

function emptyState(title, text, action) {
  return h('div', { class: 'empty' }, h('h2', null, title), text && h('p', null, text), action);
}

function gate(title, text) {
  return h('div', { class: 'page narrow' }, emptyState(title, text,
    h('button', { class: 'btn btn-primary', type: 'button', onclick: () => requireAuth() }, 'Crear mi usuario')));
}

function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', null, label), control, hint && h('small', { class: 'muted' }, hint));
}

// ───────────────────────── Inicio: cuadrícula y filtros ─────────────────────────
async function viewHome() {
  const p = new URLSearchParams(location.search);
  const f = {};
  for (const k of ['q', 'cat', 'kind', 'min', 'max', 'loc', 'sort']) f[k] = p.get(k) || '';
  document.title = state.site.name;

  const grid = h('div', { class: 'grid' });
  const heading = h('h1', { class: 'home-title' });
  const moreBtn = h('button', { class: 'btn', type: 'button', hidden: true, onclick: () => load(false) }, 'Ver más publicaciones');
  const clearBtn = h('button', { class: 'link-btn', type: 'button', hidden: true, onclick: () => go('/') }, 'Quitar filtros');
  let offset = 0;
  let seq = 0;

  function title() {
    if (f.q) return `Resultados para "${f.q}"`;
    if (f.cat) return f.cat;
    if (f.kind === 'busco') return 'Lo que la gente busca';
    return 'Recién publicado';
  }

  async function load(reset) {
    const my = ++seq;
    if (reset) offset = 0;
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) qs.set(k, v);
    qs.set('offset', offset);
    try {
      const d = await api('GET', '/api/listings?' + qs);
      if (my !== seq) return;
      if (reset) grid.replaceChildren();
      d.items.forEach((l) => grid.append(card(l)));
      offset += d.items.length;
      moreBtn.hidden = !d.hasMore;
      if (reset && !d.items.length) {
        const filtered = Object.values(f).some(Boolean);
        grid.replaceChildren(filtered
          ? emptyState('Nada coincide con tu búsqueda', 'Prueba con otras palabras o quita algún filtro.')
          : emptyState('Todavía no hay publicaciones', 'Sé la primera persona en publicar algo.',
            h('a', { class: 'btn btn-primary', href: '/vender' }, 'Publicar algo')));
      }
    } catch (e) { toastError(e); }
  }

  function apply() {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) qs.set(k, v);
    const s = qs.toString();
    history.replaceState(null, '', '/' + (s ? '?' + s : ''));
    heading.textContent = title();
    clearBtn.hidden = !s;
    load(true);
  }

  const kinds = [['', 'Todo'], ['venta', 'En venta'], ['busco', 'Se busca']];
  const kindSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Tipo de publicación' });
  const cats = h('div', { class: 'cats' });
  function drawChoices() {
    kindSeg.replaceChildren(...kinds.map(([v, label]) => h('button', {
      type: 'button', 'aria-pressed': String(f.kind === v), onclick: () => { f.kind = v; drawChoices(); apply(); },
    }, label)));
    cats.replaceChildren(...['', ...state.site.categories].map((c) => h('button', {
      type: 'button', 'aria-pressed': String(f.cat === c), onclick: () => { f.cat = c; drawChoices(); apply(); },
    }, c || 'Todas las categorías')));
  }
  drawChoices();

  let timer;
  const later = (k) => (e) => { f[k] = e.target.value.trim(); clearTimeout(timer); timer = setTimeout(apply, 350); };
  const sidebar = h('aside', { class: 'filters' },
    kindSeg,
    h('div', { class: 'filter-block' }, h('h2', null, 'Categorías'), cats),
    h('div', { class: 'filter-block' }, h('h2', null, 'Precio'),
      h('div', { class: 'range' },
        h('input', { type: 'number', min: 0, inputmode: 'decimal', placeholder: 'Mínimo', 'aria-label': 'Precio mínimo', value: f.min, oninput: later('min') }),
        h('span', { 'aria-hidden': 'true' }, 'a'),
        h('input', { type: 'number', min: 0, inputmode: 'decimal', placeholder: 'Máximo', 'aria-label': 'Precio máximo', value: f.max, oninput: later('max') }))),
    h('div', { class: 'filter-block' }, h('h2', null, 'Ubicación'),
      h('input', { type: 'text', placeholder: 'Ciudad o zona', 'aria-label': 'Ubicación', value: f.loc, oninput: later('loc') })),
    clearBtn);

  const sort = h('select', { 'aria-label': 'Ordenar', onchange: (e) => { f.sort = e.target.value; apply(); } },
    h('option', { value: '' }, 'Más recientes'),
    h('option', { value: 'precio_asc', selected: f.sort === 'precio_asc' }, 'Precio: menor a mayor'),
    h('option', { value: 'precio_desc', selected: f.sort === 'precio_desc' }, 'Precio: mayor a menor'));

  heading.textContent = title();
  clearBtn.hidden = !Object.values(f).some(Boolean);
  await load(true);

  return h('div', { class: 'home' },
    sidebar,
    h('section', { class: 'home-main' },
      h('div', { class: 'home-head' },
        heading,
        h('button', { class: 'btn btn-small filters-toggle', type: 'button', onclick: () => sidebar.classList.toggle('is-open') }, icon('sliders', 16), 'Filtros'),
        sort),
      grid,
      h('div', { class: 'more-row' }, moreBtn)));
}

// ───────────────────────── Publicación + chat ─────────────────────────
function gallery(l) {
  const items = l.media;
  if (!items.length) return h('div', { class: 'gallery is-empty' }, h('span', null, 'Se busca'));
  let i = 0;
  const stage = h('div', { class: 'gallery-stage' });
  const thumbs = h('div', { class: 'gallery-thumbs' });
  function show(n) {
    i = (n + items.length) % items.length;
    const it = items[i];
    stage.replaceChildren(...[
      it.kind === 'video'
        ? h('video', { src: it.url, controls: true, playsInline: true, preload: 'metadata' })
        : h('button', { class: 'gallery-img', type: 'button', 'aria-label': 'Ver foto en grande', onclick: () => lightbox(items, i) }, h('img', { src: it.url, alt: l.title })),
      items.length > 1 && h('button', { class: 'gallery-nav is-prev', type: 'button', 'aria-label': 'Foto anterior', onclick: () => show(i - 1) }, icon('left')),
      items.length > 1 && h('button', { class: 'gallery-nav is-next', type: 'button', 'aria-label': 'Foto siguiente', onclick: () => show(i + 1) }, icon('right')),
      l.status === 'vendida' && h('span', { class: 'stamp is-big' }, l.kind === 'busco' ? 'Conseguido' : 'Vendido'),
    ].filter(Boolean));
    [...thumbs.children].forEach((t, idx) => t.setAttribute('aria-current', String(idx === i)));
  }
  if (items.length > 1) {
    items.forEach((it, idx) => thumbs.append(h('button', { type: 'button', 'aria-label': 'Foto ' + (idx + 1), onclick: () => show(idx) },
      it.kind === 'video' ? [h('video', { src: it.url + '#t=0.1', muted: true, preload: 'metadata' }), h('span', { class: 'card-play' }, icon('play', 12))] : h('img', { src: it.url, alt: '', loading: 'lazy' }))));
  }
  show(0);
  return h('div', { class: 'gallery' }, stage, items.length > 1 && thumbs);
}

async function viewListing(id) {
  const l = await api('GET', '/api/listings/' + id);
  document.title = `${l.title} | ${state.site.name}`;
  const mine = !!state.me && state.me.id === l.seller.id;
  const target = 'l' + l.id;

  // Reacciones a la publicación
  const rxBox = h('div', { class: 'msg-rx' });
  renderReactions(rxBox, target, l.reactions);
  onLeave(bus.on('reactions', (d) => { if (d.target === target) renderReactions(rxBox, target, d.reactions); }));

  const saveBtn = h('button', { class: 'btn', type: 'button', 'aria-pressed': String(l.saved) });
  const drawSave = () => {
    saveBtn.replaceChildren(icon('bookmark', 18), l.saved ? 'Guardado' : 'Guardar');
    saveBtn.setAttribute('aria-pressed', String(l.saved));
  };
  drawSave();
  saveBtn.addEventListener('click', () => withAuth(async () => {
    l.saved = (await api('POST', `/api/listings/${l.id}/save`)).saved;
    drawSave();
    toast(l.saved ? 'Guardado. Lo encuentras en tu menú, en Guardados.' : 'Quitado de tus guardados.');
  }));

  const setStatus = async (status) => {
    try { await api('PATCH', '/api/listings/' + l.id, { status }); bus.emit('route'); } catch (e) { toastError(e); }
  };
  const remove = async () => {
    const ok = await confirmDialog({ title: '¿Eliminar esta publicación?', text: 'Se borra junto con todo su chat y sus fotos. No se puede deshacer.', ok: 'Eliminar', danger: true });
    if (!ok) return;
    try { await api('DELETE', '/api/listings/' + l.id); toast('Publicación eliminada.'); go('/'); } catch (e) { toastError(e); }
  };

  const soldWord = l.kind === 'busco' ? 'conseguido' : 'vendido';
  const ownerTools = l.canModerate && h('div', { class: 'owner-tools' },
    l.canEdit && h('a', { class: 'btn', href: `/p/${l.id}/editar` }, icon('edit', 18), 'Editar'),
    l.status === 'activa'
      ? h('button', { class: 'btn', type: 'button', onclick: () => setStatus('vendida') }, icon('check', 18), 'Marcar como ' + soldWord)
      : h('button', { class: 'btn', type: 'button', onclick: () => setStatus('activa') }, 'Volver a publicar'),
    h('button', { class: 'btn btn-danger-ghost', type: 'button', onclick: remove }, icon('trash', 18), 'Eliminar'));

  const info = h('section', { class: 'listing-info' },
    l.kind === 'busco' && h('span', { class: 'chip chip-kind' }, 'Se busca'),
    h('h1', null, l.title),
    h('div', { class: 'price-row' },
      h('span', { class: 'tag is-big' }, l.kind === 'busco' && l.price != null ? 'Hasta ' + fmtPrice(l.price) : fmtPrice(l.price)),
      l.status === 'vendida' && h('span', { class: 'chip chip-sold' }, l.kind === 'busco' ? 'Conseguido' : 'Vendido')),
    h('div', { class: 'facts' },
      h('span', { class: 'chip' }, l.category),
      l.condition && h('span', { class: 'chip' }, CONDITIONS[l.condition]),
      l.location && h('span', { class: 'fact' }, icon('pin', 16), l.location),
      h('span', { class: 'fact' }, 'Publicado ' + timeAgo(l.createdAt))),
    h('div', { class: 'listing-actions' },
      h('button', {
        class: 'btn btn-primary to-chat', type: 'button',
        onclick: () => document.querySelector('.listing-chat').scrollIntoView({ behavior: 'smooth', block: 'start' }),
      }, icon('chat', 18), l.messageCount ? `Ver el chat (${l.messageCount})` : 'Abrir el chat'),
      rxBox,
      h('button', { class: 'btn', type: 'button', onclick: (e) => emojiPicker(e.currentTarget, (em) => react(target, em)) }, icon('smile', 18), 'Reaccionar'),
      saveBtn,
      h('button', { class: 'btn', type: 'button', onclick: () => copyText(location.origin + '/p/' + l.id, 'Enlace copiado') }, icon('link', 18), 'Copiar enlace')),
    ownerTools,
    l.description && h('div', { class: 'description' }, h('h2', null, 'Descripción'), h('p', null, l.description)),
    h('div', { class: 'seller' },
      h('a', { class: 'seller-who', href: userPath(l.seller) }, avatar(l.seller, 48),
        h('span', null, h('small', { class: 'muted' }, l.kind === 'busco' ? 'Lo busca' : 'Lo vende'), h('strong', null, l.seller.username))),
      !mine && h('button', {
        class: 'btn btn-primary', type: 'button',
        onclick: () => withAuth(async () => {
          const t = await api('POST', '/api/dms', { username: l.seller.username, listingId: l.id });
          go('/mensajes/' + t.id);
        }),
      }, icon('mail', 18), 'Mensaje privado')),
    h('p', { class: 'safety' }, icon('shield', 16),
      h('span', null, 'Para comprar con calma: queda en un lugar público, revisa el artículo antes de pagar y no envíes dinero por adelantado.')),
    !mine && h('button', { class: 'link-btn', type: 'button', onclick: async () => { if (await requireAuth()) reportDialog(target, 'publicación'); } }, 'Reportar esta publicación'));

  // Chat
  const viewers = h('span', { class: 'viewers', hidden: true });
  onLeave(bus.on('presence', (d) => {
    if (d.room !== target) return;
    viewers.hidden = d.count < 2;
    viewers.replaceChildren(icon('eye', 14), `${d.count} viendo ahora`);
  }));
  onLeave(bus.on('listing', (d) => {
    if (d.id !== l.id) return;
    if (d.status === 'eliminada') { toast('Esta publicación fue eliminada.'); go('/', { replace: true }); } else if (d.status !== l.status) bus.emit('route');
  }));
  const chat = createChat({
    room: target,
    canModerate: l.canModerate,
    ownerId: l.seller.id,
    trackRead: mine,
    emptyTitle: 'Nadie ha escrito todavía',
    emptyText: 'Pregunta lo que quieras saber, haz una oferta o deja tu opinión.',
    placeholder: 'Opina u oferta',
  });
  onLeave(chat.destroy);

  return h('div', { class: 'listing' },
    h('div', { class: 'listing-main' }, gallery(l), info),
    h('aside', { class: 'listing-chat', 'aria-label': 'Chat de la publicación' },
      h('div', { class: 'chat-head' },
        h('div', { class: 'chat-head-title' }, h('h2', null, 'Chat de la publicación'), h('small', { class: 'muted' }, 'Público: lo ve cualquiera que entre')),
        viewers),
      chat.el));
}

// ───────────────────────── Vender / editar ─────────────────────────
async function viewSell(id) {
  if (!state.me) return gate('Crea tu usuario para publicar', 'Solo tienes que elegir un nombre. Tarda diez segundos.');
  const editing = id ? await api('GET', '/api/listings/' + id) : null;
  if (editing && !editing.canEdit) throw new Error('Solo quien publicó puede editar esta publicación.');
  document.title = `${editing ? 'Editar publicación' : 'Publicar'} | ${state.site.name}`;

  let kind = editing ? editing.kind : 'venta';
  const tiles = h('div', { class: 'sell-tiles' });
  const fileInput = h('input', { type: 'file', multiple: true, accept: 'image/*,video/*', hidden: true });
  const tileMap = new Map();
  const uploader = createUploader({
    max: 10,
    accept: /^(image|video)\//,
    onError: toastError,
    onChange: (what, item) => {
      if (what !== 'list') { if (tileMap.has(item.key)) tileMap.get(item.key).update(); return; }
      tileMap.clear();
      tiles.replaceChildren(
        ...uploader.items.map((it, idx) => {
          const t = pendingTile(it, {
            onRemove: () => uploader.remove(it),
            extra: idx === 0
              ? h('span', { class: 'tile-cover' }, 'Portada')
              : h('button', { type: 'button', class: 'tile-cover is-btn', onclick: () => uploader.moveFirst(it) }, 'Usar de portada'),
          });
          tileMap.set(it.key, t);
          return t;
        }),
        ...(uploader.items.length < 10 ? [h('button', { type: 'button', class: 'tile tile-add', onclick: () => fileInput.click() },
          icon('image', 26), h('span', null, uploader.items.length ? 'Agregar más' : 'Agregar fotos o videos'))] : []));
    },
  });
  fileInput.addEventListener('change', () => { uploader.addFiles([...fileInput.files]); fileInput.value = ''; });
  if (editing) editing.media.forEach((m) => uploader.addExisting(m));
  uploader.addFiles([]);

  const title = h('input', { type: 'text', maxlength: 100, required: true, placeholder: 'Qué es, marca y modelo', value: editing ? editing.title : '' });
  const price = h('input', { type: 'number', min: 0, step: '0.01', inputmode: 'decimal', placeholder: '0', value: editing && editing.price != null ? String(editing.price) : '' });
  const category = h('select', { required: true },
    h('option', { value: '' }, 'Elige una'),
    state.site.categories.map((c) => h('option', { value: c, selected: !!editing && editing.category === c }, c)));
  const condition = h('select', null,
    h('option', { value: '' }, 'Sin especificar'),
    Object.entries(CONDITIONS).map(([v, label]) => h('option', { value: v, selected: !!editing && editing.condition === v }, label)));
  const where = h('input', { type: 'text', maxlength: 80, placeholder: 'Ciudad o zona', value: editing ? editing.location : '' });
  const description = h('textarea', { rows: 6, maxlength: 5000, placeholder: 'Estado, medidas, qué incluye, por qué lo vendes…' });
  if (editing) description.value = editing.description;

  const priceLabel = h('span');
  const priceHint = h('small', { class: 'muted' });
  const conditionField = field('Estado', condition);
  const photosHint = h('p', { class: 'muted' });
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Tipo de publicación' });
  function drawKind() {
    seg.replaceChildren(...[['venta', 'Vendo algo'], ['busco', 'Busco algo']].map(([v, label]) => h('button', {
      type: 'button', 'aria-pressed': String(kind === v), onclick: () => { kind = v; drawKind(); },
    }, label)));
    priceLabel.textContent = kind === 'busco' ? 'Presupuesto máximo' : 'Precio';
    priceHint.textContent = kind === 'busco' ? 'Opcional.' : 'Déjalo vacío si es a convenir. Pon 0 si lo regalas.';
    conditionField.hidden = kind === 'busco';
    photosHint.textContent = kind === 'busco'
      ? 'Opcional: una foto de referencia ayuda a que te entiendan. Hasta 10.'
      : 'Hasta 10. La primera es la portada: que se vea bien el artículo completo.';
  }
  drawKind();

  const submit = h('button', { class: 'btn btn-primary' }, editing ? 'Guardar cambios' : 'Publicar');
  const form = h('form', {
    class: 'sell-form',
    onsubmit: async (e) => {
      e.preventDefault();
      if (uploader.busy) { toast('Espera a que terminen de subir los archivos.'); return; }
      submit.disabled = true;
      const data = {
        kind, title: title.value, price: price.value === '' ? null : Number(price.value), category: category.value,
        condition: kind === 'busco' ? '' : condition.value, location: where.value, description: description.value, media: uploader.ids,
      };
      try {
        const saved = editing ? await api('PATCH', '/api/listings/' + editing.id, data) : await api('POST', '/api/listings', data);
        toast(editing ? 'Cambios guardados.' : 'Publicado.');
        go('/p/' + saved.id);
      } catch (err) { toastError(err); submit.disabled = false; }
    },
  },
  seg,
  h('fieldset', null, h('legend', null, 'Fotos y videos'), photosHint, tiles, fileInput),
  field('Título', title),
  h('div', { class: 'field-row' },
    h('label', { class: 'field' }, priceLabel, h('span', { class: 'money' }, h('span', { 'aria-hidden': 'true' }, state.site.currency), price), priceHint),
    field('Categoría', category)),
  h('div', { class: 'field-row' }, conditionField, field('Ubicación', where)),
  field('Descripción', description),
  h('div', { class: 'form-actions' },
    h('a', { class: 'btn', href: editing ? '/p/' + editing.id : '/' }, 'Cancelar'),
    submit));

  return h('div', { class: 'page narrow' }, h('h1', null, editing ? 'Editar publicación' : '¿Qué vas a publicar?'), form);
}

// ───────────────────────── Perfil ─────────────────────────
function editProfileDialog() {
  const me = state.me;
  let avatarId; // undefined = sin cambios, null = quitar, texto = nueva foto
  openDialog((close) => {
    const preview = h('div', { class: 'avatar-edit' }, avatar(me, 84));
    const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
    const bio = h('textarea', { rows: 3, maxlength: 300, placeholder: 'Qué vendes, en qué zona entregas, horarios…' });
    bio.value = me.bio || '';
    const save = h('button', { class: 'btn btn-primary' }, 'Guardar perfil');
    file.addEventListener('change', async () => {
      const f = file.files[0];
      if (!f) return;
      save.disabled = true;
      try {
        const up = await uploadFile(f);
        if (up.kind !== 'image') throw new Error('Elige una imagen para tu foto.');
        avatarId = up.id;
        preview.replaceChildren(h('img', { class: 'avatar', src: up.url, alt: '', style: { width: '84px', height: '84px' } }));
      } catch (e) { toastError(e); }
      save.disabled = false;
    });
    return h('form', {
      class: 'dialog-body',
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          const body = { bio: bio.value };
          if (avatarId !== undefined) body.avatar = avatarId;
          const d = await api('PATCH', '/api/me', body);
          state.me = d.user;
          close();
          toast('Perfil guardado.');
          bus.emit('route');
        } catch (err) { toastError(err); }
      },
    },
    h('h2', null, 'Editar perfil'),
    h('div', { class: 'avatar-row' }, preview,
      h('div', null,
        h('button', { class: 'btn', type: 'button', onclick: () => file.click() }, 'Cambiar foto'),
        me.avatar && h('button', { class: 'link-btn', type: 'button', onclick: () => { avatarId = null; preview.replaceChildren(avatar({ ...me, avatar: null }, 84)); } }, 'Quitar foto'))),
    file,
    field('Sobre ti', bio),
    h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancelar'), save));
  });
}

async function newAccessCode() {
  const ok = await confirmDialog({
    title: '¿Generar un código de acceso nuevo?',
    text: 'El código anterior deja de funcionar y se cierra tu sesión en los demás dispositivos.',
    ok: 'Generar código',
  });
  if (!ok) return;
  try { const d = await api('POST', '/api/me/access-code'); showAccessCode(d.accessCode, { fresh: false }); } catch (e) { toastError(e); }
}

async function viewProfile(username) {
  const [p, list] = await Promise.all([
    api('GET', '/api/users/' + encodeURIComponent(username)),
    api('GET', '/api/listings?user=' + encodeURIComponent(username)),
  ]);
  const u = p.user;
  document.title = `${u.username} | ${state.site.name}`;
  const since = new Date(u.createdAt).toLocaleDateString('es', { month: 'long', year: 'numeric' });

  const actions = p.isMe
    ? [
      h('button', { class: 'btn', type: 'button', onclick: editProfileDialog }, icon('edit', 18), 'Editar perfil'),
      h('button', { class: 'btn', type: 'button', onclick: newAccessCode }, icon('key', 18), 'Código de acceso'),
    ]
    : [
      !u.banned && h('button', {
        class: 'btn btn-primary', type: 'button',
        onclick: () => withAuth(async () => { const t = await api('POST', '/api/dms', { username: u.username }); go('/mensajes/' + t.id); }),
      }, icon('mail', 18), 'Mensaje privado'),
      h('button', { class: 'btn', type: 'button', onclick: async () => { if (await requireAuth()) reportDialog('u' + u.id, 'usuario'); } }, icon('flag', 18), 'Reportar'),
      state.me && state.me.admin && !u.admin && h('button', {
        class: 'btn btn-danger-ghost', type: 'button',
        onclick: async () => {
          const ok = await confirmDialog(u.banned
            ? { title: `¿Reactivar a ${u.username}?`, ok: 'Reactivar' }
            : { title: `¿Suspender a ${u.username}?`, text: 'No podrá publicar ni escribir, y sus publicaciones dejan de aparecer.', ok: 'Suspender', danger: true });
          if (!ok) return;
          try { await api('POST', `/api/admin/users/${u.id}/ban`, { banned: !u.banned }); bus.emit('route'); } catch (e) { toastError(e); }
        },
      }, u.banned ? 'Reactivar cuenta' : 'Suspender cuenta'),
    ];

  return h('div', { class: 'page' },
    h('section', { class: 'profile' },
      avatar(u, 96),
      h('div', { class: 'profile-text' },
        h('h1', null, u.username, u.admin && h('span', { class: 'badge' }, 'Moderación'), u.banned && h('span', { class: 'chip chip-sold' }, 'Suspendido')),
        h('p', { class: 'muted' }, `En ${state.site.name} desde ${since}. ${p.active} en venta, ${p.sold} ${p.sold === 1 ? 'vendido' : 'vendidos'}.`),
        u.bio && h('p', { class: 'profile-bio' }, u.bio)),
      h('div', { class: 'profile-actions' }, actions)),
    h('h2', { class: 'section-title' }, p.isMe ? 'Tus publicaciones' : 'Publicaciones'),
    list.items.length
      ? h('div', { class: 'grid' }, list.items.map(card))
      : (p.isMe
        ? emptyState('Aún no has publicado nada', 'Sube una foto, pon un precio y listo.', h('a', { class: 'btn btn-primary', href: '/vender' }, 'Publicar algo'))
        : emptyState('Sin publicaciones por ahora')));
}

async function viewSaved() {
  if (!state.me) return gate('Crea tu usuario para guardar publicaciones', 'Así las encuentras rápido cuando quieras volver a verlas.');
  document.title = `Guardados | ${state.site.name}`;
  const d = await api('GET', '/api/listings?saved=1');
  return h('div', { class: 'page' },
    h('h1', null, 'Guardados'),
    d.items.length
      ? h('div', { class: 'grid' }, d.items.map(card))
      : emptyState('No has guardado nada', 'Toca "Guardar" en cualquier publicación para tenerla aquí.', h('a', { class: 'btn btn-primary', href: '/' }, 'Ver publicaciones')));
}

// ───────────────────────── Mensajes privados ─────────────────────────
async function viewMessages(id) {
  if (!state.me) return gate('Crea tu usuario para enviar mensajes', 'Los mensajes privados solo los ven tú y la otra persona.');
  document.title = `Mensajes | ${state.site.name}`;
  let { threads } = await api('GET', '/api/dms');
  let current = null;
  if (id) current = threads.find((t) => t.id === Number(id)) || await api('GET', '/api/dms/' + id);
  if (current) current.unread = false;

  const listEl = h('div', { class: 'inbox-items' });
  function drawList() {
    if (!threads.length && !current) {
      listEl.replaceChildren(h('p', { class: 'muted inbox-none' }, 'Aún no tienes conversaciones. Abre una publicación y toca "Mensaje privado".'));
      return;
    }
    const all = current && !threads.some((t) => t.id === current.id) ? [current, ...threads] : threads;
    listEl.replaceChildren(...all.map((t) => h('a', {
      class: 'inbox-item' + (current && t.id === current.id ? ' is-current' : '') + (t.unread ? ' is-unread' : ''), href: '/mensajes/' + t.id,
    },
    avatar(t.other, 44),
    h('span', { class: 'inbox-text' },
      h('strong', null, t.other.username),
      h('span', { class: 'inbox-last' }, t.last ? (t.last.mine ? 'Tú: ' : '') + t.last.excerpt : 'Conversación nueva')),
    h('span', { class: 'inbox-side' }, t.last && h('small', { class: 'muted' }, timeAgo(t.last.createdAt)), t.unread && h('span', { class: 'dot' })))));
  }
  drawList();
  let timer;
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        threads = (await api('GET', '/api/dms')).threads;
        if (current) threads.forEach((t) => { if (t.id === current.id) t.unread = false; });
        drawList();
      } catch { /* se actualiza con el siguiente mensaje */ }
    }, 300);
  };
  onLeave(bus.on('notify', refresh));
  onLeave(bus.on('message', refresh));
  onLeave(() => clearTimeout(timer));

  let pane;
  if (current) {
    const chat = createChat({
      room: current.room,
      trackRead: true,
      emptyTitle: `Escríbele a ${current.other.username}`,
      emptyText: 'Este chat es privado: solo lo ven ustedes dos.',
      placeholder: `Mensaje para ${current.other.username}`,
    });
    onLeave(chat.destroy);
    const li = current.listing;
    pane = h('section', { class: 'inbox-thread' },
      h('div', { class: 'chat-head' },
        h('a', { class: 'icon-btn inbox-back', href: '/mensajes', 'aria-label': 'Volver a la lista' }, icon('left')),
        h('a', { class: 'thread-who', href: userPath(current.other) }, avatar(current.other, 36), h('strong', null, current.other.username)),
        li && h('a', { class: 'thread-listing', href: '/p/' + li.id },
          li.cover && li.cover.kind === 'image' && h('img', { src: li.cover.url, alt: '' }),
          h('span', null, h('span', { class: 'thread-listing-title' }, li.title), h('small', { class: 'muted' }, fmtPrice(li.price))))),
      chat.el);
  } else {
    pane = h('section', { class: 'inbox-thread is-blank' }, emptyState('Tus mensajes privados', 'Elige una conversación de la lista.'));
  }

  return h('div', { class: 'inbox' + (current ? ' has-thread' : '') },
    h('aside', { class: 'inbox-list' }, h('h1', null, 'Mensajes'), listEl),
    pane);
}

// ───────────────────────── Moderación ─────────────────────────
async function viewAdmin() {
  if (!state.me || !state.me.admin) throw new Error('Esta página es solo para quien administra la tienda.');
  document.title = `Moderación | ${state.site.name}`;
  const { reports } = await api('GET', '/api/admin/reports');
  const act = async (fn, done) => { try { await fn(); toast(done); bus.emit('route'); } catch (e) { toastError(e); } };
  const what = { l: 'Publicación', m: 'Mensaje', u: 'Usuario' };
  return h('div', { class: 'page narrow' },
    h('h1', null, 'Moderación'),
    h('p', { class: 'muted' }, 'Reportes pendientes. También puedes borrar cualquier mensaje o publicación directamente desde su página.'),
    reports.length ? reports.map((r) => h('article', { class: 'report' },
      h('div', { class: 'report-head' },
        h('span', { class: 'chip' }, what[r.target[0]]),
        h('span', { class: 'muted' }, `Reportado por ${r.reporter.username}, ${timeAgo(r.createdAt)}`)),
      r.gone
        ? h('p', { class: 'muted' }, 'El contenido ya no existe.')
        : h('p', null, h('strong', null, r.author.username + ': '), r.summary || '(sin texto)'),
      r.reason && h('p', { class: 'report-reason' }, 'Motivo: ' + r.reason),
      h('div', { class: 'report-actions' },
        !r.gone && r.link && h('a', { class: 'btn btn-small', href: r.link }, 'Ver'),
        !r.gone && r.target[0] === 'm' && h('button', { class: 'btn btn-small', type: 'button', onclick: () => act(() => api('DELETE', '/api/messages/' + r.target.slice(1)), 'Mensaje borrado.') }, 'Borrar mensaje'),
        !r.gone && r.target[0] === 'l' && h('button', { class: 'btn btn-small', type: 'button', onclick: () => act(() => api('DELETE', '/api/listings/' + r.target.slice(1)), 'Publicación eliminada.') }, 'Eliminar publicación'),
        !r.gone && r.author.id !== state.me.id && h('button', { class: 'btn btn-small', type: 'button', onclick: () => act(() => api('POST', `/api/admin/users/${r.author.id}/ban`, { banned: true }), 'Usuario suspendido.') }, 'Suspender a ' + r.author.username),
        h('button', { class: 'btn btn-small btn-primary', type: 'button', onclick: () => act(() => api('POST', `/api/admin/reports/${r.id}/resolve`), 'Reporte cerrado.') }, 'Marcar resuelto'))))
      : emptyState('No hay reportes pendientes', 'Cuando alguien reporte algo aparecerá aquí.'));
}

// ───────────────────────── Navegación ─────────────────────────
const ROUTES = [
  { rx: /^\/$/, view: viewHome },
  { rx: /^\/p\/(\d+)$/, view: viewListing, room: (id) => 'l' + id },
  { rx: /^\/p\/(\d+)\/editar$/, view: viewSell },
  { rx: /^\/vender$/, view: viewSell },
  { rx: /^\/usuario\/([^/]+)$/, view: viewProfile },
  { rx: /^\/mensajes(?:\/(\d+))?$/, view: viewMessages, room: (id) => (id ? 'd' + id : null) },
  { rx: /^\/guardados$/, view: viewSaved },
  { rx: /^\/moderacion$/, view: viewAdmin },
];

let token = 0;
let lastPath = null;
let lastUnread = Date.now();
async function render() {
  const my = ++token;
  cleanups.splice(0).forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  closeEmojiPicker();
  renderHeader();
  const path = location.pathname.replace(/\/+$/, '') || '/';
  let match = null;
  for (const r of ROUTES) { const m = r.rx.exec(path); if (m) { match = { r, m }; break; } }
  if (!match) {
    connectEvents(null);
    view.inert = false;
    view.replaceChildren(h('div', { class: 'page narrow' }, emptyState('Esta página no existe', 'Puede que el enlace esté mal escrito.', h('a', { class: 'btn btn-primary', href: '/' }, 'Ir al inicio'))));
    return;
  }
  const args = match.m.slice(1).map((a) => (a === undefined ? a : decodeURIComponent(a)));
  connectEvents(match.r.room ? match.r.room(...args) : null);
  document.body.classList.toggle('has-chat', !!match.r.room);
  if (!match.r.room && Date.now() - lastUnread > 20_000) { lastUnread = Date.now(); refreshUnread(); }
  document.documentElement.classList.add('is-loading');
  // Mientras carga la pantalla nueva, la anterior no se puede usar: así nadie escribe
  // por error en el chat que está dejando.
  if (location.pathname + location.search !== lastPath) view.inert = true;
  let node;
  try {
    node = await match.r.view(...args);
  } catch (e) {
    node = h('div', { class: 'page narrow' }, emptyState(e.status === 404 ? 'No lo encontramos' : 'No se pudo abrir', e.message, h('a', { class: 'btn btn-primary', href: '/' }, 'Ir al inicio')));
  }
  if (my !== token) return;
  document.documentElement.classList.remove('is-loading');
  view.inert = false;
  view.replaceChildren(node);
  const full = location.pathname + location.search;
  if (full !== lastPath) window.scrollTo(0, 0);
  lastPath = full;
}

bus.on('route', render);
window.addEventListener('popstate', render);
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest('a[href]');
  if (!a || a.target || a.hasAttribute('download') || a.origin !== location.origin || a.pathname.startsWith('/media/')) return;
  e.preventDefault();
  go(a.pathname + a.search);
});

bus.on('auth', () => { connectEvents(currentRoom(), { force: true }); render(); });
bus.on('unread', () => { if (!header.contains(document.activeElement)) renderHeader(); });
bus.on('notify', (n) => {
  refreshUnread();
  if (currentRoom() === n.room) return;
  const text = n.type === 'dm'
    ? `${n.from.username} te escribió: ${n.excerpt}`
    : `${n.from.username} comentó en "${n.title}": ${n.excerpt}`;
  toast(text, { action: 'Ver', ms: 6000, onAction: () => go(n.type === 'dm' ? '/mensajes/' + n.threadId : '/p/' + n.listingId) });
});

loadMe().then(render, (e) => {
  view.replaceChildren(h('div', { class: 'page narrow' }, emptyState('No se pudo conectar con la tienda', e.message,
    h('button', { class: 'btn btn-primary', type: 'button', onclick: () => location.reload() }, 'Reintentar'))));
});
