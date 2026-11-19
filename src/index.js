// Dazzling E-Bikes demo store.
// Everything here runs on Cloudflare: this Worker is the "origin".
// Edge security (WAF custom rules, rate limiting, Access) runs BEFORE this code,
// so anything blocked there never reaches it.

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const started = Date.now();
    let res;
    try {
      res = await route(request, env, ctx, url);
    } catch (err) {
      console.error(JSON.stringify({ msg: "unhandled", path: url.pathname, err: String(err) }));
      res = json({ error: "internal_error" }, 500);
    }
    return withEdgeHeaders(res, request, started);
  },
};

async function route(request, env, ctx, url) {
  const { pathname } = url;
  const method = request.method;

  if (pathname === "/api/health") return json({ ok: true });
  if (pathname === "/api/whoami" && method === "GET") return whoami(request);
  if (pathname === "/api/config" && method === "GET")
    return json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY || "" });

  if (pathname === "/api/bikes" && method === "GET") return listBikes(request, env, ctx);
  const bike = pathname.match(/^\/api\/bikes\/([a-z0-9-]{1,40})$/);
  if (bike && method === "GET") return getBike(env, bike[1]);

  if (pathname === "/api/login" && method === "POST") return login(request, env);
  if (pathname === "/api/orders" && method === "POST") return createOrder(request, env, ctx, url);

  if (pathname === "/admin" || pathname.startsWith("/admin/")) return admin(request, env);

  // Static files are served by Workers Static Assets before this code runs.
  // Anything else is a 404.
  if (pathname.startsWith("/api/")) return json({ error: "not_found" }, 404);
  return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
}

// ---------- Catalogue (D1 + edge Cache API) ----------

async function listBikes(request, env, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(new URL("/api/bikes", request.url).toString(), { method: "GET" });

  const hit = await cache.match(cacheKey);
  if (hit) {
    const r = new Response(hit.body, hit);
    r.headers.set("x-edge-cache", "HIT");
    r.headers.delete("server-timing"); // no database call on a hit
    return r;
  }

  const t0 = Date.now();
  const { results } = await env.DB.prepare(
    "SELECT id, name, tagline, range_km, price_usd, stock, image FROM bikes ORDER BY price_usd"
  ).all();
  const dbMs = Date.now() - t0;

  const res = json({ bikes: results }, 200, {
    "cache-control": "public, max-age=0, s-maxage=60",
    "server-timing": `d1;dur=${dbMs}`,
  });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  res.headers.set("x-edge-cache", "MISS");
  return res;
}

async function getBike(env, id) {
  const row = await env.DB.prepare(
    "SELECT id, name, tagline, range_km, price_usd, stock, image FROM bikes WHERE id = ?"
  ).bind(id).first();
  return row ? json(row) : json({ error: "not_found" }, 404);
}

// ---------- Rider login (Turnstile + PBKDF2) ----------

async function login(request, env) {
  const cf = request.cf || {};
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const body = await readJson(request);
  if (!body) return json({ error: "bad_request" }, 400);

  const email = String(body.email || "").trim().toLowerCase().slice(0, 200);
  const password = String(body.password || "");
  const token = String(body.turnstileToken || "");

  // 1. Prove there is a human (Turnstile). Scripts that skip the widget fail here.
  const human = await verifyTurnstile(env, token, ip);
  if (!human.ok) {
    await logLogin(env, email, false, "bot_check_failed", ip, cf.colo);
    return json({ error: "bot_check_failed", detail: "Turnstile token missing or invalid" }, 403);
  }

  // 2. Check the password (PBKDF2-SHA256, constant-time compare).
  const rider = email
    ? await env.DB.prepare("SELECT email, name, salt, pw_hash FROM riders WHERE email = ?").bind(email).first()
    : null;
  const ok = rider ? await checkPassword(password, rider.salt, rider.pw_hash) : false;
  await logLogin(env, email, ok, ok ? "ok" : "bad_credentials", ip, cf.colo);

  if (!ok) return json({ error: "invalid_credentials" }, 401);
  return json({ ok: true, rider: { name: rider.name, email: rider.email } });
}

