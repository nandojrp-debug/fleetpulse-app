// =============================================================
// FleetPulse — Driver background location tracking (NATIVE APK)
// Uses @capacitor-community/background-geolocation
//
// Nagpapadala ng lokasyon sa backend HABANG naka-shift ang driver —
// kahit naka-lock ang phone, naka-FB, o nakabulsa. Humihinto pag clock out.
//
// Kinukuha ang Backend URL at Driver ID mula sa "Dispatch connection"
// card sa Driver view (naka-save sa localStorage).
// =============================================================

var FP = {
  // Default kung wala pang na-save sa app (pwede palitan sa Dispatch connection card)
  defaultBackend: 'https://fleetpulse-api.fernandojrpalermo-work.workers.dev',
  defaultDriverId: 'NBC-4521',
  watcherId: null
};

function fpGet(key, fallback) {
  try { var v = localStorage.getItem(key); return v || fallback; } catch (e) { return fallback; }
}
function fpBackend() { return (fpGet('fp-backend', FP.defaultBackend) || '').replace(/\/$/, ''); }
function fpDriverId() { return fpGet('fp-driverid', FP.defaultDriverId); }

function fpHasPlugin() {
  return !!(window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.BackgroundGeolocation);
}

// Simulan ang background tracking (tinatawag kapag ON SHIFT)
async function startTracking() {
  if (!fpHasPlugin()) {
    console.log('[FleetPulse] Walang native plugin (web preview). OK lang sa browser.');
    return;
  }
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
  await BackgroundGeolocation.removeWatcher({ id: FP.watcherId });
  FP.watcherId = null;
}

function sendPing(loc) {
  var url = fpBackend();
  if (!url) return;
  fetch(url + '/api/ping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
    body: JSON.stringify({
      driverId: fpDriverId(),
      lat: loc.latitude,
      lng: loc.longitude,
      speed: loc.speed,
      heading: loc.bearing,
      accuracy: loc.accuracy,
      ts: Date.now()
    })
  }).catch(function (e) { console.warn('[FleetPulse] ping failed', e); });
}

// I-wire sa shift toggle ng app (native lang; sa browser, ang in-page GPS ang bahala).
window.addEventListener('DOMContentLoaded', function () {
  if (!fpHasPlugin()) return;
  if (typeof window.toggleShift === 'function') {
    var original = window.toggleShift;
    window.toggleShift = function () {
      original();
      if (window.onShift) { startTracking(); } else { stopTracking(); }
    };
  }
  if (window.onShift) { startTracking(); }
});
