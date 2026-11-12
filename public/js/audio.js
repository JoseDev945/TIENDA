// Ajustes de audio (como en Discord): qué micrófono usar, supresión de ruido y prueba del micrófono.
// Se guardan en este navegador, porque los micrófonos son de cada dispositivo.
import { h, icon, toast, toastError } from './core.js';
import { fixDuration } from './media.js';

const KEY = 'ajustes-audio';
const DEFAULTS = { deviceId: '', deviceLabel: '', noiseSuppression: true, echoCancellation: true, autoGainControl: true };

export function getAudioPrefs() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}
function saveAudioPrefs(prefs) {
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* sin almacenamiento: vale solo hasta recargar */ }
}

export const canUseMic = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

// Abre el micrófono elegido con los ajustes guardados. Si ese micrófono ya no está conectado,
// usa el predeterminado del sistema y lo avisa.
// El navegador a veces cambia el identificador de un micrófono (por ejemplo, si el permiso no quedó guardado).
// En ese caso se busca el mismo micrófono por su nombre.
async function resolveDevice(prefs) {
  if (!prefs.deviceId) return '';
  let mics = [];
  try { mics = (await listMics()).mics; } catch { return prefs.deviceId; }
  if (!mics.length || mics.some((d) => d.deviceId === prefs.deviceId)) return prefs.deviceId;
  const same = prefs.deviceLabel && mics.find((d) => d.label === prefs.deviceLabel);
  if (!same) return prefs.deviceId;
  const saved = getAudioPrefs();
  if (saved.deviceId === prefs.deviceId) saveAudioPrefs({ ...saved, deviceId: same.deviceId });
  return same.deviceId;
}

export async function openMic(prefs = getAudioPrefs()) {
  const audio = {
    noiseSuppression: prefs.noiseSuppression,
    echoCancellation: prefs.echoCancellation,
    autoGainControl: prefs.autoGainControl,
    channelCount: 1,
  };
  const deviceId = await resolveDevice(prefs);
  if (deviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { ...audio, deviceId: { exact: deviceId } } });
    } catch (e) {
      if (!e || !/OverconstrainedError|NotFoundError|NotReadableError/.test(e.name)) throw e;
      toast('El micrófono que elegiste no está disponible. Se usa el predeterminado.');
    }
  }
  try {
    return await navigator.mediaDevices.getUserMedia({ audio });
  } catch (e) {
    if (e && e.name === 'OverconstrainedError') return navigator.mediaDevices.getUserMedia({ audio: true });
    throw e;
  }
}

export function micErrorText(e) {
  const name = e && e.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Para usar el micrófono, dale permiso: toca el candado junto a la dirección de la página y activa "Micrófono".';
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return 'Otro programa está usando el micrófono (por ejemplo Zoom, Discord o Teams). Ciérralo y vuelve a intentarlo.';
  }
  return 'No se encontró un micrófono en este dispositivo.';
}

// Mide el volumen del micrófono. onLevel recibe un valor de 0 a 1 en cada cuadro.
// onSilence se llama si en 3 segundos no llega ningún sonido.
export function levelMeter(stream, onLevel, onSilence) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return () => {};
  let ctx;
  try { ctx = new Ctx(); } catch { return () => {}; }
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const data = new Uint8Array(analyser.fftSize);
  const started = Date.now();
  let heard = false;
  let warned = false;
  let raf = 0;
  const loop = () => {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += ((v - 128) / 128) ** 2;
    const rms = Math.sqrt(sum / data.length);
    if (rms > 0.004) heard = true;
    // Escala suave: la voz con supresión de ruido llega bajita, así que se amplía.
    onLevel(Math.min(1, Math.sqrt(rms) * 2.2));
    if (onSilence && !heard && !warned && Date.now() - started > 3000) { warned = true; onSilence(); }
    raf = requestAnimationFrame(loop);
  };
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  loop();
  return () => { cancelAnimationFrame(raf); ctx.close().catch(() => {}); };
}

