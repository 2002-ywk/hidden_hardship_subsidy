import type {
  BatchCreateRequest,
  BatchCreateResponse,
  CandidateListResponse,
  CandidateSearchResponse,
  CandidateReminderResponse,
  DashboardResponse,
  DashboardSummaryResponse,
  DashboardAnalyticsResponse,
  LoginRoleOption,
  ReviewTask,
  ReviewActionRequest,
  ReviewActionResponse,
  RolePermissionRecord,
  CollegeAdminListResponse,
  CollegeAdminUpsertRequest,
  AuditReviewerSettingsResponse,
  AuditReviewerUpsertRequest,
  StaffLookupItem,
  CounselorLookupItem,
  StudentDetailResponse,
  SubsidyRecord,
  SyncJobRecord,
  SyncRunRequest,
  SyncRunResponse,
  SyncTerminateResponse,
  SyncTerminateAllResponse,
  SystemConfig,
  SystemConfigUpdateRequest,
  SystemConfigUpdateResponse,
  SystemRoleListResponse,
  SystemRoleUpsertRequest,
  UserRoleListResponse,
  UserRoleUpdateRequest,
  UserRoleCreateRequest,
  TagInvalidateResponse,
  TagRecord,
  BatchSummary,
  DictionaryListResponse,
  DictionaryTypeListResponse,
  DictionaryTypeUpsertRequest,
  DictionaryTypeUpsertResponse,
  DictionaryTypeDeleteResponse,
  DictionarySaveRequest,
  DictionarySaveResponse,
  AuthLoginRequest,
  AuthLoginResponse,
  AuthMeResponse,
  AuthLogoutResponse,
  MessageSendRequest,
} from '@/src/types';

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    // Always send cookies so session-based auth works even when frontend/backend are on different origins in dev.
    credentials: 'include',
    ...init,
  });

  if (!response.ok) {
    let message = `请求失败（HTTP ${response.status}）`;
    try {
      const payload = (await response.json()) as { message?: string };
      if (payload?.message) {
        message = payload.message;
      }
    } catch {
      // Keep default message when response body is not JSON.
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

type CandidateListFilters = {
  college?: string;
  counselorEmployeeNo?: string;
  counselorName?: string;
  candidateType?: 'special_difficulty';
  sortBy?: 'college';
  sortDirection?: 'asc' | 'desc';
};

export function fetchCandidateList(month = '2026-04', page = 1, pageSize = 100, filters: CandidateListFilters = {}) {
  const params = new URLSearchParams();
  params.set('month', month);
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  if (filters.college?.trim()) params.set('college', filters.college.trim());
  if (filters.counselorEmployeeNo?.trim()) params.set('counselorEmployeeNo', filters.counselorEmployeeNo.trim());
  if (filters.counselorName?.trim()) params.set('counselorName', filters.counselorName.trim());
  if (filters.candidateType) params.set('candidateType', filters.candidateType);
  if (filters.sortBy) params.set('sortBy', filters.sortBy);
  if (filters.sortDirection) params.set('sortDirection', filters.sortDirection);
  return requestJson<CandidateListResponse>(`/api/candidates?${params.toString()}`);
}

export function searchCandidates(keyword: string) {
  return requestJson<CandidateSearchResponse>(`/api/candidates/search?keyword=${encodeURIComponent(keyword)}`);
}

export function fetchCandidateColleges(month: string) {
  return requestJson<{ items: string[] }>(`/api/candidates/colleges?month=${encodeURIComponent(month)}`);
}

export function fetchStudentDetail(studentId: string, month: string) {
  return requestJson<StudentDetailResponse>(`/api/candidates/${studentId}?month=${encodeURIComponent(month)}`);
}

export function submitReview(studentId: string, payload: ReviewActionRequest) {
  return requestJson<ReviewActionResponse>(`/api/candidates/${studentId}/review`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function remindCandidate(studentId: string, month: string) {
  return requestJson<CandidateReminderResponse>(`/api/candidates/${encodeURIComponent(studentId)}/remind`, {
    method: 'POST',
    body: JSON.stringify({ month }),
  });
}

export function remindAllCandidates(month: string) {
  return requestJson<CandidateReminderResponse>('/api/candidates/remind-all', {
    method: 'POST',
    body: JSON.stringify({ month }),
  });
}

export function fetchDashboardData() {
  return requestJson<DashboardResponse>('/api/dashboard');
}

export function fetchDashboardSummary() {
  return requestJson<DashboardSummaryResponse>('/api/dashboard/summary');
}

export function fetchDashboardAnalytics() {
  return requestJson<DashboardAnalyticsResponse>('/api/dashboard/analytics');
}

export function fetchBatches() {
  return requestJson<BatchSummary[]>('/api/batches');
}

export function fetchAuditTasks() {
  return requestJson<ReviewTask[]>('/api/audit-tasks');
}

export function fetchSubsidyRecords(month?: string) {
  const query = month ? `?month=${encodeURIComponent(month)}` : '';
  return requestJson<SubsidyRecord[]>(`/api/subsidies${query}`);
}

export function fetchSyncJobs() {
  return requestJson<SyncJobRecord[]>('/api/sync/jobs');
}

export function runDataSync(payload: SyncRunRequest = {}) {
  return requestJson<SyncRunResponse>('/api/sync/run', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function terminateSyncJob(jobId: string) {
  return requestJson<SyncTerminateResponse>(`/api/sync/jobs/${jobId}/terminate`, {
    method: 'POST',
  });
}

export function terminateAllSyncJobs() {
  return requestJson<SyncTerminateAllResponse>('/api/sync/jobs/terminate-all', {
    method: 'POST',
  });
}

export function fetchTagRecords() {
  return requestJson<TagRecord[]>('/api/tags');
}

export function fetchRolePermissions() {
  return requestJson<RolePermissionRecord[]>('/api/roles');
}

export function fetchCollegeAdminAssignments() {
  return requestJson<CollegeAdminListResponse>('/api/roles/college-admins');
}

export function upsertCollegeAdminAssignment(college: string, payload: CollegeAdminUpsertRequest) {
  return requestJson<{ message: string }>(`/api/roles/college-admins/${encodeURIComponent(college)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function removeCollegeAdminAssignment(userId: string) {
  return requestJson<{ message: string }>(`/api/roles/college-admins/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
}

export function fetchAuditReviewers() {
  return requestJson<AuditReviewerSettingsResponse>('/api/audit-reviewers');
}

export function upsertAuditReviewer(payload: AuditReviewerUpsertRequest) {
  return requestJson<{ message: string }>('/api/audit-reviewers', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function deleteAuditReviewer(id: string) {
  return requestJson<{ message: string }>(`/api/audit-reviewers/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function fetchSystemRoles() {
  return requestJson<SystemRoleListResponse>('/api/system-roles');
}

export function upsertSystemRole(payload: SystemRoleUpsertRequest) {
  return requestJson<{ message: string }>('/api/system-roles', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function deleteSystemRoleMember(userId: string) {
  return requestJson<{ message: string }>(`/api/system-roles/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
}

export function fetchUserRoles(page = 1, pageSize = 20, filters?: { role?: string; unitOrCollege?: string; keyword?: string }) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  if (filters?.role?.trim()) params.set('role', filters.role.trim());
  if (filters?.unitOrCollege?.trim()) params.set('unitOrCollege', filters.unitOrCollege.trim());
  if (filters?.keyword?.trim()) params.set('keyword', filters.keyword.trim());
  return requestJson<UserRoleListResponse>(`/api/users/roles?${params.toString()}`);
}

export function updateUserRole(userId: string, payload: UserRoleUpdateRequest) {
  return requestJson<{ message: string }>(`/api/users/${encodeURIComponent(userId)}/role`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function createUserRole(payload: UserRoleCreateRequest) {
  return requestJson<{ message: string }>('/api/users/roles', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function deleteUserRole(userId: string) {
  return requestJson<{ message: string }>(`/api/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
}

export function lookupStaffByEmployeeNo(keyword: string) {
  return requestJson<StaffLookupItem[]>(`/api/staff/lookup?keyword=${encodeURIComponent(keyword)}`);
}

export function lookupCounselors(keyword: string) {
  return requestJson<{ items: CounselorLookupItem[] }>(`/api/counselors/lookup?keyword=${encodeURIComponent(keyword)}`);
}

export function fetchSystemConfig() {
  return requestJson<SystemConfig>('/api/system-config');
}

export function fetchLoginRoles() {
  return requestJson<LoginRoleOption[]>('/api/login-roles');
}

export function login(payload: AuthLoginRequest) {
  return requestJson<AuthLoginResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchMe() {
  return requestJson<AuthMeResponse>('/api/auth/me');
}

export function logout() {
  return requestJson<AuthLogoutResponse>('/api/auth/logout', {
    method: 'POST',
  });
}

export function createBatch(payload: BatchCreateRequest) {
  return requestJson<BatchCreateResponse>('/api/batches', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateSystemConfig(payload: SystemConfigUpdateRequest) {
  return requestJson<SystemConfigUpdateResponse>('/api/system-config', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function invalidateTag(tagId: string) {
  return requestJson<TagInvalidateResponse>(`/api/tags/${tagId}/invalidate`, {
    method: 'POST',
  });
}

export function fetchDictionaryItems(dictType = 'difficulty_level') {
  return requestJson<DictionaryListResponse>(`/api/dictionaries/${dictType}`);
}

export function saveDictionaryItems(dictType: string, payload: DictionarySaveRequest) {
  return requestJson<DictionarySaveResponse>(`/api/dictionaries/${dictType}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function fetchDictionaryTypes() {
  return requestJson<DictionaryTypeListResponse>('/api/dictionaries');
}

export function upsertDictionaryType(payload: DictionaryTypeUpsertRequest) {
  return requestJson<DictionaryTypeUpsertResponse>('/api/dictionaries', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function deleteDictionaryType(dictType: string) {
  return requestJson<DictionaryTypeDeleteResponse>(`/api/dictionaries/${encodeURIComponent(dictType)}`, {
    method: 'DELETE',
  });
}

export function sendMessage(payload: MessageSendRequest) {
  return requestJson<{ message: string; data: unknown }>('/api/messages/send', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

