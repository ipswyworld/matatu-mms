// Single source of truth for "where does this role land by default" in the
// public app. No next/headers import here deliberately — middleware.ts
// runs in the Edge runtime and can't pull in server-only code, so this
// stays a plain function importable from both middleware and page code.
export function homeForRole(role: string): string {
  if (role === "PASSENGER") return "/passenger-portal";
  if (role === "CREW") return "/crew-portal";
  return "/sacco-portal";
}