async function verifyTurnstile(env, token, ip) {
  if (!token) return { ok: false };
  if (!env.TURNSTILE_SECRET) {
    // Local development without a secret: accept any non-empty token.
    return { ok: true, skipped: true };
  }
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  form.append("remoteip", ip);
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const out = await r.json();
  return { ok: !!out.success };
}

async function checkPassword(password, saltHex, expectedHex) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(saltHex), iterations: 100000 },
    key,
    256
  );
  const a = new Uint8Array(bits);
  const b = hexToBytes(expectedHex);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function logLogin(env, email, ok, reason, ip, colo) {
  try {
    await env.DB.prepare("INSERT INTO login_events (email, ok, reason, ip, colo) VALUES (?, ?, ?, ?, ?)")
      .bind(email || null, ok ? 1 : 0, reason, ip, colo || null)
      .run();
  } catch (e) {
    console.error(JSON.stringify({ msg: "login_log_failed", err: String(e) }));
  }
}

// ---------- Orders ----------

async function createOrder(request, env, ctx, url) {
  const body = await readJson(request);
  if (!body) return json({ error: "bad_request" }, 400);
  const bikeId = String(body.bikeId || "");
  const email = String(body.email || "").trim().toLowerCase();
  if (!/^[a-z0-9-]{1,40}$/.test(bikeId) || !/^[^@\s]{1,64}@[^@\s]{1,190}$/.test(email))
    return json({ error: "invalid_order" }, 400);

  const cf = request.cf || {};
  // Decrement stock only if there is stock left (atomic in a single statement).
  const upd = await env.DB.prepare("UPDATE bikes SET stock = stock - 1 WHERE id = ? AND stock > 0").bind(bikeId).run();
  if (!upd.meta.changes) return json({ error: "out_of_stock" }, 409);

  const ins = await env.DB.prepare("INSERT INTO orders (bike_id, email, city, colo) VALUES (?, ?, ?, ?)")
    .bind(bikeId, email, cf.city || null, cf.colo || null)
    .run();

  // Stock changed: drop the cached catalogue in this location.
  ctx.waitUntil(caches.default.delete(new Request(new URL("/api/bikes", url).toString())));
  return json({ ok: true, orderId: ins.meta.last_row_id }, 201);
}

// ---------- Admin (behind Cloudflare Access) ----------

async function admin(request, env) {
  // Access blocks unauthenticated users at the edge. The Worker checks the
  // signed Access token too, so a misconfigured route still fails closed.
  const allowDev = env.DEV_ALLOW_ADMIN === "true";
  let identity = "local developer";
  if (!allowDev) {
    if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD)
      return text("Admin is locked: Cloudflare Access is not configured for this app.", 503);
    const jwt = request.headers.get("cf-access-jwt-assertion");
    const claims = jwt ? await verifyAccessJwt(jwt, env) : null;
    if (!claims) return text("Forbidden: a valid Cloudflare Access token is required.", 403);
    identity = claims.email || claims.sub || "authenticated user";
  }

  const [orders, logins, stats] = await Promise.all([
    env.DB.prepare("SELECT id, bike_id, email, city, colo, created_at FROM orders ORDER BY id DESC LIMIT 20").all(),
    env.DB.prepare("SELECT email, ok, reason, ip, colo, created_at FROM login_events ORDER BY id DESC LIMIT 20").all(),
    env.DB.prepare(
      "SELECT SUM(ok = 1) AS ok, SUM(reason = 'bad_credentials') AS bad, SUM(reason = 'bot_check_failed') AS bots FROM login_events"
    ).first(),
  ]);

  const rows = (list, cols) =>
    list.results.map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c])}</td>`).join("")}</tr>`).join("") ||
    `<tr><td colspan="${cols.length}">Nothing yet</td></tr>`;

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dazzling Admin</title><link rel="stylesheet" href="/styles.css"></head><body class="admin">
<header class="bar"><a class="brand" href="/">Dazzling<span>E-Bikes</span></a><span class="pill">Admin · signed in as ${esc(identity)}</span></header>
<main class="wrap">
<h1>Operations</h1>
<div class="kpis">
<div><b>${stats?.ok ?? 0}</b><span>successful logins</span></div>
<div><b>${stats?.bad ?? 0}</b><span>wrong passwords</span></div>
<div><b>${stats?.bots ?? 0}</b><span>bot check failures</span></div>
</div>
<h2>Latest orders</h2>
<table><tr><th>#</th><th>Bike</th><th>Rider</th><th>City</th><th>Edge</th><th>Time (UTC)</th></tr>${rows(orders, ["id", "bike_id", "email", "city", "colo", "created_at"])}</table>
<h2>Latest login attempts</h2>
<table><tr><th>Email</th><th>OK</th><th>Result</th><th>IP</th><th>Edge</th><th>Time (UTC)</th></tr>${rows(logins, ["email", "ok", "reason", "ip", "colo", "created_at"])}</table>
<p class="muted">This page has no server behind it: a Worker reads D1, and Cloudflare Access checked who you are before this code ran.</p>
</main></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