async function listMics() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return { mics: [], named: false };
  const all = await navigator.mediaDevices.enumerateDevices();
  // Sin permiso, Chrome devuelve un micrófono sin identificador: no sirve para elegir, así que se omite.
  const mics = all.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
  // Sin permiso, el navegador no dice los nombres de los micrófonos.
  return { mics, named: mics.some((d) => d.label) };
}

// ───────── Sección "Audio" de la página de ajustes ─────────
export function audioSettings() {
  const prefs = getAudioPrefs();
  let stream = null;
  let stopMeter = null;
  let testing = false;
  let preview = null;

  const select = h('select', { id: 'ajuste-microfono', 'aria-describedby': 'ajuste-microfono-ayuda' });
  const help = h('small', { class: 'muted', id: 'ajuste-microfono-ayuda' });
  const allowBtn = h('button', { class: 'btn btn-small', type: 'button', hidden: true, onclick: allow }, icon('mic', 16), 'Permitir el micrófono para ver la lista');
  const fill = h('span', { class: 'level-fill' });
  const level = h('div', { class: 'level', role: 'meter', 'aria-label': 'Volumen del micrófono', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, fill);
  const testBtn = h('button', { class: 'btn', type: 'button', onclick: () => (testing ? stopTest() : startTest()) }, icon('mic', 18), 'Probar micrófono');
  const recBtn = h('button', { class: 'btn', type: 'button', disabled: true, onclick: recordSample }, 'Grabar 3 segundos y escuchar');
  const sample = h('div', { class: 'audio-sample', hidden: true });
  const status = h('p', { class: 'field-hint', role: 'status' });

  async function refresh() {
    let list;
    try { list = await listMics(); } catch { list = { mics: [], named: false }; }
    let current = getAudioPrefs().deviceId;
    const label = getAudioPrefs().deviceLabel;
    if (current && !list.mics.some((d) => d.deviceId === current)) {
      const same = label && list.mics.find((d) => d.label === label);
      if (same) { current = same.deviceId; save({ deviceId: current }); }
    }
    select.replaceChildren(
      h('option', { value: '' }, 'Predeterminado del sistema'),
      ...list.mics.map((d, i) => h('option', { value: d.deviceId, selected: d.deviceId === current }, d.label || `Micrófono ${i + 1}`)));
    const known = !current || list.mics.some((d) => d.deviceId === current);
    if (!known) select.value = '';
    allowBtn.hidden = list.named || !canUseMic();
    if (!canUseMic()) help.textContent = 'Este navegador no permite usar el micrófono.';
    else if (!list.mics.length && list.named) help.textContent = 'No hay ningún micrófono conectado.';
    else if (!list.named) help.textContent = 'Para ver el nombre de cada micrófono, el navegador necesita tu permiso.';
    else if (!known) help.textContent = 'El micrófono que habías elegido no está conectado. Se usa el predeterminado.';
    else help.textContent = `${list.mics.length === 1 ? 'Hay 1 micrófono disponible' : `Hay ${list.mics.length} micrófonos disponibles`}. Se guarda solo en este dispositivo.`;
  }

  async function allow() {
    try {
      const s = await openMic();
      s.getTracks().forEach((t) => t.stop());
      await refresh();
    } catch (e) { toastError(new Error(micErrorText(e))); }
  }

  function save(patch) {
    Object.assign(prefs, patch);
    saveAudioPrefs(prefs);
    if (testing) { stopTest(); startTest(); }
  }

  async function startTest() {
    status.textContent = '';
    status.className = 'field-hint';
    try { stream = await openMic(prefs); } catch (e) { toastError(new Error(micErrorText(e))); return; }
    testing = true;
    testBtn.replaceChildren(icon('x', 18), 'Detener prueba');
    recBtn.disabled = false;
    status.textContent = 'Habla: la barra debe moverse con tu voz.';
    stopMeter = levelMeter(stream, (v) => {
      fill.style.transform = `scaleX(${v})`;
      level.setAttribute('aria-valuenow', String(Math.round(v * 100)));
    }, () => {
      status.className = 'field-hint is-bad';
      status.textContent = 'No llega ningún sonido. Elige otro micrófono en la lista o revisa la configuración de sonido de tu computadora.';
    });
    refresh();
  }

  function stopTest() {
    testing = false;
    if (stopMeter) stopMeter();
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    stopMeter = null;
    fill.style.transform = 'scaleX(0)';
    level.setAttribute('aria-valuenow', '0');
    testBtn.replaceChildren(icon('mic', 18), 'Probar micrófono');
    recBtn.disabled = true;
    status.textContent = '';
  }

  // Graba 3 segundos con los ajustes elegidos y los reproduce, para oír cómo te escuchan los demás.
  function recordSample() {
    if (!stream || !window.MediaRecorder) return;
    const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
    const mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks = [];
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mr.onstop = () => {
      if (preview) URL.revokeObjectURL(preview);
      preview = URL.createObjectURL(new Blob(chunks, { type: (mr.mimeType || 'audio/webm').split(';')[0] }));
      const player = fixDuration(h('audio', { src: preview, controls: true, preload: 'metadata', 'aria-label': 'Tu grabación de prueba' }));
      sample.replaceChildren(h('span', { class: 'muted' }, 'Así te escuchan:'), player);
      sample.hidden = false;
      recBtn.disabled = !testing;
      recBtn.textContent = 'Grabar 3 segundos y escuchar';
      player.play().catch(() => {});
    };
    recBtn.disabled = true;
    let left = 3;
    recBtn.textContent = `Grabando… ${left}`;
    const tick = setInterval(() => { left--; if (left > 0) recBtn.textContent = `Grabando… ${left}`; }, 1000);
    mr.start();
    setTimeout(() => { clearInterval(tick); if (mr.state !== 'inactive') mr.stop(); }, 3000);
  }

  select.addEventListener('change', () => save({ deviceId: select.value, deviceLabel: select.value ? select.selectedOptions[0].textContent : '' }));
  const toggle = (key, label, hint) => h('label', { class: 'switch' },
    h('input', { type: 'checkbox', checked: prefs[key], onchange: (e) => save({ [key]: e.target.checked }) }),
    h('span', { class: 'switch-track', 'aria-hidden': 'true' }),
    h('span', { class: 'switch-text' }, h('strong', null, label), h('small', { class: 'muted' }, hint)));

  const onDeviceChange = () => refresh();
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);
  refresh();

  const el = h('section', { class: 'settings-card', 'aria-labelledby': 'ajustes-audio' },
    h('h2', { id: 'ajustes-audio' }, 'Audio'),
    h('div', { class: 'field' },
      h('label', { for: 'ajuste-microfono' }, 'Micrófono'),
      select, help, allowBtn),
    h('div', { class: 'switches' },
      toggle('noiseSuppression', 'Supresión de ruido', 'Quita ruidos de fondo como ventiladores, tráfico o teclado.'),
      toggle('echoCancellation', 'Cancelación de eco', 'Evita que se grabe lo que suena por tus altavoces.'),
      toggle('autoGainControl', 'Volumen automático', 'Sube o baja tu volumen para que siempre se te oiga parejo.')),
    h('div', { class: 'mic-test' },
      h('h3', null, 'Prueba de micrófono'),
      level,
      status,
      h('div', { class: 'mic-test-actions' }, testBtn, recBtn),
      sample));

  return {
    el,
    destroy() {
      stopTest();
      if (preview) URL.revokeObjectURL(preview);
      if (navigator.mediaDevices && navigator.mediaDevices.removeEventListener) navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange);
    },
  };
}
