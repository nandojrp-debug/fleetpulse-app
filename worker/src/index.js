// =============================================================
// FleetPulse API — Cloudflare Worker (may signup / login / roles)
//
// Roles:
//   operator — may-ari ng fleet. Nakikita ang lahat ng truck NG SARILI NIYANG fleet.
//   driver   — nagpapadala lang ng sariling GPS. Walang access sa fleet data.
//
// Lahat ng role check ay ginagawa DITO sa server (hindi lang sa app),
// kaya kahit may mag-call nang direkta sa API, hindi siya makakalusot.
//
// Kailangan: isang D1 binding (kahit ano ang pangalan, hal. "DB").
// =============================================================

const SESSION_DAYS = 30;
const PBKDF2_ITER = 100000; // max na pinapayagan ng Workers
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // walang 0/O/1/I para hindi malito

// ---------- helpers ----------
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS },
  });
}
const err = (status, code, message) => json({ error: code, message }, status);

function getDb(env) {
  if (env.DB && typeof env.DB.prepare === 'function') return env.DB;
  const found = Object.values(env).find((v) => v && typeof v.prepare === 'function' && typeof v.batch === 'function');
  if (!found) throw new Error('Walang D1 binding sa Worker na ito.');
  return found;
}

async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body : {};
  } catch {
    return {};
  }
}

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
// Pangalan / kumpanya / plate: tanggalin ang characters na puwedeng gamitin sa HTML injection
const clean = (v, max) => str(v, max).replace(/[<>"'`\\&]/g, '').trim();
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const normEmail = (v) => str(v, 254).toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let s = '';
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return s.slice(0, 4) + '-' + s.slice(4);
}

async function sha256Hex(text) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await pbkdf2(password, salt, PBKDF2_ITER);
  return `pbkdf2$${PBKDF2_ITER}$${b64(salt)}$${b64(bits)}`;
}

async function verifyPassword(password, stored) {
  const [alg, iter, saltB64, hashB64] = String(stored).split('$');
  if (alg !== 'pbkdf2') return false;
  const bits = new Uint8Array(await pbkdf2(password, unb64(saltB64), parseInt(iter, 10)));
  const expected = unb64(hashB64);
  if (bits.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < bits.length; i++) diff |= bits[i] ^ expected[i];
  return diff === 0;
}

// Dummy hash para pareho ang tagal ng login kahit walang ganoong email
const DUMMY_HASH = 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

async function createSession(db, userId) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM fp_sessions WHERE user_id = ? AND expires_at < ?').bind(userId, now),
    db.prepare('INSERT INTO fp_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(await sha256Hex(token), userId, now + SESSION_DAYS * 86400000),
  ]);
  return token;
}

// Hanapin ang naka-login na user mula sa "Authorization: Bearer <token>"
async function getAuth(request, db) {
  const h = request.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+([a-f0-9]{64})$/i);
  if (!m) return null;
  const row = await db
    .prepare(
      `SELECT u.id, u.fleet_id, u.role, u.name, u.email, u.plate, u.active, s.token_hash, s.expires_at
         FROM fp_sessions s JOIN fp_users u ON u.id = s.user_id
        WHERE s.token_hash = ?`
    )
    .bind(await sha256Hex(m[1].toLowerCase()))
    .first();
  if (!row || row.expires_at < Date.now() || !row.active) return null;
  return row;
}

function publicUser(u) {
  return { id: u.id, role: u.role, name: u.name, email: u.email, plate: u.plate || null };
}

async function fleetInfo(db, user) {
  const f = await db.prepare('SELECT id, name, join_code FROM fp_fleets WHERE id = ?').bind(user.fleet_id).first();
  if (!f) return null;
  // Ang invite code ay para sa operator lang
  return user.role === 'operator' ? { id: f.id, name: f.name, joinCode: f.join_code } : { id: f.id, name: f.name };
}

