import crypto from 'crypto';
import { prisma } from '@/src/server/db/client';
import { dataPlatformClient } from '@/src/server/repositories/dataPlatformClient';
import {
  formatDateTimeInTimeZone,
  getDateTimePartsInTimeZone,
  hourInTimeZone,
  monthKeyInTimeZone,
  parseDateTimeAssumeFixedOffset,
} from '@/src/server/time';
import type {
  ExternalCafeteriaTransactionRecord,
  ExternalCounselorRelationRecord,
  ExternalOrgPersonRelationRecord,
  ExternalOrgPostRecord,
  ExternalOrgUnitRecord,
  SyncRunRequest,
  SyncRunResponse,
} from '@/src/types';

function parseDateTime(value?: string) {
  // Treat datetimes without timezone as China Standard Time (+08:00), so behavior is stable
  // even when the server runs in UTC (common on cloud hosts).
  return parseDateTimeAssumeFixedOffset(value);
}

function parseMonth(value: Date) {
  return monthKeyInTimeZone(value);
}

function normalizeMealSlot(input: string | undefined, occurredAt: Date) {
  if (input) {
    const normalized = input.toLowerCase();
    if (normalized === 'breakfast') return 'breakfast';
    if (normalized === 'lunch') return 'lunch';
    if (normalized === 'dinner') return 'dinner';
    if (normalized === 'lunch_dinner') {
      const hour = hourInTimeZone(occurredAt);
      if (hour >= 10 && hour < 15) return 'lunch';
      return 'dinner';
    }
  }

  const hour = hourInTimeZone(occurredAt);
  if (hour >= 5 && hour < 10) return 'breakfast';
  if (hour >= 10 && hour < 15) return 'lunch';
  return 'dinner';
}

function toDateText(value: Date) {
  return formatDateTimeInTimeZone(value);
}

