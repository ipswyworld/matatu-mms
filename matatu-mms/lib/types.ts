export type Role =
  | "SUPERADMIN"
  | "ADMIN"
  | "ENFORCEMENT"
  | "SACCO_OPERATOR"
  | "VIEWER"
  | "PASSENGER"
  | "CREW"
  | "DIRECTOR_MOBILITY"
  | "CHIEF_OFFICER"
  | "ARRESTING_OFFICER"
  | "RELEASING_OFFICER"
  | "ENFORCEMENT_COMMANDER";

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  password: string; // DEMO ONLY
  role: Role;
  saccoId?: string;
  termsAccepted?: boolean;
  termsAcceptedAt?: string;
  termsSignature?: string;
  enforcementDuty?: "ARRESTING" | "RELEASING" | null;
  assignedZoneId?: string | null;
  commanderTitle?: string | null;
  isActive?: boolean;
}

export interface Zone {
  id: string;
  name: string;
  description?: string;
}

export interface Beat {
  id: string;
  name: string;
  routeId: string;
  fromStageId: string;
  toStageId: string;
  zoneId?: string | null;
  createdAt: string;
  // Denormalized from the linked stages — null when a stage isn't geocoded
  // yet, in which case the beat just isn't drawn as a line on the map.
  fromLat?: number | null;
  fromLng?: number | null;
  toLat?: number | null;
  toLng?: number | null;
}

export interface OffenceType {
  id: string;
  name: string;
  defaultFineKes: number;
  isOther: boolean;
}

export type EnforcementCaseStatus =
  | "ARRESTED"
  | "PAID"
  | "RELEASED"
  | "DISPUTED"
  | "UNDER_REVIEW"
  | "RESOLVED_UPHELD"
  | "RESOLVED_OVERTURNED"
  | "RESOLVED_PARTIAL"
  | "WAIVED";
export type CaseResolution = "UPHELD" | "OVERTURNED" | "PARTIAL";
export type EnforcementAction = "IMPOUND" | "SELF_DRIVE_IMPOUND" | "TOLL";

export interface CaseReviewNote {
  authorId: string;
  authorName: string;
  note: string;
  at: string;
}

export interface EnforcementCase {
  id: string;
  caseReference: string;
  regNumber: string;
  offenceTypeId: string;
  offenceName?: string;
  offenceDescription?: string;
  fineAmountKes: number;
  actionTaken: EnforcementAction;
  photoPaths: string[];
  zoneId?: string;
  zoneName?: string;
  arrestingOfficerId: string;
  arrestingOfficerName?: string;
  createdAt: string;
  status: EnforcementCaseStatus;
  paymentReference?: string;
  paidAt?: string;
  releasingOfficerId?: string;
  releasingOfficerName?: string;
  releasedAt?: string;
  disputeReason?: string;
  disputedAt?: string;
  reviewerId?: string;
  reviewerName?: string;
  reviewNotes: CaseReviewNote[];
  resolution?: CaseResolution;
  resolutionReason?: string;
  resolvedById?: string;
  resolvedByName?: string;
  resolvedAt?: string;
  waivedReason?: string;
  waivedAuthorizedBy?: string;
}

export interface OfficerAssignment {
  id: string;
  name: string;
  email: string;
  role: Role;
  enforcementDuty?: "ARRESTING" | "RELEASING" | null;
  assignedZoneId?: string | null;
  commanderTitle?: string | null;
}

export type SaccoStatus = "UNREGISTERED" | "INVITED" | "PENDING_VERIFICATION" | "ACTIVE" | "REJECTED" | "SUSPENDED";
export type SaccoLicenseStatus = "ACTIVE" | "RENEWAL_DUE" | "RENEWAL_SUBMITTED" | "EXPIRED";

export interface SaccoOfficialContact {
  chairpersonName: string;
  chairpersonPhone: string;
  secretaryName: string;
  secretaryPhone: string;
  treasurerName: string;
  treasurerPhone: string;
}

export interface SaccoDocuments {
  registrationCertificate: string;
  roadServiceLicense: string;
  countyPermit: string;
  singleBusinessPermit: string;
  bonafideOfficialsContacts: SaccoOfficialContact;
}

// Must match backend/app/routes/saccos.py's DOC_FIELD_MAP keys exactly.
export type SaccoDocType =
  | "registrationCert"
  | "roadServiceLicense"
  | "countyPermit"
  | "singleBusinessPermit"
  | "taxComplianceCert"
  | "fareChart"
  | "letterNoObjection";

export type SaccoType = "NEW" | "EXISTING";
export type VerificationStageStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface Sacco {
  id: string;
  name: string;
  status: SaccoStatus;
  licenseStatus: SaccoLicenseStatus;
  primaryRouteId: string;
  secondaryRouteIds: string[];
  documents?: SaccoDocuments;
  rejectionReason?: string;
  saccoType?: SaccoType;
  createdAt?: string;
  applicationSubmittedAt?: string;
  docRegistrationCert?: string;
  docRoadServiceLicense?: string;
  docCountyPermit?: string;
  docSingleBusinessPermit?: string;
  docOfficialsContacts?: string; // JSON string
  docTaxComplianceCert?: string;
  docFareChart?: string;
  docLetterNoObjection?: string;
  directorMobilityStatus?: VerificationStageStatus;
  directorMobilityReason?: string;
  directorMobilityDecidedBy?: string;
  directorMobilityDecidedAt?: string;
  chiefOfficerStatus?: VerificationStageStatus;
  chiefOfficerReason?: string;
  chiefOfficerDecidedBy?: string;
  chiefOfficerDecidedAt?: string;
  shadowContactName?: string;
  shadowContactPhone?: string;
  shadowSource?: string;
  complianceDeadline?: string;
  invitedAt?: string;
}

