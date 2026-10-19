// Inilalagay ang background-location permissions sa AndroidManifest.xml
// na ginagawa ni Capacitor habang nagba-build sa Codemagic.
const fs = require('fs');

const path = 'android/app/src/main/AndroidManifest.xml';
let xml = fs.readFileSync(path, 'utf8');

const perms = [
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_LOCATION'
];

let lines = '';
for (const p of perms) {
  if (!xml.includes(p)) {
    lines += `    <uses-permission android:name="${p}" />\n`;
  }
}

if (lines) {
  // Idagdag pagkatapos ng unang <manifest ...> tag
  xml = xml.replace(/(<manifest[^>]*>\s*)/, `$1\n${lines}`);
  fs.writeFileSync(path, xml);
  console.log('[patch-manifest] Naidagdag ang location permissions.');
} else {
  console.log('[patch-manifest] Nandoon na lahat ng permissions.');
}
