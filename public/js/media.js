// Subida de archivos, visor a pantalla completa y dibujo de adjuntos.
import { h, icon, state, fmtSize, api } from './core.js';

async function prepare(file) {
  const out = { blob: file, w: null, h: null };
  const heic = /^image\/hei[cf]/.test(file.type) || /\.hei[cf]$/i.test(file.name || '');
  if ((!/^image\//.test(file.type) && !heic) || file.type === 'image/svg+xml') return out;
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { return out; }
  out.w = bmp.width;
  out.h = bmp.height;
  // Las fotos de teléfono pesan mucho: se reducen antes de subir. Los GIF y PNG se dejan intactos.
  const big = file.size > 1.5 * 1024 * 1024 || Math.max(bmp.width, bmp.height) > 2560;
  // Las fotos HEIC de iPhone se convierten a JPG para que se vean en cualquier navegador.
  if (heic || (big && (file.type === 'image/jpeg' || file.type === 'image/webp'))) {
    const scale = Math.min(1, 2560 / Math.max(bmp.width, bmp.height));
    const canvas = h('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.86));
    if (blob && (heic || blob.size < file.size)) { out.blob = blob; out.w = canvas.width; out.h = canvas.height; }
  }
  if (bmp.close) bmp.close();
  return out;
}

// En Vercel el archivo va directo del navegador a Vercel Blob (así no hay límite de 4,5 MB);
// después se avisa a la tienda para que lo verifique y lo registre.
async function uploadToBlob(file, blob, w, height, { onProgress, signal }) {
  const { upload } = await import('./vendor/blob-client.js');
  const safe = (file.name || 'archivo').normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-80) || 'archivo';
  let result;
  try {
    result = await upload(`u/${state.me.id}/${safe}`, blob, {
      access: 'public',
      handleUploadUrl: '/api/uploads/token',
      contentType: /^(image|video|audio)\//.test(blob.type) && blob.type !== 'image/svg+xml' ? blob.type.split(';')[0] : 'application/octet-stream',
      multipart: blob.size > 8 * 1024 * 1024,
      abortSignal: signal,
      onUploadProgress: (e) => { if (onProgress) onProgress(Math.min(0.98, e.percentage / 100)); },
    });
  } catch (e) {
    if (signal && signal.aborted) throw new DOMException('Cancelado', 'AbortError');
    console.error(e);
    throw new Error(`No se pudo subir "${file.name}". Revisa tu conexión y que no pese más de ${state.site.maxFileMB} MB.`);
  }
  if (signal && signal.aborted) throw new DOMException('Cancelado', 'AbortError');
  return api('POST', '/api/uploads/register', { url: result.url, name: file.name || 'archivo', w, h: height });
}

// Sube un archivo y devuelve { id, kind, url, ... }. onProgress recibe un número de 0 a 1.
export function uploadFile(file, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (file.size > state.site.maxFileMB * 1024 * 1024) {
      reject(new Error(`"${file.name}" pesa demasiado (máximo ${state.site.maxFileMB} MB).`));
      return;
    }
    if (file.size === 0) { reject(new Error(`"${file.name}" está vacío.`)); return; }
    if (state.site.uploads === 'none') { reject(new Error('La tienda todavía no tiene conectado el almacenamiento de archivos.')); return; }
    prepare(file).then(({ blob, w, h: height }) => {
      if (signal && signal.aborted) { reject(new DOMException('Cancelado', 'AbortError')); return; }
      if (state.site.uploads === 'blob') { uploadToBlob(file, blob, w, height, { onProgress, signal }).then(resolve, reject); return; }
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/uploads');
      xhr.setRequestHeader('Content-Type', blob.type || 'application/octet-stream');
      xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name || 'archivo'));
      if (w && height) { xhr.setRequestHeader('X-Width', w); xhr.setRequestHeader('X-Height', height); }
      xhr.upload.onprogress = (e) => { if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total); };
      xhr.onload = () => {
        let data = null;
        try { data = JSON.parse(xhr.responseText); } catch { /* sin cuerpo */ }
        if (xhr.status === 200 && data) resolve(data);
        else reject(new Error((data && data.error) || 'No se pudo subir el archivo.'));
      };
      xhr.onerror = () => reject(new Error(`No se pudo subir "${file.name}". Revisa tu conexión y que no pese más de ${state.site.maxFileMB} MB.`));
      xhr.onabort = () => reject(new DOMException('Cancelado', 'AbortError'));
      if (signal) signal.addEventListener('abort', () => xhr.abort());
      xhr.send(blob);
    }, reject);
  });
}

