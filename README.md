# Dazzling E-Bikes demo store, built entirely on Cloudflare

A working online store for the Dazzling E-Bikes presentation. There is no server: the "origin" is a Cloudflare Worker.

| Part | Cloudflare product | What it does in the demo |
|---|---|---|
| Storefront (HTML, CSS, images) | Workers Static Assets | Served from the edge city closest to the viewer |
| API: `/api/bikes`, `/api/login`, `/api/orders` | Workers | The application logic ("the origin") |
| Bikes, riders, orders, sessions, login attempts | D1 | Serverless SQL database |
| Catalogue caching | Cache API | `x-edge-cache: MISS` then `HIT` |
| Login bot check | Turnstile | Scripts without a token get 403 from the Worker |
| Injection attempts | WAF custom rule | 403 at the edge, the Worker never runs |
| Credential stuffing | Rate limiting rule | 429 at the edge after the threshold |
| `/admin` | Access (Zero Trust) | Identity check at the edge; the Worker also verifies the signed Access token |
| Rider Assistant | Workers AI, AI Gateway | Answers grounded in the live catalogue, with logging and fallback |
| Repair manuals | R2, Vectorize, Workers AI embeddings | The assistant answers repair questions from the official manuals and links to them |

Demo rider: `demo@dazzling.bike` / `RideSafe-2026`

## Deploy (about 20 minutes)

You need: Node 18+, a Cloudflare account, and the `nzioka.dev` zone on it. Nothing may already exist at `shop.nzioka.dev`.

```bash
npm install
npx wrangler login

# 1. Database
npx wrangler d1 create dazzling-shop
#    → copy the database_id into wrangler.jsonc
npx wrangler d1 migrations apply dazzling-shop --remote

# 2. Turnstile: Dashboard → Turnstile → Add widget → hostname shop.nzioka.dev, mode Managed
#    → put the site key in wrangler.jsonc (TURNSTILE_SITE_KEY), then:
npx wrangler secret put TURNSTILE_SECRET

# 3. Repair manuals: a bucket for the files and a vector index for search
npx wrangler r2 bucket create dazzling-manuals
npx wrangler vectorize create dazzling-manuals --dimensions=1024 --metric=cosine
npx wrangler vectorize create-metadata-index dazzling-manuals --property-name=bike --type=string
npm run manuals:upload

# 4. Deploy (creates the shop.nzioka.dev custom domain and its certificate)
npx wrangler deploy
```

Then open `/admin` and press **Reindex manuals**. Vectorize applies the new vectors within a few minutes.

Check it: `curl https://shop.nzioka.dev/api/whoami` should show `"servedFrom": "NBO"` (or the nearest city) and `"origin": "Cloudflare Worker (no server, no public IP)"`.

## Configure the edge (dashboard, zone nzioka.dev)

**Before you start:** turn **Bot Fight Mode off** for the demo: it can challenge curl and make the output unpredictable.

**1. WAF custom rule** · Security → WAF → Custom rules → Create

- Name: `Block injection attempts`
- Expression (Edit expression):

  ```
  (http.host eq "shop.nzioka.dev" and (lower(url_decode(http.request.uri.query)) contains "union select" or lower(url_decode(http.request.uri.query)) contains "' or 1=1" or http.user_agent contains "sqlmap"))
  ```

- Action: Block

**2. Rate limiting rule** · Security → WAF → Rate limiting rules → Create

