#!/usr/bin/env bash
#
# Uploads the Pub's Pizza item photos to Supabase Storage and points
# the matching menu_items rows at them.
#
# The photos were cropped out of the printed menu pages that live in
# ~/Downloads/pub's/ — see supabase/seed-assets/pubs-pizza/. They are
# the only per-item photography any of the three onboarded menus has:
# the OH Donuts PDF is two flattened page rasters with no separate
# product shots, and the Za Burger menu is illustrated, not shot.
#
# Run AFTER migration 075 has seeded the menu, otherwise there are no
# rows to point at and every item reports "0 rows updated".
#
# Usage:
#   ./scripts/upload-pubs-pizza-images.sh
#
# Requires SUPABASE_SERVICE_ROLE_KEY — read from ../.env.local by
# default, or exported in the environment.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSET_DIR="$SCRIPT_DIR/../supabase/seed-assets/pubs-pizza"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/../../.env.local}"

SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-}"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"

if [[ -z "$SERVICE_KEY" || -z "$SUPABASE_URL" ]] && [[ -f "$ENV_FILE" ]]; then
  # Only pull the two keys we need; the file holds dev creds too.
  SUPABASE_URL="${SUPABASE_URL:-$(grep -m1 '^NEXT_PUBLIC_SUPABASE_URL=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')}"
  SERVICE_KEY="${SERVICE_KEY:-$(grep -m1 '^SUPABASE_SERVICE_ROLE_KEY=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')}"
fi

if [[ -z "$SUPABASE_URL" || -z "$SERVICE_KEY" ]]; then
  echo "✗ Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (env or $ENV_FILE)" >&2
  exit 1
fi

REST="$SUPABASE_URL/rest/v1"
STORAGE="$SUPABASE_URL/storage/v1"
BUCKET="restaurant-media"
PUBS_ID="c44f9430-0c38-4717-9f2e-175f58803dcc"

# slug|menu_items.name_ar  — the Arabic names must match migration 075.
# Each pizza photo is reused for its half-&-half counterpart so that
# board gets art too.
MAPPING=$(cat <<'EOF'
z-burger|بيتزا زا برجر|هاف آند هاف زا برجر
super-beef|بيتزا سوبر بيف|
veggie|بيتزا فيجن|
tuna|بيتزا تونه|
shrimp|بيتزا جمبري|هاف آند هاف جمبري
sea-ranch|بيتزا سي رانش|هاف آند هاف سي رانش
cheesy-crunch|بيتزا تشيز كرانش|
premium-cheese|بيتزا بريميم تشيز|
chicken-pesto|بيتزا تشكن بيستو|
oh-pizza|اوه بيتزا|
margarita|بيتزا مارجريتا|
mix-cheese|بيتزا ميكس تشيز|هاف آند هاف ميكس تشيز
chicken-ranch|بيتزا تشكن رانش|هاف آند هاف تشكن رانش
chicken-bbq|بيتزا تشكن باربيكيو|هاف آند هاف تشكن باربيكيو
crispy-chicken|بيتزا كرسبي تشكن|هاف آند هاف تشكن كرسبي
italian-sausage|بيتزا ايطاليان سوسيدج|هاف آند هاف سجق
pepperoni|بيتزا ببروني|هاف آند هاف ببروني
pastrami|بيتزا بسطرمة|هاف آند هاف بسطرمة
EOF
)

# URL-encodes a UTF-8 string so Arabic names survive the PostgREST filter.
urlencode() {
  local s="$1" out="" c
  for (( i=0; i<${#s}; i++ )); do
    c="${s:i:1}"
    case "$c" in
      [a-zA-Z0-9.~_-]) out+="$c" ;;
      *) out+=$(printf '%s' "$c" | xxd -p -c1 | while read -r h; do printf '%%%s' "$h"; done) ;;
    esac
  done
  printf '%s' "$out"
}

point_item_at() {
  local name="$1" url="$2"
  local encoded; encoded=$(urlencode "$name")
  local resp
  resp=$(curl -sS -X PATCH \
    "$REST/menu_items?restaurant_id=eq.$PUBS_ID&name_ar=eq.$encoded" \
    -H "apikey: $SERVICE_KEY" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=representation" \
    -d "{\"image_url\":\"$url\"}")

  if [[ "$resp" == "[]" ]]; then
    echo "    ! no row matched: $name"
  else
    echo "    → $name"
  fi
}

updated=0
# Read line-by-line with IFS='|': the Arabic names contain spaces, so
# iterating the raw string would split mid-name.
while IFS='|' read -r slug pizza_name half_name; do
  [[ -n "$slug" ]] || continue

  file="$ASSET_DIR/$slug.jpg"
  [[ -f "$file" ]] || { echo "  ✗ missing asset $file"; continue; }

  path="menu/$PUBS_ID/$slug.jpg"
  echo "  ↑ $slug.jpg"

  # x-upsert makes a re-run idempotent instead of 409-ing.
  curl -sS -o /dev/null -X POST "$STORAGE/object/$BUCKET/$path" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: image/jpeg" \
    -H "x-upsert: true" \
    --data-binary "@$file"

  public_url="$STORAGE/object/public/$BUCKET/$path"

  point_item_at "$pizza_name" "$public_url"
  [[ -n "$half_name" ]] && point_item_at "$half_name" "$public_url"
  updated=$((updated + 1))
done <<< "$MAPPING"

echo
echo "✓ uploaded $updated images to $BUCKET/menu/$PUBS_ID/"
