/**
 * Static on-call/escalation directory — plain config, not a database table.
 * No real contact data exists anywhere in this system to source this from,
 * so these are placeholders: edit this file directly to keep it current,
 * the same way an incident runbook would be maintained by hand. Wiring
 * this to a real PagerDuty/Opsgenie schedule is a reasonable future step
 * once one exists, but fabricating names here would be worse than an
 * honest "not yet configured" placeholder.
 */
export interface OnCallContact {
  role: string;
  name: string;
  phone: string;
  notes?: string;
}

export const ON_CALL_DIRECTORY: OnCallContact[] = [
  // { role: "Primary on-call engineer", name: "Jane Doe", phone: "+254 7XX XXX XXX" },
  // { role: "Backend/infra escalation", name: "John Smith", phone: "+254 7XX XXX XXX" },
  // { role: "County IT liaison", name: "—", phone: "—", notes: "For NCCG-side infra/network issues" },
];
