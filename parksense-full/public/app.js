const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const ZONES = [{ z: "A", name: "Standard cars", ico: "🚗" }, { z: "B", name: "EV charging", ico: "⚡" }, { z: "C", name: "Motorbikes", ico: "🏍️" }, { z: "D", name: "Accessible", ico: "♿" }];
const COMPAT = { car: ["A"], ev: ["B", "A"], bike: ["C"], acc: ["D", "A"] };
const CURVE = [.12, .1, .08, .08, .1, .15, .3, .5, .75, .85, .8, .7, .65, .6, .62, .68, .78, .88, .82, .65, .5, .38, .25, .16];
let U = null, D = { slots: [], rates: { A: 40, B: 55, C: 15, D: 30 }, mult: 1 }, BK = [], ST = null, sel = null, pending = "dash", mode = "in";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = n => "₹" + Math.round(n).toLocaleString("en-IN");
const isAdmin = () => U && U.role === "admin";
async function api(p, body) {
  const r = await fetch("/api/" + p, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "Request failed"); return j;
}
function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 3000); }
async function refresh() {
  try { D = await api("slots"); BK = U ? await api("bookings") : []; ST = isAdmin() ? await api("admin/stats") : null; } catch (e) { /* offline: keep last data */ }
  render();
}
function go(v) {
  if (v === "gate" && !isAdmin()) return toast("The gate panel is for staff only");
  if ((v === "mine") && !U) { pending = v; toast("Sign in to see your bookings"); v = "auth"; }
  $$(".view").forEach(e => e.classList.toggle("on", e.id === v)); $$("#nav button").forEach(b => b.classList.toggle("on", b.dataset.v === v)); window.scrollTo(0, 0); render();
}
$("#nav").onclick = e => { if (e.target.dataset.v) go(e.target.dataset.v); };
$("#theme").onclick = () => { const r = document.documentElement, d = r.dataset.theme === "dark" || (!r.dataset.theme && matchMedia("(prefers-color-scheme:dark)").matches); r.dataset.theme = d ? "light" : "dark"; };

/* ---------- auth ---------- */
function setMode(m) { mode = m; $("#nameRow").hidden = m === "in"; $("#authGo").textContent = m === "in" ? "Sign in" : "Create account"; $("#tabIn").className = "btn" + (m === "in" ? "" : " alt"); $("#tabUp").className = "btn" + (m === "up" ? "" : " alt"); $("#ap").autocomplete = m === "in" ? "current-password" : "new-password"; }
$("#tabIn").onclick = () => setMode("in"); $("#tabUp").onclick = () => setMode("up");
async function doAuth() {
  try { const r = await api(mode === "in" ? "login" : "register", { name: $("#an").value, email: $("#ae").value, password: $("#ap").value }); U = r.user; $("#ap").value = ""; toast(`Welcome, ${U.name}`); await refresh(); go(pending === "auth" ? "dash" : pending); pending = "dash"; }
  catch (e) { toast(e.message); }
}
$("#authGo").onclick = doAuth; $("#ap").onkeydown = e => { if (e.key === "Enter") doAuth(); };
$("#logout").onclick = async () => { await api("logout", {}); U = null; BK = []; ST = null; toast("Signed out"); go("dash"); refresh(); };