// ---------- route handlers ----------
async function signupOperator(request, db) {
  const b = await readJson(request);
  const name = clean(b.name, 80);
  const company = clean(b.company, 80);
  const email = normEmail(b.email);
  const password = typeof b.password === 'string' ? b.password : '';
  if (!name || !company) return err(400, 'missing_fields', 'Kailangan ang pangalan at pangalan ng kumpanya.');
  if (!validEmail(email)) return err(400, 'bad_email', 'Hindi valid ang email.');
  if (password.length < 8) return err(400, 'weak_password', 'Kailangan ng password na 8 characters pataas.');

  const exists = await db.prepare('SELECT 1 FROM fp_users WHERE email = ?').bind(email).first();
  if (exists) return err(409, 'email_taken', 'May account na ang email na ito.');

  const fleetId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const now = Date.now();
  const passHash = await hashPassword(password);

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await db.batch([
        db.prepare('INSERT INTO fp_fleets (id, name, join_code, created_at) VALUES (?, ?, ?, ?)')
          .bind(fleetId, company, randomCode(), now),
        db.prepare(
          `INSERT INTO fp_users (id, fleet_id, role, name, email, pass_hash, plate, active, created_at)
           VALUES (?, ?, 'operator', ?, ?, ?, NULL, 1, ?)`
        ).bind(userId, fleetId, name, email, passHash, now),
      ]);
      break;
    } catch (e) {
      const msg = String(e && e.message);
      if (msg.includes('fp_users.email')) return err(409, 'email_taken', 'May account na ang email na ito.');
      if (!msg.includes('join_code') || attempt === 4) throw e; // retry kung nagkapareho ang code
    }
  }

  const user = { id: userId, fleet_id: fleetId, role: 'operator', name, email, plate: null };
  const token = await createSession(db, userId);
  return json({ token, user: publicUser(user), fleet: await fleetInfo(db, user) }, 201);
}

async function signupDriver(request, db) {
  const b = await readJson(request);
  const name = clean(b.name, 80);
  const email = normEmail(b.email);
  const password = typeof b.password === 'string' ? b.password : '';
  const plate = clean(b.plate, 20).toUpperCase();
  const code = str(b.inviteCode, 20).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!name || !plate) return err(400, 'missing_fields', 'Kailangan ang pangalan at plate number.');
  if (!validEmail(email)) return err(400, 'bad_email', 'Hindi valid ang email.');
  if (password.length < 8) return err(400, 'weak_password', 'Kailangan ng password na 8 characters pataas.');
  if (code.length !== 8) return err(400, 'bad_code', 'Mali ang invite code.');

  const fleet = await db.prepare('SELECT id FROM fp_fleets WHERE join_code = ?').bind(code.slice(0, 4) + '-' + code.slice(4)).first();
  if (!fleet) return err(404, 'bad_code', 'Mali o luma na ang invite code. Humingi ng bago sa operator mo.');

  const exists = await db.prepare('SELECT 1 FROM fp_users WHERE email = ?').bind(email).first();
  if (exists) return err(409, 'email_taken', 'May account na ang email na ito.');

  const userId = crypto.randomUUID();
  try {
    await db.prepare(
      `INSERT INTO fp_users (id, fleet_id, role, name, email, pass_hash, plate, active, created_at)
       VALUES (?, ?, 'driver', ?, ?, ?, ?, 1, ?)`
    ).bind(userId, fleet.id, name, email, await hashPassword(password), plate, Date.now()).run();
  } catch (e) {
    if (String(e && e.message).includes('fp_users.email')) return err(409, 'email_taken', 'May account na ang email na ito.');
    throw e;
  }

  const user = { id: userId, fleet_id: fleet.id, role: 'driver', name, email, plate };
  const token = await createSession(db, userId);
  return json({ token, user: publicUser(user), fleet: await fleetInfo(db, user) }, 201);
}

async function login(request, db) {
  const b = await readJson(request);
  const email = normEmail(b.email);
  const password = typeof b.password === 'string' ? b.password : '';
  const u = email ? await db.prepare('SELECT * FROM fp_users WHERE email = ?').bind(email).first() : null;
  const ok = await verifyPassword(password, u ? u.pass_hash : DUMMY_HASH);
  if (!u || !ok) return err(401, 'bad_login', 'Mali ang email o password.');
  if (!u.active) return err(403, 'deactivated', 'Naka-deactivate ang account na ito. Kausapin ang operator mo.');
  const token = await createSession(db, u.id);
  return json({ token, user: publicUser(u), fleet: await fleetInfo(db, u) });
}

