export type UserRole = 'admin' | 'student_affairs' | 'college_admin' | 'counselor';

export type CandidateType = 'special_difficulty' | 'potential_difficulty';

export type BatchStatus =
  | 'syncing'
  | 'calculating'
  | 'counselor_confirming'
  | 'college_auditing'
  | 'final_auditing'
  | 'completed';

export type ReviewDecision = 'approve' | 'reject' | 'pending' | 'overdue';

export type ReviewStage = 'counselor' | 'college' | 'funding_office' | 'student_affairs';

export type CandidateWorkflowStatus =
  | 'pending_counselor'
  | 'counselor_approved'
  | 'counselor_rejected'
  | 'counselor_overdue'
  | 'pending_college'
  | 'college_approved'
  | 'college_rejected'
  | 'college_overdue'
  | 'pending_funding_office'
  | 'funding_office_approved'
  | 'funding_office_rejected'
  | 'funding_office_overdue'
  | 'pending_final'
  | 'final_approved'
  | 'final_rejected'
  | 'final_overdue'
  | 'included'
  | 'not_included';

export type TagStatus = 'active' | 'inactive';

export type SyncJobStatus = 'success' | 'running' | 'failed';

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  college?: string;
  classes?: string[];
}

export interface Student {
  id: string;
  name: string;
  college: string;
  className: string;
  counselor: string;
  isSpecialDifficulty: boolean;
}

export interface CandidateListItem {
  id: string;
  studentId: string;
  month: string;
  batchId: string;
  name: string;
  college: string;
  className: string;
  counselor: string;
  type: CandidateType;
  typeLabel: string;
  averageSpendLabel: string;
  daysCount: number;
  breakfastDaysCount: number;
  lunchDinnerDaysCount: number;
  workflowStatus: CandidateWorkflowStatus;
  workflowStatusLabel: string;
  tags: string[];
  hitRules: string[];
  rank: number;
  subsidyEstimate: number;
  reviewDeadline: string;
  currentStage: ReviewStage;
}

export interface BatchSummary {
  id: string;
  month: string;
  status: BatchStatus;
  progress: number;
  startTime: string;
  endTime?: string;
  stats: {
    total: number;
    confirmed: number;
    pending: number;
  };
}

export interface StudentMonthlyStats {
  breakfastCount: number;
  breakfastTotal: number;
  breakfastAvg: number;
  lunchDinnerCount: number;
  lunchDinnerTotal: number;
  lunchDinnerAvg: number;
  daysCount: number;
  breakfastDaysCount: number;
  lunchDinnerDaysCount: number;
  breakfastP50: number;
  lunchDinnerP50: number;
  totalAmount: number;
}

export interface TagTimelineItem {
  id: string;
  tag: string;
  source: string;
  status: TagStatus;
  statusLabel: string;
  createdAt: string;
  invalidatedAt?: string;
}

export interface AuditTrailItem {
  id: string;
  stage: ReviewStage | 'system';
  nodeLabel: string;
  operator: string;
  result: string;
  comment: string;
  time: string;
}

export interface TransactionItem {
  id: string;
  time: string;
  slot: 'breakfast' | 'lunch' | 'dinner';
  slotLabel: string;
  location: string;
  amount: number;
}

export interface SubsidyResult {
  breakfast: number;
  lunchDinner: number;
  total: number;
  rank: number;
  included: boolean;
}

export interface StudentDetail {
  id: string;
  studentId: string;
  month: string;
  batchId: string;
  name: string;
  college: string;
  className: string;
  counselor: string;
  type: CandidateType;
  typeLabel: string;
  specialDifficulty: boolean;
  workflowStatus: CandidateWorkflowStatus;
  workflowStatusLabel: string;
  currentStage: ReviewStage;
  monthlyStats: StudentMonthlyStats;
  hitRules: string[];
  tags: string[];
  tagTimeline: TagTimelineItem[];
  auditTrail: AuditTrailItem[];
  transactions: TransactionItem[];
  subsidy: SubsidyResult;
}

export interface ReviewTask {
  id: string;
  studentId: string;
  student: string;
  college: string;
  month: string;
  role: string;
  status: ReviewDecision;
  time: string;
}

export interface SubsidyRecord {
  id: string;
  name: string;
  college: string;
  className: string;
  breakfast: number;
  lunchDinner: number;
  total: number;
  status: 'approved';
}

export interface SyncJobRecord {
  id: string;
  name: string;
  source: string;
  frequency: string;
  lastRun: string;
  status: SyncJobStatus;
  delta: string;
  note: string;
}

export interface TagRecord {
  id: string;
  studentId: string;
  studentName: string;
  month: string;
  tag: string;
  source: string;
  status: '生效中' | '已失效';
  time: string;
}

export interface RolePermissionRecord {
  role: string;
  dataScope: string;
  members: number;
  permissions: string[];
}