export interface ComplianceFunnelEntry {
  id: string;
  name: string;
  status: SaccoStatus;
  contactPhone?: string;
  complianceDeadline?: string;
  daysRemaining?: number;
  invitedAt?: string;
}

export interface ComplianceFunnel {
  unregistered: number;
  invited: number;
  pendingVerification: number;
  active: number;
  rejectedOrSuspended: number;
  entries: ComplianceFunnelEntry[];
}

export type MatatuStatus = "REGISTRATION_PENDING" | "ACTIVE" | "FLAGGED" | "IMPOUNDED" | "DECOMMISSIONED";

export interface Matatu {
  id: string;
  regNumber: string;
  saccoId: string;
  routeId: string;
  terminalSegment: string; // e.g. "CBD-Umoja Terminal: Tusker Stage"
  capacity: number;
  status: MatatuStatus;
  createdAt: string;
  driverName?: string;
  driverLicense?: string;
  driverPhone?: string;
  conductorName?: string;
  conductorLicense?: string;
  conductorPhone?: string;
  sacco?: Sacco;
  route?: Route;
  activities?: ActivityLog[];
  fines?: Fine[];
}

export interface Route {
  id: string;
  code: string;
  name: string;
  description: string;
  fareKes: number;
  vehicleCount?: number;
}

export type CrewRole = "DRIVER" | "CONDUCTOR";

// Real login-linked crew, distinct from Matatu.driverName/conductorName
// (plain free text). See ARCHITECTURE_DECISIONS.md §29.1.
export interface CrewAssignment {
  id: string;
  userId: string;
  matatuId: string;
  crewRole: CrewRole;
  assignedAt: string;
  unassignedAt: string | null;
  userName: string;
  userEmail: string;
  matatuRegNumber: string;
}

export type ActivityType = "TRIP" | "INSPECTION" | "INCIDENT";

export interface ActivityLog {
  id: string;
  matatuId: string;
  type: ActivityType;
  description: string;
  location: string;
  officerId: string;
  timestamp: string; // ISO date
}

export type FineStatus = "PENDING" | "PAID" | "DISPUTED" | "WAIVED";

export interface Fine {
  id: string;
  matatuId: string;
  officerId: string;
  reason: string;
  amountKes: number;
  status: FineStatus;
  issuedAt: string;
  dueDate: string;
  regNumber?: string;
  saccoId?: string;
}

export interface CrimeRecord {
  id: string;
  offenceCommitted: string;
  regNumber: string;
  driverName: string;
  driverLicense: string;
  location: string;
  fineAmountKes: number;
  remarks: string;
  officerId: string;
  officerName?: string;
  timestamp: string;
  status: "PENDING" | "PROCESSED" | "PAID" | "DISPUTED";
  photoPath?: string;
}

export interface SessionData {
  userId: string;
  name: string;
  role: Role;
  saccoId?: string;
  token?: string;
  // True when this account's role requires MFA (ADMIN/SUPERADMIN) but
  // hasn't enrolled yet — middleware force-redirects every page except
  // /mfa/setup until this flips to false (see backend's "enforce, don't
  // just offer" design, SESSION_SECURITY_STATUS.md).
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

export interface AuditLog {
  id: number;
  resourceType: string;
  resourceId: string;
  action: string;
  oldValues?: string;
  newValues?: string;
  userId: string;
  timestamp: string;
}

export interface Seat {
  id: number;
  label: string;
  isOccupied: boolean;
  isReserved?: boolean;
  fareKes: number;
}

export interface Stage {
  id: string;
  name: string;
  code: string;
  zone: string;
  lat: number;
  lng: number;
}

export type ReportStatus = "PENDING" | "REVIEWED" | "ESCALATED" | "DISMISSED";

export interface PassengerReport {
  id: string;
  matatuRegNumber?: string;
  category: string;
  message: string;
  reporterName?: string;
  reporterPhone?: string;
  photoPath?: string;
  status: ReportStatus;
  createdAt: string;
}

export interface Booking {
  id: string;
  passengerName: string;
  phone: string;
  matatuId: string;
  routeId: string;
  regNumber?: string;
  routeName?: string;
  stageName: string;
  seatNumbers: number[];
  fareKes: number;
  bookedAt: string;
  status: "CONFIRMED" | "USED" | "CANCELLED";
}

export interface TimeseriesPoint {
  bucket: string;
  count: number;
  value: number;
}

export interface TimeseriesResponse {
  metric: string;
  grouping: string;
  points: TimeseriesPoint[];
}
