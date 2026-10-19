# FleetPulse — Driver Mobile App (Capacitor)

Ito ang balot (Capacitor) ng FleetPulse web app para maging **tunay na iOS + Android app**
na may **background GPS** — nagta-track kahit naka-lock ang phone, habang naka-shift ang driver.

---

## ⬇️ Kung saan i-deploy (MAHALAGANG malaman)

Iba ang punta ng bawat bahagi — HINDI lahat Cloudflare:

| Bahagi | Saan i-deploy | Paano |
|---|---|---|
| **Driver app** (itong Capacitor project) | **Google Play** + **Apple App Store** | Build via Android Studio / Xcode, tapos upload sa store |
| **Operator dashboard** (web) | **Cloudflare Pages** | Drag-and-drop ng `index.html` (tapos na ito) |
| **Backend API** (tumatanggap ng GPS pings) | **Cloudflare Workers** | Susunod na gagawin |

> Ang mobile app ay HINDI inu-upload sa Cloudflare. Pumupunta ito sa app stores.
> Ang Cloudflare ay para sa web dashboard at backend lang.

---

## ✅ Kailangan mo muna (prerequisites)

- **Node.js** (v18+) sa computer mo — https://nodejs.org
- **Android Studio** (para sa Android build) — kahit Windows/Mac/Linux
- **Xcode** (para sa iOS build) — **Mac lang**
- **Apple Developer account** ($99/taon) — para mag-publish sa App Store
- **Google Play Console** ($25, one-time) — para mag-publish sa Play Store

---

## 🚀 Setup (gawin sa computer mo)

```bash
# 1. Pumasok sa folder
cd fleetpulse-app

# 2. I-install ang dependencies
npm install

# 3. Idagdag ang native platforms
npx cap add android
npx cap add ios        # Mac lang

# 4. I-sync ang web app + plugins sa native projects
npx cap sync
```

### Buksan at i-run
```bash
npx cap open android   # bubukas ang Android Studio -> Run sa phone/emulator
npx cap open ios       # bubukas ang Xcode (Mac) -> Run sa iPhone/simulator
```

---

## 🔑 Permissions (idagdag bago mag-build)

### Android — `android/app/src/main/AndroidManifest.xml`
Idagdag sa loob ng `<manifest>`:
```xml
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
```

### iOS — `ios/App/App/Info.plist`
Idagdag ang mga key na ito:
```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>Para masubaybayan ang lokasyon ng truck habang naka-shift.</string>
<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>Para magpadala ng lokasyon kahit naka-lock ang phone, habang naka-shift lang.</string>
<key>UIBackgroundModes</key>
<array>
  <string>location</string>
</array>
```

---

## 🔗 Ikabit sa backend

Buksan ang `www/js/tracking.js` at palitan:
```js
backendUrl: 'https://YOUR-WORKER.workers.dev/api/ping',  // <- URL ng iyong Cloudflare Worker
driverId:   'NBC-4521',                                  // <- i-set per driver pagkatapos mag-login
```
Pagkatapos: `npx cap sync` ulit.

---

## 📦 Build para sa stores

- **Android:** Android Studio → *Build → Generate Signed App Bundle (.aab)* → upload sa **Play Console**
- **iOS:** Xcode → *Product → Archive* → *Distribute App* → upload sa **App Store Connect**

### ⚠️ App Store review — background location
Mahigpit ang Apple at Google sa background location. Kailangan:
- **Privacy Policy** (link) na nagsasaad kung ano't bakit kino-collect ang lokasyon
- Malinaw na **consent** sa loob ng app (meron na tayo: shift-based, "Always decline", visible indicator)
- Paliwanag sa review: *"Tracking only during assigned work shifts, driver can clock out anytime."*

Ang consent-based na disenyo natin ay eksaktong hinahanap nila — ito ang magpapapasa.

---

## 🗺️ Mga susunod (para tunay na production)

1. **Backend** (Cloudflare Workers + D1) — tatanggap ng pings, iimbak, ibibigay sa operator (real-time)
2. **Tunay na mapa** (Google Maps / Mapbox) kapalit ng demo SVG
3. **Login / auth** para sa driver at operator
4. **Offline queue** — i-save ang pings kapag walang signal, ipadala ulit pagbalik

> Note: ang `www/index.html` ay ang buong demo app (Operator + Driver view via toggle).
> Sa totoong driver app, i-default sa **Driver view** at tanggalin ang role switcher pagkatapos mag-test.