export interface CollegeAdminAssignment {
  college: string;
  userId: string;
  account: string;
  employeeNo: string;
  name: string;
  status: string;
}

export interface CollegeAdminListResponse {
  colleges: string[];
  assignments: CollegeAdminAssignment[];
}

export interface CollegeAdminUpsertRequest {
  employeeNo: string;
  name: string;
  account?: string;
}

export type AuditReviewerStage = 'college' | 'funding_office' | 'student_affairs';

export interface AuditReviewerAssignment {
  id: string;
  stage: AuditReviewerStage;
  college?: string | null;
  userId: string;
  account: string;
  employeeNo: string;
  name: string;
  status: string;
}

export interface AuditReviewerSettingsResponse {
  colleges: string[];
  collegeReviewers: AuditReviewerAssignment[];
  fundingOfficeReviewers: AuditReviewerAssignment[];
  finalReviewers: AuditReviewerAssignment[];
}

export interface AuditReviewerUpsertRequest {
  stage: AuditReviewerStage;
  employeeNo: string;
  name?: string;
  college?: string;
}

export interface StaffLookupItem {
  employeeNo: string;
  name: string;
}

export interface SystemRoleMember {
  userId: string;
  account: string;
  employeeNo: string;
  name: string;
  role: UserRole;
  college?: string | null;
  status: string;
}

export interface SystemRoleGroup {
  role: UserRole;
  roleLabel: string;
  members: SystemRoleMember[];
}

export interface SystemRoleListResponse {
  items: SystemRoleGroup[];
}

export interface SystemRoleUpsertRequest {
  role: UserRole;
  employeeNo: string;
  name: string;
  account?: string;
  college?: string;
}

export interface CounselorLookupItem {
  employeeNo: string;
  name: string;
}

export interface DashboardStatItem {
  name: string;
  value: string;
  change: string;
  icon: 'users' | 'trend' | 'alert';
  color: string;
  bg: string;
}

export interface TrendItem {
  name: string;
  students: number;
  amount: number;
}

export interface ActivityItem {
  user: string;
  action: string;
  time: string;
  type: 'confirm' | 'audit' | 'system' | 'final';
}

export interface SystemConfig {
  breakfastSlot: { start: string; end: string };
  lunchSlot: { start: string; end: string };
  dinnerSlot: { start: string; end: string };
  subsidyLimit: number;
  finalRatio: number;
  standardPercentile: number;
  basePercentile: number;
}

export interface LoginRoleOption {
  id: UserRole;
  label: string;
  description: string;
}

export interface AuthUser {
  id: string;
  account: string;
  employeeNo: string;
  name: string;
  role: UserRole;
  college?: string | null;
}

export interface AuthLoginRequest {
  account: string;
  password: string;
  role: UserRole;
}

export interface AuthLoginResponse {
  message: string;
  data: {
    user: AuthUser;
  };
}

export interface AuthMeResponse {
  data: {
    user: AuthUser;
  };
}

export interface AuthLogoutResponse {
  message: string;
}

