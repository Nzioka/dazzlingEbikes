// Dazzling E-Bikes storefront: plain JS, talks to the Worker API.

const $ = (s) => document.querySelector(s);
const money = (n) => "$" + Number(n).toLocaleString("en-US");
let turnstileWidget = null;

async function loadBikes() {
  const grid = $("#grid");
  try {
    const t0 = performance.now();
    const r = await fetch("/api/bikes");
    const { bikes } = await r.json();
    const ms = Math.round(performance.now() - t0);
    grid.innerHTML = "";
    for (const b of bikes) {
      const el = document.createElement("article");
      el.className = "bike";
      el.innerHTML = `
        <img src="${b.image}" alt="" width="320" height="200">
        <h3></h3><p class="muted tag"></p>
        <p class="spec">${b.range_km} km range · ${b.stock > 0 ? b.stock + " in stock" : "Sold out"}</p>
        <div class="row"><b>${money(b.price_usd)}</b><button class="btn small" ${b.stock > 0 ? "" : "disabled"}>Order</button></div>`;
      el.querySelector("h3").textContent = b.name;
      el.querySelector(".tag").textContent = b.tagline;
      el.querySelector("button").addEventListener("click", () => order(b));
      grid.appendChild(el);
    }
    const cache = r.headers.get("x-edge-cache") || "n/a";
    grid.insertAdjacentHTML("beforeend", `<p class="muted note">Catalogue loaded in ${ms} ms · edge cache ${cache}</p>`);
  } catch (e) {
    grid.innerHTML = `<p class="msg err">Could not load bikes.</p>`;
  }
}

async function order(bike) {
  const email = prompt(`Order ${bike.name}. Your email?`, "demo@dazzling.bike");
  if (!email) return;
  const r = await fetch("/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ bikeId: bike.id, email }),
  });
  const out = await r.json();
  alert(r.ok ? `Order #${out.orderId} confirmed.` : `Order failed: ${out.error}`);
  loadBikes();
}

async function setupLogin() {
  const cfg = await (await fetch("/api/config")).json().catch(() => ({}));
  const mount = () => {
    if (window.turnstile && cfg.turnstileSiteKey) {
      turnstileWidget = window.turnstile.render("#turnstile", { sitekey: cfg.turnstileSiteKey });
    } else {
      setTimeout(mount, 300);
    }
  };
  mount();

  $("#login").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const msg = $("#login-msg");
    const token = window.turnstile && turnstileWidget !== null ? window.turnstile.getResponse(turnstileWidget) : "";
    msg.className = "msg";
    msg.textContent = "Signing in…";
    const r = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: f.email.value, password: f.password.value, turnstileToken: token }),
    });
    let out = {};
    try { out = await r.json(); } catch {}
    if (r.ok) {
      msg.className = "msg ok";
      msg.textContent = `Welcome back, ${out.rider.name}.`;
    } else if (r.status === 429) {
      msg.className = "msg err";
      msg.textContent = "Too many attempts. Please wait a few seconds.";
    } else {
      msg.className = "msg err";
      msg.textContent = out.error === "bot_check_failed" ? "Please complete the check." : "Email or password is wrong.";
    }
    if (window.turnstile && turnstileWidget !== null) window.turnstile.reset(turnstileWidget);
  });
}

async function showEdge() {
  try {
    const w = await (await fetch("/api/whoami")).json();
    const where = w.yourCity ? ` · you’re in ${w.yourCity}` : "";
    $("#edge").textContent = `Served from Cloudflare ${w.servedFrom}${where} · ${w.protocol || ""}`;
  } catch {
    $("#edge").textContent = "Served from Cloudflare";
  }
}

loadBikes();
setupLogin();
showEdge();