// ───────── Visor a pantalla completa ─────────
export function lightbox(items, index = 0) {
  let i = index;
  const stage = h('div', { class: 'lb-stage' });
  const counter = h('span', { class: 'lb-count' });
  const prev = h('button', { class: 'lb-nav lb-prev', type: 'button', 'aria-label': 'Anterior', onclick: () => show(i - 1) }, icon('left', 28));
  const next = h('button', { class: 'lb-nav lb-next', type: 'button', 'aria-label': 'Siguiente', onclick: () => show(i + 1) }, icon('right', 28));
  const dlg = h('dialog', { class: 'lightbox' },
    h('div', { class: 'lb-bar' },
      counter,
      h('a', { class: 'icon-btn', 'aria-label': 'Descargar', title: 'Descargar', download: '' }, icon('download')),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Cerrar', onclick: () => dlg.close() }, icon('x'))),
    prev, stage, next);

  function show(n) {
    i = (n + items.length) % items.length;
    const it = items[i];
    stage.replaceChildren(it.kind === 'video'
      ? h('video', { src: it.url, controls: true, autoplay: '', playsInline: true })
      : h('img', { src: it.url, alt: it.name || '' }));
    counter.textContent = items.length > 1 ? `${i + 1} de ${items.length}` : '';
    dlg.querySelector('a[download]').href = it.download || it.url;
    prev.hidden = next.hidden = items.length < 2;
  }
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') show(i - 1);
    if (e.key === 'ArrowRight') show(i + 1);
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target === stage) dlg.close(); });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  show(i);
  dlg.showModal();
}

// Las grabaciones del navegador (webm) no traen su duración y el reproductor mostraría "0:00 / --".
// Saltar al final obliga al navegador a calcularla; luego se vuelve al inicio.
export function fixDuration(audio) {
  audio.addEventListener('loadedmetadata', () => {
    if (audio.duration !== Infinity && !Number.isNaN(audio.duration)) return;
    const back = () => { audio.removeEventListener('timeupdate', back); audio.currentTime = 0; };
    audio.addEventListener('timeupdate', back);
    audio.currentTime = 1e101;
  }, { once: true });
  return audio;
}

// ───────── Adjuntos dentro de un mensaje ─────────
export function renderAttachments(list) {
  const visual = list.filter((a) => a.kind === 'image');
  const out = [];
  if (visual.length) {
    const grid = h('div', { class: 'att-images' + (visual.length > 1 ? ' is-grid n' + Math.min(visual.length, 4) : '') });
    visual.forEach((a, idx) => {
      const img = h('img', { src: a.url, alt: a.name || 'Imagen', loading: 'lazy' });
      const btn = h('button', { type: 'button', class: 'att-image', 'aria-label': 'Ver imagen', onclick: () => lightbox(visual, idx) }, img);
      if (visual.length === 1 && a.w && a.h) {
        const maxW = 360;
        const maxH = 320;
        const scale = Math.min(1, maxW / a.w, maxH / a.h);
        btn.style.width = Math.max(60, Math.round(a.w * scale)) + 'px';
        btn.style.aspectRatio = `${a.w} / ${a.h}`;
      }
      grid.append(btn);
    });
    out.push(grid);
  }
  for (const a of list) {
    if (a.kind === 'video') {
      out.push(h('video', { class: 'att-video', src: a.url, controls: true, preload: 'metadata', playsInline: true }));
    } else if (a.kind === 'audio' && /^nota-de-voz\./.test(a.name)) {
      out.push(h('div', { class: 'att-voice' },
        h('span', { class: 'att-voice-icon', title: 'Nota de voz' }, icon('mic', 18)),
        fixDuration(h('audio', { src: a.url, controls: true, preload: 'metadata', 'aria-label': 'Nota de voz' }))));
    } else if (a.kind === 'audio') {
      out.push(h('div', { class: 'att-audio' },
        h('span', { class: 'att-name' }, a.name),
        fixDuration(h('audio', { src: a.url, controls: true, preload: 'metadata' }))));
    } else if (a.kind === 'file') {
      out.push(h('a', { class: 'att-file', href: a.download || a.url, download: a.name },
        h('span', { class: 'att-file-icon' }, icon('file', 22)),
        h('span', { class: 'att-file-text' }, h('span', { class: 'att-name' }, a.name), h('span', { class: 'muted' }, fmtSize(a.size))),
        icon('download', 18)));
    }
  }
  return out;
}

