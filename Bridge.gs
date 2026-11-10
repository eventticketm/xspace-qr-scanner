/**
 * XSpace standalone scanner bridge.
 * Add this file as a new Script file named "Bridge" in the existing Apps Script project.
 * It deliberately exposes only login, logout and scanTicket; it never accepts arbitrary function names.
 */
function doPost(e) {
  var requestId = '';
  var response = { ok: false, error: 'Invalid scanner request.' };

  try {
    var raw = e && e.parameter && e.parameter.xspace_request;
    if (!raw || raw.length > 5000) throw new Error('Invalid or oversized request.');
    var request = JSON.parse(raw);
    requestId = String(request.requestId || '');
    if (!/^[a-f0-9-]{20,80}$/i.test(requestId)) throw new Error('Invalid request identifier.');

    var action = String(request.action || '');
    var data = request.data || {};

    if (action === 'login') {
      var email = String(data.email || '').trim().toLowerCase();
      var pin = String(data.pin || '');
      if (!email || email.length > 180 || !pin || pin.length > 100) {
        throw new Error('Enter a valid staff email and PIN.');
      }
      // Limit repeated failed PIN attempts per email for five minutes.
      var cache = CacheService.getScriptCache();
      var attemptKey = 'xspace_bridge_login_' + hash_(email, 'xspace-login-window').slice(0, 32);
      var attempts = Number(cache.get(attemptKey) || 0);
      if (attempts >= 8) throw new Error('Too many failed attempts. Wait five minutes and try again.');
      var result;
      try {
        result = login(email, pin);
        cache.remove(attemptKey);
      } catch (loginError) {
        cache.put(attemptKey, String(attempts + 1), 300);
        throw loginError;
      }
      if (result.role !== 'ENTRY' && result.role !== 'EXIT') {
        logout(result.token);
        throw new Error('This scanner is for Entry and Exit staff accounts only. Use the Admin website for administration.');
      }
      response = { ok: true, data: result };

    } else if (action === 'logout') {
      logout(data.token);
      response = { ok: true, data: { loggedOut: true } };

    } else if (action === 'scanTicket') {
      var user = auth_(data.token);
      if (user.role !== 'ENTRY' && user.role !== 'EXIT') {
        throw new Error('Only Entry and Exit staff can scan tickets.');
      }
      // Direction comes from the authenticated server-side session, never from the browser.
      var result = scanTicket(data.token, data.qr, user.role);
      response = { ok: true, data: result };

    } else {
      throw new Error('Unsupported scanner action.');
    }

  } catch (err) {
    response = { ok: false, error: String(err && err.message ? err.message : 'Scanner request failed.').slice(0, 300) };
  }

  return HtmlService.createHtmlOutput(xspaceBridgeResponseHtml_(requestId, response))
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Sends the result from the Apps Script response frame to the standalone GitHub Pages
 * scanner. Target origin is deliberately pinned to this repository owner's GitHub Pages
 * origin; do not change to "*" without a clear security reason.
 */
function xspaceBridgeResponseHtml_(requestId, response) {
  var message = {
    type: 'xspace-scanner-response',
    requestId: requestId,
    response: response
  };
  var json = JSON.stringify(message)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  var html = '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
    '<script>window.top.postMessage(' + json + ', "https://eventticketm.github.io");</script>' +
    '</body></html>';

  return html;
}
