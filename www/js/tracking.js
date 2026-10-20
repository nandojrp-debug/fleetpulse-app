// =============================================================
// FleetPulse — Driver background location tracking (NATIVE APK)
// Uses @capacitor-community/background-geolocation
//
// Nagpapadala ng lokasyon sa backend HABANG naka-shift ang driver —
// kahit naka-lock ang phone, naka-FB, o nakabulsa. Humihinto pag clock out.
//
// Gumagana LANG kapag naka-login bilang DRIVER. Ang login token ang
// nagsasabi sa server kung sinong driver ito (walang driver ID na tina-type).
// =============================================================

var FP = {
  defaultBackend: 'https://fleetpulse-api.fernandojrpalermo-work.workers.dev',
  watcherId: null
};

function fpGet(key, fallback) {
  try { var v = localStorage.getItem(key); return v || fallback; } catch (e) { return fallback; }
}
function fpBackend() { return (fpGet('fp-backend', FP.defaultBackend) || '').replace(/\/$/, ''); }
function fpSession() {
  try { var s = JSON.parse(localStorage.getItem('fp-session') || 'null'); return s && s.token && s.user ? s : null; }
  catch (e) { return null; }
}
function fpIsDriver() { var s = fpSession(); return !!(s && s.user.role === 'driver'); }

function fpHasPlugin() {
  return !!(window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.BackgroundGeolocation);
}

// Simulan ang background tracking (tinatawag kapag ON SHIFT)
async function startTracking() {
  if (!fpHasPlugin()) {
    console.log('[FleetPulse] Walang native plugin (web preview). OK lang sa browser.');
    return;
  }
  if (!fpIsDriver()) return;          // operator o demo: walang tracking
  if (FP.watcherId) return;

  var BackgroundGeolocation = Capacitor.Plugins.BackgroundGeolocation;
  FP.watcherId = await BackgroundGeolocation.addWatcher(
    {
      backgroundTitle: 'FleetPulse',
      backgroundMessage: 'Naka-share ang lokasyon habang naka-shift.',
      requestPermissions: true,
      stale: false,
      distanceFilter: 30
    },
    function (location, error) {
      if (error) {
        if (error.code === 'NOT_AUTHORIZED') {
          console.warn('[FleetPulse] Hindi pinayagan ang "Always" location.');
        }
        console.error('[FleetPulse]', error);
        return;
      }
      sendPing(location);
    }
  );
}

async function stopTracking() {
  if (!fpHasPlugin() || !FP.watcherId) return;
  var BackgroundGeolocation = Capacitor.Plugins.BackgroundGeolocation;
  var id = FP.watcherId;
  FP.watcherId = null;
  await BackgroundGeolocation.removeWatcher({ id: id });
}

function sendPing(loc) {
  var s = fpSession();
  if (!s || s.user.role !== 'driver') { stopTracking(); return; }
  fetch(fpBackend() + '/api/ping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.token },
    keepalive: true,
    body: JSON.stringify({
      lat: loc.latitude,
      lng: loc.longitude,
      speed: loc.speed,
      heading: loc.bearing,
      accuracy: loc.accuracy,
      ts: Date.now()
    })
  }).then(function (res) {
    // Na-logout o na-deactivate ng operator → itigil ang tracking
    if (res.status === 401 || res.status === 403) stopTracking();
  }).catch(function (e) { console.warn('[FleetPulse] ping failed', e); });
}

// Tinatawag ng app pagkatapos mag-login / mag-logout
window.fpNativeSync = function () {
  if (!fpHasPlugin()) return;
  if (fpIsDriver() && window.onShift) startTracking(); else stopTracking();
};
window.fpNativeStop = function () { stopTracking(); };

// I-wire sa shift toggle ng app (native lang; sa browser, ang in-page GPS ang bahala).
window.addEventListener('DOMContentLoaded', function () {
  if (!fpHasPlugin()) return;
  if (typeof window.toggleShift === 'function') {
    var original = window.toggleShift;
    window.toggleShift = function () {
      original();
      window.fpNativeSync();
    };
  }
  window.fpNativeSync();
});
