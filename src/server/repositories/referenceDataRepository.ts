import { prisma } from '@/src/server/db/client';
import { candidateRepository } from '@/src/server/repositories/candidateRepository';
import { ACTIVE_STATUS_CODES, EXCLUDED_PERSON_TYPE_CODES, activeStudentWhere } from '@/src/server/repositories/studentScope';
import { formatDateTimeMinuteInTimeZone, getDateTimePartsInTimeZone } from '@/src/server/time';
import type {
  BatchSummary,
  DictionaryItemRecord,
  DictionaryListResponse,
  DictionaryTypeRecord,
  DashboardAnalyticsResponse,
  DashboardResponse,
  DashboardSummaryResponse,
  LoginRoleOption,
  RolePermissionRecord,
  CollegeAdminListResponse,
  AuditReviewerSettingsResponse,
  StaffLookupItem,
  UserRoleListResponse,
  SystemRoleListResponse,
  CounselorLookupItem,
  SubsidyRecord,
  SyncJobRecord,
  SystemConfig,
} from '@/src/types';

function normalizeSyncSource(source: string) {
  const normalized = (source ?? '').trim();
  if (!normalized) return normalized;
  return normalized.endsWith('_api') ? normalized.slice(0, -4) : normalized;
}

function isInternalSchedulerSource(source: string) {
  return String(source ?? '').trim().startsWith('system_');
}

function normalizeMojibakeText(input: string) {
  let text = String(input ?? '').trim();
  if (!text) return text;

  const replacements: Array<[string, string]> = [
    ['绯荤粺', '系统'],
    ['瀛︾敓澶勭粓瀹', '学生处终审'],
    ['瀛︾敓澶勯€氳繃', '学生处通过'],
    ['瀛︾敓澶勯┏鍥', '学生处驳回'],
    ['瀛﹂櫌瀹℃牳', '学院审核'],
    ['瀛﹂櫌閫氳繃', '学院通过'],
    ['瀛﹂櫌椹冲洖', '学院驳回'],
    ['杈呭鍛樼‘璁', '辅导员确认'],
    ['杈呭鍛橀€氳繃', '辅导员通过'],
    ['杈呭鍛橀┏鍥', '辅导员驳回'],
    ['瀛﹂櫌绠＄悊鍛榒', '学院管理员'],
  ];

  for (const [from, to] of replacements) {
    text = text.replaceAll(from, to);
  }

  if (text.includes('杈') || text.includes('鍛')) {
    if (text.includes('杈')) return '辅导员';
  }
  if (text.includes('瀛') && (text.includes('櫌') || text.includes('绠') || text.includes('悊'))) {
    return '学院管理员';
  }
  if (text.includes('澶') || text.includes('勭') || text.includes('敓')) {
    if (text.includes('瀛')) return '学生处管理员';
  }
  if (text.includes('绯')) {
    return '系统管理员';
  }

  return text;
}

function formatDate(value: Date) {
  const p = getDateTimePartsInTimeZone(value);
  return `${p.year}-${p.month}-${p.day}`;
}

