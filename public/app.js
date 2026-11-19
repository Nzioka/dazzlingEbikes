// Dazzling E-Bikes storefront: plain JS, talks to the Worker API.

const $ = (s) => document.querySelector(s);
const money = (n) => "$" + Number(n).toLocaleString("en-US");
let turnstileWidget = null;
let account = null; // { rider, orders } while signed in

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
  let body;
  if (account) {
    if (!confirm(`Order ${bike.name} for ${money(bike.price_usd)}?`)) return;
    body = { bikeId: bike.id };
  } else {
    const email = prompt(`Order ${bike.name}. Your email?`, "demo@dazzling.bike");
    if (!email) return;
    body = { bikeId: bike.id, email };
  }
  const r = await fetch("/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const out = await r.json().catch(() => ({}));
  alert(r.ok
    ? `Order #${out.orderId} confirmed.${account ? " You'll find it under Rider account." : ""}`
    : `Order failed: ${out.error || r.status}`);
  loadBikes();
  if (account) loadAccount();
}

async function loadAccount() {
  try {
    const out = await (await fetch("/api/me")).json();
    account = out.signedIn ? out : null;
  } catch {
    account = null;
  }
  renderAccount();
}

function renderAccount() {
  $("#login").hidden = !!account;
  $("#me").hidden = !account;
  if (!account) return;
  $("#me-name").textContent = account.rider.name;
  $("#me-email").textContent = account.rider.email;
  const list = $("#me-orders");
  list.innerHTML = "";
  if (!account.orders.length) {
    list.innerHTML = `<li class="muted">No orders yet. Pick a bike from the range above.</li>`;
  }
  for (const o of account.orders) {
    const li = document.createElement("li");
    const when = String(o.created_at).slice(0, 16);
    li.textContent = `#${o.id} · ${o.bike_name} · ${money(o.price_usd)} · ${when} UTC`;
    list.appendChild(li);
  }
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
      msg.className = "msg";
      msg.textContent = "";
      f.reset();
      await loadAccount();
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

function setupAssistant() {
  const panel = $("#assist"), log = $("#assist-log"), form = $("#assist-form");
  const input = $("#assist-input"), openBtn = $("#assist-open");
  const history = [];
  let busy = false;

  const say = (cls, text) => {
    const p = document.createElement("p");
    p.className = "say " + cls;
    p.textContent = text; // plain text only: model output is never inserted as HTML
    log.appendChild(p);
    log.scrollTop = log.scrollHeight;
    return p;
  };
  const toggle = (open) => {
    panel.hidden = !open;
    openBtn.hidden = open;
    openBtn.setAttribute("aria-expanded", String(open));
    if (open) {
      if (!log.childElementCount)
        say("assistant", "Hi! I’m the Dazzling Rider Assistant. Ask me which bike suits your rides, how far they go on a charge, or how ordering works.");
      input.focus();
    } else {
      openBtn.focus();
    }
  };

  async function ask(q) {
    q = q.trim();
    if (!q || busy) return;
    busy = true;
    input.value = "";
    say("user", q);
    history.push({ role: "user", content: q });
    const pending = say("assistant pending", "Thinking…");
    try {
      const r = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history.slice(-10) }),
      });
      const out = await r.json().catch(() => ({}));
      if (r.ok && out.reply) {
        pending.className = "say assistant";
        pending.textContent = out.reply;
        history.push({ role: "assistant", content: out.reply });
      } else {
        history.pop();
        pending.className = "say assistant err";
        pending.textContent = r.status === 429
          ? "You’re asking faster than I can pedal. Give me a minute and try again."
          : "Sorry, I couldn’t answer that just now. Please try again.";
      }
    } catch {
      history.pop();
      pending.className = "say assistant err";
      pending.textContent = "Sorry, I couldn’t reach the assistant.";
    }
    busy = false;
    input.focus();
  }

  openBtn.addEventListener("click", () => toggle(true));
  $("#assist-close").addEventListener("click", () => toggle(false));
  panel.addEventListener("keydown", (e) => { if (e.key === "Escape") toggle(false); });
  panel.querySelectorAll("[data-q]").forEach((b) => b.addEventListener("click", () => ask(b.dataset.q)));
  form.addEventListener("submit", (e) => { e.preventDefault(); ask(input.value); });
}

$("#signout").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" }).catch(() => {});
  account = null;
  renderAccount();
});

loadBikes();
loadAccount();
setupLogin();
showEdge();
setupAssistant();
