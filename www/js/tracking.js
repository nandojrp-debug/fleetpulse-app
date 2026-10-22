// =============================================================
// FleetPulse — Driver background location tracking (NATIVE APK)
// @capacitor-community/background-geolocation
//
// Mga feature:
//  - Background GPS habang naka-shift (kahit lock/FB/nakabulsa)
//  - HEARTBEAT: nagpapadala kada ~60s kahit nakahinto -> laging "online"
//  - OFFLINE QUEUE: kapag walang data, ini-save ang pings, ipapadala
//    pagbalik ng internet (hindi mawawala ang ruta)
//  - AUTO-RECONNECT: kusang nagre-resume pagbalik ng data (walang re-login)
//
// Backend URL + Driver ID = galing sa "Dispatch connection" card (localStorage).
// =============================================================

var FP = {
  defaultBackend: 'https://fleetpulse-api.fernandojrpalermo-work.workers.dev',
  defaultDriverId: 'NBC-4521',
  watcherId: null,
  lastLoc: null,          // huling alam na lokasyon (para sa heartbeat)
  heartbeatTimer: null,
  queueKey: 'fp-ping-queue',
  maxQueue: 500           // limitasyon para hindi lumobo ang storage
};

function fpGet(key, fallback) {
  try { var v = localStorage.getItem(key); return v || fallback; } catch (e) { return fallback; }
}
function fpBackend() { return (fpGet('fp-backend', FP.defaultBackend) || '').replace(/\/$/, ''); }
function fpDriverId() { return fpGet('fp-driverid', FP.defaultDriverId); }
function fpOnShift() { return window.onShift !== false; }
function fpHasPlugin() { return !!(window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.BackgroundGeolocation); }

// ---------- Offline queue ----------
function queueRead() { try { return JSON.parse(localStorage.getItem(FP.queueKey) || '[]'); } catch (e) { return []; } }
function queueWrite(arr) { try { localStorage.setItem(FP.queueKey, JSON.stringify(arr.slice(-FP.maxQueue))); } catch (e) {} }
function queuePush(body) { var q = queueRead(); q.push(body); queueWrite(q); }

function postPing(body) {
  var url = fpBackend();
  if (!url) return Promise.reject('no-url');
  return fetch(url + '/api/ping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
    body: JSON.stringify(body)
  }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r; });
}

// Subukang ipadala lahat ng naka-queue (in order). Hihinto sa unang pumalya.
function flushQueue() {
  var q = queueRead();
  if (!q.length) return Promise.resolve();
  function next() {
    var cur = queueRead();
    if (!cur.length) return Promise.resolve();
    var body = cur[0];
    return postPing(body).then(function () {
      var rest = queueRead(); rest.shift(); queueWrite(rest);
      return next();
    }).catch(function () { /* wala pa ring data — iwan muna sa queue */ });
  }
  return next();
}

// Pangunahing send: subukan agad; kapag pumalya, i-queue para sa auto-resume.
function sendPing(body) {
  postPing(body)
    .then(function () { flushQueue(); })           // nakadaan -> flush din ang naipon
    .catch(function () { queuePush(body); });      // walang data -> i-save muna
}

function pingFromLoc(loc, ts) {
  return {
    driverId: fpDriverId(),
    lat: loc.latitude, lng: loc.longitude,
    speed: (loc.speed != null ? loc.speed : null),
    heading: (loc.bearing != null ? loc.bearing : null),
    accuracy: loc.accuracy,
    ts: ts || Date.now()
  };
}

// ---------- Heartbeat (laging online kahit nakahinto) ----------
function startHeartbeat() {
  if (FP.heartbeatTimer) return;
  FP.heartbeatTimer = setInterval(function () {
    if (!fpOnShift()) return;
    flushQueue();                                  // subukang ipadala ang naipon
    if (FP.lastLoc) sendPing(pingFromLoc(FP.lastLoc, Date.now())); // fresh "online" ping
  }, 60000); // kada 60 segundo
}
function stopHeartbeat() { if (FP.heartbeatTimer) { clearInterval(FP.heartbeatTimer); FP.heartbeatTimer = null; } }

// ---------- Background watcher ----------
async function startTracking() {
  if (!fpHasPlugin()) { console.log('[FleetPulse] Web preview — plugin absent, OK lang.'); return; }
  if (FP.watcherId) return;
  var BG = Capacitor.Plugins.BackgroundGeolocation;
  FP.watcherId = await BG.addWatcher(
    {
      backgroundTitle: 'FleetPulse',
      backgroundMessage: 'Naka-share ang lokasyon habang naka-shift.',
      requestPermissions: true,
      stale: false,
      distanceFilter: 25
    },
    function (location, error) {
      if (error) { console.error('[FleetPulse]', error); return; }
      FP.lastLoc = location;
      sendPing(pingFromLoc(location));
    }
  );
  startHeartbeat();
}

async function stopTracking() {
  stopHeartbeat();
  if (!fpHasPlugin() || !FP.watcherId) return;
  var BG = Capacitor.Plugins.BackgroundGeolocation;
  await BG.removeWatcher({ id: FP.watcherId });
  FP.watcherId = null;
}

// ---------- Wiring ----------
window.addEventListener('DOMContentLoaded', function () {
  if (!fpHasPlugin()) return;

  // Shift toggle -> start/stop
  if (typeof window.toggleShift === 'function') {
    var original = window.toggleShift;
    window.toggleShift = function () {
      original();
      if (window.onShift) { startTracking(); } else { stopTracking(); }
    };
  }

  // Auto-reconnect: pagbalik ng internet, i-flush ang queue + magpadala agad
  window.addEventListener('online', function () {
    flushQueue();
    if (fpOnShift() && FP.lastLoc) sendPing(pingFromLoc(FP.lastLoc, Date.now()));
  });

  if (window.onShift) { startTracking(); }
});