function formatDateTime(value: Date) {
  return formatDateTimeMinuteInTimeZone(value);
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

function parseMonthFromTableName(tableName: string) {
  const match = (tableName ?? '').toLowerCase().match(/^card_transaction_(\d{6})$/);
  if (!match) return '';
  const raw = match[1];
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}`;
}

type SubsidyStandardSnapshot = {
  month: string;
  percentile: number;
  sampleCount: number;
  breakfastStandard: number;
  lunchDinnerStandard: number;
  computedAt: number;
};

type DashboardCacheEntry<T> = {
  expiresAt: number;
  value: T;
};

type DashboardContext = {
  id: string;
  role: string;
  college?: string | null;
  canFundingOfficeReview?: boolean;
  canFinalReview?: boolean;
};

let cachedStandards: SubsidyStandardSnapshot | null = null;
const dashboardSummaryCache = new Map<string, DashboardCacheEntry<DashboardSummaryResponse>>();
const dashboardAnalyticsCache = new Map<string, DashboardCacheEntry<DashboardAnalyticsResponse>>();
const DASHBOARD_SUMMARY_CACHE_TTL_MS = 30 * 1000;
const DASHBOARD_ANALYTICS_CACHE_TTL_MS = 5 * 60 * 1000;

let defaultDictionaryTypesEnsuredOnce: Promise<void> | null = null;
let defaultDifficultyDictionaryEnsuredOnce: Promise<void> | null = null;
const EXCLUDED_COLLEGE_FOR_ADMIN_ASSIGNMENT = new Set([
  '诚毅学院',
  '船员培训中心',
  '海外教育学院',
  '集美大学库克项目',
  '继续教育学院',
  '马克思主义学院',
]);
const AUDIT_REVIEWER_STAGES = new Set(['college', 'funding_office', 'student_affairs']);

function isTransientDatabaseConnectionError(error: unknown) {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('Server has closed the connection') ||
    message.includes('ECONNRESET') ||
    message.includes('ETIMEDOUT') ||
    message.includes('Connection terminated unexpectedly')
  );
}

async function retryOnTransientDatabaseConnectionError<T>(
  operation: () => Promise<T>,
  options?: { maxRetries?: number; retryDelayMs?: number }
) {
  const maxRetries = Math.max(0, Math.floor(options?.maxRetries ?? 2));
  const retryDelayMs = Math.max(0, Math.floor(options?.retryDelayMs ?? 200));

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientDatabaseConnectionError(error) || attempt >= maxRetries) {
        throw error;
      }
      if (retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }
  throw lastError;
}

function daysInMonth(month: string) {
  const match = (month ?? '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return 30;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11) return 30;
  return new Date(year, monthIndex + 1, 0).getDate();
}

function monthToTableName(month: string) {
  const compact = (month ?? '').replace('-', '');
  if (!/^\d{6}$/.test(compact)) return '';
  return `card_transaction_${compact}`;
}

function toNumber(value: { toString(): string } | number | null | undefined) {
  if (value == null) {
    return 0;
  }

  return typeof value === 'number' ? value : Number(value.toString());
}

function roundAmount(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toAmount(value: { toString(): string } | number | null | undefined) {
  return roundAmount(toNumber(value));
}

function toPercentDisplay(value: number) {
  return Number((value * 100).toFixed(2));
}

function toCurrencyDisplay(value: number) {
  return `¥${roundAmount(value).toFixed(1)}`;
}

function percentileValue(values: number[], percentile: number) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const p = Math.min(1, Math.max(0, percentile));
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1));
  return roundAmount(sorted[index] ?? 0);
}

function studentCollege(value: { departmentName: string }) {
  return value.departmentName || '-';
}

function isSpecialDifficultyLevel(level: string | null | undefined) {
  const raw = (level ?? '').trim();
  if (!raw) {
    return false;
  }
  const normalized = raw.toLowerCase();
  if (normalized.includes('鐗瑰埆') || normalized.includes('鐗瑰洶') || normalized.includes('special')) {
    return true;
  }
  return /^0*1$/.test(normalized);
}

const loginRoles: LoginRoleOption[] = [
  { id: 'student_affairs', label: '学生处管理员', description: '查看全校业务数据并执行终审' },
  { id: 'college_admin', label: '学院管理员', description: '审核本学院候选名单与驳回记录' },
  { id: 'counselor', label: '辅导员', description: '确认所带班级学生资助需求' },
  { id: 'admin', label: '系统管理员', description: '维护角色、参数与同步配置' },
];

const defaultDifficultyDictionary: DictionaryItemRecord[] = [
  { code: '1', label: '特别困难', isSpecialDifficulty: true, sortOrder: 10, enabled: true, description: '系统默认' },
  { code: '3', label: '困难', isSpecialDifficulty: false, sortOrder: 20, enabled: true, description: '系统默认' },
  { code: '21', label: '一般困难', isSpecialDifficulty: false, sortOrder: 30, enabled: true, description: '系统默认' },
];

const defaultDictionaryTypes: DictionaryTypeRecord[] = [
  {
    dictType: 'difficulty_level',
    label: '困难等级',
    description: '本科生困难认定等级字典',
    sortOrder: 10,
    enabled: true,
  },
];

function roleLabel(role: string) {
  if (role === 'admin') return '系统管理员';
  if (role === 'student_affairs') return '学生处管理员';
  if (role === 'college_admin') return '学院管理员';
  return '辅导员';
}

function dashboardContextCacheKey(context?: DashboardContext) {
  const role = String(context?.role ?? '').trim() || 'anonymous';
  const id = String(context?.id ?? '').trim() || '-';
  const college = String(context?.college ?? '').trim() || '-';
  const canFundingOfficeReview = context?.canFundingOfficeReview ? '1' : '0';
  const canFinalReview = context?.canFinalReview ? '1' : '0';
  return [role, id, college, canFundingOfficeReview, canFinalReview].join(':');
}

function getCachedValue<T>(cache: Map<string, DashboardCacheEntry<T>>, key: string) {
  const cached = cache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return cached.value;
}

function setCachedValue<T>(cache: Map<string, DashboardCacheEntry<T>>, key: string, value: T, ttlMs: number) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

export class ReferenceDataRepository {
  private async getDashboardBaseData(context?: DashboardContext) {
    const safe = <T>(operation: () => Promise<T>) =>
      retryOnTransientDatabaseConnectionError(operation, { maxRetries: 2, retryDelayMs: 200 });

    const [specialDifficultyStudents, reviewTasks, batches] = await Promise.all([
      safe(() => this.countSpecialDifficultyStudents()),
      safe(() => prisma.reviewRecord.findMany({ orderBy: { reviewedAt: 'desc' }, take: 200 })),
      safe(() => prisma.subsidyBatch.findMany({ orderBy: { month: 'desc' }, take: 12 })),
    ]);
    const systemConfig = await safe(() => prisma.systemConfig.findUnique({ where: { id: 1 } }));
    const standardPercentile = Math.min(1, Math.max(0.01, systemConfig?.standardPercentile ?? 0.25));

    const tableRows = await safe(() =>
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>("SHOW TABLES LIKE 'card_transaction_%'")
    );
    const tableNames = tableRows
      .map((row) => Object.values(row)[0])
      .filter((value): value is string => typeof value === 'string')
      .sort();
    const latestTransactionTable = tableNames.at(-1) ?? '';
    const snapshotMonth = latestTransactionTable ? parseMonthFromTableName(latestTransactionTable) : '';

    let sampleCount = 0;
    let breakfastStandard = 0;
    let lunchDinnerStandard = 0;
    if (snapshotMonth) {
      const activePlaceholders = ACTIVE_STATUS_CODES.map(() => '?').join(', ');
      const excludedPlaceholders = EXCLUDED_PERSON_TYPE_CODES.map(() => '?').join(', ');
      const batch = await safe(() => prisma.subsidyBatch.findUnique({ where: { month: snapshotMonth } }));
      const batchId = batch?.id ?? null;
      if (batchId) {
        await safe(() => this.ensureStudentMonthStats(batchId, snapshotMonth));
      }
      const sourceSql = batchId
        ? `
        WITH per_student AS (
          SELECT
            CASE WHEN sms.breakfastCount > 0 THEN sms.breakfastAvg ELSE NULL END AS breakfastAvg,
            CASE WHEN sms.lunchDinnerCount > 0 THEN sms.lunchDinnerAvg ELSE NULL END AS lunchDinnerAvg
          FROM \`StudentMonthStat\` sms
          WHERE sms.month = ?
            AND sms.batchId = ?
        )
        `
        : `
        WITH per_student AS (
          SELECT
            ct.studentNo,
            CASE
              WHEN COUNT(DISTINCT CASE WHEN ct.mealSlot = 'breakfast' THEN DATE(ct.occurredAt) END) = 0 THEN NULL
              ELSE SUM(CASE WHEN ct.mealSlot = 'breakfast' THEN ct.amount ELSE 0 END)
                / COUNT(DISTINCT CASE WHEN ct.mealSlot = 'breakfast' THEN DATE(ct.occurredAt) END)
            END AS breakfastAvg,
            CASE
              WHEN (
                COUNT(DISTINCT CASE
                  WHEN ct.mealSlot = 'lunch' OR (ct.mealSlot = 'lunch_dinner' AND HOUR(ct.occurredAt) >= 10 AND HOUR(ct.occurredAt) < 15)
                  THEN DATE(ct.occurredAt)
                END)
                + COUNT(DISTINCT CASE
                  WHEN ct.mealSlot IN ('dinner', 'night', 'night_snack', 'supper', 'late_night')
                    OR (ct.mealSlot = 'lunch_dinner' AND NOT (HOUR(ct.occurredAt) >= 10 AND HOUR(ct.occurredAt) < 15))
                  THEN DATE(ct.occurredAt)
                END)
              ) = 0 THEN NULL
              ELSE (
                SUM(CASE WHEN ct.mealSlot = 'lunch' OR (ct.mealSlot = 'lunch_dinner' AND HOUR(ct.occurredAt) >= 10 AND HOUR(ct.occurredAt) < 15) THEN ct.amount ELSE 0 END)
                + SUM(CASE
                  WHEN ct.mealSlot IN ('dinner', 'night', 'night_snack', 'supper', 'late_night')
                    OR (ct.mealSlot = 'lunch_dinner' AND NOT (HOUR(ct.occurredAt) >= 10 AND HOUR(ct.occurredAt) < 15))
                  THEN ct.amount ELSE 0 END)
              ) / (
                COUNT(DISTINCT CASE
                  WHEN ct.mealSlot = 'lunch' OR (ct.mealSlot = 'lunch_dinner' AND HOUR(ct.occurredAt) >= 10 AND HOUR(ct.occurredAt) < 15)
                  THEN DATE(ct.occurredAt)
                END)
                + COUNT(DISTINCT CASE
                  WHEN ct.mealSlot IN ('dinner', 'night', 'night_snack', 'supper', 'late_night')
                    OR (ct.mealSlot = 'lunch_dinner' AND NOT (HOUR(ct.occurredAt) >= 10 AND HOUR(ct.occurredAt) < 15))
                  THEN DATE(ct.occurredAt)
                END)
              )
            END AS lunchDinnerAvg
          FROM \`${latestTransactionTable}\` ct
	          INNER JOIN \`Student\` s
	            ON s.studentId COLLATE utf8mb4_unicode_ci = ct.studentNo COLLATE utf8mb4_unicode_ci
          WHERE ct.amount > 0
            AND ct.mealSlot IN ('breakfast', 'lunch', 'dinner', 'lunch_dinner', 'night', 'night_snack', 'supper', 'late_night')
            AND s.isReadingCode IN (${activePlaceholders})
            AND s.isRegisteredCode IN (${activePlaceholders})
            AND s.personTypeCode NOT IN (${excludedPlaceholders})
          GROUP BY ct.studentNo
        )
        `;

      const sql = `
        ${sourceSql}
        SELECT
          (
            SELECT value
            FROM (
              SELECT
                breakfastAvg AS value,
                ROW_NUMBER() OVER (ORDER BY breakfastAvg) AS rn,
                COUNT(*) OVER () AS cnt
              FROM per_student
              WHERE breakfastAvg IS NOT NULL
            ) ranked
            WHERE rn = GREATEST(1, CEIL(cnt * CAST(? AS DECIMAL(10, 6))))
            LIMIT 1
          ) AS breakfastStandard,
          (
            SELECT value
            FROM (
              SELECT
                lunchDinnerAvg AS value,
                ROW_NUMBER() OVER (ORDER BY lunchDinnerAvg) AS rn,
                COUNT(*) OVER () AS cnt
              FROM per_student
              WHERE lunchDinnerAvg IS NOT NULL
            ) ranked
            WHERE rn = GREATEST(1, CEIL(cnt * CAST(? AS DECIMAL(10, 6))))
            LIMIT 1
          ) AS lunchDinnerStandard,
          (SELECT COUNT(*) FROM per_student) AS sampleCount
      `;
      const params = batchId
        ? [snapshotMonth, batchId, standardPercentile, standardPercentile]
        : [
            ...ACTIVE_STATUS_CODES,
            ...ACTIVE_STATUS_CODES,
            ...EXCLUDED_PERSON_TYPE_CODES,
            standardPercentile,
            standardPercentile,
          ];

      const rows = await safe(() => prisma.$queryRawUnsafe<
        Array<{ breakfastStandard: unknown; lunchDinnerStandard: unknown; sampleCount: unknown }>
      >(sql, ...params));
      sampleCount = toNumber(rows[0]?.sampleCount);
      breakfastStandard = toNumber(rows[0]?.breakfastStandard);
      lunchDinnerStandard = toNumber(rows[0]?.lunchDinnerStandard);
      cachedStandards = {
        month: snapshotMonth,
        percentile: standardPercentile,
        sampleCount,
        breakfastStandard,
        lunchDinnerStandard,
        computedAt: Date.now(),
      };
    }

    const candidateScopeWhere = this.buildCandidateScopeWhere(context);
    return {
      safe,
      specialDifficultyStudents,
      reviewTasks,
      batches,
      snapshotMonth,
      sampleCount,
      breakfastStandard,
      lunchDinnerStandard,
      candidateScopeWhere,
    };
  }

  private async buildDashboardSummaryFromBase(
    baseData: Awaited<ReturnType<ReferenceDataRepository['getDashboardBaseData']>>,
    context?: DashboardContext
  ): Promise<DashboardSummaryResponse> {
    const { safe, specialDifficultyStudents, reviewTasks, snapshotMonth, sampleCount, breakfastStandard, lunchDinnerStandard, candidateScopeWhere } = baseData;
    let candidateStudentCount = 0;
    if (snapshotMonth) {
      const batch = await safe(() => prisma.subsidyBatch.findUnique({ where: { month: snapshotMonth } }));
      if (batch) {
        candidateStudentCount = await safe(() => prisma.candidateResult.count({
          where: {
            month: snapshotMonth,
            batchId: batch.id,
            ...candidateScopeWhere,
          },
        }));
      } else {
        candidateStudentCount = await safe(() => prisma.candidateResult.count({
          where: {
            month: snapshotMonth,
            ...candidateScopeWhere,
          },
        }));
      }
    }

    const dashboardBatch = snapshotMonth
      ? await safe(() => prisma.subsidyBatch.findUnique({ where: { month: snapshotMonth } }))
      : null;
    const dashboardBatchId = dashboardBatch?.id ?? null;
    const role = String(context?.role ?? '').trim();
    const pendingStatusByRole: Record<string, string[]> = {
      counselor: ['pending_counselor'],
      college_admin: ['pending_college'],
      student_affairs: ['pending_final'],
      admin: ['pending_counselor', 'pending_college', 'pending_funding_office', 'pending_final'],
    };
    const overdueStatusByRole: Record<string, string[]> = {
      counselor: ['pending_counselor', 'counselor_overdue'],
      college_admin: ['pending_counselor', 'pending_college', 'counselor_overdue', 'college_overdue'],
      student_affairs: [
        'pending_counselor',
        'pending_college',
        'pending_funding_office',
        'pending_final',
        'counselor_overdue',
        'college_overdue',
        'funding_office_overdue',
        'final_overdue',
      ],
      admin: [
        'pending_counselor',
        'pending_college',
        'pending_funding_office',
        'pending_final',
        'counselor_overdue',
        'college_overdue',
        'funding_office_overdue',
        'final_overdue',
      ],
    };
    const pendingStatuses = pendingStatusByRole[role] ?? ['pending_counselor', 'pending_college', 'pending_funding_office', 'pending_final'];
    const overdueStatuses = overdueStatusByRole[role] ?? ['counselor_overdue', 'college_overdue', 'funding_office_overdue', 'final_overdue'];
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [subsidySum, selectedCount, pendingCount, overdueCount] = await Promise.all([
      safe(() =>
        prisma.finalSubsidyResult.aggregate({
          where: dashboardBatchId
            ? {
                batchId: dashboardBatchId,
                selected: true,
                finalDecision: 'included',
              }
            : undefined,
          _sum: { totalSubsidy: true },
        })
      ),
      dashboardBatchId
        ? safe(() =>
            prisma.finalSubsidyResult.count({
              where: {
                batchId: dashboardBatchId,
                selected: true,
                finalDecision: 'included',
              },
            })
          )
        : 0,
      dashboardBatchId && snapshotMonth
        ? safe(() =>
            prisma.candidateResult.count({
              where: {
                workflowStatus: {
                  in: pendingStatuses,
                },
                ...candidateScopeWhere,
              },
            })
          )
        : 0,
      safe(() =>
        prisma.candidateResult.count({
          where: {
            ...candidateScopeWhere,
            workflowStatus: {
              in: overdueStatuses,
            },
            batch: {
              startTime: {
                lte: sevenDaysAgo,
              },
            },
          },
        })
      ),
    ]);

    const totalSubsidy = toNumber(subsidySum._sum.totalSubsidy);
    const sampleText = `${sampleCount} 人样本`;

    return {
      stats: [
        { name: '特别困难学生人数', value: specialDifficultyStudents.toLocaleString('zh-CN'), change: '来自困难认定', icon: 'users', color: 'text-blue-600', bg: 'bg-blue-50' },
        { name: '候选学生人数', value: candidateStudentCount.toLocaleString('zh-CN'), change: `${snapshotMonth || '-'} 消费分析`, icon: 'users', color: 'text-indigo-600', bg: 'bg-indigo-50' },
        { name: '早餐补助标准', value: toCurrencyDisplay(breakfastStandard), change: sampleText, icon: 'trend', color: 'text-emerald-600', bg: 'bg-emerald-50' },
        { name: '午晚餐补助标准', value: toCurrencyDisplay(lunchDinnerStandard), change: sampleText, icon: 'trend', color: 'text-emerald-600', bg: 'bg-emerald-50' },
        { name: '本月补助总额', value: `¥${totalSubsidy.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, change: `发放 ${selectedCount} 人`, icon: 'trend', color: 'text-blue-600', bg: 'bg-blue-50' },
        { name: '逾期 / 待处理', value: `${overdueCount} / ${pendingCount}`, change: '来自实时库统计', icon: 'alert', color: 'text-red-600', bg: 'bg-red-50' },
      ],
      activities: reviewTasks.map((item) => ({
        user: normalizeMojibakeText(item.reviewerName ?? '系统'),
        action: normalizeMojibakeText(item.comment ?? item.resultLabel),
        time: formatDateTime(item.reviewedAt),
        type:
          item.stage === 'counselor'
            ? 'confirm'
            : item.stage === 'college'
              ? 'audit'
              : item.stage === 'student_affairs'
                ? 'final'
              : 'system',
      })),
    };
  }

  private async buildDashboardAnalyticsFromBase(
    baseData: Awaited<ReturnType<ReferenceDataRepository['getDashboardBaseData']>>
  ): Promise<DashboardAnalyticsResponse> {
    const { batches, candidateScopeWhere } = baseData;
    return {
      trends: await this.buildDashboardTrends(batches, candidateScopeWhere),
      consumptionAnalytics: await this.buildConsumptionAnalytics(batches, candidateScopeWhere),
    };
  }

  async ensureAuditReviewerAssignmentTable() {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS audit_reviewer_assignment (
        id VARCHAR(191) NOT NULL PRIMARY KEY,
        stage VARCHAR(64) NOT NULL,
        college VARCHAR(255) NULL,
        userId VARCHAR(191) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'active',
        createdAt DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
        updatedAt DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0),
        INDEX idx_audit_reviewer_stage_status (stage, status),
        INDEX idx_audit_reviewer_college (college),
        UNIQUE KEY uk_audit_reviewer_stage_user_college (stage, userId, college)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  }

  async listAuditReviewerSettings(): Promise<AuditReviewerSettingsResponse> {
    await this.ensureAuditReviewerAssignmentTable();
    const [collegeRows, rows] = await Promise.all([
      prisma.student.findMany({
        select: { departmentName: true },
        where: { departmentName: { not: '' } },
        distinct: ['departmentName'],
      }),
      prisma.$queryRawUnsafe<Array<{
        id: string; stage: string; college: string | null; userId: string; status: string;
        account: string; employeeNo: string | null; name: string;
      }>>(
        `SELECT a.id, a.stage, a.college, a.userId, a.status, u.account, u.employeeNo, u.name
           FROM audit_reviewer_assignment a
           JOIN \`User\` u ON BINARY u.id = BINARY a.userId
          WHERE BINARY a.status = BINARY 'active'
          ORDER BY a.stage ASC, a.college ASC, u.employeeNo ASC`
      ),
    ]);
    const colleges = Array.from(
      new Set(
        collegeRows
          .map((row) => String(row.departmentName ?? '').trim())
          .filter((college) => college && !EXCLUDED_COLLEGE_FOR_ADMIN_ASSIGNMENT.has(college))
      )
    ).sort((a, b) => a.localeCompare(b, 'zh-CN'));

    const mapped = rows.map((item) => ({
      id: item.id,
      stage: item.stage as 'college' | 'funding_office' | 'student_affairs',
      college: item.college,
      userId: item.userId,
      account: item.account,
      employeeNo: item.employeeNo ?? item.account,
      name: item.name,
      status: item.status,
    }));

    // Backward compatibility: derive display fallback from legacy user roles,
    // and use fallback per-stage when that stage has no configured rows.
    {
      const [collegeAdmins, studentAffairsUsers, fundingOfficeRelations, finalReviewerRelations] = await Promise.all([
        prisma.user.findMany({
          where: { role: 'college_admin', status: 'active' },
          select: { id: true, account: true, employeeNo: true, name: true, college: true, status: true },
          orderBy: [{ college: 'asc' }, { employeeNo: 'asc' }, { account: 'asc' }],
        }),
        prisma.user.findMany({
          where: { role: 'student_affairs', status: 'active' },
          select: { id: true, account: true, employeeNo: true, name: true, status: true },
          orderBy: [{ employeeNo: 'asc' }, { account: 'asc' }],
        }),
        prisma.$queryRawUnsafe<Array<{ employeeNo: string | null }>>(
          `SELECT DISTINCT employeeNo FROM org_person_relation_sync WHERE BINARY unitCode = BINARY '00000090'`
        ),
        prisma.$queryRawUnsafe<Array<{ employeeNo: string | null }>>(
          `SELECT DISTINCT employeeNo
             FROM org_person_relation_sync
            WHERE BINARY unitCode = BINARY '00000009'
              AND postName LIKE '%部长%'`
        ),
      ]);

      const fundingOfficeEmployeeNos = new Set(
        fundingOfficeRelations.map((item) => String(item.employeeNo ?? '').trim()).filter(Boolean)
      );
      const finalReviewerEmployeeNos = new Set(
        finalReviewerRelations.map((item) => String(item.employeeNo ?? '').trim()).filter(Boolean)
      );
      const allFallbackEmployeeNos = Array.from(
        new Set(
          [...collegeAdmins, ...studentAffairsUsers]
            .map((item) => String(item.employeeNo ?? '').trim())
            .filter(Boolean)
        )
      );
      const staffRows = allFallbackEmployeeNos.length
        ? await prisma.facultyStaff.findMany({
            where: { employeeNo: { in: allFallbackEmployeeNos } },
            select: { employeeNo: true, name: true },
          })
        : [];
      const staffNameByEmployeeNo = new Map(
        staffRows
          .map((item) => [String(item.employeeNo ?? '').trim(), String(item.name ?? '').trim()] as const)
          .filter(([employeeNo, name]) => employeeNo.length > 0 && name.length > 0)
      );
      const displayName = (user: { employeeNo: string | null; account: string; name: string }) => {
        const employeeNo = String(user.employeeNo ?? '').trim();
        const account = String(user.account ?? '').trim();
        const rawName = String(user.name ?? '').trim();
        const staffName = employeeNo ? staffNameByEmployeeNo.get(employeeNo) ?? '' : '';
        if (staffName) return staffName;
        if (!rawName) return employeeNo || account || '-';
        if (rawName === employeeNo || rawName === account) return employeeNo || account || '-';
        return rawName;
      };

      const fallbackCollegeReviewers = collegeAdmins
        .filter((item) => {
          const c = String(item.college ?? '').trim();
          return c && !EXCLUDED_COLLEGE_FOR_ADMIN_ASSIGNMENT.has(c);
        })
        .map((item) => ({
          id: `fallback:college:${item.id}`,
          stage: 'college' as const,
          college: String(item.college ?? '').trim(),
          userId: item.id,
          account: item.account,
          employeeNo: item.employeeNo ?? item.account,
          name: displayName(item),
          status: item.status,
        }));

      const fallbackFundingOfficeReviewers = studentAffairsUsers
        .filter((item) => {
          const no = String(item.employeeNo ?? '').trim();
          return no && fundingOfficeEmployeeNos.has(no);
        })
        .map((item) => ({
          id: `fallback:funding:${item.id}`,
          stage: 'funding_office' as const,
          college: null,
          userId: item.id,
          account: item.account,
          employeeNo: item.employeeNo ?? item.account,
          name: displayName(item),
          status: item.status,
        }));

      const fallbackFinalReviewers = studentAffairsUsers
        .filter((item) => {
          const no = String(item.employeeNo ?? '').trim();
          return no && finalReviewerEmployeeNos.has(no);
        })
        .map((item) => ({
          id: `fallback:final:${item.id}`,
          stage: 'student_affairs' as const,
          college: null,
          userId: item.id,
          account: item.account,
          employeeNo: item.employeeNo ?? item.account,
          name: displayName(item),
          status: item.status,
        }));

      const configuredCollegeReviewers = mapped.filter((item) => item.stage === 'college');
      const configuredFundingOfficeReviewers = mapped.filter((item) => item.stage === 'funding_office');
      const configuredFinalReviewers = mapped.filter((item) => item.stage === 'student_affairs');
      const mergeByKey = <T extends { stage: string; employeeNo: string; college?: string | null }>(items: T[]) => {
        const byKey = new Map<string, T>();
        for (const item of items) {
          const key = `${item.stage}:${String(item.employeeNo ?? '').trim()}:${String(item.college ?? '').trim()}`;
          if (!byKey.has(key)) byKey.set(key, item);
        }
        return Array.from(byKey.values());
      };

      return {
        colleges,
        collegeReviewers: mergeByKey([...configuredCollegeReviewers, ...fallbackCollegeReviewers]),
        fundingOfficeReviewers: mergeByKey([...configuredFundingOfficeReviewers, ...fallbackFundingOfficeReviewers]),
        finalReviewers: mergeByKey([...configuredFinalReviewers, ...fallbackFinalReviewers]),
      };
    }
  }

  async upsertAuditReviewer(
    payload: { stage: string; employeeNo: string; name?: string; college?: string },
    operator?: { role?: string }
  ) {
    await this.ensureAuditReviewerAssignmentTable();
    const stage = String(payload.stage ?? '').trim();
    const employeeNo = String(payload.employeeNo ?? '').trim();
    const college = String(payload.college ?? '').trim();
    if (!AUDIT_REVIEWER_STAGES.has(stage)) throw new Error('invalid stage');
    if (!employeeNo) throw new Error('employeeNo is required');
    if (stage === 'student_affairs' && String(operator?.role ?? '').trim() !== 'admin') {
      throw new Error('仅系统管理员可配置学生处终审审核人');
    }
    if (stage === 'college' && !college) throw new Error('college is required for college reviewer');

    const staff = await prisma.facultyStaff.findUnique({ where: { employeeNo }, select: { name: true } });
    const user = await prisma.user.findFirst({
      where: { OR: [{ employeeNo }, { account: employeeNo }] },
      select: { id: true, account: true, employeeNo: true, name: true, status: true },
    });
    if (!user) throw new Error('user not found');
    if (String(user.status ?? '').toLowerCase() === 'inactive') throw new Error('user is inactive');

    const reviewerName = String(payload.name ?? '').trim() || String(staff?.name ?? '').trim() || user.name || employeeNo;
    if (reviewerName && reviewerName !== user.name) {
      await prisma.user.update({ where: { id: user.id }, data: { name: reviewerName } });
    }

    await prisma.$executeRawUnsafe(
      `INSERT INTO audit_reviewer_assignment (id, stage, college, userId, status, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, 'active', NOW(), NOW())
       ON DUPLICATE KEY UPDATE status='active', updatedAt=NOW()`,
      `${stage}:${college || '_'}:${user.id}`,
      stage,
      stage === 'college' ? college : null,
      user.id
    );
  }

  async deleteAuditReviewer(id: string, operator?: { role?: string }) {
    await this.ensureAuditReviewerAssignmentTable();
    const normalizedId = String(id ?? '').trim();
    if (!normalizedId) throw new Error('id is required');
    if (normalizedId.startsWith('fallback:')) {
      const segments = normalizedId.split(':');
      const scope = segments[1] ?? '';
      const userId = segments[2] ?? '';
      if (!userId) throw new Error('assignment not found');
      const targetUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, college: true, status: true },
      });
      if (!targetUser) throw new Error('user not found');
      if (scope === 'college') {
        await prisma.user.update({
          where: { id: userId },
          data: { role: 'counselor', college: null },
        });
        return;
      }
      if (scope === 'funding') {
        // Legacy fallback entry: remove funding-office capability by setting inactive
        // only when the user is not a system admin.
        if (targetUser.role === 'admin') throw new Error('不能移除系统管理员');
        await prisma.user.update({
          where: { id: userId },
          data: { status: 'inactive' },
        });
        return;
      }
      if (scope === 'final') {
        if (String(operator?.role ?? '').trim() !== 'admin') {
          throw new Error('仅系统管理员可移除学生处终审审核人');
        }
        if (targetUser.role === 'admin') throw new Error('不能移除系统管理员');
        await prisma.user.update({
          where: { id: userId },
          data: { status: 'inactive' },
        });
        return;
      }
      throw new Error('assignment not found');
    }
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; stage: string }>>(
      'SELECT id, stage FROM audit_reviewer_assignment WHERE BINARY id = BINARY ? LIMIT 1',
      normalizedId
    );
    const existing = rows[0];
    if (!existing) throw new Error('assignment not found');
    if (existing.stage === 'student_affairs' && String(operator?.role ?? '').trim() !== 'admin') {
      throw new Error('仅系统管理员可移除学生处终审审核人');
    }
    await prisma.$executeRawUnsafe('DELETE FROM audit_reviewer_assignment WHERE BINARY id = BINARY ?', normalizedId);
  }

  async resolveAuditReviewerCapabilities(employeeNo: string, college?: string | null) {
    await this.ensureAuditReviewerAssignmentTable();
    const normalizedEmployeeNo = String(employeeNo ?? '').trim();
    if (!normalizedEmployeeNo) return { isCollegeReviewer: false, canFundingOfficeReview: false, canFinalReview: false };
    const rows = await prisma.$queryRawUnsafe<Array<{ stage: string; college: string | null }>>(
      `SELECT a.stage, a.college
         FROM audit_reviewer_assignment a
         JOIN \`User\` u ON BINARY u.id = BINARY a.userId
        WHERE BINARY a.status = BINARY 'active' AND (BINARY u.employeeNo = BINARY ? OR BINARY u.account = BINARY ?)`,
      normalizedEmployeeNo,
      normalizedEmployeeNo
    );
    const normalizedCollege = String(college ?? '').trim();
    const isCollegeReviewer = rows.some((row) => row.stage === 'college' && String(row.college ?? '').trim() === normalizedCollege);
    const canFundingOfficeReview = rows.some((row) => row.stage === 'funding_office');
    const canFinalReview = rows.some((row) => row.stage === 'student_affairs');
    return { isCollegeReviewer, canFundingOfficeReview, canFinalReview };
  }
  private buildCandidateScopeWhere(context?: DashboardContext) {
    const role = String(context?.role ?? '').trim();
    if (!role || role === 'admin' || role === 'student_affairs') {
      return {};
    }

    if (role === 'counselor') {
      const counselorId = String(context?.id ?? '').trim();
      if (!counselorId) return { studentId: { in: ['__NO_MATCH__'] } };
      return {
        student: {
          relations: {
            some: {
              counselorId,
            },
          },
        },
      };
    }

    if (role === 'college_admin') {
      const college = String(context?.college ?? '').trim();
      if (!college) return { studentId: { in: ['__NO_MATCH__'] } };
      return {
        student: {
          departmentName: college,
        },
      };
    }

    return { studentId: { in: ['__NO_MATCH__'] } };
  }

  async lookupStaffByEmployeeNo(keyword: string): Promise<StaffLookupItem[]> {
    const normalized = String(keyword ?? '').trim();
    if (!normalized) return [];
    const rows = await prisma.facultyStaff.findMany({
      where: {
        OR: [
          { employeeNo: { contains: normalized } },
          { name: { contains: normalized } },
        ],
      },
      select: {
        employeeNo: true,
        name: true,
      },
      take: 20,
      orderBy: [{ employeeNo: 'asc' }, { name: 'asc' }],
    });
    return rows.map((item) => ({
      employeeNo: item.employeeNo,
      name: String(item.name ?? '').trim() || item.employeeNo,
    }));
  }

  async lookupCounselors(keyword: string): Promise<CounselorLookupItem[]> {
    const normalized = String(keyword ?? '').trim();
    if (!normalized || normalized.length < 1) return [];
    const rows = await prisma.user.findMany({
      where: {
        role: 'counselor',
        OR: [
          { employeeNo: { contains: normalized } },
          { name: { contains: normalized } },
        ],
      },
      select: {
        employeeNo: true,
        name: true,
      },
      take: 20,
      orderBy: [{ employeeNo: 'asc' }, { name: 'asc' }],
    });
    const employeeNos = Array.from(
      new Set(rows.map((item) => String(item.employeeNo ?? '').trim()).filter(Boolean))
    );
    const staffRows = employeeNos.length
      ? await prisma.facultyStaff.findMany({
          where: { employeeNo: { in: employeeNos } },
          select: { employeeNo: true, name: true },
        })
      : [];
    const staffNameByEmployeeNo = new Map(
      staffRows
        .map((item) => [String(item.employeeNo ?? '').trim(), String(item.name ?? '').trim()] as const)
        .filter(([employeeNo, name]) => employeeNo.length > 0 && name.length > 0)
    );

    const deduped = new Map<string, CounselorLookupItem>();
    for (const item of rows) {
      const employeeNo = String(item.employeeNo ?? '').trim();
      if (!employeeNo || deduped.has(employeeNo)) continue;
      const userName = String(item.name ?? '').trim();
      const staffName = staffNameByEmployeeNo.get(employeeNo) ?? '';
      deduped.set(employeeNo, {
        employeeNo,
        name: staffName || userName || employeeNo,
      });
    }

    return Array.from(deduped.values());
  }

  private async ensureStudentMonthStats(batchId: string, month: string) {
    const tableName = monthToTableName(month);
    if (!tableName) return { created: 0 };

    const tableRows = await prisma.$queryRawUnsafe<Array<{ TABLE_NAME: string }>>(
      `
        SELECT TABLE_NAME
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND LOWER(TABLE_NAME) = LOWER(?)
        LIMIT 1
      `,
      tableName
    );
    if (tableRows.length === 0) {
      return { created: 0 };
    }
    const actualTableName = tableRows[0].TABLE_NAME;

    const existingCount = await prisma.studentMonthStat.count({ where: { batchId, month } });
    if (existingCount > 0) {
      return { created: 0 };
    }

    const monthDays = daysInMonth(month);
    const activePlaceholders = ACTIVE_STATUS_CODES.map(() => '?').join(', ');
    const excludedPlaceholders = EXCLUDED_PERSON_TYPE_CODES.map(() => '?').join(', ');
    const sql = `
      SELECT
        s.id AS studentId,
        COUNT(DISTINCT CASE WHEN ct.mealSlot = 'breakfast' THEN DATE(ct.occurredAt) END) AS breakfastCount,
        COALESCE(SUM(CASE WHEN ct.mealSlot = 'breakfast' THEN ct.amount ELSE 0 END), 0) AS breakfastTotal,
        COALESCE(
          SUM(CASE WHEN ct.mealSlot = 'breakfast' THEN ct.amount ELSE 0 END)
            / NULLIF(COUNT(DISTINCT CASE WHEN ct.mealSlot = 'breakfast' THEN DATE(ct.occurredAt) END), 0),
          0
        ) AS breakfastAvg,
        (
          COUNT(DISTINCT CASE
            WHEN ct.mealSlot = 'lunch' OR (ct.mealSlot = 'lunch_dinner' AND HOUR(ct.occurredAt) >= 10 AND HOUR(ct.occurredAt) < 15)
            THEN DATE(ct.occurredAt)
          END)
          + COUNT(DISTINCT CASE
            WHEN ct.mealSlot IN ('dinner', 'night', 'night_snack', 'supper', 'late_night')
              OR (ct.mealSlot = 'lunch_dinner' AND NOT (HOUR(ct.occurredAt) >= 10 AND HOUR(ct.occurredAt) < 15))
            THEN DATE(ct.occurredAt)
          END)
        ) AS lunchDinnerCount,
        COALESCE(
          SUM(CASE WHEN ct.mealSlot = 'lunch' OR (ct.mealSlot = 'lunch_dinner' AND HOUR(ct.occurredAt) >= 10 AND HOUR(ct.occurredAt) < 15) THEN ct.amount ELSE 0 END)
          + SUM(CASE
            WHEN ct.mealSlot IN ('dinner', 'night', 'night_snack', 'supper', 'late_night')
              OR (ct.mealSlot = 'lunch_dinner' AND NOT (HOUR(ct.occurredAt) >= 10 AND HOUR(ct.occurredAt) < 15))
            THEN ct.amount ELSE 0 END),
          0
        ) AS lunchDinnerTotal,
        COALESCE(
          (
            SUM(CASE WHEN ct.mealSlot = 'lunch' OR (ct.mealSlot = 'lunch_dinner' AND HOUR(ct.occurredAt) >= 10 AND HOUR(ct.occurredAt) < 15) THEN ct.amount ELSE 0 END)
            + SUM(CASE
              WHEN ct.mealSlot IN ('dinner', 'night', 'night_snack', 'supper', 'late_night')
                OR (ct.mealSlot = 'lunch_dinner' AND NOT (HOUR(ct.occurredAt) >= 10 AND HOUR(ct.occurredAt) < 15))
              THEN ct.amount ELSE 0 END)
          ) / NULLIF(
            COUNT(DISTINCT CASE
              WHEN ct.mealSlot = 'lunch' OR (ct.mealSlot = 'lunch_dinner' AND HOUR(ct.occurredAt) >= 10 AND HOUR(ct.occurredAt) < 15)
              THEN DATE(ct.occurredAt)
            END)
            + COUNT(DISTINCT CASE
              WHEN ct.mealSlot IN ('dinner', 'night', 'night_snack', 'supper', 'late_night')
                OR (ct.mealSlot = 'lunch_dinner' AND NOT (HOUR(ct.occurredAt) >= 10 AND HOUR(ct.occurredAt) < 15))
              THEN DATE(ct.occurredAt)
            END),
            0
          ),
          0
        ) AS lunchDinnerAvg,
        COUNT(DISTINCT DATE(ct.occurredAt)) AS daysCount,
        COALESCE(SUM(ct.amount), 0) AS totalAmount
      FROM \`${actualTableName}\` ct
      INNER JOIN \`Student\` s
        ON s.studentId COLLATE utf8mb4_unicode_ci = ct.studentNo COLLATE utf8mb4_unicode_ci
      WHERE ct.amount > 0
        AND ct.mealSlot IN ('breakfast', 'lunch', 'dinner', 'lunch_dinner', 'night', 'night_snack', 'supper', 'late_night')
        AND s.isReadingCode IN (${activePlaceholders})
        AND s.isRegisteredCode IN (${activePlaceholders})
        AND s.personTypeCode NOT IN (${excludedPlaceholders})
      GROUP BY s.id
    `;

    const rows = await prisma.$queryRawUnsafe<
      Array<{
        studentId: string;
        breakfastCount: unknown;
        breakfastTotal: unknown;
        breakfastAvg: unknown;
        lunchDinnerCount: unknown;
        lunchDinnerTotal: unknown;
        lunchDinnerAvg: unknown;
        daysCount: unknown;
        totalAmount: unknown;
      }>
    >(
      sql,
      ...ACTIVE_STATUS_CODES,
      ...ACTIVE_STATUS_CODES,
      ...EXCLUDED_PERSON_TYPE_CODES
    );

    await prisma.studentMonthStat.deleteMany({ where: { batchId, month } });

    let created = 0;
    for (let i = 0; i < rows.length; i += 1000) {
      const chunk = rows.slice(i, i + 1000);
      await prisma.studentMonthStat.createMany({
        data: chunk.map((row) => ({
          batchId,
          studentId: row.studentId,
          month,
          breakfastCount: Math.max(0, Math.floor(toNumber(row.breakfastCount))),
          breakfastTotal: toNumber(row.breakfastTotal),
          breakfastAvg: toNumber(row.breakfastAvg),
          lunchDinnerCount: Math.max(0, Math.floor(toNumber(row.lunchDinnerCount))),
          lunchDinnerTotal: toNumber(row.lunchDinnerTotal),
          lunchDinnerAvg: toNumber(row.lunchDinnerAvg),
          daysCount: Math.max(0, Math.floor(toNumber(row.daysCount))),
          attendanceDays: monthDays,
          totalAmount: toNumber(row.totalAmount),
        })),
      });
      created += chunk.length;
    }

    return { created };
  }

  private async countSpecialDifficultyStudents() {
    await this.ensureDefaultDifficultyDictionary();

    const activeStatusPlaceholders = ACTIVE_STATUS_CODES.map(() => '?').join(', ');
    const excludedPersonPlaceholders = EXCLUDED_PERSON_TYPE_CODES.map(() => '?').join(', ');
    const args = [...ACTIVE_STATUS_CODES, ...ACTIVE_STATUS_CODES, ...EXCLUDED_PERSON_TYPE_CODES];

    const rows = await prisma.$queryRawUnsafe<Array<{ cnt: unknown }>>(
      `
        SELECT COUNT(*) AS cnt
        FROM \`UndergraduateDifficultyRecognition\` udr
        INNER JOIN \`Student\` s ON s.id = udr.studentId
        INNER JOIN (
          SELECT
            udr2.startAcademicYear,
            udr2.endAcademicYear,
            udr2.semester
          FROM \`UndergraduateDifficultyRecognition\` udr2
          INNER JOIN \`Student\` s2 ON s2.id = udr2.studentId
          WHERE s2.isReadingCode IN (${activeStatusPlaceholders})
            AND s2.isRegisteredCode IN (${activeStatusPlaceholders})
            AND s2.personTypeCode NOT IN (${excludedPersonPlaceholders})
          ORDER BY
            CAST(udr2.startAcademicYear AS UNSIGNED) DESC,
            CAST(udr2.endAcademicYear AS UNSIGNED) DESC,
            CAST(udr2.semester AS UNSIGNED) DESC
          LIMIT 1
        ) currentTerm
          ON currentTerm.startAcademicYear = udr.startAcademicYear
         AND currentTerm.endAcademicYear = udr.endAcademicYear
         AND currentTerm.semester = udr.semester
        INNER JOIN \`DictionaryItem\` di
          ON di.dictType = 'difficulty_level'
         AND di.enabled = true
         AND di.isSpecialDifficulty = true
         AND di.code = TRIM(udr.difficultyLevel)
        WHERE s.isReadingCode IN (${activeStatusPlaceholders})
          AND s.isRegisteredCode IN (${activeStatusPlaceholders})
          AND s.personTypeCode NOT IN (${excludedPersonPlaceholders})
      `
      ,
      ...args,
      ...args
    );

    return toNumber(rows[0]?.cnt ?? 0);
  }

  private async ensureDefaultDictionaryTypes() {
    if (defaultDictionaryTypesEnsuredOnce) {
      await defaultDictionaryTypesEnsuredOnce;
      return;
    }

    defaultDictionaryTypesEnsuredOnce = (async () => {
      await retryOnTransientDatabaseConnectionError(
        async () => {
          await prisma.dictionaryType.createMany({
            data: defaultDictionaryTypes.map((item) => ({
              dictType: item.dictType,
              label: item.label,
              description: item.description,
              sortOrder: item.sortOrder,
              enabled: item.enabled,
            })),
            skipDuplicates: true,
          });
        },
        { maxRetries: 2, retryDelayMs: 200 }
      );
    })();

    try {
      await defaultDictionaryTypesEnsuredOnce;
    } catch (error) {
      defaultDictionaryTypesEnsuredOnce = null;
      throw error;
    }
  }

  private async ensureDefaultDifficultyDictionary() {
    if (defaultDifficultyDictionaryEnsuredOnce) {
      await defaultDifficultyDictionaryEnsuredOnce;
      return;
    }

    defaultDifficultyDictionaryEnsuredOnce = (async () => {
      await this.ensureDefaultDictionaryTypes();
      await retryOnTransientDatabaseConnectionError(
        async () => {
          await prisma.dictionaryItem.createMany({
            data: defaultDifficultyDictionary.map((item) => ({
              dictType: 'difficulty_level',
              code: item.code,
              label: item.label,
              isSpecialDifficulty: item.isSpecialDifficulty,
              sortOrder: item.sortOrder,
              enabled: item.enabled,
              description: item.description,
            })),
            skipDuplicates: true,
          });
        },
        { maxRetries: 2, retryDelayMs: 200 }
      );
    })();

    try {
      await defaultDifficultyDictionaryEnsuredOnce;
    } catch (error) {
      defaultDifficultyDictionaryEnsuredOnce = null;
      throw error;
    }
  }

  async listDictionaryTypes(): Promise<DictionaryTypeRecord[]> {
    await this.ensureDefaultDictionaryTypes();
    const rows = await prisma.dictionaryType.findMany({
      orderBy: [{ sortOrder: 'asc' }, { dictType: 'asc' }],
    });
    return rows.map((item) => ({
      dictType: item.dictType,
      label: item.label,
      description: item.description || '',
      sortOrder: item.sortOrder,
      enabled: item.enabled,
    }));
  }

  async upsertDictionaryType(input: DictionaryTypeRecord): Promise<DictionaryTypeRecord> {
    const dictType = (input.dictType ?? '').trim();
    if (!dictType) {
      throw new Error('dictType is required');
    }
    const label = (input.label ?? '').trim();
    if (!label) {
      throw new Error('label is required');
    }

    const saved = await prisma.dictionaryType.upsert({
      where: { dictType },
      create: {
        dictType,
        label,
        description: (input.description ?? '').trim(),
        sortOrder: Number.isFinite(input.sortOrder) ? Math.floor(input.sortOrder) : 0,
        enabled: Boolean(input.enabled),
      },
      update: {
        label,
        description: (input.description ?? '').trim(),
        sortOrder: Number.isFinite(input.sortOrder) ? Math.floor(input.sortOrder) : 0,
        enabled: Boolean(input.enabled),
      },
    });

    return {
      dictType: saved.dictType,
      label: saved.label,
      description: saved.description || '',
      sortOrder: saved.sortOrder,
      enabled: saved.enabled,
    };
  }

  async deleteDictionaryType(dictType: string) {
    const normalizedType = (dictType ?? '').trim();
    if (!normalizedType) {
      throw new Error('dictType is required');
    }

    if (normalizedType === 'difficulty_level') {
      throw new Error('difficulty_level is a system dictionary and cannot be deleted');
    }

    const [removedItems, removedTypes] = await prisma.$transaction([
      prisma.dictionaryItem.deleteMany({ where: { dictType: normalizedType } }),
      prisma.dictionaryType.deleteMany({ where: { dictType: normalizedType } }),
    ]);

    return {
      removedItems: removedItems.count,
      removedTypes: removedTypes.count,
    };
  }

  async listDictionaryItems(dictType: string): Promise<DictionaryListResponse> {
    const normalizedType = (dictType ?? '').trim();
    if (!normalizedType) {
      throw new Error('dictType is required');
    }

    if (normalizedType === 'difficulty_level') {
      await this.ensureDefaultDifficultyDictionary();
    }

    const rows = await prisma.dictionaryItem.findMany({
      where: { dictType: normalizedType },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });

    return {
      dictType: normalizedType,
      items: rows.map((item) => ({
        code: item.code,
        label: item.label,
        isSpecialDifficulty: item.isSpecialDifficulty,
        sortOrder: item.sortOrder,
        enabled: item.enabled,
        description: item.description || '',
      })),
    };
  }

  async saveDictionaryItems(dictType: string, items: DictionaryItemRecord[]): Promise<DictionaryListResponse> {
    const normalizedType = (dictType ?? '').trim();
    if (!normalizedType) {
      throw new Error('dictType is required');
    }
    await prisma.dictionaryType.upsert({
      where: { dictType: normalizedType },
      create: {
        dictType: normalizedType,
        label: normalizedType,
        description: '',
        sortOrder: 999,
        enabled: true,
      },
      update: {},
    });

    const normalized = (items ?? [])
      .map((item) => ({
        code: (item.code ?? '').trim(),
        label: (item.label ?? '').trim(),
        isSpecialDifficulty: Boolean(item.isSpecialDifficulty),
        sortOrder: Number.isFinite(item.sortOrder) ? Math.floor(item.sortOrder) : 0,
        enabled: Boolean(item.enabled),
        description: (item.description ?? '').trim(),
      }))
      .filter((item) => item.code && item.label);

    const uniqueByCode = new Map<string, (typeof normalized)[number]>();
    for (const item of normalized) {
      uniqueByCode.set(item.code, item);
    }
    const finalItems = Array.from(uniqueByCode.values()).sort((a, b) => (a.sortOrder - b.sortOrder) || a.code.localeCompare(b.code));

    await prisma.$transaction([
      prisma.dictionaryItem.deleteMany({
        where: {
          dictType: normalizedType,
        },
      }),
      ...(finalItems.length > 0
        ? [
            prisma.dictionaryItem.createMany({
              data: finalItems.map((item) => ({
                dictType: normalizedType,
                code: item.code,
                label: item.label,
                isSpecialDifficulty: item.isSpecialDifficulty,
                sortOrder: item.sortOrder,
                enabled: item.enabled,
                description: item.description,
              })),
            }),
          ]
        : []),
    ]);

    return this.listDictionaryItems(normalizedType);
  }

  async getDashboardData(context?: DashboardContext): Promise<DashboardResponse> {
    const [summary, analytics] = await Promise.all([
      this.getDashboardSummary(context),
      this.getDashboardAnalytics(context),
    ]);

    return {
      stats: summary.stats,
      activities: summary.activities,
      trends: analytics.trends,
      consumptionAnalytics: analytics.consumptionAnalytics,
    };
  }

  async getDashboardSummary(context?: DashboardContext): Promise<DashboardSummaryResponse> {
    const cacheKey = dashboardContextCacheKey(context);
    const cached = getCachedValue(dashboardSummaryCache, cacheKey);
    if (cached) {
      return cached;
    }

    const baseData = await this.getDashboardBaseData(context);
    const summary = await this.buildDashboardSummaryFromBase(baseData, context);
    setCachedValue(dashboardSummaryCache, cacheKey, summary, DASHBOARD_SUMMARY_CACHE_TTL_MS);
    return summary;
  }

  async getDashboardAnalytics(context?: DashboardContext): Promise<DashboardAnalyticsResponse> {
    const cacheKey = dashboardContextCacheKey(context);
    const cached = getCachedValue(dashboardAnalyticsCache, cacheKey);
    if (cached) {
      return cached;
    }

    const baseData = await this.getDashboardBaseData(context);
    const analytics = await this.buildDashboardAnalyticsFromBase(baseData);
    setCachedValue(dashboardAnalyticsCache, cacheKey, analytics, DASHBOARD_ANALYTICS_CACHE_TTL_MS);
    return analytics;
  }

  private async buildDashboardTrends(
    batches: Array<{ id: string; month: string }>,
    candidateScopeWhere: ReturnType<ReferenceDataRepository['buildCandidateScopeWhere']>
  ) {
    if (!Array.isArray(batches) || batches.length === 0) {
      return [];
    }

    const ordered = [...batches].sort((a, b) => a.month.localeCompare(b.month));
    const months = ordered.map((b) => b.month);
    const batchIds = ordered.map((b) => b.id);

    const [candidateCounts, subsidyRows] = await Promise.all([
      prisma.candidateResult.groupBy({
        by: ['month'],
        where: {
          month: {
            in: months,
          },
          ...candidateScopeWhere,
        },
        _count: { _all: true },
      }),
      prisma.finalSubsidyResult.findMany({
        where: {
          batchId: {
            in: batchIds,
          },
          student: (candidateScopeWhere as { student?: object }).student as object | undefined,
        },
        select: {
          batchId: true,
          totalSubsidy: true,
        },
      }),
    ]);

    const candidateCountByMonth = new Map(candidateCounts.map((row) => [row.month, row._count._all]));
    const subsidySumByBatchId = new Map<string, number>();
    for (const row of subsidyRows) {
      subsidySumByBatchId.set(
        row.batchId,
        roundAmount((subsidySumByBatchId.get(row.batchId) ?? 0) + toNumber(row.totalSubsidy))
      );
    }

    return ordered.map((batch) => ({
      name: `${Number(batch.month.slice(5))}月`,
      students: candidateCountByMonth.get(batch.month) ?? 0,
      amount: roundAmount(subsidySumByBatchId.get(batch.id) ?? 0),
    }));
  }

  private async buildConsumptionAnalytics(
    batches: Array<{ id: string; month: string }>,
    candidateScopeWhere: ReturnType<ReferenceDataRepository['buildCandidateScopeWhere']>
  ) {
    if (!Array.isArray(batches) || batches.length === 0) {
      return { series: [], latest: null };
    }

    const ordered = [...batches].sort((a, b) => a.month.localeCompare(b.month));
    for (const batch of ordered) {
      await this.ensureStudentMonthStats(batch.id, batch.month);
    }

    const stats = await prisma.studentMonthStat.findMany({
      where: {
        batchId: { in: ordered.map((item) => item.id) },
        student: (candidateScopeWhere as { student?: object }).student as object | undefined,
      },
      select: {
        month: true,
        breakfastCount: true,
        breakfastAvg: true,
        lunchDinnerCount: true,
        lunchDinnerAvg: true,
        totalAmount: true,
        daysCount: true,
        attendanceDays: true,
      },
      orderBy: [{ month: 'asc' }],
    });

    const statsByMonth = new Map<
      string,
      Array<{
        breakfastCount: number;
        breakfastAvg: number;
        lunchDinnerCount: number;
        lunchDinnerAvg: number;
        totalAmount: number;
        daysCount: number;
        attendanceDays: number;
      }>
    >();

    for (const row of stats) {
      const month = row.month;
      const bucket = statsByMonth.get(month) ?? [];
      bucket.push({
        breakfastCount: Math.max(0, Number(row.breakfastCount ?? 0)),
        breakfastAvg: toAmount(row.breakfastAvg),
        lunchDinnerCount: Math.max(0, Number(row.lunchDinnerCount ?? 0)),
        lunchDinnerAvg: toAmount(row.lunchDinnerAvg),
        totalAmount: toAmount(row.totalAmount),
        daysCount: Math.max(0, Number(row.daysCount ?? 0)),
        attendanceDays: Math.max(0, Number(row.attendanceDays ?? 0)),
      });
      statsByMonth.set(month, bucket);
    }

    const series = ordered.map((batch) => {
      const rows = statsByMonth.get(batch.month) ?? [];
      const activeStudents = rows.length;
      const breakfastRows = rows.filter((item) => item.breakfastCount > 0);
      const lunchDinnerRows = rows.filter((item) => item.lunchDinnerCount > 0);
      const breakfastValues = breakfastRows.map((item) => item.breakfastAvg).filter((item) => item > 0);
      const lunchDinnerValues = lunchDinnerRows.map((item) => item.lunchDinnerAvg).filter((item) => item > 0);
      const totalAvg =
        activeStudents > 0 ? roundAmount(rows.reduce((sum, item) => sum + item.totalAmount, 0) / activeStudents) : 0;
      const daysAvg =
        activeStudents > 0 ? roundAmount(rows.reduce((sum, item) => sum + item.daysCount, 0) / activeStudents) : 0;
      const attendanceDaysAvg =
        activeStudents > 0 ? roundAmount(rows.reduce((sum, item) => sum + item.attendanceDays, 0) / activeStudents) : 0;

      return {
        month: batch.month,
        name: `${Number(batch.month.slice(5))}月`,
        activeStudents,
        breakfastStudents: breakfastRows.length,
        lunchDinnerStudents: lunchDinnerRows.length,
        breakfastParticipationRate: activeStudents > 0 ? roundAmount(breakfastRows.length / activeStudents) : 0,
        lunchDinnerParticipationRate: activeStudents > 0 ? roundAmount(lunchDinnerRows.length / activeStudents) : 0,
        breakfastP25: percentileValue(breakfastValues, 0.25),
        breakfastP50: percentileValue(breakfastValues, 0.5),
        breakfastAvg:
          breakfastValues.length > 0 ? roundAmount(breakfastValues.reduce((sum, item) => sum + item, 0) / breakfastValues.length) : 0,
        lunchDinnerP25: percentileValue(lunchDinnerValues, 0.25),
        lunchDinnerP50: percentileValue(lunchDinnerValues, 0.5),
        lunchDinnerAvg:
          lunchDinnerValues.length > 0 ? roundAmount(lunchDinnerValues.reduce((sum, item) => sum + item, 0) / lunchDinnerValues.length) : 0,
        totalAvg,
        daysAvg,
        attendanceDaysAvg,
      };
    });

    const latest = series.at(-1)
      ? {
          latestMonth: series[series.length - 1].month,
          sampleStudents: series[series.length - 1].activeStudents,
          breakfastParticipationRate: series[series.length - 1].breakfastParticipationRate,
          lunchDinnerParticipationRate: series[series.length - 1].lunchDinnerParticipationRate,
          breakfastP25: series[series.length - 1].breakfastP25,
          breakfastP50: series[series.length - 1].breakfastP50,
          breakfastAvg: series[series.length - 1].breakfastAvg,
          lunchDinnerP25: series[series.length - 1].lunchDinnerP25,
          lunchDinnerP50: series[series.length - 1].lunchDinnerP50,
          lunchDinnerAvg: series[series.length - 1].lunchDinnerAvg,
          totalAvg: series[series.length - 1].totalAvg,
          daysAvg: series[series.length - 1].daysAvg,
          attendanceDaysAvg: series[series.length - 1].attendanceDaysAvg,
        }
      : null;

    return { series, latest };
  }

  async listBatches(): Promise<BatchSummary[]> {
    const [batches, candidateResults] = await Promise.all([
      prisma.subsidyBatch.findMany({ orderBy: { month: 'desc' } }),
      prisma.candidateResult.findMany(),
    ]);

    return batches.map((batch) => {
      const batchItems = candidateResults.filter((item) => item.batchId === batch.id);
      const confirmed = batchItems.filter((item) => !item.workflowStatus.startsWith('pending')).length;

      return {
        id: batch.id,
        month: batch.month,
        status: batch.status as never,
        progress: batch.progress,
        startTime: formatDate(batch.startTime),
        endTime: batch.endTime ? formatDate(batch.endTime) : undefined,
        stats: {
          total: batchItems.length,
          confirmed,
          pending: Math.max(batchItems.length - confirmed, 0),
        },
      };
    });
  }

  async listAuditTasks(context?: { id: string; role: string; college?: string | null }) {
    return candidateRepository.listReviewTasks(context);
  }

  async listSubsidyRecords(month?: string): Promise<SubsidyRecord[]> {
    const results = await prisma.finalSubsidyResult.findMany({
      where: {
        selected: true,
        finalDecision: 'included',
        ...(month ? { batch: { month } } : {}),
      },
      include: {
        student: true,
      },
      orderBy: [{ totalSubsidy: 'desc' }, { studentId: 'asc' }],
    });

    return results.map((item) => ({
      id: item.student.studentId,
      name: item.student.name,
      college: studentCollege(item.student),
      className: item.student.classCode || '-',
      breakfast: toAmount(item.breakfastSubsidy),
      lunchDinner: toAmount(item.lunchDinnerSubsidy),
      total: toAmount(item.totalSubsidy),
      status: 'approved',
    }));
  }

  async listSyncJobs(): Promise<SyncJobRecord[]> {
    const jobs = await prisma.syncJob.findMany({
      where: {
        NOT: {
          source: {
            startsWith: 'system_',
          },
        },
      },
    });

    // Keep only the latest row for each logical sync task to avoid duplicate cards in UI.
    // Use source (not name) as the stable key so renaming won't create a new card.
    const latestByTask = new Map<string, (typeof jobs)[number]>();
    for (const job of jobs) {
      const key = normalizeSyncSource(job.source);
      const current = latestByTask.get(key);
      if (!current) {
        latestByTask.set(key, job);
        continue;
      }

      // Prefer numeric job id ordering ("sync-<epochMs>") to avoid mixing records created when
      // different timezone strategies were used for createdAt/updatedAt.
      const jobId = job.id.startsWith('sync-') ? Number(job.id.slice(5)) : Number.NaN;
      const currentId = current.id.startsWith('sync-') ? Number(current.id.slice(5)) : Number.NaN;
      if (Number.isFinite(jobId) && Number.isFinite(currentId)) {
        if (jobId > currentId) {
          latestByTask.set(key, job);
        }
        continue;
      }

      // Fallback to createdAt if ids are not comparable.
      if (job.createdAt.getTime() > current.createdAt.getTime()) {
        latestByTask.set(key, job);
      }
    }

    const normalizeDelta = (value: string | null | undefined) => {
      const text = (value ?? '').trim();
      if (!text) return '-';
      if (text === 'running') return '运行中';
      if (text === 'aborted') return '已中止';
      if (text === 'cancelled') return '已取消';
      if (text === 'failed') return '澶辫触';
      if (text === 'success') return '鎴愬姛';
      return text;
    };

    return Array.from(latestByTask.values()).map((job) => ({
      id: job.id,
      name: job.name,
      // Normalize source so UI can match stable keys (e.g. strip "_api" suffix).
      source: normalizeSyncSource(job.source),
      frequency: job.frequency ?? '-',
      lastRun: job.lastRunAt ? formatDateTime(job.lastRunAt) : '-',
      status: job.status as never,
      delta: normalizeDelta(job.delta),
      // Always show something useful in remarks: prefer stored note, otherwise show last-run summary.
      note:
        (job.note && job.note.trim()) ||
        (job.lastRunAt
          ? `上次执行：${formatDateTime(job.lastRunAt)}；状态：${job.status ?? '-'}；增量：${normalizeDelta(job.delta)}`
          : '-'),
    }));
  }

  async listTagRecords() {
    return candidateRepository.listTagRecords();
  }

  async listRolePermissions(): Promise<RolePermissionRecord[]> {
    const [permissions, users] = await Promise.all([
      prisma.rolePermission.findMany({ orderBy: [{ role: 'asc' }, { permission: 'asc' }] }),
      prisma.user.findMany(),
    ]);

    const grouped = new Map<string, RolePermissionRecord>();

    for (const permission of permissions) {
      const current = grouped.get(permission.role);
      if (current) {
        current.permissions.push(permission.permission);
        continue;
      }

      const label = roleLabel(permission.role);

      grouped.set(permission.role, {
        role: label,
        dataScope: permission.dataScope,
        members: users.filter((item) => item.role === permission.role).length,
        permissions: [permission.permission],
      });
    }

    return Array.from(grouped.values());
  }

  async listSystemRoleMembers(): Promise<SystemRoleListResponse> {
    const users = await prisma.user.findMany({
      where: {
        role: { in: ['admin', 'student_affairs', 'college_admin', 'counselor'] },
      },
      orderBy: [{ role: 'asc' }, { college: 'asc' }, { employeeNo: 'asc' }, { account: 'asc' }],
      select: {
        id: true,
        account: true,
        employeeNo: true,
        name: true,
        role: true,
        college: true,
        status: true,
      },
    });

    const roleOrder = ['admin', 'student_affairs', 'college_admin', 'counselor'] as const;
    return {
      items: roleOrder.map((role) => ({
        role,
        roleLabel: roleLabel(role),
        members: users
          .filter((user) => user.role === role)
          .map((user) => ({
            userId: user.id,
            account: user.account,
            employeeNo: user.employeeNo ?? user.account,
            name: user.name,
            role: user.role as never,
            college: user.college,
            status: user.status,
          })),
      })),
    };
  }

  async upsertSystemRoleMember(
    payload: {
    role: string;
    employeeNo: string;
    name: string;
    account?: string;
    college?: string;
  },
    operator?: { role?: string }
  ) {
    const role = String(payload.role ?? '').trim();
    const employeeNo = String(payload.employeeNo ?? '').trim();
    const name = String(payload.name ?? '').trim();
    const account = String(payload.account ?? '').trim() || employeeNo;
    const college = String(payload.college ?? '').trim() || null;
    if (!['admin', 'student_affairs', 'college_admin', 'counselor'].includes(role)) throw new Error('invalid role');
    if (role === 'admin' && String(operator?.role ?? '').trim() !== 'admin') {
      throw new Error('仅系统管理员可授予系统管理员角色');
    }
    if (!employeeNo) throw new Error('employeeNo is required');
    if (!name) throw new Error('name is required');
    if (role === 'college_admin' && !college) throw new Error('college is required for college_admin');

    const existing = await prisma.user.findFirst({
      where: { OR: [{ employeeNo }, { account }] },
      select: { id: true },
    });

    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          account,
          employeeNo,
          name,
          role,
          college: role === 'college_admin' ? college : null,
          status: 'active',
        },
      });
      return;
    }

    await prisma.user.create({
      data: {
        account,
        employeeNo,
        name,
        role,
        college: role === 'college_admin' ? college : null,
        status: 'active',
      },
    });
  }

  async deleteSystemRoleMember(userId: string) {
    const id = String(userId ?? '').trim();
    if (!id) throw new Error('userId is required');
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw new Error('user not found');
    await prisma.user.delete({ where: { id } });
  }

  async listUserRoles(
    page = 1,
    pageSize = 20,
    filters?: { role?: string; unitOrCollege?: string; keyword?: string }
  ): Promise<UserRoleListResponse> {
    const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
    const safePageSize = Number.isFinite(pageSize) ? Math.max(1, Math.min(200, Math.floor(pageSize))) : 20;
    const roleFilter = String(filters?.role ?? '').trim();
    const unitOrCollegeFilter = String(filters?.unitOrCollege ?? '').trim();
    const matchedEmployeeNos =
      unitOrCollegeFilter.length > 0
        ? (
            await prisma.facultyStaff.findMany({
              where: { unitName: { contains: unitOrCollegeFilter } },
              select: { employeeNo: true },
            })
          )
            .map((row) => String(row.employeeNo ?? '').trim())
            .filter(Boolean)
        : [];
    const keyword = String(filters?.keyword ?? '').trim();
    const keywordMatchedEmployeeNos =
      keyword.length > 0
        ? (
            await prisma.facultyStaff.findMany({
              where: {
                OR: [
                  { employeeNo: { contains: keyword } },
                  { name: { contains: keyword } },
                ],
              },
              select: { employeeNo: true },
            })
          )
            .map((row) => String(row.employeeNo ?? '').trim())
            .filter(Boolean)
        : [];
    const whereClause =
      roleFilter || unitOrCollegeFilter
        ? {
            AND: [
              ...(roleFilter ? [{ role: roleFilter }] : []),
              ...(unitOrCollegeFilter
                ? [
                    {
                      OR: [
                        { college: { contains: unitOrCollegeFilter } },
                        ...(matchedEmployeeNos.length > 0
                          ? [{ employeeNo: { in: matchedEmployeeNos } }]
                          : []),
                      ],
                    },
                  ]
                : []),
              ...(keyword
                ? [
                    {
                      OR: [
                        { employeeNo: { contains: keyword } },
                        { name: { contains: keyword } },
                        ...(keywordMatchedEmployeeNos.length > 0
                          ? [{ employeeNo: { in: keywordMatchedEmployeeNos } }]
                          : []),
                      ],
                    },
                  ]
                : []),
            ],
          }
        : keyword
          ? {
              OR: [
                { employeeNo: { contains: keyword } },
                { name: { contains: keyword } },
                ...(keywordMatchedEmployeeNos.length > 0
                  ? [{ employeeNo: { in: keywordMatchedEmployeeNos } }]
                  : []),
              ],
            }
          : undefined;
    const [total, users] = await Promise.all([
      prisma.user.count({ where: whereClause }),
      prisma.user.findMany({
      skip: (safePage - 1) * safePageSize,
      take: safePageSize,
      orderBy: [{ updatedAt: 'desc' }],
      where: whereClause,
      select: {
        id: true,
        account: true,
        employeeNo: true,
        name: true,
        role: true,
        college: true,
        status: true,
      },
    }),
    ]);
    const employeeNos = users
      .map((item) => String(item.employeeNo ?? '').trim())
      .filter(Boolean);
    const staffs = employeeNos.length
      ? await prisma.facultyStaff.findMany({
          where: { employeeNo: { in: employeeNos } },
          select: { employeeNo: true, unitName: true, name: true },
        })
      : [];
    const unitNameByEmployeeNo = new Map(
      staffs.map((row) => [String(row.employeeNo ?? '').trim(), String(row.unitName ?? '').trim()] as const)
    );
    const staffNameByEmployeeNo = new Map(
      staffs.map((row) => [String(row.employeeNo ?? '').trim(), String(row.name ?? '').trim()] as const)
    );

    return {
      items: users.map((item) => {
        const employeeNo = String(item.employeeNo ?? item.account).trim();
        const fallbackUnit = unitNameByEmployeeNo.get(employeeNo) ?? '';
        const fallbackName = staffNameByEmployeeNo.get(employeeNo) ?? '';
        const rawName = String(item.name ?? '').trim();
        const displayName =
          !rawName || rawName === employeeNo || rawName === String(item.account ?? '').trim()
            ? (fallbackName || rawName || employeeNo)
            : rawName;
        const collegeOrUnit = String(item.college ?? '').trim() || fallbackUnit;
        return ({
        userId: item.id,
        account: item.account,
        employeeNo,
        name: displayName,
        role: item.role as never,
        college: collegeOrUnit || null,
        status: item.status,
      });
      }),
      pagination: {
        page: safePage,
        pageSize: safePageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / safePageSize)),
      },
    };
  }

  async updateUserRole(
    userId: string,
    payload: { role: string; college?: string },
    operator?: { role?: string }
  ) {
    const id = String(userId ?? '').trim();
    if (!id) throw new Error('userId is required');
    const role = String(payload.role ?? '').trim();
    if (!['admin', 'student_affairs', 'college_admin', 'counselor'].includes(role)) throw new Error('invalid role');
    if (role === 'admin' && String(operator?.role ?? '').trim() !== 'admin') {
      throw new Error('仅系统管理员可授予系统管理员角色');
    }
    const college = String(payload.college ?? '').trim() || null;
    if (role === 'college_admin' && !college) throw new Error('college is required for college_admin');

    const existing = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
    if (!existing) throw new Error('user not found');
    if (existing.role === 'admin' && String(operator?.role ?? '').trim() !== 'admin') {
      throw new Error('学生处管理员不能修改系统管理员权限');
    }

    await prisma.user.update({
      where: { id },
      data: {
        role,
        college: role === 'college_admin' ? college : null,
        status: 'active',
      },
    });
  }

  async createUserRole(
    payload: { employeeNo: string; name?: string; role: string; college?: string },
    operator?: { role?: string }
  ) {
    const employeeNo = String(payload.employeeNo ?? '').trim();
    const role = String(payload.role ?? '').trim();
    const college = String(payload.college ?? '').trim() || null;
    if (!employeeNo) throw new Error('employeeNo is required');
    if (!['admin', 'student_affairs', 'college_admin', 'counselor'].includes(role)) throw new Error('invalid role');
    if (role === 'admin' && String(operator?.role ?? '').trim() !== 'admin') {
      throw new Error('仅系统管理员可授予系统管理员角色');
    }
    if (role === 'college_admin' && !college) throw new Error('college is required for college_admin');

    const staff = await prisma.facultyStaff.findUnique({
      where: { employeeNo },
      select: { employeeNo: true, name: true },
    });
    const resolvedName = String(payload.name ?? '').trim() || String(staff?.name ?? '').trim() || employeeNo;
    const account = employeeNo;

    const exists = await prisma.user.findFirst({
      where: { OR: [{ employeeNo }, { account }] },
      select: { id: true },
    });
    if (exists) throw new Error('user already exists');

    await prisma.user.create({
      data: {
        account,
        employeeNo,
        name: resolvedName,
        role,
        college: role === 'college_admin' ? college : null,
        status: 'active',
      },
    });
  }

  async deleteUserRole(userId: string, operator?: { role?: string }) {
    const id = String(userId ?? '').trim();
    if (!id) throw new Error('userId is required');
    const existing = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
    if (!existing) throw new Error('user not found');
    if (existing.role === 'admin' && String(operator?.role ?? '').trim() !== 'admin') {
      throw new Error('学生处管理员不能删除系统管理员');
    }
    await prisma.user.delete({ where: { id } });
  }

  async listCollegeAdminAssignments(): Promise<CollegeAdminListResponse> {
    const [collegeRows, admins] = await Promise.all([
      prisma.student.findMany({
        select: { departmentName: true },
        where: { departmentName: { not: '' } },
        distinct: ['departmentName'],
      }),
      prisma.user.findMany({
        where: { role: 'college_admin' },
        orderBy: [{ college: 'asc' }, { updatedAt: 'desc' }],
        select: {
          id: true,
          account: true,
          employeeNo: true,
          name: true,
          college: true,
          status: true,
        },
      }),
    ]);

    const colleges = new Set<string>();
    for (const row of collegeRows) {
      const college = String(row.departmentName ?? '').trim();
      if (college && !EXCLUDED_COLLEGE_FOR_ADMIN_ASSIGNMENT.has(college)) colleges.add(college);
    }
    for (const row of admins) {
      const college = String(row.college ?? '').trim();
      if (college && !EXCLUDED_COLLEGE_FOR_ADMIN_ASSIGNMENT.has(college)) colleges.add(college);
    }

    const assignments = admins
      .filter((item) => {
        const college = String(item.college ?? '').trim();
        return college && !EXCLUDED_COLLEGE_FOR_ADMIN_ASSIGNMENT.has(college);
      })
      .map((item) => ({
        college: String(item.college ?? '').trim(),
        userId: item.id,
        account: item.account,
        employeeNo: item.employeeNo ?? item.account,
        name: item.name,
        status: item.status,
      }));

    return {
      colleges: Array.from(colleges).sort((a, b) => a.localeCompare(b, 'zh-CN')),
      assignments,
    };
  }

  async upsertCollegeAdminAssignment(college: string, payload: { employeeNo: string; name: string; account?: string }) {
    const normalizedCollege = String(college ?? '').trim();
    const employeeNo = String(payload.employeeNo ?? '').trim();
    const name = String(payload.name ?? '').trim();
    const account = String(payload.account ?? '').trim() || employeeNo;

    if (!normalizedCollege) throw new Error('college is required');
    if (EXCLUDED_COLLEGE_FOR_ADMIN_ASSIGNMENT.has(normalizedCollege)) {
      throw new Error('诚毅学院不允许学院管理员授权');
    }
    if (!employeeNo) throw new Error('employeeNo is required');
    if (!name) throw new Error('name is required');

    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ employeeNo }, { account }],
      },
      select: { id: true },
    });

    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          account,
          employeeNo,
          name,
          role: 'college_admin',
          college: normalizedCollege,
          status: 'active',
        },
      });
      return;
    }

    await prisma.user.create({
      data: {
        account,
        employeeNo,
        name,
        role: 'college_admin',
        college: normalizedCollege,
        status: 'active',
      },
    });
  }

  async removeCollegeAdminAssignment(userId: string) {
    const id = String(userId ?? '').trim();
    if (!id) throw new Error('userId is required');

    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true },
    });
    if (!user) throw new Error('user not found');
    if (user.role !== 'college_admin') throw new Error('user is not a college admin');

    await prisma.user.update({
      where: { id },
      data: {
        role: 'counselor',
        college: null,
        status: 'active',
      },
    });
  }

  async getSystemConfig(): Promise<SystemConfig> {
    let config = await prisma.systemConfig.findUnique({ where: { id: 1 } });

    if (!config) {
      config = await prisma.systemConfig.create({
        data: {
          id: 1,
          breakfastStart: '05:00',
          breakfastEnd: '09:00',
          lunchStart: '10:00',
          lunchEnd: '14:00',
          dinnerStart: '16:00',
          dinnerEnd: '21:00',
          subsidyLimit: (500).toFixed(2),
          finalRatio: 0.015,
          standardPercentile: 0.25,
          basePercentile: 0.5,
          timeoutWorkdays: 7,
        },
      });
    }

    return {
      breakfastSlot: { start: config.breakfastStart, end: config.breakfastEnd },
      lunchSlot: { start: config.lunchStart, end: config.lunchEnd },
      dinnerSlot: { start: config.dinnerStart, end: config.dinnerEnd },
      subsidyLimit: toNumber(config.subsidyLimit),
      finalRatio: toPercentDisplay(config.finalRatio),
      standardPercentile: toPercentDisplay(config.standardPercentile),
      basePercentile: toPercentDisplay(config.basePercentile),
    };
  }

  async listLoginRoles() {
    return loginRoles;
  }

  async createBatch(month: string, options?: { allowAnyMonth?: boolean }) {
    const normalizedMonth = (month ?? '').trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(normalizedMonth)) {
      throw new Error(`month 鏍煎紡涓嶅悎娉曪細${normalizedMonth}锛屽簲涓?YYYY-MM`);
    }

    const expected = previousMonthKey();
    const allowAnyMonth =
      options?.allowAnyMonth === true || String(process.env.BATCH_CREATE_ALLOW_ANY_MONTH ?? '') === '1';
    if (!allowAnyMonth && normalizedMonth !== expected) {
      throw new Error(`褰撳墠浠呭厑璁稿彂璧蜂笂涓湀璁ゅ畾鎵规锛氭湰娆?${normalizedMonth}锛屽厑璁?${expected}`);
    }

    const existing = await prisma.subsidyBatch.findUnique({ where: { month: normalizedMonth } });

    if (existing) {
      return {
        created: false,
        data: {
          id: existing.id,
          month: existing.month,
          status: existing.status as never,
          progress: existing.progress,
          startTime: formatDate(existing.startTime),
          endTime: existing.endTime ? formatDate(existing.endTime) : undefined,
          stats: {
            total: 0,
            confirmed: 0,
            pending: 0,
          },
        },
      };
    }

    const config = await prisma.systemConfig.findUnique({ where: { id: 1 } });
    const created = await prisma.subsidyBatch.create({
      data: {
        id: `B${normalizedMonth.replace('-', '')}`,
        month: normalizedMonth,
        status: 'syncing',
        progress: 0,
        startTime: new Date(),
        ruleVersion: 'v1.0',
        standardPercentile: config?.standardPercentile ?? 0.25,
        basePercentile: config?.basePercentile ?? 0.5,
        finalRatio: config?.finalRatio ?? 0.015,
      },
    });

    return {
      created: true,
      data: {
        id: created.id,
        month: created.month,
        status: created.status as never,
        progress: created.progress,
        startTime: formatDate(created.startTime),
        stats: {
          total: 0,
          confirmed: 0,
          pending: 0,
        },
      },
    };
  }

  async updateSystemConfig(payload: SystemConfig) {
    const updated = await prisma.systemConfig.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        breakfastStart: payload.breakfastSlot.start,
        breakfastEnd: payload.breakfastSlot.end,
        lunchStart: payload.lunchSlot.start,
        lunchEnd: payload.lunchSlot.end,
        dinnerStart: payload.dinnerSlot.start,
        dinnerEnd: payload.dinnerSlot.end,
        subsidyLimit: payload.subsidyLimit,
        finalRatio: payload.finalRatio / 100,
        standardPercentile: payload.standardPercentile / 100,
        basePercentile: payload.basePercentile / 100,
      },
      update: {
        breakfastStart: payload.breakfastSlot.start,
        breakfastEnd: payload.breakfastSlot.end,
        lunchStart: payload.lunchSlot.start,
        lunchEnd: payload.lunchSlot.end,
        dinnerStart: payload.dinnerSlot.start,
        dinnerEnd: payload.dinnerSlot.end,
        subsidyLimit: payload.subsidyLimit,
        finalRatio: payload.finalRatio / 100,
        standardPercentile: payload.standardPercentile / 100,
        basePercentile: payload.basePercentile / 100,
      },
    });

    return {
      breakfastSlot: { start: updated.breakfastStart, end: updated.breakfastEnd },
      lunchSlot: { start: updated.lunchStart, end: updated.lunchEnd },
      dinnerSlot: { start: updated.dinnerStart, end: updated.dinnerEnd },
      subsidyLimit: toNumber(updated.subsidyLimit),
      finalRatio: toPercentDisplay(updated.finalRatio),
      standardPercentile: toPercentDisplay(updated.standardPercentile),
      basePercentile: toPercentDisplay(updated.basePercentile),
    };
  }
}

export const referenceDataRepository = new ReferenceDataRepository();

