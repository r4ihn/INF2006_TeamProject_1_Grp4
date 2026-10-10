// Startup safety net: if the app's JavaScript fails to load or crashes before React
// renders, show the error on the page instead of a blank white screen.
// A separate file (not inline in index.html) so the server's Content-Security-Policy can
// forbid inline scripts.
(function () {
  function show(msg) {
    var root = document.getElementById('root');
    if (!root || root.getAttribute('data-app-ready') === 'true') return;
    root.innerHTML = '';
    var box = document.createElement('div');
    box.style.cssText =
      'font-family:system-ui,sans-serif;max-width:720px;margin:48px auto;padding:20px;' +
      'border:1px solid #e0b4a6;border-radius:12px;background:#fbece7;color:#2a211b';
    var h = document.createElement('strong');
    h.textContent = 'CafeStock failed to start';
    var pre = document.createElement('pre');
    pre.style.cssText = 'white-space:pre-wrap;font-size:13px;margin:12px 0';
    pre.textContent = msg;
    var tip = document.createElement('div');
    tip.style.fontSize = '14px';
    tip.textContent =
      'Copy this message (and anything red in the VS Code terminal) and send it over.';
    box.append(h, pre, tip);
    root.appendChild(box);
  }
  window.__showStartupError = show;
  window.addEventListener(
    'error',
    function (e) {
      if (e.target && e.target.tagName === 'SCRIPT') {
        show('Could not load script: ' + e.target.src);
      } else {
        show(e.message + (e.filename ? '\n  at ' + e.filename + ':' + e.lineno : ''));
      }
    },
    true,
  );
  window.addEventListener('unhandledrejection', function (e) {
    show(String((e.reason && (e.reason.stack || e.reason.message)) || e.reason));
  });
  // If React still hasn't rendered after 8 seconds, say so.
  setTimeout(function () {
    show(
      'The page loaded, but the app did not start within 8 seconds.\n' +
        'Open DevTools (F12) > Console to see the error.',
    );
  }, 8000);
})();