// ───────── Archivos pendientes de enviar (compositor y formulario de venta) ─────────
// Lleva la lista de archivos en subida. `onChange` se llama cada vez que cambia algo.
export function createUploader({ max = 10, accept = null, onChange, onError }) {
  const items = []; // { key, file, preview, kind, progress, upload, error, ctrl }
  let key = 0;

  function addFiles(files) {
    for (const file of files) {
      if (items.length >= max) { onError(new Error(`Máximo ${max} archivos.`)); break; }
      if (accept && !accept.test(file.type)) { onError(new Error(`"${file.name}" no es una foto ni un video.`)); continue; }
      const kind = /^image\//.test(file.type) ? 'image' : /^video\//.test(file.type) ? 'video' : /^audio\//.test(file.type) ? 'audio' : 'file';
      const item = {
        key: ++key, file, kind, progress: 0, upload: null, error: null,
        preview: kind === 'image' || kind === 'video' ? URL.createObjectURL(file) : null,
        ctrl: new AbortController(),
      };
      items.push(item);
      uploadFile(file, { signal: item.ctrl.signal, onProgress: (p) => { item.progress = p; onChange('progress', item); } })
        .then((u) => { item.upload = u; item.progress = 1; onChange('done', item); })
        .catch((e) => {
          if (e.name === 'AbortError') return;
          remove(item, true);
          onError(e);
        });
    }
    onChange('list');
  }
  function addExisting(upload) {
    items.push({ key: ++key, file: null, kind: upload.kind, progress: 1, upload, error: null, preview: upload.url, existing: true, ctrl: null });
    onChange('list');
  }
  function remove(item, silent) {
    const i = items.indexOf(item);
    if (i < 0) return;
    items.splice(i, 1);
    if (item.ctrl) item.ctrl.abort();
    if (item.preview && !item.existing) URL.revokeObjectURL(item.preview);
    onChange('list');
    if (!silent && item.file) { /* el servidor borra solo lo que nunca se publica */ }
  }
  function moveFirst(item) {
    const i = items.indexOf(item);
    if (i > 0) { items.splice(i, 1); items.unshift(item); onChange('list'); }
  }
  function clear() {
    for (const it of items) if (it.preview && !it.existing) URL.revokeObjectURL(it.preview);
    items.length = 0;
    onChange('list');
  }
  return {
    items, addFiles, addExisting, remove, moveFirst, clear,
    get busy() { return items.some((it) => !it.upload); },
    get ids() { return items.filter((it) => it.upload).map((it) => it.upload.id); },
  };
}

// Miniatura de un archivo pendiente, con barra de progreso y botón de quitar.
export function pendingTile(item, { onRemove, extra } = {}) {
  let thumb;
  if (item.kind === 'image') thumb = h('img', { src: item.preview, alt: '' });
  else if (item.kind === 'video') thumb = h('video', { src: item.preview, muted: true, preload: 'metadata' });
  else thumb = h('span', { class: 'tile-file' }, icon('file', 22), h('span', null, (item.file && item.file.name) || (item.upload && item.upload.name) || 'Archivo'));
  const bar = h('span', { class: 'tile-bar', hidden: !!item.upload }, h('span', { style: { width: Math.round(item.progress * 100) + '%' } }));
  const tile = h('div', { class: 'tile' + (item.upload ? '' : ' is-loading'), dataset: { key: item.key } },
    thumb,
    item.kind === 'video' && h('span', { class: 'tile-play' }, icon('play', 16)),
    bar,
    h('button', { type: 'button', class: 'tile-x', 'aria-label': 'Quitar', onclick: onRemove }, icon('x', 14)),
    extra);
  tile.update = () => {
    bar.firstChild.style.width = Math.round(item.progress * 100) + '%';
    if (item.upload) { bar.hidden = true; tile.classList.remove('is-loading'); }
  };
  return tile;
}