let jwksCache = { at: 0, keys: [] };

async function verifyAccessJwt(token, env) {
  try {
    const [h, p, s] = token.split(".");
    if (!h || !p || !s) return null;
    const header = JSON.parse(b64urlDecodeText(h));
    const claims = JSON.parse(b64urlDecodeText(p));
    const team = env.ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//, "").replace(/\/$/, "");

    if (header.alg !== "RS256") return null;
    const now = Math.floor(Date.now() / 1000);
    if (!claims.exp || claims.exp < now) return null;
    if (claims.iss !== `https://${team}`) return null;
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(env.ACCESS_AUD)) return null;

    if (Date.now() - jwksCache.at > 10 * 60 * 1000 || !jwksCache.keys.length) {
      const r = await fetch(`https://${team}/cdn-cgi/access/certs`);
      jwksCache = { at: Date.now(), keys: (await r.json()).keys || [] };
    }
    const jwk = jwksCache.keys.find((k) => k.kid === header.kid);
    if (!jwk) return null;

    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlDecode(s),
      new TextEncoder().encode(`${h}.${p}`)
    );
    return valid ? claims : null;
  } catch {
    return null;
  }
}

// ---------- Where am I being served from ----------

function whoami(request) {
  const cf = request.cf || {};
  return json(
    {
      servedFrom: cf.colo || "local",
      yourCity: cf.city || null,
      yourCountry: cf.country || null,
      network: cf.asOrganization || null,
      protocol: cf.httpProtocol || null,
      tls: cf.tlsVersion || null,
      // Present only on plans with Bot Management (Enterprise).
      botScore: cf.botManagement ? cf.botManagement.score : null,
      origin: "Cloudflare Worker (no server, no public IP)",
    },
    200,
    { "cache-control": "no-store" }
  );
}

// ---------- Helpers ----------

function withEdgeHeaders(res, request, started) {
  const r = new Response(res.body, res);
  const colo = (request.cf && request.cf.colo) || "local";
  r.headers.set("x-served-by", `worker@${colo}`);
  r.headers.append("server-timing", `worker;dur=${Date.now() - started}`);
  r.headers.set("x-content-type-options", "nosniff");
  r.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  r.headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  if (!r.headers.has("x-frame-options")) r.headers.set("x-frame-options", "DENY");
  return r;
}

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj, null, 2), { status, headers: { ...JSON_HEADERS, ...extra } });
}
function text(s, status = 200) {
  return new Response(s, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}
async function readJson(request) {
  if (!(request.headers.get("content-type") || "").includes("application/json")) return null;
  try {
    return await request.json();
  } catch {
    return null;
  }
}
function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
function b64urlDecode(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function b64urlDecodeText(s) {
  return new TextDecoder().decode(b64urlDecode(s));
}
