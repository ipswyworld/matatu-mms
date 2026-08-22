import { redirect } from "next/navigation";

// /system's actual content moved to its own app/process — matatu-mms-ops
// (ADMIN_DASHBOARD_AUDIT §4.3 Option B), reached through the same :3002
// nginx network restriction this page used to sit behind directly. This
// route only exists so old bookmarks/links still land somewhere: the
// middleware's SUPERADMIN-only gate on "/system" still applies before this
// redirect ever runs, so it can't be used to discover the ops console's
// existence by an unauthorized role.
const OPS_APP_URL = process.env.OPS_APP_URL || "http://localhost:3002";

export default function SystemRedirectPage() {
  redirect(OPS_APP_URL);
}
