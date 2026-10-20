# FleetPulse — Paano i-deploy ang accounts update

Tatlong bahagi ang ia-update, sa ganitong pagkakasunod:

## 1. Database (D1) — gawin ang bagong tables

1. Cloudflare dashboard → **Storage & Databases → D1** → buksan ang database ng FleetPulse
2. Pumunta sa **Console**
3. Kopyahin ang buong laman ng `worker/schema.sql`, i-paste, tapos **Execute**
4. Dapat lumabas ang 4 na bagong tables: `fp_fleets`, `fp_users`, `fp_sessions`, `fp_pings`

Hindi nito gagalawin ang luma mong tables o data.

## 2. Worker (backend) — palitan ang code

1. Cloudflare dashboard → **Workers & Pages** → **fleetpulse-api**
2. **Edit code**
3. Burahin ang lumang code, i-paste ang buong laman ng `worker/src/index.js`
4. **Deploy**
5. Check: **Settings → Bindings** — dapat may **D1 database** na naka-bind (kahit anong pangalan).
   Kung wala, idagdag: *Add binding → D1 database → Variable name: `DB`* → piliin ang database.
6. Test: buksan ang `https://fleetpulse-api.fernandojrpalermo-work.workers.dev/api/health`
   Dapat makita ang `"auth":true`.

> Pagka-deploy, HINDI na tatanggap ng GPS ang lumang APK (walang login).
> Kailangan i-install ang bagong APK (step 3).

## 3. App — dashboard (Pages) + APK (Codemagic)

1. I-upload sa GitHub ang mga bagong files (`www/index.html`, `www/js/tracking.js`, at ang `worker/` folder)
2. **Operator dashboard (Cloudflare Pages):** i-upload ulit ang bagong `www/index.html`
3. **Driver APK:** sa Codemagic → **Start new build** → i-install ang bagong APK sa phone

## Paano gamitin

**Operator:**
1. Buksan ang dashboard → *Create account* → piliin ang **Operator**
2. Pagka-login, makikita ang **invite code** (hal. `VNMY-7XHQ`) sa Feed at sa Fleet tab
3. Ibigay ang code sa mga driver

**Driver:**
1. Buksan ang APK → *Create account* → piliin ang **Driver**
2. Ilagay ang invite code + plate number
3. **Start shift** → lalabas na ang truck sa dashboard ng operator

**Pag-alis ng driver:** Fleet tab → Drivers → **Remove**. Mala-logout siya agad at hindi na makakapagpadala ng GPS.
**Kung kumalat ang code:** Fleet tab → **New code**. Hindi na gagana ang luma (hindi apektado ang naka-signup na).

## API endpoints (para sa reference)

| Endpoint | Sino | Gamit |
|---|---|---|
| `POST /api/auth/signup-operator` | public | Gumawa ng operator + fleet |
| `POST /api/auth/signup-driver` | public (may invite code) | Gumawa ng driver sa fleet |
| `POST /api/auth/login` / `logout` | public | Login / logout |
| `GET /api/me` | naka-login | Account info |
| `POST /api/ping` | **driver lang** | Magpadala ng GPS |
| `GET /api/fleet` | **operator lang** | Huling lokasyon ng trucks (sariling fleet lang) |
| `GET /api/drivers` | **operator lang** | Listahan ng drivers |
| `POST /api/drivers/:id/deactivate` / `activate` | **operator lang** | Alisin / ibalik ang driver |
| `POST /api/fleet/rotate-code` | **operator lang** | Bagong invite code |
