export interface OpsSessionData {
  userId: string;
  name: string;
  role: "SUPERADMIN";
  token: string;
}

export interface AbacPolicy {
  id: string;
  description: string;
  appliesToRoles: string[];
}

export interface SystemHealth {
  uptimeSeconds: number;
  database: {
    reachable: boolean;
    error: string | null;
    engine: string;
    pool: Record<string, string | number>;
  };
  redis: {
    reachable: boolean;
    error: string | null;
  };
  config: {
    secretKeyConfigured: boolean;
    nairobiPayCallbackSecretConfigured: boolean;
    sentryConfigured: boolean;
  };
  abacPolicies: AbacPolicy[];
}

// One row of the Service Health Matrix (OPS_CONSOLE_AND_USER_ACTIVITY_SPEC.md
// A.3's "service/software catalog") — deliberately derived live from the
// Render API rather than a hand-maintained list, so it can't drift.
export interface RenderServiceStatus {
  id: string;
  name: string;
  url: string | null;
  deployStatus: string | null; // Render's own deploy status strings: "live", "build_failed", "update_in_progress", "deactivated", ...
  commitId: string | null;
  commitMessage: string | null;
  deployedAt: string | null;
}

export interface AuditLog {
  id: number;
  resourceType: string;
  resourceId: string;
  action: string;
  oldValues?: string | null;
  newValues?: string | null;
  userId: string;
  timestamp: string;
}

export interface StaffUser {
  id: string;
  name: string;
}