/* ---------- render ---------- */
const cnt = st => D.slots.filter(s => s.st === st).length, occPct = () => D.slots.length ? (D.slots.length - cnt("free")) / D.slots.length : 0;
function render() {
  $("#who").textContent = U ? U.name : ""; $("#authNav").textContent = U ? "Account" : "Sign in"; $("#gateNav").hidden = !isAdmin();
  $("#guest").hidden = !!U; $("#acct").hidden = !U; if (U) { $("#acName").textContent = U.name; $("#acInfo").textContent = U.email + " · " + (U.role === "admin" ? "Staff admin" : "Driver"); }
  const o = occPct();
  $("#stats").innerHTML = `<div class="card stat"><b style="color:var(--free)">${cnt("free")}</b><span>Free bays</span></div><div class="card stat"><b style="color:var(--occ)">${cnt("occ")}</b><span>Occupied</span></div><div class="card stat"><b style="color:var(--res)">${cnt("res")}</b><span>Reserved</span></div><div class="card stat"><b>${Math.round(o * 100)}%</b><span>Lot full</span><div class="meter"><div style="width:${o * 100}%"></div></div></div><div class="card stat"><b>${D.mult}×</b><span>${D.mult > 1 ? "Busy-hour pricing" : "Standard pricing"}</span></div>`;
  const f = $("#zoneFilter").value;
  $("#zones").innerHTML = ZONES.filter(z => !f || z.z === f).map(zn => { const L = D.slots.filter(s => s.z === zn.z); return `<div class="zone card"><h3>${zn.ico} Zone ${zn.z} · ${zn.name}</h3><small>${L.filter(s => s.st === "free").length} of ${L.length} free · ${money(D.rates[zn.z])}/hour</small><div class="bay">${L.map(s => `<button class="slot ${s.st}${sel === s.id ? " pick" : ""}" data-id="${s.id}" title="${s.st === "free" ? "Free – tap to book" : s.st === "res" ? "Reserved" : "Occupied"}${s.plate ? " · " + esc(s.plate) : ""}"><span>${zn.ico}</span>${s.id}</button>`).join("")}</div></div>`; }).join("");
  fillSlots(); priceUI(); bookings(); insights(); $("#hv").textContent = $("#hours").value;
}
$("#zones").onclick = e => {
  const b = e.target.closest(".slot"); if (!b) return; const s = D.slots.find(x => x.id === b.dataset.id);
  if (s.st !== "free") return toast(`Bay ${s.id} is ${s.st === "res" ? "reserved" : "occupied"}`);
  sel = s.id; $("#vtype").value = s.z === "B" ? "ev" : s.z === "C" ? "bike" : s.z === "D" ? "acc" : "car"; go("book"); fillSlots(); $("#slotSel").value = s.id; priceUI(); toast(`Bay ${s.id} selected`);
};
$("#zoneFilter").onchange = render;
function fillSlots() {
  const t = $("#vtype").value, cur = $("#slotSel").value || sel, L = D.slots.filter(s => s.st === "free" && COMPAT[t].includes(s.z));
  $("#slotSel").innerHTML = `<option value="">${L.length ? "Let AI choose for me" : "No free bays for this type"}</option>` + L.map(s => `<option value="${s.id}">${s.id} · ${s.dist} m · ${money(D.rates[s.z])}/h</option>`).join("");
  if (cur && L.some(s => s.id === cur)) $("#slotSel").value = cur;
}
function priceUI() {
  const s = D.slots.find(x => x.id === $("#slotSel").value), z = s ? s.z : COMPAT[$("#vtype").value][0], h = +$("#hours").value;
  $("#priceBox").innerHTML = `<div class="price"><span>Zone ${z} rate</span><span>${money(D.rates[z])}/hour</span></div><div class="price"><span>Duration</span><span>${h} h</span></div><div class="price"><span>Demand factor</span><span>${D.mult}×</span></div><div class="price t"><span>Total</span><span>${money(D.rates[z] * h * D.mult)}</span></div>`;
}
["vtype", "hours", "slotSel", "pref"].forEach(id => $("#" + id).addEventListener("input", () => { if (id === "vtype") { sel = null; $("#aiBox").innerHTML = ""; fillSlots(); } $("#hv").textContent = $("#hours").value; priceUI(); }));
$("#recBtn").onclick = async () => {
  try { const r = await api("recommend", { type: $("#vtype").value, pref: $("#pref").value }); if (!r.best) return $("#aiBox").innerHTML = `<div class="ai">${esc(r.text)}</div>`;
    $("#slotSel").value = r.best; sel = r.best; priceUI(); $("#aiBox").innerHTML = `<div class="ai"><b>AI suggestion</b><br>${esc(r.text)}${r.alts.length ? `<br>Other options: ${r.alts.map(esc).join(", ")}` : ""}</div>`; } catch (e) { toast(e.message); }
};