function previousMonthKey(baseDate = new Date()) {
  const parts = getDateTimePartsInTimeZone(baseDate);
  let year = Number(parts.year);
  let month = Number(parts.month);
  month -= 1;
  if (month <= 0) {
    year -= 1;
    month = 12;
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

function normalizeSyncMonth(input?: string) {
  const value = (input ?? '').trim();
  if (!value) {
    return previousMonthKey();
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new Error(`syncMonth format invalid: ${value}. Expected YYYY-MM.`);
  }
  return value;
}
function normalizeSyncMonths(inputs?: string[] | null) {
  const values = (inputs ?? []).map((item) => String(item ?? "").trim()).filter(Boolean);
  if (values.length === 0) {
    return [] as string[];
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeSyncMonth(value);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function parseResumePageFromNote(note?: string | null) {
  if (!note) return 1;
  const match = note.match(/page\s*(\d+)\s*\/\s*\d+/i);
  const page = match ? Number(match[1]) : 0;
  if (!Number.isFinite(page) || page <= 0) {
    return 1;
  }
  return page + 1;
}

function monthToTableName(month: string) {
  const compact = month.replace('-', '');
  if (!/^\d{6}$/.test(compact)) {
    throw new Error(`Invalid month format: ${month}. Expected YYYY-MM.`);
  }
  return `card_transaction_${compact}`;
}

function toSafeAccount(name: string, employeeNo?: string, account?: string) {
  if (account) return account;
  if (employeeNo) return `counselor_${employeeNo}`;
  const normalized = name.replace(/\s+/g, '').toLowerCase();
  const fallback = normalized || 'counselor';
  return `counselor_${fallback.slice(0, 24)}`;
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

type NormalizedStudentRow = {
  studentId: string;
  name: string;
  classCode: string;
  personTypeCode: string;
  isReadingCode: string;
  isRegisteredCode: string;
  genderCode: string;
  departmentName: string;
};

function preferNonEmpty(incoming: string, existing: string) {
  return incoming !== '' ? incoming : existing;
}

function mergeStudentRow(existing: NormalizedStudentRow, incoming: NormalizedStudentRow): NormalizedStudentRow {
  return {
    studentId: existing.studentId,
    name: preferNonEmpty(incoming.name, existing.name),
    classCode: preferNonEmpty(incoming.classCode, existing.classCode),
    personTypeCode: preferNonEmpty(incoming.personTypeCode, existing.personTypeCode),
    isReadingCode: preferNonEmpty(incoming.isReadingCode, existing.isReadingCode),
    isRegisteredCode: preferNonEmpty(incoming.isRegisteredCode, existing.isRegisteredCode),
    genderCode: preferNonEmpty(incoming.genderCode, existing.genderCode),
    departmentName: preferNonEmpty(incoming.departmentName, existing.departmentName),
  };
}

function sourceAliases(source: string) {
  if (source === 'jmu_student_basic' || source === 'jmu_student_basic_api') {
    return ['jmu_student_basic', 'jmu_student_basic_api'];
  }

  if (source === 'jmu_staff_basic' || source === 'jmu_staff_basic_api') {
    return ['jmu_staff_basic', 'jmu_staff_basic_api'];
  }

  if (source === 'jmu_counselor_relation' || source === 'jmu_counselor_relation_api') {
    return ['jmu_counselor_relation', 'jmu_counselor_relation_api'];
  }

  if (source === 'jmu_undergrad_difficulty' || source === 'jmu_undergrad_difficulty_api') {
    return ['jmu_undergrad_difficulty', 'jmu_undergrad_difficulty_api'];
  }

  if (source === 'jmu_cafeteria_transaction' || source === 'jmu_cafeteria_transaction_api') {
    return ['jmu_cafeteria_transaction', 'jmu_cafeteria_transaction_api'];
  }
  if (source === 'jmu_org_unit' || source === 'jmu_org_unit_api') {
    return ['jmu_org_unit', 'jmu_org_unit_api'];
  }
  if (source === 'jmu_org_post' || source === 'jmu_org_post_api') {
    return ['jmu_org_post', 'jmu_org_post_api'];
  }
  if (source === 'jmu_org_person_relation' || source === 'jmu_org_person_relation_api') {
    return ['jmu_org_person_relation', 'jmu_org_person_relation_api'];
  }

  return [source];
}

function normalizeSource(source?: string) {
  const normalized = (source ?? '').trim();
  if (!normalized) {
    return 'jmu_student_basic';
  }

  if (normalized === 'jmu_student_basic' || normalized === 'jmu_student_basic_api') {
    return 'jmu_student_basic';
  }

  if (normalized === 'jmu_staff_basic' || normalized === 'jmu_staff_basic_api') {
    return 'jmu_staff_basic';
  }

  if (normalized === 'jmu_counselor_relation' || normalized === 'jmu_counselor_relation_api') {
    return 'jmu_counselor_relation';
  }

  if (normalized === 'jmu_undergrad_difficulty' || normalized === 'jmu_undergrad_difficulty_api') {
    return 'jmu_undergrad_difficulty';
  }

  if (normalized === 'jmu_cafeteria_transaction' || normalized === 'jmu_cafeteria_transaction_api') {
    return 'jmu_cafeteria_transaction';
  }
  if (normalized === 'jmu_org_unit' || normalized === 'jmu_org_unit_api') {
    return 'jmu_org_unit';
  }
  if (normalized === 'jmu_org_post' || normalized === 'jmu_org_post_api') {
    return 'jmu_org_post';
  }
  if (normalized === 'jmu_org_person_relation' || normalized === 'jmu_org_person_relation_api') {
    return 'jmu_org_person_relation';
  }

  return normalized;
}

async function resolveSourcePayload(payload: SyncRunRequest) {
  const source = normalizeSource(payload.source);
  const hasManualPayload =
    (payload.students?.length ?? 0) > 0 ||
    (payload.staffs?.length ?? 0) > 0 ||
    (payload.difficultyRecognitions?.length ?? 0) > 0 ||
    (payload.counselorRelations?.length ?? 0) > 0 ||
    (payload.transactions?.length ?? 0) > 0 ||
    (payload.cafeteriaTransactions?.length ?? 0) > 0;

  if (hasManualPayload) {
    return payload;
  }

  if (source === 'jmu_student_basic') {
    const students = await dataPlatformClient.fetchStudentsByScope();
    return {
      source: 'jmu_student_basic_api',
      students,
      staffs: [],
      difficultyRecognitions: [],
      counselorRelations: [],
      transactions: [],
      cafeteriaTransactions: [],
    };
  }

  if (source === 'jmu_staff_basic') {
    const staffs = await dataPlatformClient.fetchStaffsByScope();
    return {
      source: 'jmu_staff_basic_api',
      students: [],
      staffs,
      difficultyRecognitions: [],
      counselorRelations: [],
      transactions: [],
      cafeteriaTransactions: [],
    };
  }

  if (source === 'jmu_counselor_relation') {
    const counselorRelations = await dataPlatformClient.fetchCounselorRelationsByScope();
    return {
      source: 'jmu_counselor_relation_api',
      students: [],
      staffs: [],
      difficultyRecognitions: [],
      counselorRelations,
      transactions: [],
      cafeteriaTransactions: [],
    };
  }

  if (source === 'jmu_undergrad_difficulty') {
    const difficultyRecognitions = await dataPlatformClient.fetchDifficultyRecognitionsByScope();
    return {
      source: 'jmu_undergrad_difficulty_api',
      students: [],
      staffs: [],
      difficultyRecognitions,
      counselorRelations: [],
      transactions: [],
      cafeteriaTransactions: [],
    };
  }

  if (source === 'jmu_cafeteria_transaction') {
    const syncMonths = normalizeSyncMonths(payload.syncMonths);
    if (syncMonths.length > 0) {
      return {
        source: 'jmu_cafeteria_transaction_api',
        syncMonths,
        students: [],
        staffs: [],
        difficultyRecognitions: [],
        counselorRelations: [],
        transactions: [],
        cafeteriaTransactions: [],
      };
    }

    const syncMonth = normalizeSyncMonth(payload.syncMonth ?? process.env.DATA_PLATFORM_CAFETERIA_SYNC_MONTH);
    return {
      source: 'jmu_cafeteria_transaction_api',
      syncMonth,
      students: [],
      staffs: [],
      difficultyRecognitions: [],
      counselorRelations: [],
      transactions: [],
      cafeteriaTransactions: [],
    };
  }
  if (source === 'jmu_org_unit') {
    const orgUnits = await dataPlatformClient.fetchOrgUnitsByScope();
    return {
      source: 'jmu_org_unit_api',
      students: [],
      staffs: [],
      difficultyRecognitions: [],
      counselorRelations: [],
      transactions: [],
      cafeteriaTransactions: [],
      orgUnits,
      orgPosts: [],
      orgPersonRelations: [],
    };
  }
  if (source === 'jmu_org_post') {
    const orgPosts = await dataPlatformClient.fetchOrgPostsByScope();
    return {
      source: 'jmu_org_post_api',
      students: [],
      staffs: [],
      difficultyRecognitions: [],
      counselorRelations: [],
      transactions: [],
      cafeteriaTransactions: [],
      orgUnits: [],
      orgPosts,
      orgPersonRelations: [],
    };
  }
  if (source === 'jmu_org_person_relation') {
    const orgPersonRelations = await dataPlatformClient.fetchOrgPersonRelationsByScope();
    return {
      source: 'jmu_org_person_relation_api',
      students: [],
      staffs: [],
      difficultyRecognitions: [],
      counselorRelations: [],
      transactions: [],
      cafeteriaTransactions: [],
      orgUnits: [],
      orgPosts: [],
      orgPersonRelations,
    };
  }

  const sourceUrl = process.env.DATA_PLATFORM_SYNC_URL;
  if (!sourceUrl) {
    throw new Error(
      'No sync payload provided. Specify a known source (jmu_student_basic/jmu_staff_basic/jmu_counselor_relation/jmu_undergrad_difficulty/jmu_cafeteria_transaction/jmu_org_unit/jmu_org_post/jmu_org_person_relation) or configure DATA_PLATFORM_SYNC_URL.'
    );
  }

  const headers: Record<string, string> = {};
  if (process.env.DATA_PLATFORM_SYNC_TOKEN) {
    headers.Authorization = `Bearer ${process.env.DATA_PLATFORM_SYNC_TOKEN}`;
  }

  const response = await fetch(sourceUrl, { headers });
  if (!response.ok) {
    throw new Error(`涓彴鍚屾鎺ュ彛璋冪敤澶辫触: ${response.status}`);
  }

  const body = (await response.json()) as SyncRunRequest;
  return {
    source: payload.source ?? body.source ?? sourceUrl,
    students: body.students ?? [],
    staffs: body.staffs ?? [],
    difficultyRecognitions: body.difficultyRecognitions ?? [],
    counselorRelations: body.counselorRelations ?? [],
    transactions: body.transactions ?? [],
    cafeteriaTransactions: body.cafeteriaTransactions ?? [],
  };
}

function isRetryableWriteConflict(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const anyError = error as { code?: unknown; meta?: unknown; message?: unknown };
  const code = typeof anyError.code === 'string' ? anyError.code : '';
  const meta = anyError.meta as { code?: unknown; message?: unknown } | undefined;
  const metaCode = meta && typeof meta.code === 'string' ? meta.code : '';
  const message = typeof anyError.message === 'string' ? anyError.message : '';
  const metaMessage = meta && typeof meta.message === 'string' ? meta.message : '';
  const combinedMessage = `${message}\n${metaMessage}`.toLowerCase();

  if (code === 'P2034') {
    return true;
  }

  if (metaCode === '1213' || metaCode === '1205') {
    return true;
  }

  return (
    combinedMessage.includes('deadlock') ||
    combinedMessage.includes('write conflict') ||
    combinedMessage.includes('lock wait timeout')
  );
}

async function withWriteConflictRetry<T>(
  operation: () => Promise<T>,
  options: { retries?: number; baseDelayMs?: number } = {}
) {
  const retries = options.retries ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 50;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !isRetryableWriteConflict(error)) {
        throw error;
      }

      const jitter = Math.floor(Math.random() * baseDelayMs);
      const delay = baseDelayMs * Math.pow(2, attempt) + jitter;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const limit = Math.max(1, Math.floor(concurrency));

  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await mapper(items[index]);
    }
  });

  await Promise.all(workers);
  return results;
}

export class DataSyncRepository {
  private cancelledJobIds = new Set<string>();
  private allowEmptyFullRefresh = (process.env.FULL_REFRESH_ALLOW_EMPTY ?? '').trim() === '1';
  private syncJobTextLimit = Math.max(20, Number(process.env.SYNC_JOB_TEXT_LIMIT) || 180);

  private truncateSyncJobText(value: unknown) {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (trimmed.length <= this.syncJobTextLimit) return trimmed;
    return `${trimmed.slice(0, this.syncJobTextLimit - 1)}…`;
  }

  private sanitizeSyncJobUpdate(data: Record<string, unknown>) {
    return {
      ...data,
      note: this.truncateSyncJobText(data.note),
      delta: this.truncateSyncJobText(data.delta),
    };
  }

  private compareExternalTxnId(a: string, b: string) {
    if (a === b) return 0;
    const aDigits = a.replace(/[^\d]/g, '');
    const bDigits = b.replace(/[^\d]/g, '');
    if (aDigits && bDigits) {
      try {
        const aNum = BigInt(aDigits);
        const bNum = BigInt(bDigits);
        if (aNum === bNum) return 0;
        return aNum > bNum ? 1 : -1;
      } catch {
        // Fall back to lexicographic comparison.
      }
    }
    return a > b ? 1 : -1;
  }

  private async getLatestCafeteriaExternalTxnId(tableName: string): Promise<string | undefined> {
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ externalTxnId: string }>>(
        `SELECT externalTxnId FROM \`${tableName}\` ORDER BY externalTxnId DESC LIMIT 1`
      );
      return rows[0]?.externalTxnId;
    } catch {
      return undefined;
    }
  }

  private async updateJobIfRunning(jobId: string, data: Record<string, unknown>) {
    await prisma.syncJob.updateMany({
      where: { id: jobId, status: 'running' },
      data: this.sanitizeSyncJobUpdate(data),
    });
  }

  async terminateJob(jobId: string) {
    const id = (jobId ?? '').trim();
    if (!id) {
      throw new Error('缺少任务ID（jobId）');
    }
    this.cancelledJobIds.add(id);
    const finishedAt = new Date();
    await prisma.syncJob.updateMany({
      where: { id, status: 'running' },
      data: this.sanitizeSyncJobUpdate({
        status: 'failed',
        finishedAt,
        lastRunAt: finishedAt,
        delta: '已终止',
        note: '任务已手动终止',
      }),
    });
    return { jobId: id, status: 'failed' as const };
  }

  async terminateAllRunningJobs() {
    const runningJobs = await prisma.syncJob.findMany({
      where: { status: 'running' },
      select: { id: true },
    });

    const jobIds = runningJobs.map((job) => job.id);
    for (const id of jobIds) {
      this.cancelledJobIds.add(id);
    }

    const finishedAt = new Date();
    if (jobIds.length > 0) {
      await prisma.syncJob.updateMany({
        where: {
          id: { in: jobIds },
          status: 'running',
        },
        data: this.sanitizeSyncJobUpdate({
          status: 'failed',
          finishedAt,
          lastRunAt: finishedAt,
          delta: '已终止',
          note: '已手动终止所有运行中的同步任务',
        }),
      });
    }

    return { terminated: jobIds.length, jobIds };
  }

  private isCancelled(jobId: string) {
    return this.cancelledJobIds.has(jobId);
  }

  private async resolveCafeteriaResumePage(syncMonth: string) {
    const latest = await prisma.syncJob.findFirst({
      where: {
        source: {
          in: ['jmu_cafeteria_transaction', 'jmu_cafeteria_transaction_api'],
        },
        status: 'failed',
        note: {
          contains: `月份=${syncMonth}`,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    if (!latest) {
      return 1;
    }
    return parseResumePageFromNote(latest.note);
  }

  async runSync(inputPayload: SyncRunRequest): Promise<SyncRunResponse> {
    const startedAt = new Date();
    const source = normalizeSource(inputPayload.source);
    const syncMonths =
      source === 'jmu_cafeteria_transaction'
        ? (() => {
            const months = normalizeSyncMonths(inputPayload.syncMonths);
            if (months.length > 0) return months;
            return [normalizeSyncMonth(inputPayload.syncMonth ?? process.env.DATA_PLATFORM_CAFETERIA_SYNC_MONTH)];
          })()
        : [];
    const syncName =
      source === 'jmu_student_basic'
        ? '学生基本信息同步'
        : source === 'jmu_staff_basic'
          ? '教职工基本信息同步'
          : source === 'jmu_counselor_relation'
            ? '辅导员带班关系同步'
            : source === 'jmu_undergrad_difficulty'
              ? '本科生困难认定同步'
              : source === 'jmu_cafeteria_transaction'
                ? '一卡通食堂消费同步'
                : source === 'jmu_org_unit'
                  ? '院系所单位信息同步'
                  : source === 'jmu_org_post'
                    ? '院系所岗位信息同步'
                    : source === 'jmu_org_person_relation'
                      ? '院系所人员关联同步'
                : 'sync';
    const aliases = sourceAliases(source);
    const staleThresholdMs = 30 * 60 * 1000;
    const staleBefore = new Date(Date.now() - staleThresholdMs);
    const staleBeforeId = `sync-${staleBefore.getTime()}`;
    const resumePagesByMonth = new Map<string, number>();
    if (source === 'jmu_cafeteria_transaction') {
      for (const month of syncMonths) {
        const resumePage = syncMonths.length === 1 ? await this.resolveCafeteriaResumePage(month) : 1;
        resumePagesByMonth.set(month, resumePage);
      }
    }

    if (source === 'jmu_cafeteria_transaction') {
      // Pre-create monthly table immediately so users can verify table existence right after triggering sync.
      for (const month of syncMonths) {
        await this.ensureCafeteriaMonthlyTable(monthToTableName(month), month);
      }
    }

    const resumePage =
      source === 'jmu_cafeteria_transaction' && syncMonths.length === 1
        ? (resumePagesByMonth.get(syncMonths[0]) ?? 1)
        : 1;

    // Recover previously interrupted jobs to prevent stale "running" tasks blocking new syncs.
    // Prefer id ("sync-<epochMs>") when available so timezone/storage drift in createdAt
    // won't prevent stale job cleanup.
    await prisma.syncJob.updateMany({
      where: {
        status: 'running',
        source: {
          in: aliases,
        },
        id: {
          lt: staleBeforeId,
        },
      },
      data: this.sanitizeSyncJobUpdate({
        status: 'failed',
        finishedAt: startedAt,
        lastRunAt: startedAt,
        delta: '已中止',
        note: '任务运行超过30分钟，已自动标记为失败（避免卡住后续同步）',
      }),
    });
    await prisma.syncJob.updateMany({
      where: {
        status: 'running',
        source: {
          in: aliases,
        },
        NOT: {
          id: {
            startsWith: 'sync-',
          },
        },
      },
      data: {
        status: 'failed',
        finishedAt: startedAt,
        lastRunAt: startedAt,
        delta: '已中止',
        note: '任务运行超过30分钟，已自动标记为失败（避免卡住后续同步）',
      },
    });

    const runningJob = await prisma.syncJob.findFirst({
      where: {
        status: 'running',
        source: {
          in: aliases,
        },
        id: {
          startsWith: 'sync-',
        },
      },
      orderBy: {
        id: 'desc',
      },
    });

    if (runningJob) {
      return {
        message: '已有同步任务正在执行',
        data: {
          jobId: runningJob.id,
          status: 'running',
          source: runningJob.source,
          imported: { students: 0, staffs: 0, difficultyRecognitions: 0, counselorRelations: 0, transactions: 0 },
          skipped: { difficultyRecognitions: 0, counselorRelations: 0, transactions: 0 },
          startedAt: toDateText(runningJob.startedAt ?? runningJob.createdAt),
          finishedAt: '-',
        },
      };
    }

    const job = await prisma.syncJob.create({
      data: {
        id: `sync-${Date.now()}`,
        name: syncName,
        source,
        jobType: 'manual_sync',
        frequency: 'manual',
        status: 'running',
        delta: '运行中',
        note:
          source === 'jmu_cafeteria_transaction'
            ? syncMonths.length === 1
              ? `同步任务已启动，月份=${syncMonths[0]}，续传起始页=${resumePage}`
              : `同步任务已启动，月份=${syncMonths.join(',')}，将按月顺序同步`
            : '同步任务已启动，正在拉取中台数据',
        startedAt,
      },
    });

    const payloadWithIncrement = await this.attachStudentIncrementCursor({
      ...inputPayload,
      source,
      syncMonth: source === 'jmu_cafeteria_transaction' && syncMonths.length === 1 ? syncMonths[0] : undefined,
      syncMonths: source === 'jmu_cafeteria_transaction' ? syncMonths : undefined,
    });
    void this.executeSyncJob(job.id, payloadWithIncrement, resumePage);

    return {
      message: '同步任务已启动',
      data: {
        jobId: job.id,
        status: 'running',
        source,
        imported: { students: 0, staffs: 0, difficultyRecognitions: 0, counselorRelations: 0, transactions: 0 },
        skipped: { difficultyRecognitions: 0, counselorRelations: 0, transactions: 0 },
        startedAt: toDateText(startedAt),
        finishedAt: '-',
      },
    };
  }

  private async executeSyncJob(jobId: string, inputPayload: SyncRunRequest, resumePage = 1) {
    const imported = { students: 0, staffs: 0, difficultyRecognitions: 0, counselorRelations: 0, transactions: 0 };
    const skipped = { difficultyRecognitions: 0, counselorRelations: 0, transactions: 0 };
    const skippedDifficultyStudentIdSamples = new Map<string, number>();

    try {
      if (this.isCancelled(jobId)) {
        throw new Error('任务已手动终止');
      }
      const requestedSyncKind = normalizeSource(inputPayload.source);
      const manualCounselorPayloadCount = inputPayload.counselorRelations?.length ?? 0;
      const manualStudentPayloadCount = inputPayload.students?.length ?? 0;
      if (requestedSyncKind === 'jmu_counselor_relation' && manualCounselorPayloadCount === 0) {
        const counselorStreamingResult = await this.syncCounselorRelationsStreaming(jobId);
        imported.counselorRelations = counselorStreamingResult.imported;
        skipped.counselorRelations = counselorStreamingResult.skipped;
        await this.refreshCandidateSnapshotCounselors();
        const finishedAt = new Date();
        await this.updateJobIfRunning(jobId, {
          source: 'jmu_counselor_relation_api',
          status: 'success',
          finishedAt,
          lastRunAt: finishedAt,
          delta: `学生 0，教职工 0，困难认定 0，关系 ${imported.counselorRelations}，流水 0`,
          note: `跳过困难认定 0 条，跳过关系 ${skipped.counselorRelations} 条，跳过流水 0 条`,
        });
        return;
      }
      if (requestedSyncKind === 'jmu_student_basic' && manualStudentPayloadCount === 0) {
        const studentStreamingResult = await this.syncStudentsStreaming(jobId, inputPayload.incrementalCzsj);
        imported.students = studentStreamingResult.imported;
        const finishedAt = new Date();
        await this.updateJobIfRunning(jobId, {
          source: 'jmu_student_basic_api',
          status: 'success',
          finishedAt,
          lastRunAt: finishedAt,
          delta: `学生 ${imported.students}，教职工 0，困难认定 0，关系 0，流水 0`,
          note: `学生已写入 ${studentStreamingResult.imported} 条，已删除 ${studentStreamingResult.deleted} 条；跳过困难认定 0 条，跳过关系 0 条，跳过流水 0 条`,
        });
        return;
      }
      const payload = await resolveSourcePayload(inputPayload);
      await this.updateJobIfRunning(jobId, {
        source: payload.source ?? inputPayload.source ?? 'jmu_student_basic',
        note:
          payload.source === 'jmu_cafeteria_transaction_api'
            ? `已获取中台食堂消费数据（月份=${
                payload.syncMonths && payload.syncMonths.length > 0
                  ? normalizeSyncMonths(payload.syncMonths).join(',')
                  : payload.syncMonth ?? normalizeSyncMonth(inputPayload.syncMonth)
              }），正在写入数据库...`
            : inputPayload.incrementalCzsj
              ? `已获取中台数据（CZSJ>=${inputPayload.incrementalCzsj}），正在写入数据库...`
              : '已获取中台数据，正在写入数据库...',
      });

      const students = payload.students ?? [];
      const staffs = payload.staffs ?? [];
      const difficultyRecognitions = payload.difficultyRecognitions ?? [];
      const counselorRelations = payload.counselorRelations ?? [];
      const transactions = payload.transactions ?? [];
      const cafeteriaTransactions = payload.cafeteriaTransactions ?? [];
      const orgUnits = payload.orgUnits ?? [];
      const orgPosts = payload.orgPosts ?? [];
      const orgPersonRelations = payload.orgPersonRelations ?? [];
      const syncKind = normalizeSource(payload.source ?? inputPayload.source);

      if (syncKind === 'jmu_org_unit') {
        const importedOrgUnits = await this.replaceOrgUnits(orgUnits);
        imported.staffs = importedOrgUnits;
      }
      if (syncKind === 'jmu_org_post') {
        const importedOrgPosts = await this.replaceOrgPosts(orgPosts);
        imported.staffs = importedOrgPosts;
      }
      if (syncKind === 'jmu_org_person_relation') {
        const importedRelations = await this.replaceOrgPersonRelations(orgPersonRelations);
        imported.counselorRelations = importedRelations;
      }

      const normalizedStudents = students
        .filter((item) => item.studentId)
        .map((item) => ({
          studentId: String(item.studentId).trim(),
          name: item.name ?? '',
          classCode: item.classCode ?? item.className ?? '',
          personTypeCode: item.personTypeCode ?? '',
          isReadingCode: item.isReadingCode ?? '',
          isRegisteredCode: item.isRegisteredCode ?? '',
          genderCode: item.genderCode ?? '',
          departmentName: item.departmentName ?? item.college ?? '',
        }));
      const deduplicatedStudentMap = new Map<string, NormalizedStudentRow>();
      for (const item of normalizedStudents) {
        const existing = deduplicatedStudentMap.get(item.studentId);
        if (!existing) {
          deduplicatedStudentMap.set(item.studentId, item);
          continue;
        }
        deduplicatedStudentMap.set(item.studentId, mergeStudentRow(existing, item));
      }
      const deduplicatedStudents = Array.from(deduplicatedStudentMap.values());

      if (deduplicatedStudents.length > 0) {
        if (syncKind === 'jmu_student_basic') {
          const existingStudents = await prisma.student.findMany({
            select: {
              id: true,
              studentId: true,
              name: true,
              classCode: true,
              personTypeCode: true,
              isReadingCode: true,
              isRegisteredCode: true,
              genderCode: true,
              departmentName: true,
            },
          });
          const incomingByStudentId = new Map(deduplicatedStudents.map((item) => [item.studentId, item]));
          const existingByStudentId = new Map(existingStudents.map((item) => [item.studentId, item]));

          const createRows = deduplicatedStudents
            .filter((item) => !existingByStudentId.has(item.studentId))
            .map((item) => ({
              studentId: item.studentId,
              name: item.name,
              classCode: item.classCode,
              personTypeCode: item.personTypeCode,
              isReadingCode: item.isReadingCode,
              isRegisteredCode: item.isRegisteredCode,
              genderCode: item.genderCode,
              departmentName: item.departmentName,
            }));
          for (const chunk of chunkArray(createRows, 1000)) {
            await prisma.student.createMany({ data: chunk });
          }

          const changedRows = existingStudents
            .map((existing) => {
              const incoming = incomingByStudentId.get(existing.studentId);
              if (!incoming) return null;
              if (
                existing.name === incoming.name &&
                existing.classCode === incoming.classCode &&
                existing.personTypeCode === incoming.personTypeCode &&
                existing.isReadingCode === incoming.isReadingCode &&
                existing.isRegisteredCode === incoming.isRegisteredCode &&
                existing.genderCode === incoming.genderCode &&
                existing.departmentName === incoming.departmentName
              ) {
                return null;
              }
              return { id: existing.id, incoming };
            })
            .filter((item): item is { id: string; incoming: NormalizedStudentRow } => item !== null);
          await mapWithConcurrency(
            changedRows,
            Math.max(1, Number(process.env.SYNC_WRITE_CONCURRENCY) || 4),
            async ({ id, incoming }) => {
              await withWriteConflictRetry(() =>
                prisma.student.update({
                  where: { id },
                  data: {
                    name: incoming.name,
                    classCode: incoming.classCode,
                    personTypeCode: incoming.personTypeCode,
                    isReadingCode: incoming.isReadingCode,
                    isRegisteredCode: incoming.isRegisteredCode,
                    genderCode: incoming.genderCode,
                    departmentName: incoming.departmentName,
                  },
                })
              );
            }
          );

          const staleIds = existingStudents
            .filter((item) => !incomingByStudentId.has(item.studentId))
            .map((item) => item.id);
          await this.deleteStudentsByIds(staleIds);

          imported.students = createRows.length + changedRows.length;
        } else {
          // Other sync sources may fetch student rows as a prerequisite (id mapping),
          // but do not treat that as a student sync. Keep a safe upsert behavior.
          const studentChunks = chunkArray(deduplicatedStudents, 500);
          for (const chunk of studentChunks) {
            const existing = await prisma.student.findMany({
              where: {
                studentId: {
                  in: chunk.map((item) => item.studentId),
                },
              },
              select: {
                studentId: true,
                name: true,
                classCode: true,
                personTypeCode: true,
                isReadingCode: true,
                isRegisteredCode: true,
                genderCode: true,
                departmentName: true,
              },
            });
            const existingById = new Map(existing.map((item) => [item.studentId, item]));
            const newRows = chunk.filter((item) => !existingById.has(item.studentId));
            const updateRows = chunk.filter((item) => existingById.has(item.studentId));
            if (newRows.length > 0) {
              await prisma.student.createMany({
                data: newRows,
              });
            }

            for (const row of updateRows) {
              const existingRow = existingById.get(row.studentId);
              if (!existingRow) {
                continue;
              }
              const mergedRow = mergeStudentRow(
                {
                  studentId: existingRow.studentId,
                  name: existingRow.name,
                  classCode: existingRow.classCode,
                  personTypeCode: existingRow.personTypeCode,
                  isReadingCode: existingRow.isReadingCode,
                  isRegisteredCode: existingRow.isRegisteredCode,
                  genderCode: existingRow.genderCode,
                  departmentName: existingRow.departmentName,
                },
                row
              );
              await prisma.student.update({
                where: { studentId: row.studentId },
                data: {
                  name: mergedRow.name,
                  classCode: mergedRow.classCode,
                  personTypeCode: mergedRow.personTypeCode,
                  isReadingCode: mergedRow.isReadingCode,
                  isRegisteredCode: mergedRow.isRegisteredCode,
                  genderCode: mergedRow.genderCode,
                  departmentName: mergedRow.departmentName,
                },
              });
            }
          }
        }
      } else if (syncKind === 'jmu_student_basic') {
        if (!this.allowEmptyFullRefresh) {
          throw new Error('student sync returned empty result (FULL_REFRESH_ALLOW_EMPTY=1 to allow clearing)');
        }
        await prisma.student.deleteMany();
      }

      const normalizedStaffs = staffs
        .filter((item) => item.employeeNo)
        .map((item) => ({
          employeeNo: item.employeeNo,
          name: item.name ?? '',
          genderCode: item.genderCode ?? '',
          unitName: item.unitName ?? '',
          staffCategoryCode: item.staffCategoryCode ?? '',
          currentStatusCode: item.currentStatusCode ?? '',
        }));
      const deduplicatedStaffs = Array.from(
        new Map(normalizedStaffs.map((item) => [item.employeeNo, item])).values()
      );

      if (syncKind === 'jmu_staff_basic') {
        if (deduplicatedStaffs.length === 0 && !this.allowEmptyFullRefresh) {
          throw new Error('staff sync returned empty result (FULL_REFRESH_ALLOW_EMPTY=1 to allow clearing)');
        }
        await prisma.facultyStaff.deleteMany();
        if (deduplicatedStaffs.length > 0) {
          const staffChunks = chunkArray(deduplicatedStaffs, 1000);
          for (const chunk of staffChunks) {
            await prisma.facultyStaff.createMany({
              data: chunk,
            });
          }
        }
        imported.staffs = deduplicatedStaffs.length;
      }

      const allStudentIds = Array.from(
        new Set([
          ...students.map((item) => item.studentId),
          ...difficultyRecognitions.map((item) => item.studentId),
          ...counselorRelations.map((item) => item.studentId),
        ])
      );
      const studentRows = allStudentIds.length
        ? await prisma.student.findMany({
            where: { studentId: { in: allStudentIds } },
            select: { id: true, studentId: true },
          })
        : [];
      const studentIdMap = new Map(studentRows.map((item) => [item.studentId, item.id]));

      const normalizedDifficultyRecognitions = difficultyRecognitions
        .filter(
          (item) =>
            item.studentId &&
            item.startAcademicYear &&
            item.endAcademicYear &&
            item.semester
        )
        .map((item) => ({
          studentId: item.studentId,
          startAcademicYear: item.startAcademicYear,
          endAcademicYear: item.endAcademicYear,
          semester: item.semester,
          difficultyLevel: item.difficultyLevel ?? '',
        }));
      // De-duplicate only when ALL business fields are identical.
      const exactDeduplicatedDifficultyRecognitions = Array.from(
        new Map(
          normalizedDifficultyRecognitions.map((item) => [
            `${item.studentId}::${item.startAcademicYear}::${item.endAcademicYear}::${item.semester}::${item.difficultyLevel}`,
            item,
          ])
        ).values()
      );

      // The table has a unique constraint on (studentId, startAcademicYear, endAcademicYear, semester),
      // so we still must collapse to that unique key for inserting.
      // When there are conflicting difficultyLevel values for the same key, we can either throw (default)
      // or auto-resolve by preferring non-empty values.
      const strictDifficultyConflict =
        String(process.env.UNDERGRAD_DIFFICULTY_CONFLICT_STRICT ?? '1').trim() !== '0';

      const difficultyLevelSetByKey = new Map<string, Set<string>>();
      for (const item of exactDeduplicatedDifficultyRecognitions) {
        const key = `${item.studentId}::${item.startAcademicYear}::${item.endAcademicYear}::${item.semester}`;
        const existing = difficultyLevelSetByKey.get(key);
        if (!existing) {
          difficultyLevelSetByKey.set(key, new Set([item.difficultyLevel]));
          continue;
        }
        existing.add(item.difficultyLevel);
      }

      const conflictKeys: string[] = [];
      for (const [key, levels] of difficultyLevelSetByKey.entries()) {
        if (levels.size > 1) {
          conflictKeys.push(key);
        }
      }
      if (strictDifficultyConflict && conflictKeys.length > 0) {
        const samples = conflictKeys.slice(0, 5).join(', ');
        throw new Error(`difficulty recognition conflicts detected (${conflictKeys.length} groups). samples=${samples}`);
      }

      // Auto-resolve (non-strict): prefer non-empty difficultyLevel, otherwise keep last observed value.
      const deduplicatedDifficultyMap = new Map<
        string,
        (typeof exactDeduplicatedDifficultyRecognitions)[number]
      >();
      for (const item of exactDeduplicatedDifficultyRecognitions) {
        const key = `${item.studentId}::${item.startAcademicYear}::${item.endAcademicYear}::${item.semester}`;
        const existing = deduplicatedDifficultyMap.get(key);
        if (!existing) {
          deduplicatedDifficultyMap.set(key, item);
          continue;
        }
        if (!existing.difficultyLevel && item.difficultyLevel) {
          deduplicatedDifficultyMap.set(key, item);
          continue;
        }
        if (existing.difficultyLevel && !item.difficultyLevel) {
          continue;
        }
        deduplicatedDifficultyMap.set(key, item);
      }
      const deduplicatedDifficultyRecognitions = Array.from(deduplicatedDifficultyMap.values());

      const difficultyToUpsert: Array<{
        studentRowId: string;
        startAcademicYear: string;
        endAcademicYear: string;
        semester: string;
        difficultyLevel: string;
      }> = [];
      for (const item of deduplicatedDifficultyRecognitions) {
        const studentRowId = studentIdMap.get(item.studentId);
        if (!studentRowId) {
          skipped.difficultyRecognitions += 1;
          if (skippedDifficultyStudentIdSamples.size < 20 || skippedDifficultyStudentIdSamples.has(item.studentId)) {
            skippedDifficultyStudentIdSamples.set(
              item.studentId,
              (skippedDifficultyStudentIdSamples.get(item.studentId) ?? 0) + 1
            );
          }
          continue;
        }
        difficultyToUpsert.push({
          studentRowId,
          startAcademicYear: item.startAcademicYear,
          endAcademicYear: item.endAcademicYear,
          semester: item.semester,
          difficultyLevel: item.difficultyLevel,
        });
      }

      const writeConcurrency = Math.max(1, Number(process.env.SYNC_WRITE_CONCURRENCY) || 4);
      if (syncKind === 'jmu_undergrad_difficulty') {
        if (deduplicatedDifficultyRecognitions.length > 0 && studentIdMap.size === 0) {
          throw new Error('difficulty sync requires student basic data; run student sync first');
        }
        await prisma.undergraduateDifficultyRecognition.deleteMany();
        const createRows = difficultyToUpsert.map((item) => ({
          studentId: item.studentRowId,
          startAcademicYear: item.startAcademicYear,
          endAcademicYear: item.endAcademicYear,
          semester: item.semester,
          difficultyLevel: item.difficultyLevel,
        }));
        const chunks = chunkArray(createRows, 1000);
        for (const chunk of chunks) {
          await prisma.undergraduateDifficultyRecognition.createMany({
            data: chunk,
          });
        }
        imported.difficultyRecognitions = createRows.length;
      }

      const deduplicatedRelations = Array.from(
        new Map(
          counselorRelations
            .filter((item) => item.studentId && (item.counselorEmployeeNo || item.counselorName))
            .map((item) => [
              `${item.studentId}::${item.counselorEmployeeNo ?? item.counselorName}::${item.relationType ?? 'student'}`,
              item,
            ])
        ).values()
      );

      const relationToUpsert: Array<{
        studentRowId: string;
        counselorKey: string;
        relation: ExternalCounselorRelationRecord;
        relationType: string;
      }> = [];
      const uniqueCounselors = new Map<string, ExternalCounselorRelationRecord>();
      for (const relation of deduplicatedRelations) {
        const studentRowId = studentIdMap.get(relation.studentId);
        const counselorName = relation.counselorName || relation.counselorEmployeeNo || '';
        if (!studentRowId || !counselorName) {
          skipped.counselorRelations += 1;
          continue;
        }

        const counselorKey = relation.counselorEmployeeNo
          ? `employeeNo:${relation.counselorEmployeeNo}`
          : `account:${toSafeAccount(counselorName, relation.counselorEmployeeNo, relation.counselorAccount)}`;
        if (!uniqueCounselors.has(counselorKey)) {
          uniqueCounselors.set(counselorKey, { ...relation, counselorName });
        }

        relationToUpsert.push({
          studentRowId,
          counselorKey,
          relation: { ...relation, counselorName },
          relationType: relation.relationType ?? 'student',
        });
      }

      const uniqueCounselorList = Array.from(uniqueCounselors.entries());
      const counselorIdByKey = await this.syncCounselorsInBulk(uniqueCounselorList, writeConcurrency);

      if (syncKind === 'jmu_counselor_relation') {
        if (deduplicatedRelations.length > 0 && studentIdMap.size === 0) {
          throw new Error('counselor relation sync requires student basic data; run student sync first');
        }
        const createRows: Array<{
          counselorId: string;
          studentId: string;
          relationType: string;
          effectiveFrom: Date | null;
          effectiveTo: Date | null;
        }> = [];

        for (const item of relationToUpsert) {
          const counselorId = counselorIdByKey.get(item.counselorKey);
          if (!counselorId) {
            skipped.counselorRelations += 1;
            continue;
          }
          createRows.push({
            counselorId,
            studentId: item.studentRowId,
            relationType: item.relationType,
            effectiveFrom: parseDateTime(item.relation.effectiveFrom) ?? null,
            effectiveTo: parseDateTime(item.relation.effectiveTo) ?? null,
          });
        }

        imported.counselorRelations = await this.applyCounselorRelationDelta(createRows);
        await this.refreshCandidateSnapshotCounselors();
      }

      skipped.transactions += transactions.length;

      const shouldSyncCafeteria =
        payload.source === 'jmu_cafeteria_transaction_api' ||
        inputPayload.source === 'jmu_cafeteria_transaction';
      if (shouldSyncCafeteria) {
        const months =
          (payload.syncMonths && payload.syncMonths.length > 0
            ? normalizeSyncMonths(payload.syncMonths)
            : normalizeSyncMonths(inputPayload.syncMonths)) ?? [];
        const normalizedMonths =
          months.length > 0 ? months : [payload.syncMonth ?? normalizeSyncMonth(inputPayload.syncMonth)];

        for (const syncMonth of normalizedMonths) {
          const startPage = normalizedMonths.length === 1 ? resumePage : 1;
          const cafeteriaResult =
            cafeteriaTransactions.length > 0
              ? await this.syncCafeteriaTransactionsByMonth(cafeteriaTransactions, syncMonth)
              : await this.syncCafeteriaTransactionsStreaming(jobId, syncMonth, startPage);
          imported.transactions += cafeteriaResult.imported;
          skipped.transactions += cafeteriaResult.skipped;
        }
      }

      const finishedAt = new Date();
      const difficultySkipDetail =
        skipped.difficultyRecognitions > 0
          ? (() => {
              const samples = Array.from(skippedDifficultyStudentIdSamples.entries())
                .slice(0, 10)
                .map(([studentId, count]) => (count > 1 ? `${studentId}(${count})` : studentId))
                .join(', ');
              return samples
                ? `；困难认定跳过原因：studentId 未在学生基础表中找到（可先同步“学生基本信息”，或检查学号格式：空格/前导零）；示例学号：${samples}`
                : `；困难认定跳过原因：studentId 未在学生基础表中找到（可先同步“学生基本信息”，或检查学号格式：空格/前导零）`;
            })()
          : '';
      await this.updateJobIfRunning(jobId, {
        status: 'success',
        finishedAt,
        lastRunAt: finishedAt,
        delta: `学生 ${imported.students}，教职工 ${imported.staffs}，困难认定 ${imported.difficultyRecognitions}，关系 ${imported.counselorRelations}，流水 ${imported.transactions}`,
        note: `跳过困难认定 ${skipped.difficultyRecognitions} 条，跳过关系 ${skipped.counselorRelations} 条，跳过流水 ${skipped.transactions} 条${difficultySkipDetail}`,
      });
    } catch (error) {
      const finishedAt = new Date();
      const message = error instanceof Error ? error.message : '未知错误';
      const failedNote =
        (inputPayload.source === 'jmu_cafeteria_transaction' || inputPayload.source === 'jmu_cafeteria_transaction_api') &&
        (inputPayload.syncMonths?.length ? inputPayload.syncMonths.join(',') : inputPayload.syncMonth)
          ? `月份=${(inputPayload.syncMonths?.length ? inputPayload.syncMonths.join(',') : inputPayload.syncMonth)}，${message}`
          : message;
      await this.updateJobIfRunning(jobId, {
        status: 'failed',
        finishedAt,
        lastRunAt: finishedAt,
        delta: this.isCancelled(jobId) ? '已取消' : '失败',
        note: this.isCancelled(jobId) ? '任务已被用户取消。' : failedNote,
      });
    }
  }

  private async syncCafeteriaTransactionsByMonth(
    items: ExternalCafeteriaTransactionRecord[],
    syncMonth?: string
  ): Promise<{ imported: number; skipped: number }> {
    const grouped = new Map<string, ExternalCafeteriaTransactionRecord[]>();
    for (const item of items) {
      const occurredAt = parseDateTime(item.occurredAt);
      if (!occurredAt) {
        continue;
      }
      const month = parseMonth(occurredAt);
      const list = grouped.get(month) ?? [];
      list.push(item);
      grouped.set(month, list);
    }

    let imported = 0;
    let skipped = 0;
    if (syncMonth && !grouped.has(syncMonth)) {
      grouped.set(syncMonth, []);
    }
    for (const [month, monthItems] of grouped.entries()) {
      const tableName = monthToTableName(month);
      await this.ensureCafeteriaMonthlyTable(tableName, month);
      const cursor = await this.getLatestCafeteriaExternalTxnId(tableName);

      const deduplicated = Array.from(
        new Map(monthItems.map((item) => [item.externalTxnId, item])).values()
      );

      const incrementalItems =
        cursor != null
          ? deduplicated.filter((item) => this.compareExternalTxnId(item.externalTxnId, cursor) > 0)
          : deduplicated;
      skipped += Math.max(0, deduplicated.length - incrementalItems.length);

      const result = await this.upsertCafeteriaBatch(tableName, incrementalItems);
      imported += result.imported;
      skipped += result.skipped;
    }

    return { imported, skipped };
  }
  private async syncCafeteriaTransactionsStreaming(
    jobId: string,
    syncMonth: string,
    startPage = 1
  ): Promise<{ imported: number; skipped: number }> {
    const tableName = monthToTableName(syncMonth);
    await this.ensureCafeteriaMonthlyTable(tableName, syncMonth);
    const cursor = await this.getLatestCafeteriaExternalTxnId(tableName);

    let imported = 0;
    let skipped = 0;
    const reportEveryPages = 10;

    await dataPlatformClient.streamCafeteriaTransactionsByScope(
      syncMonth,
      async (pageItems, pageIndex, totalPages) => {
        if (this.isCancelled(jobId)) {
          throw new Error('任务已被用户取消。');
        }

        const deduplicated = Array.from(
          new Map(pageItems.map((item) => [item.externalTxnId, item])).values()
        );

        const incrementalItems =
          cursor != null
            ? deduplicated.filter((item) => this.compareExternalTxnId(item.externalTxnId, cursor) > 0)
            : deduplicated;
        skipped += Math.max(0, deduplicated.length - incrementalItems.length);

        const result = await this.upsertCafeteriaBatch(tableName, incrementalItems);
        imported += result.imported;
        skipped += result.skipped;

        if (pageIndex === 1 || pageIndex === totalPages || pageIndex % reportEveryPages === 0) {
          await this.updateJobIfRunning(jobId, {
            note:
              '食堂消费边拉边写：月份=' +
              syncMonth +
              '，第 ' +
              pageIndex +
              '/' +
              totalPages +
              ' 页，已写入 ' +
              imported +
              ' 条',
          });
        }
      },
      { startPage }
    );

    return { imported, skipped };
  }

  private async upsertCafeteriaBatch(
    tableName: string,
    items: ExternalCafeteriaTransactionRecord[]
  ): Promise<{ imported: number; skipped: number }> {
    const validRows: Array<[string, string, string, number, string, string, string]> = [];
    let skipped = 0;

    for (const item of items) {
      const occurredAt = parseDateTime(item.occurredAt);
      if (!occurredAt || Number.isNaN(Number(item.amount)) || !item.externalTxnId || !item.studentNo) {
        skipped += 1;
        continue;
      }
      validRows.push([
        item.externalTxnId,
        item.studentNo,
        // Insert a local time text into MySQL DATETIME to avoid driver/server timezone shifts.
        formatDateTimeInTimeZone(occurredAt),
        Number(item.amount),
        item.cbid,
        item.mealSlot,
        item.location ?? '',
      ]);
    }

    if (validRows.length === 0) {
      return { imported: 0, skipped };
    }

    const batchSize = Math.max(1, Number(process.env.CAFETERIA_INSERT_BATCH_SIZE) || 1500);
    for (let i = 0; i < validRows.length; i += batchSize) {
      const batch = validRows.slice(i, i + batchSize);
      const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ');
      const sql = `
        INSERT INTO \`${tableName}\`
          (externalTxnId, studentNo, occurredAt, amount, cbid, mealSlot, location)
        VALUES ${placeholders}
        ON DUPLICATE KEY UPDATE
          studentNo = VALUES(studentNo),
          occurredAt = VALUES(occurredAt),
          amount = VALUES(amount),
          cbid = VALUES(cbid),
          mealSlot = VALUES(mealSlot),
          location = VALUES(location)
      `;
      await prisma.$executeRawUnsafe(sql, ...batch.flat());
    }

    return { imported: validRows.length, skipped };
  }

  private async ensureCafeteriaMonthlyTable(tableName: string, month: string) {
    const sql = `
      CREATE TABLE IF NOT EXISTS \`${tableName}\` (
        id BIGINT NOT NULL AUTO_INCREMENT COMMENT 'primary key',
        externalTxnId VARCHAR(64) NOT NULL COMMENT 'external txn id (LSH)',
        studentNo VARCHAR(64) NOT NULL COMMENT 'student no (XGH)',
        occurredAt DATETIME NOT NULL COMMENT 'transaction time (JYSJ)',
        amount DECIMAL(12,2) NOT NULL COMMENT 'amount (JYJE)',
        cbid VARCHAR(16) NOT NULL COMMENT 'meal category id (CBID)',
        mealSlot VARCHAR(32) NOT NULL COMMENT 'meal slot',
        location VARCHAR(255) DEFAULT '' COMMENT 'device/location (JYSBMC)',
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'created at',
        updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'updated at',
        PRIMARY KEY (id),
        UNIQUE KEY uk_externalTxnId (externalTxnId),
        KEY idx_studentNo_occurredAt (studentNo, occurredAt),
        KEY idx_occurredAt (occurredAt)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='cafeteria transactions monthly table (${month})'
    `;
    await prisma.$executeRawUnsafe(sql);

    try {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE \`${tableName}\` MODIFY COLUMN occurredAt DATETIME NOT NULL COMMENT 'transaction time (JYSJ)'`
      );
    } catch {
      // Ignore if it's already DATETIME or permissions are restricted.
    }
  }

  private async ensureOrgTables() {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS org_unit_sync (
        id VARCHAR(191) NOT NULL PRIMARY KEY,
        unitCode VARCHAR(128) NULL,
        unitName VARCHAR(255) NULL,
        parentUnitCode VARCHAR(128) NULL,
        parentUnitName VARCHAR(255) NULL,
        levelCode VARCHAR(64) NULL,
        levelName VARCHAR(128) NULL,
        status VARCHAR(64) NULL,
        rawJson LONGTEXT NULL,
        createdAt DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_org_unit_code (unitCode)
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS org_post_sync (
        id VARCHAR(191) NOT NULL PRIMARY KEY,
        postCode VARCHAR(128) NULL,
        postName VARCHAR(255) NULL,
        unitCode VARCHAR(128) NULL,
        unitName VARCHAR(255) NULL,
        status VARCHAR(64) NULL,
        rawJson LONGTEXT NULL,
        createdAt DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_org_post_code (postCode),
        INDEX idx_org_post_unit_code (unitCode)
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS org_person_relation_sync (
        id VARCHAR(191) NOT NULL PRIMARY KEY,
        employeeNo VARCHAR(64) NULL,
        personName VARCHAR(128) NULL,
        account VARCHAR(128) NULL,
        unitCode VARCHAR(128) NULL,
        unitName VARCHAR(255) NULL,
        postCode VARCHAR(128) NULL,
        postName VARCHAR(255) NULL,
        status VARCHAR(64) NULL,
        rawJson LONGTEXT NULL,
        createdAt DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_org_person_emp_no (employeeNo),
        INDEX idx_org_person_unit_code (unitCode),
        INDEX idx_org_person_post_code (postCode)
      )
    `);
  }

  private async replaceOrgUnits(items: ExternalOrgUnitRecord[]) {
    await this.ensureOrgTables();
    await prisma.$executeRawUnsafe(`DELETE FROM org_unit_sync`);
    if (items.length === 0) return 0;

    const deduplicatedEntries = Array.from(
      new Map(
        items.map((item, index) => [String(item.unitCode ?? item.unitName ?? `row_${index}`), item])
      ).entries()
    );
    const now = new Date();
    for (const chunk of chunkArray(deduplicatedEntries, 500)) {
      const rows = chunk.map(([dedupKey, item]) => ({
        id: crypto.createHash('sha1').update(`unit:${dedupKey}`).digest('hex'),
        unitCode: item.unitCode ?? null,
        unitName: item.unitName ?? null,
        parentUnitCode: item.parentUnitCode ?? null,
        parentUnitName: item.parentUnitName ?? null,
        levelCode: item.levelCode ?? null,
        levelName: item.levelName ?? null,
        status: item.status ?? null,
        rawJson: item.raw ? JSON.stringify(item.raw) : null,
        createdAt: now,
        updatedAt: now,
      }));
      for (const row of rows) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO org_unit_sync (id, unitCode, unitName, parentUnitCode, parentUnitName, levelCode, levelName, status, rawJson, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             unitCode=VALUES(unitCode),
             unitName=VALUES(unitName),
             parentUnitCode=VALUES(parentUnitCode),
             parentUnitName=VALUES(parentUnitName),
             levelCode=VALUES(levelCode),
             levelName=VALUES(levelName),
             status=VALUES(status),
             rawJson=VALUES(rawJson),
             updatedAt=VALUES(updatedAt)`,
          row.id, row.unitCode, row.unitName, row.parentUnitCode, row.parentUnitName,
          row.levelCode, row.levelName, row.status, row.rawJson, row.createdAt, row.updatedAt
        );
      }
    }
    return deduplicatedEntries.length;
  }

  private async replaceOrgPosts(items: ExternalOrgPostRecord[]) {
    await this.ensureOrgTables();
    await prisma.$executeRawUnsafe(`DELETE FROM org_post_sync`);
    if (items.length === 0) return 0;
    const deduplicatedEntries = Array.from(
      new Map(
        items.map((item, index) => [String(item.postCode ?? `${item.postName ?? ''}_${index}`), item])
      ).entries()
    );
    const now = new Date();
    for (const [dedupKey, row] of deduplicatedEntries) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO org_post_sync (id, postCode, postName, unitCode, unitName, status, rawJson, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           postCode=VALUES(postCode),
           postName=VALUES(postName),
           unitCode=VALUES(unitCode),
           unitName=VALUES(unitName),
           status=VALUES(status),
           rawJson=VALUES(rawJson),
           updatedAt=VALUES(updatedAt)`,
        crypto.createHash('sha1').update(`post:${dedupKey}`).digest('hex'),
        row.postCode ?? null,
        row.postName ?? null,
        row.unitCode ?? null,
        row.unitName ?? null,
        row.status ?? null,
        row.raw ? JSON.stringify(row.raw) : null,
        now,
        now
      );
    }
    return deduplicatedEntries.length;
  }

  private async replaceOrgPersonRelations(items: ExternalOrgPersonRelationRecord[]) {
    await this.ensureOrgTables();
    await prisma.$executeRawUnsafe(`DELETE FROM org_person_relation_sync`);
    if (items.length === 0) return 0;
    const deduplicatedEntries = Array.from(
      new Map(
        items.map((item, index) => [String(`${item.employeeNo ?? ''}:${item.unitCode ?? ''}:${item.postCode ?? ''}:${index}`), item])
      ).entries()
    );
    const now = new Date();
    for (const [dedupKey, row] of deduplicatedEntries) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO org_person_relation_sync (id, employeeNo, personName, account, unitCode, unitName, postCode, postName, status, rawJson, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           employeeNo=VALUES(employeeNo),
           personName=VALUES(personName),
           account=VALUES(account),
           unitCode=VALUES(unitCode),
           unitName=VALUES(unitName),
           postCode=VALUES(postCode),
           postName=VALUES(postName),
           status=VALUES(status),
           rawJson=VALUES(rawJson),
           updatedAt=VALUES(updatedAt)`,
        crypto.createHash('sha1').update(`person:${dedupKey}`).digest('hex'),
        row.employeeNo ?? null,
        row.personName ?? null,
        row.account ?? null,
        row.unitCode ?? null,
        row.unitName ?? null,
        row.postCode ?? null,
        row.postName ?? null,
        row.status ?? null,
        row.raw ? JSON.stringify(row.raw) : null,
        now,
        now
      );
    }

    // Best-effort: backfill faculty staff unit fields from personnel relation.
    const updatable = deduplicatedEntries.map(([, item]) => item).filter((item) => item.employeeNo && item.unitName);
    for (const item of updatable) {
      await prisma.facultyStaff.updateMany({
        where: { employeeNo: String(item.employeeNo) },
        data: { unitName: String(item.unitName) },
      });
    }
    return deduplicatedEntries.length;
  }

  private async attachStudentIncrementCursor(inputPayload: SyncRunRequest): Promise<SyncRunRequest> {
    // Full refresh strategy for non-cafeteria datasets: always pull full data and upsert.
    // (Older versions used incrementalCzsj cursors; that is intentionally disabled.)
    return inputPayload;
  }

  private async upsertStudentRowsInChunks(rows: NormalizedStudentRow[]) {
    const chunks = chunkArray(rows, 800);
    for (const chunk of chunks) {
      const now = new Date();
      const placeholders = chunk.map(() => '(UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const sql = `
        INSERT INTO \`Student\`
          (\`id\`, \`studentId\`, \`name\`, \`classCode\`, \`personTypeCode\`, \`isReadingCode\`, \`isRegisteredCode\`, \`genderCode\`, \`departmentName\`, \`updatedAt\`)
        VALUES ${placeholders}
        ON DUPLICATE KEY UPDATE
          \`name\`=VALUES(\`name\`),
          \`classCode\`=VALUES(\`classCode\`),
          \`personTypeCode\`=VALUES(\`personTypeCode\`),
          \`isReadingCode\`=VALUES(\`isReadingCode\`),
          \`isRegisteredCode\`=VALUES(\`isRegisteredCode\`),
          \`genderCode\`=VALUES(\`genderCode\`),
          \`departmentName\`=VALUES(\`departmentName\`),
          \`updatedAt\`=VALUES(\`updatedAt\`)
      `;
      const args: unknown[] = [];
      for (const row of chunk) {
        if (!row.studentId) continue;
        args.push(
          row.studentId,
          row.name,
          row.classCode,
          row.personTypeCode,
          row.isReadingCode,
          row.isRegisteredCode,
          row.genderCode,
          row.departmentName,
          now
        );
      }
      if (args.length > 0) {
        await prisma.$executeRawUnsafe(sql, ...args);
      }
    }
  }


  private async deleteStudentsByIds(studentIds: string[]) {
    if (studentIds.length === 0) {
      return 0;
    }
    let deleted = 0;
    for (const chunk of chunkArray(studentIds, 1000)) {
      await prisma.$transaction([
        prisma.undergraduateDifficultyRecognition.deleteMany({
          where: { studentId: { in: chunk } },
        }),
        prisma.counselorStudentRelation.deleteMany({
          where: { studentId: { in: chunk } },
        }),
        prisma.studentMonthStat.deleteMany({
          where: { studentId: { in: chunk } },
        }),
        prisma.candidateResult.deleteMany({
          where: { studentId: { in: chunk } },
        }),
        prisma.reviewRecord.deleteMany({
          where: { studentId: { in: chunk } },
        }),
        prisma.tagRecord.deleteMany({
          where: { studentId: { in: chunk } },
        }),
        prisma.finalSubsidyResult.deleteMany({
          where: { studentId: { in: chunk } },
        }),
      ]);
      const deleteResult = await prisma.student.deleteMany({
        where: { id: { in: chunk } },
      });
      deleted += deleteResult.count;
    }
    return deleted;
  }
  private async syncStudentsStreaming(jobId: string, incrementalCzsj?: string): Promise<{ imported: number; deleted: number }> {
    let pulled = 0;
    let upserted = 0;
    const seenStudentIds = new Set<string>();
    const reportEveryPages = 5;
    await dataPlatformClient.streamStudentsByScope(
      async (items, pageIndex, totalPages) => {
        if (this.isCancelled(jobId)) {
          throw new Error('任务已被用户取消。');
        }
        pulled += items.length;
        const normalizedStudents = items
          .filter((item) => item.studentId)
          .map((item) => ({
            studentId: String(item.studentId).trim(),
            name: item.name ?? '',
            classCode: item.classCode ?? item.className ?? '',
            personTypeCode: item.personTypeCode ?? '',
            isReadingCode: item.isReadingCode ?? '',
            isRegisteredCode: item.isRegisteredCode ?? '',
            genderCode: item.genderCode ?? '',
            departmentName: item.departmentName ?? item.college ?? '',
          }));
        const deduplicatedMap = new Map<string, NormalizedStudentRow>();
        for (const item of normalizedStudents) {
          const existing = deduplicatedMap.get(item.studentId);
          if (!existing) {
            deduplicatedMap.set(item.studentId, item);
          } else {
            deduplicatedMap.set(item.studentId, mergeStudentRow(existing, item));
          }
        }
        const deduplicatedStudents = Array.from(deduplicatedMap.values());
        for (const row of deduplicatedStudents) {
          seenStudentIds.add(row.studentId);
        }
        await this.upsertStudentRowsInChunks(deduplicatedStudents);
        upserted += deduplicatedStudents.length;

        if (pageIndex === 1 || pageIndex === totalPages || pageIndex % reportEveryPages === 0) {
          await this.updateJobIfRunning(jobId, {
            source: 'jmu_student_basic_api',
            note: `学生基本信息边拉边存：第 ${pageIndex}/${totalPages} 页，已拉取 ${pulled} 条，已写入 ${upserted} 条`,
            delta: `学生 ${upserted}`,
          });
        }
      },
      { incrementalCzsj }
    );

    if (seenStudentIds.size === 0 && !this.allowEmptyFullRefresh) {
      throw new Error('student sync returned empty result (FULL_REFRESH_ALLOW_EMPTY=1 to allow clearing)');
    }
    const existingRows = await prisma.student.findMany({
      select: {
        id: true,
        studentId: true,
      },
    });
    const staleIds = existingRows.filter((item) => !seenStudentIds.has(item.studentId)).map((item) => item.id);
    const deleted = await this.deleteStudentsByIds(staleIds);
    return { imported: upserted, deleted };
  }

  private async bulkUpsertCounselorRelations(
    rows: Array<{
      counselorId: string;
      studentId: string;
      relationType: string;
      effectiveFrom: Date | null;
      effectiveTo: Date | null;
    }>
  ) {
    if (rows.length === 0) {
      return;
    }
    await this.ensureCounselorRelationUpdatedAtDefault();
    const chunks = chunkArray(rows, 1000);
    for (const chunk of chunks) {
      const now = new Date();
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const sql = `
        INSERT INTO \`CounselorStudentRelation\`
          (id, counselorId, studentId, relationType, effectiveFrom, effectiveTo, createdAt, updatedAt)
        VALUES ${placeholders}
        ON DUPLICATE KEY UPDATE
          effectiveFrom = VALUES(effectiveFrom),
          effectiveTo = VALUES(effectiveTo),
          updatedAt = CURRENT_TIMESTAMP
      `;
      const args: unknown[] = [];
      for (const row of chunk) {
        args.push(
          crypto.randomUUID(),
          row.counselorId,
          row.studentId,
          row.relationType,
          row.effectiveFrom,
          row.effectiveTo,
          now,
          now
        );
      }
      await prisma.$executeRawUnsafe(sql, ...args);
    }
  }

  private async ensureCounselorRelationUpdatedAtDefault() {
    try {
      await prisma.$executeRawUnsafe(
        "ALTER TABLE `CounselorStudentRelation` MODIFY COLUMN `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
      );
    } catch {
      // Ignore when permission is limited or schema is already compatible.
    }
  }

  private relationIdentityKey(row: { counselorId: string; studentId: string; relationType: string }) {
    return `${row.counselorId}::${row.studentId}::${row.relationType}`;
  }

  private async applyCounselorRelationDelta(
    desiredRows: Array<{
      counselorId: string;
      studentId: string;
      relationType: string;
      effectiveFrom: Date | null;
      effectiveTo: Date | null;
    }>
  ) {
    const deduplicated = Array.from(
      new Map(desiredRows.map((item) => [this.relationIdentityKey(item), item])).values()
    );
    await this.bulkUpsertCounselorRelations(deduplicated);

    const desiredKeySet = new Set(deduplicated.map((item) => this.relationIdentityKey(item)));
    const existingRows = await prisma.counselorStudentRelation.findMany({
      select: { id: true, counselorId: true, studentId: true, relationType: true },
    });
    const staleIds = existingRows
      .filter((item) => !desiredKeySet.has(this.relationIdentityKey(item)))
      .map((item) => item.id);
    const deleteChunks = chunkArray(staleIds, 1000);
    for (const chunk of deleteChunks) {
      await prisma.counselorStudentRelation.deleteMany({
        where: { id: { in: chunk } },
      });
    }

    return deduplicated.length;
  }

  private async syncCounselorRelationsStreaming(jobId: string): Promise<{ imported: number; skipped: number }> {
    const writeConcurrency = Math.max(1, Number(process.env.SYNC_WRITE_CONCURRENCY) || 4);
    const desiredMap = new Map<
      string,
      {
        counselorId: string;
        studentId: string;
        relationType: string;
        effectiveFrom: Date | null;
        effectiveTo: Date | null;
      }
    >();
    let pulled = 0;
    let skipped = 0;
    const reportEveryPages = 5;

    await dataPlatformClient.streamCounselorRelationsByScope(async (items, pageIndex, totalPages) => {
      if (this.isCancelled(jobId)) {
        throw new Error('任务已被用户取消。');
      }

      pulled += items.length;
      const deduplicatedRelations = Array.from(
        new Map(
          items
            .filter((item) => item.studentId && (item.counselorEmployeeNo || item.counselorName))
            .map((item) => [
              `${item.studentId}::${item.counselorEmployeeNo ?? item.counselorName}::${item.relationType ?? 'student'}`,
              item,
            ])
        ).values()
      );
      const studentNos = Array.from(new Set(deduplicatedRelations.map((item) => item.studentId)));
      const studentRows = studentNos.length
        ? await prisma.student.findMany({
            where: { studentId: { in: studentNos } },
            select: { id: true, studentId: true },
          })
        : [];
      const studentIdMap = new Map(studentRows.map((item) => [item.studentId, item.id]));

      const uniqueCounselors = new Map<string, ExternalCounselorRelationRecord>();
      for (const relation of deduplicatedRelations) {
        const counselorName = relation.counselorName || relation.counselorEmployeeNo || '';
        const counselorKey = relation.counselorEmployeeNo
          ? `employeeNo:${relation.counselorEmployeeNo}`
          : `account:${toSafeAccount(counselorName, relation.counselorEmployeeNo, relation.counselorAccount)}`;
        if (!uniqueCounselors.has(counselorKey)) {
          uniqueCounselors.set(counselorKey, { ...relation, counselorName });
        }
      }
      const counselorIdByKey = await this.syncCounselorsInBulk(Array.from(uniqueCounselors.entries()), writeConcurrency);

      const pageRows: Array<{
        counselorId: string;
        studentId: string;
        relationType: string;
        effectiveFrom: Date | null;
        effectiveTo: Date | null;
      }> = [];
      for (const relation of deduplicatedRelations) {
        const studentRowId = studentIdMap.get(relation.studentId);
        const counselorName = relation.counselorName || relation.counselorEmployeeNo || '';
        const counselorKey = relation.counselorEmployeeNo
          ? `employeeNo:${relation.counselorEmployeeNo}`
          : `account:${toSafeAccount(counselorName, relation.counselorEmployeeNo, relation.counselorAccount)}`;
        const counselorId = counselorIdByKey.get(counselorKey);
        if (!studentRowId || !counselorId) {
          skipped += 1;
          continue;
        }
        const row = {
          counselorId,
          studentId: studentRowId,
          relationType: relation.relationType ?? 'student',
          effectiveFrom: parseDateTime(relation.effectiveFrom) ?? null,
          effectiveTo: parseDateTime(relation.effectiveTo) ?? null,
        };
        desiredMap.set(this.relationIdentityKey(row), row);
        pageRows.push(row);
      }

      await this.bulkUpsertCounselorRelations(pageRows);
      if (pageIndex === 1 || pageIndex === totalPages || pageIndex % reportEveryPages === 0) {
        await this.updateJobIfRunning(jobId, {
          source: 'jmu_counselor_relation_api',
          note: `辅导员关系边拉边存：第 ${pageIndex}/${totalPages} 页，已拉取 ${pulled} 条，当前有效关系 ${desiredMap.size} 条`,
          delta: `关系 ${desiredMap.size}`,
        });
      }
    });

    const imported = await this.applyCounselorRelationDelta(Array.from(desiredMap.values()));
    return { imported, skipped };
  }

  private async refreshCandidateSnapshotCounselors() {
    await prisma.$executeRawUnsafe(`
      UPDATE \`CandidateListSnapshot\` cls
      LEFT JOIN \`Student\` s
        ON s.studentId COLLATE utf8mb4_unicode_ci = cls.studentId COLLATE utf8mb4_unicode_ci
      SET cls.counselor = COALESCE(
        (
          SELECT u.name
          FROM \`CounselorStudentRelation\` csr
          INNER JOIN \`User\` u ON u.id = csr.counselorId
          WHERE csr.studentId = s.id
          ORDER BY csr.updatedAt DESC, csr.createdAt DESC
          LIMIT 1
        ),
        '-'
      ),
      cls.updatedAt = CURRENT_TIMESTAMP
    `);
  }

  private async syncCounselorsInBulk(
    uniqueCounselorList: Array<[string, ExternalCounselorRelationRecord]>,
    writeConcurrency: number
  ) {
    const result = new Map<string, string>();
    if (uniqueCounselorList.length === 0) {
      return result;
    }

    const normalized = uniqueCounselorList.map(([key, item]) => ({
      key,
      employeeNo: item.counselorEmployeeNo ?? null,
      account: toSafeAccount(item.counselorName, item.counselorEmployeeNo, item.counselorAccount),
      name: item.counselorName,
      college: item.college ?? null,
    }));
    const employeeNos = Array.from(new Set(normalized.map((item) => item.employeeNo).filter((item): item is string => !!item)));
    const accounts = Array.from(new Set(normalized.map((item) => item.account).filter(Boolean)));
    const userWhereOr: Array<{ employeeNo?: { in: string[] }; account?: { in: string[] } }> = [];
    if (employeeNos.length > 0) {
      userWhereOr.push({ employeeNo: { in: employeeNos } });
    }
    if (accounts.length > 0) {
      userWhereOr.push({ account: { in: accounts } });
    }
    const existingUsers = userWhereOr.length
      ? await prisma.user.findMany({
          where: { OR: userWhereOr },
          select: {
            id: true,
            employeeNo: true,
            account: true,
            name: true,
            role: true,
            college: true,
            status: true,
          },
        })
      : [];
    const existingByEmployeeNo = new Map(existingUsers.filter((item) => item.employeeNo).map((item) => [item.employeeNo as string, item]));
    const existingByAccount = new Map(existingUsers.map((item) => [item.account, item]));

    const createRows = normalized
      .filter((item) => {
        if (item.employeeNo) {
          return !existingByEmployeeNo.has(item.employeeNo);
        }
        return !existingByAccount.has(item.account);
      })
      .map((item) => ({
        account: item.account,
        employeeNo: item.employeeNo,
        name: item.name,
        role: 'counselor',
        college: item.college,
        status: 'active',
      }));
    const createChunks = chunkArray(createRows, 1000);
    for (const chunk of createChunks) {
      await withWriteConflictRetry(() =>
        prisma.user.createMany({
          data: chunk,
          skipDuplicates: true,
        })
      );
    }

    const refreshedUsers = userWhereOr.length
      ? await prisma.user.findMany({
          where: { OR: userWhereOr },
          select: {
            id: true,
            employeeNo: true,
            account: true,
            name: true,
            role: true,
            college: true,
            status: true,
          },
        })
      : [];
    const refreshedByEmployeeNo = new Map(
      refreshedUsers.filter((item) => item.employeeNo).map((item) => [item.employeeNo as string, item])
    );
    const refreshedByAccount = new Map(refreshedUsers.map((item) => [item.account, item]));

    const usersToUpdate = normalized
      .map((item) => {
        const existing = item.employeeNo ? refreshedByEmployeeNo.get(item.employeeNo) : refreshedByAccount.get(item.account);
        if (!existing) return null;
        const nextCollege = item.college;
        const needsUpdate =
          existing.account !== item.account ||
          existing.name !== item.name ||
          existing.role !== 'counselor' ||
          existing.status !== 'active' ||
          (nextCollege != null && existing.college !== nextCollege);
        if (!needsUpdate) {
          return null;
        }
        return { item, userId: existing.id };
      })
      .filter((item): item is { item: (typeof normalized)[number]; userId: string } => item !== null);
    await mapWithConcurrency(usersToUpdate, Math.max(1, writeConcurrency), async ({ item, userId }) => {
      await withWriteConflictRetry(() =>
        prisma.user.update({
          where: { id: userId },
          data: {
            account: item.account,
            employeeNo: item.employeeNo ?? undefined,
            name: item.name,
            role: 'counselor',
            college: item.college ?? undefined,
            status: 'active',
          },
        })
      );
    });

    for (const item of normalized) {
      const row = item.employeeNo ? refreshedByEmployeeNo.get(item.employeeNo) : refreshedByAccount.get(item.account);
      if (row) {
        result.set(item.key, row.id);
      }
    }

    return result;
  }
}

export const dataSyncRepository = new DataSyncRepository();


