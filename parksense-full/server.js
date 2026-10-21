"use strict";
/* ParkSense backend – zero dependencies (Node 18+). Run: node server.js */
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const PORT = +process.env.PORT || 3000, HOLD = 10 * 60 * 1000;
const DIR = path.join(__dirname, "data"), DBF = path.join(DIR, "db.json"), PUB = path.join(__dirname, "public");
const ZONES = [["A", 16, 10], ["B", 8, 25], ["C", 8, 40], ["D", 4, 5]];
const RATE = { A: 40, B: 55, C: 15, D: 30 }, COMPAT = { car: ["A"], ev: ["B", "A"], bike: ["C"], acc: ["D", "A"] };
const rnd = n => crypto.randomBytes(n).toString("hex");
const hash = (pw, salt = rnd(16)) => salt + ":" + crypto.scryptSync(pw, salt, 64).toString("hex");
const verify = (pw, h) => { const [s, k] = h.split(":"), a = Buffer.from(k, "hex"), b = crypto.scryptSync(pw, s, 64); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const rp = () => { const L = "ABCDEFGHJKLMNPRSTUVWXYZ", r = n => crypto.randomInt(n); return `AP${10 + r(40)} ${L[r(L.length)]}${L[r(L.length)]} ${1000 + r(9000)}`; };

/* ---------- database (JSON file) ---------- */
function fresh() {
  const slots = [];
  for (const [z, n, base] of ZONES) for (let i = 0; i < n; i++) {
    const o = Math.random() < .4;
    slots.push({ id: z + (i + 1), z, dist: base + i * 3, st: o ? "occ" : "free", plate: o ? rp() : "", since: o ? Date.now() - (10 + Math.random() * 170) * 6e4 : 0 });
  }
  const admin = { id: 1, name: "Admin", email: "admin@parksense.local", role: "admin", pw: hash(process.env.ADMIN_PASSWORD || "admin123") };
  return { slots, users: [admin], bookings: [], payments: [], sessions: {}, seq: 1000, uid: 1 };
}
let db; try { db = JSON.parse(fs.readFileSync(DBF, "utf8")); } catch { db = fresh(); }
function save() { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(DBF + ".tmp", JSON.stringify(db)); fs.renameSync(DBF + ".tmp", DBF); }
save();

/* ---------- helpers ---------- */
const send = (res, c, o) => { res.writeHead(c, { "Content-Type": "application/json", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" }); res.end(JSON.stringify(o)); };
const fail = (c, m) => Object.assign(new Error(m), { code: c });
const readBody = req => new Promise((ok, no) => { let d = ""; req.on("data", c => { d += c; if (d.length > 2e4) { no(fail(413, "Request too large")); req.destroy(); } }); req.on("end", () => { try { ok(d ? JSON.parse(d) : {}); } catch { no(fail(400, "Invalid JSON")); } }); });
const cookies = req => Object.fromEntries((req.headers.cookie || "").split(";").map(c => c.trim().split("=")).filter(a => a[0]));
const me = req => { const t = cookies(req).sid, s = t && db.sessions[t]; return s && s.exp > Date.now() ? db.users.find(u => u.id === s.uid) || null : null; };
const safe = u => u && { id: u.id, name: u.name, email: u.email, role: u.role };
const startSession = (res, u) => { const t = rnd(32); db.sessions[t] = { uid: u.id, exp: Date.now() + 7 * 864e5 }; res.setHeader("Set-Cookie", `sid=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`); };
const normPlate = v => String(v || "").toUpperCase().replace(/\s+/g, " ").trim();
const okPlate = v => /^[A-Z0-9 -]{5,13}$/.test(v);
const busy = p => db.slots.some(s => s.plate === p && s.st !== "free");
const occPct = () => db.slots.filter(s => s.st !== "free").length / db.slots.length;
const mult = () => { const o = occPct(); return o >= .8 ? 1.5 : o >= .6 ? 1.25 : 1; };
const attempts = {};
const luhn = n => { let s = 0, d = false; for (let i = n.length - 1; i >= 0; i--) { let x = +n[i]; if (d && (x *= 2) > 9) x -= 9; s += x; d = !d; } return s % 10 === 0; };

function recommend(type, pref) {
  const zs = COMPAT[type]; if (!zs) return null;
  const free = db.slots.filter(s => s.st === "free" && zs.includes(s.z)); if (!free.length) return null;
  const sc = s => { let v = s.dist; if (pref === "cheap") v = RATE[s.z] * 10 + s.dist * .1; if (pref === "charge") v = (s.z === "B" ? 0 : 500) + s.dist; if (type === "ev" && s.z === "B") v -= 15; return v; };
  const r = free.slice().sort((a, b) => sc(a) - sc(b)), best = r[0];
  const why = { near: "it is the closest free bay to the entrance", cheap: "it has the lowest hourly rate available", charge: best.z === "B" ? "it has an EV charger" : "no charger bay is free, so this is the nearest fallback" }[pref] || "it is the closest free bay to the entrance";
  return { slot: best, best: best.id, alts: r.slice(1, 4).map(s => s.id), text: `Bay ${best.id} (${best.dist} m from entrance) is my pick because ${why}.` };
}

/* Payment provider. TEST MODE: validates input only, never charges money and never stores card numbers.
   To go live, replace the body with a Razorpay / Stripe call (create + verify a payment) and return { ref }. */
function charge(amount, method, d) {
  if (method === "card") {
    const n = String(d.number || "").replace(/\s/g, ""), m = /^(\d{2})\/(\d{2})$/.exec(d.expiry || "");
    if (!/^\d{13,19}$/.test(n) || !luhn(n)) throw fail(402, "Card number is invalid");
    if (!m || +m[1] < 1 || +m[1] > 12 || new Date(2000 + +m[2], +m[1], 1) <= new Date()) throw fail(402, "Card has expired or the date is invalid");
    if (!/^\d{3,4}$/.test(d.cvv || "")) throw fail(402, "CVV is invalid");
    if (n.endsWith("0002")) throw fail(402, "Card declined by the bank (test card)");
    return { ref: "ch_" + rnd(6), detail: "card ····" + n.slice(-4) };
  }
  if (method === "upi") {
    if (!/^[\w.-]{2,}@[a-z]{2,}$/i.test(d.upi || "")) throw fail(402, "UPI ID is invalid");
    return { ref: "upi_" + rnd(6), detail: "UPI" };
  }
  throw fail(400, "Choose card or UPI");
}
const recPay = (bk, uid, amount, method, detail, ref) => db.payments.unshift({ id: "PAY" + rnd(4), bookingId: bk ? bk.id : null, userId: uid, amount, method, detail, ref, at: Date.now() });

/* ---------- API ---------- */
async function api(req, res, p) {
  const u = me(req), M = req.method;
  const need = () => { if (!u) throw fail(401, "Please sign in first"); };
  const admin = () => { need(); if (u.role !== "admin") throw fail(403, "Staff only"); };
  let b = {};
  if (M === "POST") { if (!(req.headers["content-type"] || "").includes("application/json")) throw fail(415, "JSON only"); b = await readBody(req); }
  let m;

  if (M === "GET" && p === "me") return { user: safe(u) };
  if (M === "GET" && p === "slots") return { slots: db.slots.map(s => ({ id: s.id, z: s.z, dist: s.dist, st: s.st, plate: u && u.role === "admin" ? s.plate : undefined })), rates: RATE, mult: mult() };
  if (M === "POST" && p === "recommend") { const r = recommend(b.type, b.pref); return r ? { best: r.best, alts: r.alts, text: r.text } : { best: null, text: "No free bays for this vehicle type right now." }; }

  if (M === "POST" && p === "register") {
    const name = String(b.name || "").trim(), email = String(b.email || "").trim().toLowerCase(), pw = String(b.password || "");
    if (name.length < 2 || name.length > 40) throw fail(400, "Enter your name (2–40 characters)");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw fail(400, "Enter a valid email");
    if (pw.length < 8) throw fail(400, "Password must be at least 8 characters");
    if (db.users.some(x => x.email === email)) throw fail(409, "An account with this email already exists");
    const nu = { id: ++db.uid + 0, name, email, role: "user", pw: hash(pw) }; db.users.push(nu); startSession(res, nu); save(); return { user: safe(nu) };
  }
  if (M === "POST" && p === "login") {
    const email = String(b.email || "").trim().toLowerCase(), k = req.socket.remoteAddress + email, a = attempts[k] || { n: 0, t: Date.now() };
    if (Date.now() - a.t > 6e4) { a.n = 0; a.t = Date.now(); }
    if (a.n >= 5) throw fail(429, "Too many attempts. Try again in a minute");
    const x = db.users.find(y => y.email === email);
    if (!x || !verify(String(b.password || ""), x.pw)) { a.n++; attempts[k] = a; throw fail(401, "Email or password is incorrect"); }
    delete attempts[k]; startSession(res, x); save(); return { user: safe(x) };
  }
  if (M === "POST" && p === "logout") { delete db.sessions[cookies(req).sid]; res.setHeader("Set-Cookie", "sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"); save(); return { ok: true }; }

  if (M === "GET" && p === "bookings") {
    need(); const L = u.role === "admin" ? db.bookings : db.bookings.filter(x => x.userId === u.id);
    return L.map(x => ({ ...x, user: u.role === "admin" ? (db.users.find(y => y.id === x.userId) || {}).email : undefined }));
  }
  if (M === "POST" && p === "bookings") {
    need(); const plate = normPlate(b.plate), h = Math.floor(+b.hours);
    if (!okPlate(plate)) throw fail(400, "Enter a valid vehicle number (5–13 characters)");
    if (!(h >= 1 && h <= 12)) throw fail(400, "Duration must be 1–12 hours");
    if (!COMPAT[b.type]) throw fail(400, "Unknown vehicle type");
    if (busy(plate)) throw fail(409, "This vehicle already has a bay");
    let s = null;
    if (b.slot) { s = db.slots.find(x => x.id === b.slot); if (!s) throw fail(404, "Bay not found"); if (s.st !== "free" || !COMPAT[b.type].includes(s.z)) throw fail(409, "That bay is not available. Pick another"); }
    else { const r = recommend(b.type, b.pref); if (!r) throw fail(409, "No free bays for this vehicle type"); s = r.slot; }
    const bk = { id: "PS" + (++db.seq), userId: u.id, plate, slot: s.id, hours: h, price: Math.round(RATE[s.z] * h * mult()), status: "reserved", paid: false, at: Date.now(), expires: Date.now() + HOLD };
    s.st = "res"; s.plate = plate; db.bookings.unshift(bk); save(); return bk;
  }
  if (M === "POST" && (m = p.match(/^bookings\/(PS\d+)\/(pay|checkin|cancel|checkout)$/))) {
    need(); const bk = db.bookings.find(x => x.id === m[1]);
    if (!bk || (bk.userId !== u.id && u.role !== "admin")) throw fail(404, "Booking not found");
    const s = db.slots.find(x => x.id === bk.slot);
    if (m[2] === "pay") {
      if (bk.status !== "reserved") throw fail(409, "This booking can no longer be paid");
      if (bk.paid) throw fail(409, "Already paid");
      const c = charge(bk.price, b.method, b); bk.paid = true; bk.expires = null; recPay(bk, bk.userId, bk.price, b.method, c.detail, c.ref);
    } else if (m[2] === "checkin") {
      if (bk.status !== "reserved") throw fail(409, "Booking is not waiting for check-in");
      if (!bk.paid) throw fail(402, "Pay for this booking before checking in");
      bk.status = "parked"; s.st = "occ"; s.since = Date.now();
    } else if (m[2] === "cancel") {
      if (bk.status !== "reserved") throw fail(409, "Only reserved bookings can be cancelled");
      if (bk.paid) recPay(bk, bk.userId, -bk.price, "refund", "Refund", "re_" + rnd(6));
      bk.status = "cancelled"; s.st = "free"; s.plate = "";
    } else {
      if (bk.status !== "parked") throw fail(409, "Vehicle is not checked in");
      bk.status = "done"; s.st = "free"; s.plate = "";
    }
    save(); return bk;
  }

  if (M === "POST" && p === "gate/entry") {
    admin(); const plate = normPlate(b.plate); if (!okPlate(plate)) throw fail(400, "Enter a valid plate");
    const bk = db.bookings.find(x => x.plate === plate && x.status === "reserved");
    if (bk) { if (!bk.paid) throw fail(402, `Booking ${bk.id} is unpaid. Ask the driver to pay first`); const s = db.slots.find(x => x.id === bk.slot); bk.status = "parked"; s.st = "occ"; s.since = Date.now(); save(); return { message: `Booking found. Proceed to bay ${bk.slot}.` }; }
    if (busy(plate)) throw fail(409, "This vehicle is already inside");
    const r = recommend(b.type, "near"); if (!r) throw fail(409, "Lot full for this vehicle type");
    Object.assign(r.slot, { st: "occ", plate, since: Date.now() }); save(); return { message: r.text.replace("is my pick because", "assigned because") + " Gate open." };
  }
  if (M === "POST" && p === "gate/exit") {
    admin(); const plate = normPlate(b.plate), s = db.slots.find(x => x.plate === plate && x.st === "occ");
    if (!s) throw fail(404, `No parked vehicle matches ${plate}`);
    const bk = db.bookings.find(x => x.plate === plate && x.status === "parked"); let fee = 0, note;
    if (bk) { bk.status = "done"; note = `Booking ${bk.id}, already paid`; }
    else { const h = Math.max(1, Math.ceil((Date.now() - s.since) / 36e5)); fee = Math.round(RATE[s.z] * h * mult()); note = `${h} h at ₹${RATE[s.z]}/h × ${mult()}`; recPay(null, u.id, fee, "gate", "Collected at gate", "gt_" + rnd(6)); }
    s.st = "free"; s.plate = ""; s.since = 0; save(); return { fee, message: `${fee ? "Collected ₹" + fee : "Nothing to pay"}. ${note}. Bay ${s.id} is free again.` };
  }
  if (M === "GET" && p === "admin/stats") {
    admin(); const by = {}; db.bookings.forEach(x => by[x.status] = (by[x.status] || 0) + 1);
    return { revenue: db.payments.reduce((t, x) => t + x.amount, 0), users: db.users.length, bookings: db.bookings.length, byStatus: by, payments: db.payments.slice(0, 8).map(x => ({ ...x, email: (db.users.find(y => y.id === x.userId) || {}).email })) };
  }
  throw fail(404, "Not found");
}

/* ---------- static files ---------- */
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };
function serve(res, p) {
  const f = path.normalize(path.join(PUB, p === "/" ? "index.html" : p));
  if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("Not found"); }
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream", "X-Content-Type-Options": "nosniff" }); fs.createReadStream(f).pipe(res);
}
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (!url.pathname.startsWith("/api/")) return serve(res, decodeURIComponent(url.pathname));
  try { send(res, 200, await api(req, res, url.pathname.slice(5))); }
  catch (e) { if (!e.code) console.error(e); send(res, e.code || 500, { error: e.code ? e.message : "Server error" }); }
}).listen(PORT, () => console.log(`ParkSense running at http://localhost:${PORT}`));

/* ---------- background jobs ---------- */
setInterval(() => { // release unpaid holds
  let ch = false;
  for (const bk of db.bookings) if (bk.status === "reserved" && !bk.paid && bk.expires && bk.expires < Date.now()) { bk.status = "expired"; const s = db.slots.find(x => x.id === bk.slot); s.st = "free"; s.plate = ""; ch = true; }
  for (const t in db.sessions) if (db.sessions[t].exp < Date.now()) { delete db.sessions[t]; ch = true; }
  if (ch) save();
}, 15000);
if (process.env.SIMULATE !== "0") setInterval(() => { // demo traffic from other drivers
  const own = new Set(db.bookings.filter(x => x.status === "reserved" || x.status === "parked").map(x => x.plate));
  const free = db.slots.filter(s => s.st === "free"), occ = db.slots.filter(s => s.st === "occ" && !own.has(s.plate));
  if (Math.random() < .5 && free.length > 2) Object.assign(free[Math.floor(Math.random() * free.length)], { st: "occ", plate: rp(), since: Date.now() });
  else if (occ.length) Object.assign(occ[Math.floor(Math.random() * occ.length)], { st: "free", plate: "", since: 0 });
  save();
}, 8000);