/* ---------- booking + payment ---------- */
$("#confirm").onclick = async () => {
  if (!U) { pending = "book"; toast("Sign in to book a bay"); return go("auth"); }
  try { const b = await api("bookings", { plate: $("#plate").value, type: $("#vtype").value, hours: +$("#hours").value, pref: $("#pref").value, slot: $("#slotSel").value || undefined });
    $("#plate").value = ""; $("#aiBox").innerHTML = ""; sel = null; await refresh(); payDlg(b); } catch (e) { toast(e.message); refresh(); }
};
function qr(seed) { let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0; let r = ""; for (let i = 0; i < 81; i++) { h = (h * 1103515245 + 12345) >>> 0; if ((h >>> 16) & 1) r += `<rect x="${(i % 9) * 8}" y="${Math.floor(i / 9) * 8}" width="8" height="8"/>`; } return `<svg viewBox="0 0 72 72" width="110" fill="currentColor" aria-label="Ticket code">${r}</svg>`; }
function payDlg(b) {
  const d = $("#dlg");
  d.innerHTML = `<h2>Pay ${money(b.price)}</h2><p class="mute">Bay ${esc(b.slot)} · ${esc(b.plate)} · ${b.hours} h. Test mode: no real money is charged. Try card 4242 4242 4242 4242, any future date, any CVV.</p>
  <label for="pm">Method</label><select id="pm"><option value="card">Card</option><option value="upi">UPI</option></select>
  <div id="cardF"><label for="cn">Card number</label><input id="cn" inputmode="numeric" autocomplete="cc-number" placeholder="4242 4242 4242 4242" maxlength="23"><div style="display:flex;gap:10px"><div style="flex:1"><label for="ce">Expiry</label><input id="ce" placeholder="MM/YY" maxlength="5" autocomplete="cc-exp"></div><div style="flex:1"><label for="cv">CVV</label><input id="cv" type="password" inputmode="numeric" maxlength="4" autocomplete="cc-csc"></div></div></div>
  <div id="upiF" hidden><label for="cu">UPI ID</label><input id="cu" placeholder="name@bank"></div>
  <p id="pe" style="color:var(--occ);font-size:13px;min-height:18px"></p>
  <div class="row" style="margin-top:4px"><button class="btn good" id="pgo">Pay ${money(b.price)}</button><button class="btn alt" id="plater">Pay later</button></div>`;
  d.showModal();
  $("#pm").onchange = e => { $("#cardF").hidden = e.target.value !== "card"; $("#upiF").hidden = e.target.value !== "upi"; };
  $("#plater").onclick = () => { d.close(); toast("Held for 10 minutes. Pay from My bookings"); go("mine"); };
  $("#pgo").onclick = async () => {
    $("#pgo").disabled = true; $("#pe").textContent = "";
    try { await api(`bookings/${b.id}/pay`, { method: $("#pm").value, number: $("#cn").value, expiry: $("#ce").value, cvv: $("#cv").value, upi: $("#cu").value }); await refresh(); ticket(b); }
    catch (e) { $("#pe").textContent = e.message; $("#pgo").disabled = false; }
  };
}
function ticket(b) {
  const d = $("#dlg"); d.innerHTML = `<h2>Payment received ✓</h2><p class="mute">Show this code at the gate.</p><div style="display:flex;gap:16px;align-items:center;margin-top:10px">${qr(b.id + b.plate)}<div><b style="font:800 28px 'Bricolage Grotesque'">${esc(b.slot)}</b><br>${esc(b.plate)}<br>${b.hours} h · ${money(b.price)}<br><small>Ref ${b.id}</small></div></div><div class="row"><button class="btn" id="dOk">Done</button><button class="btn alt" id="dMine">View bookings</button></div>`;
  $("#dOk").onclick = () => d.close(); $("#dMine").onclick = () => { d.close(); go("mine"); };
}
function bookings() {
  if (!U) return $("#bkList").innerHTML = `<div class="card empty">Sign in to book and manage your bays.<div class="row" style="justify-content:center"><button class="btn" data-a="auth">Sign in</button></div></div>`;
  const label = b => b.status === "reserved" ? (b.paid ? "Paid · reserved" : "Awaiting payment") : { parked: "Parked", done: "Completed", cancelled: "Cancelled", expired: "Expired" }[b.status];
  $("#bkList").innerHTML = BK.length ? BK.map(b => `<div class="card bk"><div><h3>${esc(b.slot)} · ${esc(b.plate)}</h3><p>${b.id} · ${b.hours} h · ${money(b.price)}${b.user ? " · " + esc(b.user) : ""} · ${new Date(b.at).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}${b.status === "reserved" && !b.paid && b.expires ? ` · pay within ${Math.max(0, Math.ceil((b.expires - Date.now()) / 6e4))} min` : ""}</p></div><div class="row" style="margin:0;align-items:center"><span class="badge ${b.status === "reserved" ? "reserved" : b.status}">${label(b)}</span>${b.status === "reserved" && !b.paid ? `<button class="btn" data-a="pay" data-i="${b.id}">Pay ${money(b.price)}</button>` : ""}${b.status === "reserved" && b.paid ? `<button class="btn good" data-a="checkin" data-i="${b.id}">Check in</button>` : ""}${b.status === "reserved" ? `<button class="btn alt" data-a="cancel" data-i="${b.id}">Cancel</button>` : ""}${b.status === "parked" ? `<button class="btn" data-a="checkout" data-i="${b.id}">Check out</button>` : ""}</div></div>`).join("") : `<div class="card empty">No bookings yet. Open <b>Book a slot</b> to reserve your first bay.</div>`;
}
$("#bkList").onclick = async e => {
  const a = e.target.dataset.a; if (!a) return; if (a === "auth") return go("auth");
  const b = BK.find(x => x.id === e.target.dataset.i); if (a === "pay") return payDlg(b);
  try { await api(`bookings/${b.id}/${a}`, {}); toast({ checkin: `Checked in at ${b.slot}`, cancel: b.paid ? "Cancelled. Your payment is refunded" : "Booking cancelled", checkout: "Checked out. Safe drive!" }[a]); refresh(); } catch (err) { toast(err.message); }
};

