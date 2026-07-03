#!/usr/bin/env bash
# Quick test: fires tracking pixel hits, then checks whether they persisted.
set -e

BASE_URL="https://n8n.iptvnord4k.com"
KEY="${DASHBOARD_SECRET:-}"

if [ -z "$KEY" ]; then
  read -p "Enter your DASHBOARD_SECRET: " KEY
fi

echo "== 1. Firing 3 test pixel hits =="
curl -s -o /dev/null -w "  hit 1 status: %{http_code}\n" \
  -H "X-Vercel-IP-Country: US" \
  "$BASE_URL/tracker/track.php?email=script-test-1@example.com"

curl -s -o /dev/null -w "  hit 2 status: %{http_code}\n" \
  -H "X-Vercel-IP-Country: MA" \
  "$BASE_URL/tracker/track.php?email=script-test-2@example.com"

curl -s -o /dev/null -w "  hit 3 status: %{http_code}\n" \
  -H "X-Vercel-IP-Country: US" \
  "$BASE_URL/tracker/track.php?email=script-test-1@example.com"

echo ""
echo "== 2. Waiting 2s, then checking dashboard =="
sleep 2

RESPONSE=$(curl -s "$BASE_URL/api/dashboard?key=$KEY")
echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"

echo ""
TOTAL=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('summary',{}).get('totalOpens','?'))" 2>/dev/null || echo "?")

echo "== Result =="
if [ "$TOTAL" != "?" ] && [ "$TOTAL" -ge 3 ] 2>/dev/null; then
  echo "✅ PASS — totalOpens is $TOTAL (persisted correctly). Storage is working."
else
  echo "❌ Data did not persist. If summary shows totalOpens: 0, KV still isn't connected/redeployed."
  echo "   If you got a 401, your DASHBOARD_SECRET is wrong."
fi