- Name: `Login burst`
- If: Hostname equals `shop.nzioka.dev` AND URI Path equals `/api/login` AND Request Method equals `POST`
- Characteristics: IP · 5 requests per 10 seconds · Action Block for 10 seconds
- (Free plan limits: one rule, 10-second period. In production you'd count per account too, and use longer windows.)

**3. Access** · Zero Trust → Access → Applications → Add → Self-hosted

- Domain: `shop.nzioka.dev`, path `admin`
- Policy: Allow, Include → Emails → your email. Login method: One-time PIN.
- Copy the **Application Audience (AUD) tag** and your team domain (for example `nzioka.cloudflareaccess.com`) into `wrangler.jsonc` (`ACCESS_AUD`, `ACCESS_TEAM_DOMAIN`), then `npx wrangler deploy` again.
- Until both are set, `/admin` returns 503. It fails closed.

## Run the demo

```bash
chmod +x demo/run-demo.sh
./demo/run-demo.sh https://shop.nzioka.dev
```

The script pauses after each beat so you can talk. Beats 5 and 6 are best finished in the browser. Expected output:

| Beat | You run | You should see | Where to show it |
|---|---|---|---|
| 0 | `/api/whoami` | `servedFrom: NBO`, origin is a Worker | Terminal |
| 1 · Block | `?q=1 union select…` | `HTTP/2 403` and a `cf-ray` | Security → Events, search the Ray ID |
| 2 · Throttle | 12 logins with no Turnstile token | `403 bot_check_failed` ×5, then `429` | Security → Events (rate limit); then a normal browser login works |
| 3 · Accelerate | `/api/bikes` twice | `x-edge-cache: MISS` with `x-d1-served-by: EEUR (replica)` and `server-timing: d1;dur=…`, then `HIT` | Terminal; the store footer shows the serving city |
| 4 · Zero Trust | `/admin` | `302` to `…cloudflareaccess.com` | Browser: sign in with the PIN, the admin page lists the login attempts that reached the Worker |
| 5 · Rider account | `/api/me` without and with a forged cookie | `{"signedIn":false}` both times | Browser: open `/account`, sign in as the demo rider, order a bike, it appears under "Your orders"; sign out |
| 6 · AI assistant | Three questions to `/api/assistant` | A Cargo Max recommendation with live price and stock; an E07 repair answer with `x-manual-matches` showing the manual sections Vectorize found; a refusal to invent a discount | Browser: the "Ask the Rider Assistant" button; dashboard → AI → AI Gateway → default |

**The admin page is the punchline for beat 2:** the 403s are listed because they reached the code; the 429s and the WAF block aren't there, because the edge stopped them before the code ever ran.

## Updating the repair manuals

The manuals are Markdown files in `manuals/`, one section per `## ` heading. Edit or add a file, then:

```bash
npm run manuals:upload      # copies manuals/*.md to the R2 bucket
```

Open `/admin` and press **Reindex manuals**. The Worker reads every file in the bucket, splits it into sections, embeds them with `@cf/baai/bge-m3` (multilingual, so Swahili or French questions match English manuals) and upserts them into Vectorize. When a question names a bike, the search is filtered to that bike's manual plus the shared drive system manual. Riders can read any manual at `/api/manuals/<file>.md`.

## Run locally

```bash
npm install
npx wrangler d1 migrations apply dazzling-shop --local
echo 'DEV_ALLOW_ADMIN="true"' > .dev.vars
npx wrangler dev
```

The R2 bucket and the Vectorize index are marked `"remote": true`, so local development uses the real manuals and index (Vectorize has no local simulator).

Locally, Turnstile verification is skipped when `TURNSTILE_SECRET` isn't set (any non-empty token passes), and `/admin` is open because of `DEV_ALLOW_ADMIN`. Never set `DEV_ALLOW_ADMIN` in production.

## Free plan vs what you'd sell Dazzling E-Bikes

The demo uses free-plan features so it runs on your own account. In the pitch, map each one to the Enterprise feature:

- WAF custom rule → Managed Rulesets, OWASP rules and WAF Attack Score
- Turnstile + one rate limit → Bot Management (a bot score on every request), per-account rate limits, leaked-credential detection
- `x-edge-cache` from the Cache API → CDN, Tiered Cache, Argo for the AWS origin
- Access on `/admin` → Access for dealer and staff portals, with their identity provider
- R2 + Vectorize manuals → AI Search, which watches the bucket and keeps the index up to date with no reindex button