/* ---------- gate (staff) ---------- */
const rp = () => { const L = "ABCDEFGHJKLMNPRSTUVWXYZ", r = n => Math.floor(Math.random() * n); return `AP${10 + r(40)} ${L[r(L.length)]}${L[r(L.length)]} ${1000 + r(9000)}`; };
function scanAnim(el, text) { el.classList.remove("go"); void el.offsetWidth; el.classList.add("go"); el.textContent = "SCANNING…"; return new Promise(r => setTimeout(() => { el.textContent = text || "– – – –"; r(); }, 1100)); }
const note = (el, h) => $(el).innerHTML = `<div class="ai">${h}</div>`;
$("#scanBtn").onclick = async () => { const p = rp(); await scanAnim($("#scanE"), p); $("#gp").value = p; };
$("#admit").onclick = async () => { await scanAnim($("#scanE"), $("#gp").value.toUpperCase()); try { const r = await api("gate/entry", { plate: $("#gp").value, type: $("#gt").value }); note("#entryOut", `<b>Gate open</b><br>${esc(r.message)}`); refresh(); } catch (e) { note("#entryOut", `<b style="color:var(--occ)">Denied</b><br>${esc(e.message)}`); } };
$("#exitBtn").onclick = async () => { await scanAnim($("#scanX"), $("#xp").value.toUpperCase()); try { const r = await api("gate/exit", { plate: $("#xp").value }); note("#exitOut", `<b>Exit approved</b><br>${esc(r.message)}`); refresh(); } catch (e) { note("#exitOut", `<b style="color:var(--occ)">Not found</b><br>${esc(e.message)}`); } };

