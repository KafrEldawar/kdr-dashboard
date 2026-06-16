/**
 * Extract { lat, lng } from a pasted Google Maps link (or raw "lat,lng").
 *
 * Handles the common Google Maps URL shapes:
 *  - Place pin coords:    .../@31.0,30.0,17z/data=...!3d31.143!4d30.123   → prefers !3d/!4d (the actual place)
 *  - Query params:        ?q=31.1,30.1 | &query=.. | &ll=.. | &destination=.. | &center=..
 *  - Camera center:       /@31.1,30.1,15z
 *  - Raw coordinates:     "31.143, 30.123"
 *
 * Shortened links (maps.app.goo.gl / goo.gl/maps) can't be resolved in the
 * browser (the redirect target isn't readable due to CORS) — returns null so
 * the caller can ask the user to paste the full/expanded link.
 */
export function parseGoogleMapsUrl(input: string): { lat: number; lng: number } | null {
  if (!input) return null;
  const url = input.trim();

  // 1) Actual place coordinates (highest priority)
  const place = url.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (place) return clamp(parseFloat(place[1]), parseFloat(place[2]));

  // 2) Explicit query params: q / query / ll / sll / destination / center = "lat,lng"
  //    (comma may be URL-encoded as %2C)
  const param = url.match(
    /[?&](?:q|query|ll|sll|destination|center)=(-?\d+(?:\.\d+)?)(?:%2C|,)\s*(-?\d+(?:\.\d+)?)/i,
  );
  if (param) return clamp(parseFloat(param[1]), parseFloat(param[2]));

  // 3) Camera center: @lat,lng
  const at = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (at) return clamp(parseFloat(at[1]), parseFloat(at[2]));

  // 4) Raw "lat, lng"
  const bare = url.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
  if (bare) return clamp(parseFloat(bare[1]), parseFloat(bare[2]));

  return null;
}

function clamp(lat: number, lng: number): { lat: number; lng: number } | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** Whether a pasted string is a Google Maps short link we can't parse client-side. */
export function isShortGoogleMapsLink(input: string): boolean {
  return /(?:maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(input.trim());
}
