/* Shared theme preference of all Perp DEX Stats pages (light / dark): applied before the first paint, saved whenever any page toggles it. */
(function () {
  var K = 'pds_theme', r = document.documentElement;
  try { var t = localStorage.getItem(K); if (t === 'light' || t === 'dark') r.setAttribute('data-theme', t); } catch (e) { }
  new MutationObserver(function () { try { localStorage.setItem(K, r.getAttribute('data-theme') || 'dark'); } catch (e) { } }).observe(r, { attributes: true, attributeFilter: ['data-theme'] });
})();