/* ---------- insights ---------- */
function predict() { const o = occPct(), h = new Date().getHours(), f = Math.min(1.3, Math.max(.7, .5 + (o / Math.max(.05, CURVE[h])) * .5)); return CURVE.map(v => Math.min(.98, v * f)); }
function insights() {
  const P = predict(), h = new Date().getHours(); let pk = 0, lo = 7; P.forEach((v, i) => { if (v > P[pk]) pk = i; if (i >= 7 && i <= 22 && v < P[lo]) lo = i; });
  const t = n => (n % 12 || 12) + (n < 12 ? " AM" : " PM");
  $("#insStats").innerHTML = `<div class="card stat"><b>${t(pk)}</b><span>Predicted peak (${Math.round(P[pk] * 100)}% full)</span></div><div class="card stat"><b>${t(lo)}</b><span>Quietest daytime hour</span></div><div class="card stat"><b>${Math.round(occPct() * 100)}%</b><span>Full right now</span></div><div class="card stat"><b>${D.mult}×</b><span>Current price factor</span></div>`;
  $("#chart").innerHTML = P.map((v, i) => `<div class="${i === h ? "now " : ""}${v > .8 ? "hi" : v < .4 ? "lo" : ""}" style="height:${v * 100}%" title="${t(i)}: ${Math.round(v * 100)}%"></div>`).join("");
  $("#axis").innerHTML = P.map((v, i) => `<span>${i % 3 === 0 ? i : ""}</span>`).join("");
  $("#zoneUse").innerHTML = ZONES.map(z => { const L = D.slots.filter(s => s.z === z.z), u = L.length ? L.filter(s => s.st !== "free").length / L.length : 0; return `<div style="margin-bottom:10px"><div class="price" style="border:0;padding:0"><span>${z.ico} Zone ${z.z}</span><span>${Math.round(u * 100)}%</span></div><div class="meter"><div style="width:${u * 100}%"></div></div></div>`; }).join("");
  const nx = P[(h + 1) % 24], tips = [nx > P[h] + .05 ? "Demand is rising. Book now to lock today’s rate." : nx < P[h] - .05 ? "Demand is easing over the next hour. Prices may drop soon." : "Demand is steady for the next hour.", `Arrive around ${t(lo)} for the best choice of bays.`];
  if (D.mult > 1) tips.push(`Busy-hour pricing is on (${D.mult}×). Short stays cost less.`);
  const ev = D.slots.filter(s => s.z === "B" && s.st === "free").length; tips.push(ev ? `${ev} EV charging bay${ev > 1 ? "s" : ""} free right now.` : "All EV charging bays are taken.");
  $("#tips").innerHTML = tips.map(x => `<div class="ai" style="margin:0 0 8px">${x}</div>`).join("");
  $("#adminBox").innerHTML = ST ? `<div class="card" style="margin-top:16px"><h3>Admin overview</h3><div class="stats" style="margin:12px 0"><div class="card stat"><b>${money(ST.revenue)}</b><span>Net revenue</span></div><div class="card stat"><b>${ST.users}</b><span>Accounts</span></div><div class="card stat"><b>${ST.bookings}</b><span>Bookings</span></div><div class="card stat"><b>${ST.byStatus.parked || 0}</b><span>Parked now</span></div></div><h3 style="font-size:15px">Recent payments</h3>${ST.payments.length ? `<div style="overflow-x:auto"><table><tr><th>When</th><th>User</th><th>Method</th><th>Amount</th></tr>${ST.payments.map(p => `<tr><td>${new Date(p.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</td><td>${esc(p.email)}</td><td>${esc(p.detail)}</td><td>${money(p.amount)}</td></tr>`).join("")}</table></div>` : `<p class="mute">No payments yet.</p>`}</div>` : "";
}

/* ---------- start ---------- */
const tick = () => $("#clock").textContent = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
setInterval(tick, 1000); tick();
setInterval(() => { if (!$("dialog[open]")) refresh(); }, 6000);
(async () => { try { U = (await api("me")).user; } catch { U = null; } await refresh(); })();
