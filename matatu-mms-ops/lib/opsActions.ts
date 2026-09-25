/**
 * Action safety framework (Ops Console Rebuild Spec §4).
 *
 * Every action in this console is declared here as a descriptor and
 * rendered through <ActionButton>, so confirmation, reason capture, and
 * blast-radius disclosure are enforced by the component rather than by
 * remembering to add them at each call site. A new action cannot
 * accidentally ship without its safety properties, because the properties
 * are what the renderer consumes.
 *
 * Pure data and types — no "use server" here, because client components
 * import these to render.
 */

export type ActionClass = "routine" | "elevated" | "critical";

export interface ActionDescriptor {
  /** Stable identifier. Recorded in the audit trail and used by the
   *  command palette, so renaming one is a breaking change. */
  id: string;
  /** Verb + object, e.g. "Cancel job" — never "OK" or "Confirm". */
  label: string;
  actionClass: ActionClass;
  /** Human-readable blast radius: "1 account", "all sessions", "this replica". */
  affectedScope: string;
  reversible: boolean | "partial";
  /** How to undo it, shown in the confirmation when reversible. */
  reversalHint?: string;
  /** Longer explanation of what actually happens. */
  detail?: string;
  /**
   * True when the control itself is the confirmation — a toggle switch
   * shows its new state immediately and flips back with one more click.
   *
   * Wrapping something like that in a modal would be safety theatre, and
   * worse than useless: operators who dismiss a dialog for every trivial
   * toggle learn to dismiss dialogs, which is exactly the habit that makes
   * the confirmation on a genuinely dangerous action stop working. Only
   * instantly-reversible, self-evident controls qualify.
   */
  inlineApply?: boolean;
}

export const ACTION_CLASS_META: Record<
  ActionClass,
  {
    label: string;
    chip: string;
    requiresReason: boolean;
    requiresTypedConfirm: boolean;
    requiresReauth?: boolean;
  }
> = {
  routine: {
    label: "Routine",
    chip: "bg-county-green/10 text-county-green",
    requiresReason: false,
    requiresTypedConfirm: false,
  },
  elevated: {
    label: "Elevated",
    chip: "bg-amber-100 text-amber-800",
    requiresReason: true,
    requiresTypedConfirm: false,
  },
  critical: {
    // Typed confirmation, a reason, AND step-up re-authentication.
    //
    // Two-person approval was the original design. It was dropped because
    // this console is internal and everyone with access is trusted, so
    // requiring a second approver would mostly mean nobody is reachable at
    // 3am — a control that cannot be used during an incident is not a
    // safety measure. Re-auth defends the threat that actually remains: a
    // session left open on an unlocked laptop, or a stolen cookie.
    label: "Critical",
    chip: "bg-county-red/10 text-county-red",
    requiresReason: true,
    requiresTypedConfirm: true,
    requiresReauth: true,
  },
};

/**
 * Every action the console can perform. The command palette enumerates
 * this, and each panel looks its own actions up by id, so there is exactly
 * one place where an action's safety properties are defined.
 */