export interface CandidateListResponse {
  month: string;
  batch: BatchSummary;
  items: CandidateListItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface StudentDetailResponse {
  data: StudentDetail;
}

export interface ReviewActionRequest {
  stage: ReviewStage;
  decision: 'approve' | 'reject';
  comment: string;
  month?: string;
}

export interface ReviewActionResponse {
  message: string;
  data: StudentDetail;
}

export interface DashboardResponse {
  stats: DashboardStatItem[];
  trends: TrendItem[];
  activities: ActivityItem[];
}

export interface CandidateSearchItem {
  studentId: string;
  name: string;
  college: string;
  className: string;
  month: string;
}

export interface CandidateSearchResponse {
  items: CandidateSearchItem[];
}

export interface BatchCreateRequest {
  month: string;
  /**
   * 临时开关：允许创建任意月份批次（绕过“只能创建上个月”的限制）。
   * 建议仅在管理员临时补发历史月份时使用。
   */
  force?: boolean;
}

export interface BatchCreateResponse {
  message: string;
  data: BatchSummary;
}

export interface SystemConfigUpdateRequest {
  breakfastSlot: { start: string; end: string };
  lunchSlot: { start: string; end: string };
  dinnerSlot: { start: string; end: string };
  subsidyLimit: number;
  finalRatio: number;
  standardPercentile: number;
  basePercentile: number;
}

export interface SystemConfigUpdateResponse {
  message: string;
  data: SystemConfig;
}

export interface TagInvalidateResponse {
  message: string;
}

export interface DictionaryItemRecord {
  code: string;
  label: string;
  isSpecialDifficulty: boolean;
  sortOrder: number;
  enabled: boolean;
  description: string;
}

export interface DictionaryTypeRecord {
  dictType: string;
  label: string;
  description: string;
  sortOrder: number;
  enabled: boolean;
}

export interface DictionaryTypeListResponse {
  items: DictionaryTypeRecord[];
}

export interface DictionaryTypeUpsertRequest {
  dictType: string;
  label: string;
  description?: string;
  sortOrder?: number;
  enabled?: boolean;
}

export interface DictionaryTypeUpsertResponse {
  message: string;
  data: DictionaryTypeRecord;
}

export interface DictionaryTypeDeleteResponse {
  message: string;
}

export interface DictionaryListResponse {
  dictType: string;
  items: DictionaryItemRecord[];
}

export interface UserRoleRecord {
  userId: string;
  account: string;
  employeeNo: string;
  name: string;
  role: UserRole;
  college?: string | null;
  status: string;
}

export interface UserRoleListResponse {
  items: UserRoleRecord[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface UserRoleUpdateRequest {
  role: UserRole;
  college?: string;
}

export interface UserRoleCreateRequest {
  employeeNo: string;
  name?: string;
  role: UserRole;
  college?: string;
}

export interface DictionarySaveRequest {
  items: DictionaryItemRecord[];
}

export interface DictionarySaveResponse {
  message: string;
  data: DictionaryListResponse;
}

export interface ExternalStudentRecord {
  studentId: string;
  classCode?: string;
  personTypeCode?: string;
  isReadingCode?: string;
  isRegisteredCode?: string;
  genderCode?: string;
  departmentName?: string;
  name?: string;
  college?: string;
  className?: string;
  specialDifficulty?: boolean;
  status?: string;
}

export interface ExternalStaffRecord {
  employeeNo: string;
  name?: string;
  genderCode?: string;
  unitName?: string;
  staffCategoryCode?: string;
  currentStatusCode?: string;
}

export interface ExternalDifficultyRecognitionRecord {
  studentId: string;
  startAcademicYear: string;
  endAcademicYear: string;
  semester: string;
  difficultyLevel?: string;
}

export interface ExternalCounselorRelationRecord {
  studentId: string;
  counselorName: string;
  counselorEmployeeNo?: string;
  counselorAccount?: string;
  college?: string;
  relationType?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
}

export interface ExternalOrgUnitRecord {
  unitCode?: string;
  unitName?: string;
  parentUnitCode?: string;
  parentUnitName?: string;
  levelCode?: string;
  levelName?: string;
  status?: string;
  raw?: Record<string, unknown>;
}

export interface ExternalOrgPostRecord {
  postCode?: string;
  postName?: string;
  unitCode?: string;
  unitName?: string;
  status?: string;
  raw?: Record<string, unknown>;
}

export interface ExternalOrgPersonRelationRecord {
  employeeNo?: string;
  personName?: string;
  account?: string;
  unitCode?: string;
  unitName?: string;
  postCode?: string;
  postName?: string;
  status?: string;
  raw?: Record<string, unknown>;
}

export interface ExternalCardTransactionRecord {
  externalTxnId?: string;
  studentId: string;
  occurredAt: string;
  amount: number;
  location?: string;
  merchant?: string;
  txnType?: string;
  mealSlot?: string;
  batchMonth?: string;
}

export interface ExternalCafeteriaTransactionRecord {
  externalTxnId: string;
  studentNo: string;
  occurredAt: string;
  amount: number;
  cbid: string;
  mealSlot: 'breakfast' | 'lunch' | 'dinner' | 'lunch_dinner';
  location?: string;
}

export interface SyncRunRequest {
  source?: string;
  incrementalCzsj?: string;
  syncMonth?: string;
  syncMonths?: string[];
  students?: ExternalStudentRecord[];
  staffs?: ExternalStaffRecord[];
  difficultyRecognitions?: ExternalDifficultyRecognitionRecord[];
  counselorRelations?: ExternalCounselorRelationRecord[];
  transactions?: ExternalCardTransactionRecord[];
  cafeteriaTransactions?: ExternalCafeteriaTransactionRecord[];
  orgUnits?: ExternalOrgUnitRecord[];
  orgPosts?: ExternalOrgPostRecord[];
  orgPersonRelations?: ExternalOrgPersonRelationRecord[];
}

export interface SyncRunResponse {
  message: string;
  data: {
    jobId: string;
    status: SyncJobStatus;
    source: string;
    imported: {
      students: number;
      staffs: number;
      difficultyRecognitions: number;
      counselorRelations: number;
      transactions: number;
    };
    skipped: {
      difficultyRecognitions: number;
      counselorRelations: number;
      transactions: number;
    };
    startedAt: string;
    finishedAt: string;
  };
}

export interface SyncTerminateResponse {
  message: string;
  data: {
    jobId: string;
    status: SyncJobStatus;
  };
}

export interface SyncTerminateAllResponse {
  message: string;
  data: {
    terminated: number;
    jobIds: string[];
  };
}
