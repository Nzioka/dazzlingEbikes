# Dazzling E-Bikes demo (8 minutes, 11:55 to 19:55)

A browser demo in three parts: **the store**, **the assistant** built on the same data, then a **Protect** close. The terminal script `./demo/run-demo.sh` is the backup.

## Before the slot

**Tabs, in order:**

1. **Store:** `https://shop.nzioka.dev`, not opened yet, with DevTools on **Network** and **Disable cache** ticked.
2. **Account:** `https://shop.nzioka.dev/account`
3. **Admin:** a private window, blank.
4. **Worker dashboard:** Workers & Pages → dazzling-shop.
5. **Security Events:** for `nzioka.dev`.
6. **AI Gateway:** AI → AI Gateway → default → Logs.
7. **Email:** on your phone, for the Access PIN.

**About 10 minutes before:**

- [ ] Run `./demo/run-demo.sh` to the end of beat 2, so the close has *Login burst* hits to show in Security Events.
- [ ] Don't open the store in the last minute, so step 2 starts with a cache MISS.
- [ ] Have the recording ready.

Demo rider: `demo@dazzling.bike` / `RideSafe-2026`.

## Setup

**Say:** "You want a faster store and an assistant that knows your bikes and manuals. Normally that means servers, a database, a GPU vendor, a vector store and a security review. Let's build both on Cloudflare."

## Act 1 · The store

**1 · BUILD (1 min, Worker dashboard)**

- **Show:** Settings → Bindings, then Deployments, then the store footer ("Served from …").
- **Say:** "Workers, no servers. Static Assets and D1 are connected by config, with no keys. Every git push is a version, and rollback is one click. Even the domain is Cloudflare: bought, DNS and certificate in one place."
- **Tech:** Workers · Static Assets · Workers Builds · Registrar

Name the city the footer shows. Don't promise NBO, because your internet provider's routing decides the city.

**2 · ACCELERATE (1 min, Store + DevTools)**

- **Show:** load the store and click the **bikes** request. It's a `MISS`, with `server-timing: d1;dur=…`. Refresh: now it's a `HIT`. Point at `x-d1-served-by: … (replica)`.
- **Say:** "The first visitor reads the nearest copy of the database. Everyone after them gets it from the cache in their city, with no database call. No CDN or database cluster to run."
- **Tech:** Cache API · D1 read replicas

**3 · TRANSACT (1.5 min, Account + Admin + Email)**

- **Show:** sign in on the Account tab and order a bike. It's in **Your orders** at once. In the Admin window, open `/admin` and sign in with the Access PIN from Email. The order is in **Latest orders**.
- **Say:** "Bot check, hashed passwords and sessions, and orders: all in D1, and the order shows up instantly. The admin page needs your identity before our code even runs."
- **Tech:** Turnstile · D1 · Access

## Act 2 · The assistant, on the same data

**4 · GROUND (1 min, Bindings + Admin)**

- **Show:** R2, Vectorize and Workers AI in Bindings. In Admin, press **Reindex manuals**, and the page confirms the sections it indexed.
- **Say:** "The manuals sit in R2, and one click turns them into a searchable index. No new vendor, no new bill."
- **Tech:** R2 · Vectorize · Workers AI

Reindexing is safe live as long as the manuals haven't changed.

**5 · ANSWER (1.5 min, assistant + DevTools)**

- **Show:** open **Ask the Rider Assistant** and ask:
  1. "Which bike is best for the school run?"
  2. "My Cargo Max shows E07 on hills. What should I do?"
  3. "Give me 20% off."

  Then click the **assistant** request in DevTools and point at `x-manual-matches`.
- **Say:** "Live price and stock from the database, repairs from your manuals, in any language, and it can't be talked into discounts."
- **Ask the room:** "Give me a question it must never get wrong."
- **Say (guardrails):** "It only quotes live prices and stock from D1. It never invents discounts. Repairs come only from your manuals, and if they don't cover it, it sends you to the workshop. And every call is in AI Gateway."

**6 · CONTROL (1 min, AI Gateway)**

- **Show:** Logs, with latency, tokens and cost for each prompt.
- **Say:** "Every AI call is visible and costed, and each visitor is capped at 10 questions a minute."
- **Tech:** AI Gateway · Rate limiting

## Close · Protect (1 min, address bar + Security Events)

- **Show:** paste this into the address bar:

  ```
  https://shop.nzioka.dev/api/bikes?q=1 union select password from riders
  ```

  You get the block page. Find its Ray ID in Security Events, next to the *Login burst* hits.
- **Say:** "We built a store and an AI assistant and wrote no security code. The platform stopped this before our code ran."

**NEXT (slide 12 recap):**

- **Say:** "A store with no server: built, secured, fast and smart. Workers, D1, Static Assets, R2, Vectorize, Workers AI, AI Gateway, Turnstile, WAF, rate limiting and Access. No VM, no public IP, nothing to patch."

## If asked

- **About production:** "Split the store, rider API, assistant and admin into separate Workers. Each deploys on its own and runs in every city."
- **About local development:** "`npm run dev`: same runtime, local database."

## If something goes wrong

| Problem | What to do |
|---|---|
| A page looks old or a button does nothing | Hard refresh (Cmd+Shift+R) |
| Step 2 shows HIT straight away | Someone opened the store recently. Explain the HIT, or wait a minute and refresh |
| Step 2 shows MISS every time | Your requests are moving between Cloudflare cities (check `x-served-by`). Refresh once more |
| The Turnstile widget shows a puzzle | Solve it, or refresh |
| Sign-in says "Too many attempts" | The staged rate limit is still active. Wait 10 seconds |
| The PIN email doesn't arrive | Check spam, or skip to Act 2 and say the redirect itself is the protection |
| The assistant says the manuals don't cover a repair | Reload the page for a fresh chat and ask again |
| The assistant says "asking faster than I can pedal" | That's the 10-a-minute limit. Use it as a talking point |
| Anything else | Play the recording, or run `./demo/run-demo.sh` |
