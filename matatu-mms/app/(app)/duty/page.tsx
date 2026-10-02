import { redirect } from "next/navigation";

// The duty console moved into /enforcement's "Duty Allocation" tab —
// posting officers is enforcement command work, and having it as its own
// top-level section meant a commander bouncing between two places to do
// one job. Kept as a redirect rather than deleted so existing links and
// bookmarks still land somewhere useful, same as /enforcement/command.
export default function DutyRedirect() {
  redirect("/enforcement");
}
