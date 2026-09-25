export interface OpsSessionData {
  userId: string;
  name: string;
  role: "SUPERADMIN";
  token: string;
  /** Set from auth.py's login response for a never-enrolled admin-tier
   * account — see middleware.ts, which redirects to the staff app's real
   * enrollment flow (this console has no MFA-setup UI of its own) until
   * enrollment completes. */
  mfaSetupRequired?: boolean;
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

export interface RenderDeploy {
  id: string;
  status: string;
  commitId: string | null;
  commitMessage: string | null;
  finishedAt: string | null;
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
  scheduledEnableAt: string | null;
  scheduledDisableAt: string | null;
}

export interface MessagingSpendBreakdown {
  category: string;
  status: string;
  messages: number;
  segments: number;
  costKes: string;
}

export interface MessagingSpendSummary {
  windowDays: number;
  totalMessages: number;
  totalCostKes: string;
  breakdown: MessagingSpendBreakdown[];
}

export interface SaccoOption {
  id: string;
  name: string;
}

export interface ApiClientUsage {
  used: number;
  limit: number;
  windowSeconds: number;
}

export interface ApiClient {
  id: string;
  name: string;
  clientId: string;
  saccoId: string | null;
  effectiveRole: string;
  scopes: string[];
  quotaTier: string;
  environment: "sandbox" | "production";
  ipAllowlist: string[];
  createdAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  active: boolean;
  usage: ApiClientUsage;
}

export interface ApiScope {
  scope: string;
  description: string;
  permissions: string[];
}

export interface ApiClientIssuedSecret {
  id: string;
  name: string;
  clientId: string;
  clientSecret: string;
  saccoId: string | null;
  scopes: string[];
  quotaTier: string;
  environment: string;
  ipAllowlist: string[];
  warning: string;
}

export interface ApiClientUsageDay {
  date: string;
  requests: number;
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

export interface SyntheticCheckPoint {
  ok: boolean;
  latencyMs: number | null;
  checkedAt: string;
}

export interface DataQualityCheck {
  checkName: string;
  issueCount: number | null;
  sampleIds: string[];
  checkedAt: string | null;
}

export interface DataSubjectRequest {
  id: number;
  requestType: "ACCESS" | "CORRECTION" | "DELETION" | "OBJECTION";
  subjectName: string;
  subjectContact: string;
  description: string;
  status: "RECEIVED" | "IN_PROGRESS" | "FULFILLED" | "REJECTED";
  receivedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNotes: string | null;
}

export interface RetentionReviewRow {
  tableName: string;
  eligibleCount: number | null;
  oldestEligibleDate: string | null;
  scannedAt: string | null;
}

export interface BackupRestoreTest {
  id: number;
  testedAt: string;
  success: boolean;
  durationSeconds: number;
  backupTag: string | null;
  rowCounts: Record<string, number> | null;
  error: string | null;
}

export interface ConfigHistoryEntry {
  id: number;
  resourceType: "rate_limit" | "circuit_breaker" | "feature_flag";
  resourceId: string;
  action: string;
  oldValues: Record<string, any> | null;
  newValues: Record<string, any> | null;
  userId: string;
  timestamp: string;
}

export interface CostSnapshot {
  id: number;
  month: string;
  amountKes: string;
  note: string | null;
  recordedBy: string;
  recordedAt: string;
}

export interface CiScanStatus {
  runId: number;
  runUrl: string;
  runCreatedAt: string;
  headSha: string;
  scanJobFound: boolean;
  scanConclusion: string | null;
  scanUrl: string;
}

export interface SyntheticCheckTarget {
  targetName: string;
  url: string;
  latest: { ok: boolean; latencyMs: number | null; error: string | null; checkedAt: string };
  recent: SyntheticCheckPoint[];
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
  /** True when more than one process reported: percentiles cannot be merged
   *  validly, so the figure shown is the worst instance's, not a blend. */
  latencyIsWorstInstance?: boolean;
  instanceCount?: number;
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

/** A browser-side crash (Next.js error.tsx/global-error.tsx boundary),
 *  reported by backend/app/routes/client_errors.py — distinct from
 *  RecentError above, which is only ever a backend 5xx response. */
export interface RecentClientError {
  at: number;
  app: string;
  message: string;
  url: string;
  digest: string | null;
  stack: string | null;
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

export interface MaintenanceState {
  enabled: boolean;
  scope: string;      // "public" | "all"
  message: string;
  scopes: string[];
}

export interface KillSwitchState {
  feature: string;
  description: string;
  killed: boolean;
}

export interface SystemControls {
  maintenance: MaintenanceState;
  killSwitches: KillSwitchState[];
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
  recentClientErrors: RecentClientError[];
  controls: SystemControls;
  worstStatus: DependencyStatus;
}
