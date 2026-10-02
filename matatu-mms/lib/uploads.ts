const PUBLIC_BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";

/**
 * Turns a stored upload path into something a browser can load.
 *
 * app/storage.py returns three different shapes depending on which backend
 * is configured, and getting this wrong is silent — a broken <img> on an
 * evidence photo looks the same as a case with no photo:
 *
 *   local → "/uploads/enforcement_cases/case-x/abc_scene.jpg"
 *   db    → "/api/uploads/enforcement_cases/case-x/abc_scene.jpg"   (Render uses this)
 *   s3    → "https://cdn.example.com/enforcement_cases/case-x/abc_scene.jpg"
 *
 * The first two are root-relative and need the backend origin prefixed; the
 * third is already absolute and must be left alone. Existing call sites
 * concatenate unconditionally (which breaks under s3) or test for
 * "/uploads/" only (which breaks under db, the backend actually deployed).
 * Checking for an absolute URL instead is correct for all three.
 */
export function uploadUrl(path: string): string {
  if (!path) return "";
  return /^https?:\/\//i.test(path) ? path : `${PUBLIC_BACKEND_URL}${path}`;
}
