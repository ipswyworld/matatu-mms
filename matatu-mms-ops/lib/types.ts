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
export interface RenderIpAllowEntry {
  cidrBlock: string;
  description: string;
}

export interface RenderServiceStatus {
  id: string;
  name: string;
  url: string | null;
  deployStatus: string | null; // Render's own deploy status strings: "live", "build_failed", "update_in_progress", "deactivated", ...
  commitId: string | null;
  commitMessage: string | null;
  deployedAt: string | null;
  // View-only here (see lib/render.ts's comment on why this console
  // doesn't write to it) — "everywhere" (0.0.0.0/0) is worth surfacing
  // plainly since it means this service has no IP restriction at all.
  ipAllowList: RenderIpAllowEntry[];
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
  role: string;
  isActive: boolean;
}

export interface FeatureFlag {
  key: string;
  description: string | null;
  enabled: boolean;
  updatedBy: string | null;
  updatedAt: string;
}

export interface JobSummary {
  jobId: string;
  function: string;
  status: string; // "queued" | "deferred" | "in_progress" | "complete" | "not_found"
  enqueueTime: string;
  jobTry: number | null;
  startTime: string | null;
  finishTime: string | null;
  success: boolean | null;
  resultPreview: string | null;
}

export interface PrivilegedLogin {
  id: number;
  userId: string;
  userName: string;
  ipAddress: string | null;
  createdAt: string;
  isNewIp: boolean;
}

export interface FailedLoginBurst {
  email: string;
  count: number;
  lastAttemptAt: string;
}

export interface LoginOverview {
  recentPrivilegedLogins: PrivilegedLogin[];
  failedLoginBursts: FailedLoginBurst[];
}

// --- Ops control plane (Ops Console Rebuild Spec §6) -----------------------

export type DependencyStatus = "ok" | "degraded" | "down";

export interface DependencyState {
  name: string;
  status: DependencyStatus;
  latencyMs: number | null;
  error: string | null;
}

export interface RequestMetrics {
  windowSeconds: number;
  requestsPerSecond: number;
  totalRequests: number;
  errorCount: number;
  serverErrorCount: number;
  errorRate: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
}

export interface SeriesPoint {
  t: number;
  requests: number;
  errors: number;
}

export interface QueueDepth {
  queued: number;
  inProgress: number;
  completed: number;
  failed: number;
  reachable: boolean;
  error: string | null;
}

export interface CircuitBreakerState {
  name: string;
  description: string;
  state: string;          // CLOSED | OPEN | HALF-OPEN
  override: string;       // auto | open | closed
  failureCount: number;
  failureThreshold: number;
  recoveryTime: number;
  effectivelyBlocking: boolean;
}

export interface RateLimitState {
  scope: string;
  effective: string;
  default: string;
  overridden: boolean;
  description: string;
}

export interface RecentError {
  at: number;
  method: string;
  path: string;
  status: number;
  durationMs: number;
}

export interface WebhookDelivery {
  id: number;
  subscriptionId: number;
  eventType: string;
  statusCode: number | null;
  errorMessage: string | null;
  attempt: number;
  timestamp: string | null;
  succeeded: boolean;
}

/** One tick of the live feed — the shape both `/api/control/overview` and
 *  each SSE `snapshot` event carry, so first paint and live updates use
 *  exactly the same renderer. */
export interface OpsSnapshot {
  at: string;
  dependencies: DependencyState[];
  metrics: RequestMetrics;
  series: SeriesPoint[];
  queue: QueueDepth;
  breakers: CircuitBreakerState[];
  rateLimits: RateLimitState[];
  recentErrors: RecentError[];
  worstStatus: DependencyStatus;
}
