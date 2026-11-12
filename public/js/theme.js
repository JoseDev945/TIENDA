// Aplica el modo claro u oscuro guardado antes de pintar la página (evita el parpadeo).
(function () {
  try {
    var t = localStorage.getItem('tema');
    if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
  } catch (e) { /* sin almacenamiento */ }
})();
