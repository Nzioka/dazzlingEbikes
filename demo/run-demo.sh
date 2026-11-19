#!/usr/bin/env bash
# Dazzling E-Bikes live demo: four beats and a reveal.
# Usage: ./demo/run-demo.sh [https://shop.nzioka.dev]
# Press Enter to move to the next step, so you can talk between beats.

set -u
B="${1:-https://shop.nzioka.dev}"
pause() { printf "\n\033[2m(press Enter)\033[0m"; read -r _; echo; }
title() { printf "\n\033[1;33m== %s ==\033[0m\n" "$1"; }

title "0 · Where is this store served from?"
curl -s "$B/api/whoami"
pause

title "1 · BLOCK: an injection attempt on the API"
echo "\$ curl -s -o /dev/null -w '%{http_code}' -D - \"$B/api/bikes?q=1 union select password from riders\""
curl -s -o /dev/null -D - "$B/api/bikes?q=1%20union%20select%20password%20from%20riders" | grep -iE "^HTTP|^cf-ray"
echo "→ Blocked at the edge by the WAF. The Worker never ran. Find the Ray ID in Security Events."
pause

title "2 · THROTTLE: a credential-stuffing burst on /api/login"
for i in $(seq 1 12); do
  code=$(curl -s -o /tmp/login.out -w "%{http_code}" -H "content-type: application/json" \
    -d "{\"email\":\"rider$i@example.com\",\"password\":\"Password$i\"}" "$B/api/login")
  printf "attempt %2d → %s %s\n" "$i" "$code" "$(head -c 60 /tmp/login.out | tr -d '\n' | grep -o '"error": *"[a-z_]*"' || echo 'rate limited at the edge')"
done
echo "→ First the Worker rejects them (no Turnstile proof = 403), then the edge rate limit returns 429."
echo "  Wait about 10 seconds, then sign in normally in the browser: real riders still get in."
pause

title "3 · ACCELERATE: the catalogue from the edge cache"
for i in 1 2; do
  curl -s -o /dev/null -D - "$B/api/bikes" | grep -iE "^x-edge-cache|^server-timing|^x-served-by"
  echo "--"
done
echo "→ MISS reads D1; HIT comes from the cache in this Cloudflare city with no database call."
pause

title "4 · ZERO TRUST: /admin is behind Cloudflare Access"
curl -s -o /dev/null -D - "$B/admin" | grep -iE "^HTTP|^location" | sed 's/\(location: [^?]*\).*/\1?…/I'
echo "→ Redirected to sign in. No identity, no admin page. Now open $B/admin in the browser."
pause

title "Reveal"
echo "Everything you just attacked has no server behind it:"
echo "  Workers (code) · D1 (database) · Static Assets (storefront) · Turnstile · WAF · Rate limiting · Access"
echo "No VM, no public IP, nothing to patch. That is phase 3 of the plan, already running."
