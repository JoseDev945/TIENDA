import { h } from './core.js';

const split = (s) => s.split(' ');
export const EMOJI = [
  { name: 'Caras', icon: '😀', list: split('😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 💩 🤡 👻 👽 🤖') },
  { name: 'Gestos', icon: '👍', list: split('👍 👎 👌 🤌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 👋 🤝 🙏 👏 🙌 💪 ✍️ 🤳 👀 🧠 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💯 🔥 ✨ ⭐ 🌟 💫 💥 💢 💦 💨 🎉 🎊') },
  { name: 'Compra y venta', icon: '💰', list: split('💰 💵 💸 💳 🪙 🏷️ 🛒 🛍️ 📦 🎁 📈 📉 🧾 🔖 ✅ ❌ ⚠️ ❓ ❗ 🆕 🆓 🔝 🔔 📌 📍 🚚 ✈️ ⏰ ⌛ 🔒 🔑 📞 💬 🤝 👑 💎 🏆 🥇') },
  { name: 'Cosas', icon: '📱', list: split('📱 💻 ⌨️ 🖥️ 🖨️ 🎮 🕹️ 🎧 📷 🎥 📺 ⌚ 👕 👖 👗 👟 👠 👜 🎒 🕶️ 💍 💄 🚗 🚙 🏍️ 🚲 🛴 🏠 🛋️ 🛏️ 🚪 🔧 🔨 🪛 🧰 ⚽ 🏀 🎸 🎹 📚 🧸 🍼 ⚔️ 🛡️ 🗡️ 🧪') },
  { name: 'Animales y comida', icon: '🐶', list: split('🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🦄 🐝 🦋 🐢 🐍 🐙 🐬 🐳 🍎 🍌 🍉 🍓 🍍 🥑 🌮 🍕 🍔 🍟 🌭 🍿 🍩 🍪 🎂 ☕ 🍺 🍷 🥤') },
];

export const QUICK = ['👍', '❤️', '😂', '😮', '🔥'];

function recents() {
  try { return JSON.parse(localStorage.getItem('emojis') || '[]').slice(0, 16); } catch { return []; }
}
function remember(e) {
  try { localStorage.setItem('emojis', JSON.stringify([e, ...recents().filter((x) => x !== e)].slice(0, 16))); } catch { /* sin almacenamiento */ }
}

let openPicker = null;
export function closeEmojiPicker() { if (openPicker) openPicker(); }

// Abre el selector junto al botón `anchor`. Si keepOpen es true no se cierra al elegir.
export function emojiPicker(anchor, onPick, { keepOpen = false } = {}) {
  if (openPicker) { const same = openPicker.anchor === anchor; openPicker(); if (same) return; }

  const grid = h('div', { class: 'emoji-grid' });
  const tabs = h('div', { class: 'emoji-tabs', role: 'tablist' });
  const title = h('div', { class: 'emoji-title' });
  const pop = h('div', { class: 'emoji-pop', role: 'dialog', 'aria-label': 'Elegir emoji' }, tabs, title, grid);

  const show = (name, list, tab) => {
    title.textContent = name;
    grid.replaceChildren(...list.map((e) => h('button', {
      type: 'button', class: 'emoji-btn',
      onclick: () => { remember(e); onPick(e); if (!keepOpen) close(); },
    }, e)));
    for (const t of tabs.children) t.setAttribute('aria-selected', String(t === tab));
  };

  const rec = recents();
  const groups = rec.length ? [{ name: 'Recientes', icon: '🕘', list: rec }, ...EMOJI] : EMOJI;
  groups.forEach((g) => {
    const tab = h('button', { type: 'button', class: 'emoji-tab', role: 'tab', title: g.name, 'aria-label': g.name, onclick: () => show(g.name, g.list, tab) }, g.icon);
    tabs.append(tab);
  });
  show(groups[0].name, groups[0].list, tabs.firstChild);

  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  if (window.innerWidth > 560) {
    let left = Math.min(Math.max(8, r.right - pw), window.innerWidth - pw - 8);
    let top = r.top - ph - 8;
    if (top < 8) top = Math.min(r.bottom + 8, window.innerHeight - ph - 8);
    pop.style.left = left + 'px';
    pop.style.top = Math.max(8, top) + 'px';
  } else {
    pop.classList.add('is-sheet');
  }

  const onDown = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') { close(); anchor.focus(); } };
  function close() {
    pop.remove();
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    if (openPicker === close) openPicker = null;
  }
  close.anchor = anchor;
  openPicker = close;
  setTimeout(() => {
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
  });
}