export const OPS_ACTIONS: Record<string, ActionDescriptor> = {
  // --- Feature flags (existing, migrated onto the framework) --------------
  "flag.create": {
    id: "flag.create",
    label: "Add flag",
    actionClass: "routine",
    affectedScope: "New flag, disabled by default",
    reversible: true,
    reversalHint: "Delete the flag.",
    detail: "Creates a feature flag in the off position. Nothing branches on it until code checks it.",
  },
  "flag.toggle": {
    id: "flag.toggle",
    label: "Toggle flag",
    actionClass: "routine",
    affectedScope: "Every request that checks this flag",
    reversible: true,
    reversalHint: "Toggle it back.",
    // The switch is the confirmation: the new state is visible instantly
    // and one more click undoes it.
    inlineApply: true,
  },
  "flag.delete": {
    id: "flag.delete",
    label: "Delete flag",
    actionClass: "elevated",
    affectedScope: "Every call site checking this flag falls back to its default",
    reversible: "partial",
    reversalHint: "The flag can be recreated, but its history and current value are lost.",
  },

  // --- Jobs ---------------------------------------------------------------
  "job.retry": {
    id: "job.retry",
    label: "Retry job",
    actionClass: "routine",
    affectedScope: "1 job",
    reversible: false,
    detail: "Re-enqueues the same function and arguments as a fresh job. Job types here are documented as idempotent.",
  },
  "job.cancel": {
    id: "job.cancel",
    label: "Cancel job",
    actionClass: "routine",
    affectedScope: "1 job",
    reversible: "partial",
    reversalHint: "A cancelled job can be re-enqueued with Retry, but partial work already done is not rolled back.",
  },
  "job.retryAllFailed": {
    id: "job.retryAllFailed",
    label: "Retry all failed jobs",
    actionClass: "elevated",
    affectedScope: "Every failed job currently in the result store",
    reversible: false,
    detail: "ARQ has no dead-letter queue; failed results stay in its result store. This re-enqueues all of them at once, which can produce a burst of load.",
  },

  // --- Webhooks -----------------------------------------------------------
  "webhook.replay": {
    id: "webhook.replay",
    label: "Replay delivery",
    actionClass: "routine",
    affectedScope: "1 webhook delivery to 1 partner endpoint",
    reversible: false,
    detail: "Re-sends through the normal queued path, so it inherits the same retry and circuit-breaker behaviour as an original delivery.",
  },

  // --- Circuit breakers ---------------------------------------------------
  "breaker.override": {
    id: "breaker.override",
    label: "Override breaker",
    actionClass: "elevated",
    affectedScope: "All calls to this dependency, on this replica",
    reversible: true,
    reversalHint: 'Set the override back to "auto".',
    detail: "Overrides are per-process: they apply to the replica that received the request, because a breaker guards that process's own calls.",
  },

  // --- Rate limits --------------------------------------------------------
  "rateLimit.update": {
    id: "rateLimit.update",
    label: "Change limit",
    actionClass: "elevated",
    affectedScope: "Every client hitting this endpoint",
    reversible: true,
    reversalHint: "Restore the default, or set the previous value back.",
    detail: "Takes effect on this replica immediately and on others within about 10 seconds. Raising a limit weakens the protection it provides.",
  },

  // --- Sessions and accounts ---------------------------------------------
  "session.revoke": {
    id: "session.revoke",
    label: "Revoke sessions",
    actionClass: "elevated",
    affectedScope: "Every active session for 1 account",
    reversible: false,
    detail: "The user is signed out everywhere and must sign in again. Existing tokens stop working immediately.",
  },
  "user.lock": {
    id: "user.lock",
    label: "Lock account",
    actionClass: "elevated",
    affectedScope: "1 account, signed out and unable to sign in",
    reversible: true,
    reversalHint: "Unlock the account.",
    detail: "Deactivates the account and revokes its live sessions together, so an already-issued token cannot outlive the lock.",
  },
  "user.unlock": {
    id: "user.unlock",
    label: "Unlock account",
    actionClass: "elevated",
    affectedScope: "1 account",
    reversible: true,
    reversalHint: "Lock the account again.",
  },
  "user.resetMfa": {
    id: "user.resetMfa",
    label: "Reset MFA",
    actionClass: "elevated",
    affectedScope: "1 account's MFA enrolment and all its sessions",
    reversible: false,
    detail: "Clears the authenticator enrolment so the user can re-enrol, and revokes sessions in case the lost device still holds one.",
  },

  // --- Impersonation ------------------------------------------------------
  // --- Critical tier (Phase 5) -------------------------------------------
  "maintenance.enable": {
    id: "maintenance.enable",
    label: "Enable maintenance mode",
    actionClass: "critical",
    affectedScope: "Every public request, cluster-wide",
    reversible: true,
    reversalHint: "Disable maintenance mode.",
    detail:
      'Scope "public" leaves staff endpoints reachable so the people handling the incident can keep working. Scope "all" is a genuine full stop. The ops control plane is always exempt, so this can always be turned back off.',
  },
  "maintenance.disable": {
    id: "maintenance.disable",
    label: "Disable maintenance mode",
    actionClass: "critical",
    affectedScope: "Restores service cluster-wide",
    reversible: true,
    reversalHint: "Enable maintenance mode again.",
  },
  "killSwitch.toggle": {
    id: "killSwitch.toggle",
    label: "Toggle kill switch",
    actionClass: "critical",
    affectedScope: "One capability, disabled for every user cluster-wide",
    reversible: true,
    reversalHint: "Toggle the switch back.",
    detail:
      "A load-shedding lever, not a feature flag: it turns an expensive capability off during an incident. Users of that feature will see it stop working.",
  },
  "sessions.revokeAll": {
    id: "sessions.revokeAll",
    label: "Revoke all sessions",
    actionClass: "critical",
    affectedScope: "Every account in the system, including your own",
    reversible: false,
    detail:
      "Signs out every user everywhere. Your own session is revoked too — exempting it would leave one live session behind during a compromise response, and would defeat the action entirely if your account is the compromised one. You will need to sign in again.",
  },

  // --- Cost dashboard (Phase 4) --------------------------------------------
  "cost.record": {
    id: "cost.record",
    label: "Record monthly cost",
    actionClass: "elevated",
    affectedScope: "The cost dashboard's trend chart",
    reversible: true,
    reversalHint: "Record the month again with a corrected figure.",
    detail: "A manual entry, not a live billing pull — Render's API has no billing endpoint to read this from automatically.",
  },

  // --- Partner API clients (Phase 2) --------------------------------------
  "apiClient.create": {
    id: "apiClient.create",
    label: "Issue API client",
    actionClass: "critical",
    affectedScope: "New partner credentials, granted the scopes selected",
    reversible: true,
    reversalHint: "Revoke the client.",
    detail:
      "The client secret is shown exactly once, immediately after this — it is never stored in a form that can be shown again. If it's lost, revoke this client and issue a new one.",
  },
  "apiClient.revoke": {
    id: "apiClient.revoke",
    label: "Revoke API client",
    actionClass: "critical",
    affectedScope: "Every request this client makes, immediately",
    reversible: false,
    detail:
      "Cuts off a partner's access at once — existing tokens stop working immediately, not when they expire. Revocation is permanent; issue a new client if access needs to be restored.",
  },

  // --- Render deploy control (Phase 4) ------------------------------------
  "deploy.trigger": {
    id: "deploy.trigger",
    label: "Deploy latest commit",
    actionClass: "critical",
    affectedScope: "1 service — every request it serves while the new build starts",
    reversible: "partial",
    reversalHint: "Roll back to the previous deploy once the new one is live.",
    detail:
      "Deploys the latest commit on this service's configured branch, the same as clicking Manual Deploy in Render's own dashboard. The service is briefly unavailable while the new instance starts.",
  },
  "deploy.rollback": {
    id: "deploy.rollback",
    label: "Roll back deploy",
    actionClass: "critical",
    affectedScope: "1 service — reverts to a specific previous deploy",
    reversible: "partial",
    reversalHint: "Deploy forward again, or roll back to a different prior deploy.",
    detail:
      "Rolls this service back to the deploy you pick from its history. Whatever is live now is replaced immediately, including any data-shape changes the current deploy introduced.",
  },

  "impersonate.start": {
    id: "impersonate.start",
    label: "Impersonate",
    actionClass: "routine",
    affectedScope: "Your own session, viewing the staff app as this user",
    reversible: true,
    reversalHint: "End impersonation from the banner in the staff app.",
    detail: "Start and end are both audited, and a persistent banner marks the session throughout.",
  },
};

export function actionFor(id: string): ActionDescriptor {
  const found = OPS_ACTIONS[id];
  if (!found) {
    // Loud rather than silent: an unregistered action would otherwise
    // render with no safety metadata at all, which is the exact failure
    // this framework exists to prevent.
    throw new Error(`Unregistered ops action: ${id}`);
  }
  return found;
}

export function reversibilityText(d: ActionDescriptor): string {
  if (d.reversible === true) return d.reversalHint ? `Reversible. ${d.reversalHint}` : "Reversible.";
  if (d.reversible === "partial") return d.reversalHint ? `Partly reversible. ${d.reversalHint}` : "Partly reversible.";
  return "Not reversible.";
}