async function logout(request, db) {
  const h = request.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+([a-f0-9]{64})$/i);
  if (m) await db.prepare('DELETE FROM fp_sessions WHERE token_hash = ?').bind(await sha256Hex(m[1].toLowerCase())).run();
  return json({ ok: true });
}

// DRIVER lang — ang driverId ay galing sa session, hindi sa body,
// kaya hindi makakapagpanggap ang isang driver na ibang truck.
async function ping(request, db, me) {
  const b = await readJson(request);
  const lat = num(b.lat);
  const lng = num(b.lng);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return err(400, 'bad_location', 'Hindi valid ang lokasyon.');
  }
  const now = Date.now();
  let ts = num(b.ts);
  if (ts === null || Math.abs(ts - now) > 86400000) ts = now; // iwas sa maling oras ng phone
  await db.prepare(
    `INSERT INTO fp_pings (fleet_id, driver_id, lat, lng, speed, heading, accuracy, ts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(me.fleet_id, me.id, lat, lng, num(b.speed), num(b.heading), num(b.accuracy), Math.round(ts)).run();
  return json({ ok: true });
}

// OPERATOR lang — huling lokasyon ng bawat driver sa SARILI niyang fleet
async function fleet(db, me) {
  const { results } = await db.prepare(
    `SELECT u.id AS driverId, u.name AS driverName, u.plate AS plate,
            p.lat, p.lng, p.speed, p.heading, p.accuracy, p.ts
       FROM fp_users u
       JOIN fp_pings p ON p.id = (
             SELECT id FROM fp_pings WHERE driver_id = u.id ORDER BY ts DESC LIMIT 1)
      WHERE u.fleet_id = ? AND u.role = 'driver' AND u.active = 1
      ORDER BY p.ts DESC`
  ).bind(me.fleet_id).all();
  return json({ fleet: results || [] });
}

async function listDrivers(db, me) {
  const { results } = await db.prepare(
    `SELECT u.id, u.name, u.email, u.plate, u.active, u.created_at AS createdAt,
            (SELECT MAX(ts) FROM fp_pings WHERE driver_id = u.id) AS lastPing
       FROM fp_users u
      WHERE u.fleet_id = ? AND u.role = 'driver'
      ORDER BY u.active DESC, u.name`
  ).bind(me.fleet_id).all();
  return json({ drivers: (results || []).map((d) => ({ ...d, active: !!d.active })) });
}

async function setDriverActive(db, me, driverId, active) {
  // Sariling fleet lang ang puwedeng galawin
  const d = await db.prepare(`SELECT id FROM fp_users WHERE id = ? AND fleet_id = ? AND role = 'driver'`)
    .bind(driverId, me.fleet_id).first();
  if (!d) return err(404, 'not_found', 'Walang ganitong driver sa fleet mo.');
  const stmts = [db.prepare('UPDATE fp_users SET active = ? WHERE id = ?').bind(active ? 1 : 0, driverId)];
  if (!active) stmts.push(db.prepare('DELETE FROM fp_sessions WHERE user_id = ?').bind(driverId)); // logout agad
  await db.batch(stmts);
  return json({ ok: true });
}

// Kahit sinong naka-login: palitan ang sariling password.
// Mala-logout ang ibang phone/browser; mananatiling naka-login ang kasalukuyan.
async function changePassword(request, db, me) {
  const b = await readJson(request);
  const current = typeof b.currentPassword === 'string' ? b.currentPassword : '';
  const next = typeof b.newPassword === 'string' ? b.newPassword : '';
  if (next.length < 8) return err(400, 'weak_password', 'Kailangan ng bagong password na 8 characters pataas.');
  const row = await db.prepare('SELECT pass_hash FROM fp_users WHERE id = ?').bind(me.id).first();
  if (!row || !(await verifyPassword(current, row.pass_hash))) {
    return err(400, 'bad_password', 'Mali ang kasalukuyang password.');
  }
  if (current === next) return err(400, 'same_password', 'Pareho ang bago at lumang password.');
  await db.batch([
    db.prepare('UPDATE fp_users SET pass_hash = ? WHERE id = ?').bind(await hashPassword(next), me.id),
    db.prepare('DELETE FROM fp_sessions WHERE user_id = ? AND token_hash != ?').bind(me.id, me.token_hash),
  ]);
  return json({ ok: true });
}

// Pansamantalang password: madaling basahin at i-type (walang 0/O/1/I/l)
function tempPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s.slice(0, 5) + '-' + s.slice(5);
}

// OPERATOR lang: i-reset ang password ng driver sa SARILI niyang fleet.
async function resetDriverPassword(db, me, driverId) {
  const d = await db.prepare(`SELECT id FROM fp_users WHERE id = ? AND fleet_id = ? AND role = 'driver'`)
    .bind(driverId, me.fleet_id).first();
  if (!d) return err(404, 'not_found', 'Walang ganitong driver sa fleet mo.');
  const temp = tempPassword();
  await db.batch([
    db.prepare('UPDATE fp_users SET pass_hash = ? WHERE id = ?').bind(await hashPassword(temp), driverId),
    db.prepare('DELETE FROM fp_sessions WHERE user_id = ?').bind(driverId), // logout sa lahat ng phone
  ]);
  return json({ tempPassword: temp });
}

async function rotateCode(db, me) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    try {
      await db.prepare('UPDATE fp_fleets SET join_code = ? WHERE id = ?').bind(code, me.fleet_id).run();
      return json({ joinCode: code });
    } catch (e) {
      if (!String(e && e.message).includes('join_code') || attempt === 4) throw e;
    }
  }
}

// ---------- router ----------
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method;

    try {
      const db = getDb(env);

      if (path === '/' || path === '/api/health') return json({ ok: true, service: 'fleetpulse-api', auth: true, maps: !!env.GOOGLE_MAPS_KEY });

      // Public config para sa app. Ang Google Maps browser key ay hindi sikreto (nakikita talaga sa browser);
      // protektado ito ng "Website restrictions" sa Google Cloud.
      if (method === 'GET' && path === '/api/config') {
        return json({ googleMapsKey: typeof env.GOOGLE_MAPS_KEY === 'string' ? env.GOOGLE_MAPS_KEY.trim() : '' });
      }

      // Public (walang login)
      if (method === 'POST' && path === '/api/auth/signup-operator') return await signupOperator(request, db);
      if (method === 'POST' && path === '/api/auth/signup-driver') return await signupDriver(request, db);
      if (method === 'POST' && path === '/api/auth/login') return await login(request, db);
      if (method === 'POST' && path === '/api/auth/logout') return await logout(request, db);

      // Lahat ng nasa ibaba: kailangan naka-login
      const me = await getAuth(request, db);
      if (!me) return err(401, 'unauthorized', 'Mag-login muna.');

      if (method === 'GET' && path === '/api/me') {
        return json({ user: publicUser(me), fleet: await fleetInfo(db, me) });
      }
      if (method === 'POST' && path === '/api/auth/change-password') return await changePassword(request, db, me);

      // Driver lang
      if (method === 'POST' && path === '/api/ping') {
        if (me.role !== 'driver') return err(403, 'forbidden', 'Para sa driver accounts lang ito.');
        return await ping(request, db, me);
      }

      // Operator lang
      const operatorRoutes = path === '/api/fleet' || path.startsWith('/api/drivers') || path === '/api/fleet/rotate-code';
      if (operatorRoutes && me.role !== 'operator') return err(403, 'forbidden', 'Para sa operator accounts lang ito.');

      if (method === 'GET' && path === '/api/fleet') return await fleet(db, me);
      if (method === 'GET' && path === '/api/drivers') return await listDrivers(db, me);
      if (method === 'POST' && path === '/api/fleet/rotate-code') return await rotateCode(db, me);
      const m = path.match(/^\/api\/drivers\/([0-9a-f-]{36})\/(deactivate|activate)$/);
      if (method === 'POST' && m) return await setDriverActive(db, me, m[1], m[2] === 'activate');
      const rp = path.match(/^\/api\/drivers\/([0-9a-f-]{36})\/reset-password$/);
      if (method === 'POST' && rp) return await resetDriverPassword(db, me, rp[1]);

      return err(404, 'not_found', 'Walang ganitong endpoint.');
    } catch (e) {
      console.error('[fleetpulse-api]', e && e.stack ? e.stack : e);
      return err(500, 'server_error', 'May error sa server. Subukan ulit.');
    }
  },
};
