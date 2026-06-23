import { prisma } from '@/src/server/db/client';
import { activeStudentWhere } from '@/src/server/repositories/studentScope';
import { formatDateTimeMinuteInTimeZone, getDateTimePartsInTimeZone } from '@/src/server/time';
import type {
  CandidateSearchItem,
  CandidateListResponse,
  ReviewActionRequest,
  ReviewTask,
  StudentDetail,
  TagRecord,
} from '@/src/types';

type AccessContext = {
  id: string;
  role: string;
  college?: string | null;
  canFundingOfficeReview?: boolean;
  canFinalReview?: boolean;
};

type CandidateSnapshotFilters = {
  college?: string;
  counselorEmployeeNo?: string;
  counselorName?: string;
  candidateType?: 'special_difficulty';
  sortBy?: 'college';
  sortDirection?: 'asc' | 'desc';
};

function formatDate(value: Date) {
  const p = getDateTimePartsInTimeZone(value);
  return `${p.year}-${p.month}-${p.day}`;
}

function formatDateTime(value: Date) {
  return formatDateTimeMinuteInTimeZone(value);
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
  const amount = toNumber(value);
  return roundAmount(amount);
}

function getStageLabel(stage: string) {
  switch (stage) {
    case 'counselor':
      return '辅导员确认';
    case 'college':
      return '学院审核';
    case 'funding_office':
      return '学生资助管理办公室审核';
    case 'student_affairs':
      return '学生处终审';
    default:
      return '系统处理';
  }
}

function normalizeMojibakeText(input: string) {
  const text = String(input ?? '').trim();
  if (!text) return text;

  return text
    .replaceAll('寰呭鐢熷缁堝', '待学生处终审')
    .replaceAll('杈呭鍛樼‘璁', '辅导员确认')
    .replaceAll('杈呭鍛橀€氳繃', '辅导员通过')
    .replaceAll('杈呭鍛橀┏鍥', '辅导员驳回')
    .replaceAll('瀛﹂櫌瀹℃牳', '学院审核')
    .replaceAll('瀛﹂櫌閫氳繃', '学院通过')
    .replaceAll('瀛﹂櫌椹冲洖', '学院驳回')
    .replaceAll('瀛︾敓澶勭粓瀹', '学生处终审')
    .replaceAll('瀛︾敓澶勯€氳繃', '学生处通过')
    .replaceAll('瀛︾敓澶勯┏鍥', '学生处驳回')
    .replaceAll('瀛︾敓澶勭鐞嗗憳', '学生处管理员')
    .replaceAll('瀹℃牳閫氳繃', '审核通过')
    .replaceAll('瀹℃牳椹冲洖', '审核驳回')
    .replaceAll('鎸夊綋鍓嶄笟鍔￠鏋舵祦杞埌涓嬩竴瀹℃牳鐜妭銆?', '按当前业务流程流转到下一审核环节。')
    .replaceAll('婕旂ず椹冲洖鍔ㄤ綔锛屽悗缁彲琛ュ厖鍘熷洜妯℃澘鍜岄€€鍥炶鍒欍€?', '演示驳回动作，后续可补充原因模板和退回规则。')
    .replaceAll('瀛﹂櫌', '学院')
    .replaceAll('杈呭鍛', '辅导员')
    .replaceAll('瀛︾敓澶', '学生处');
}

function getSlotLabel(slot: string) {
  switch (slot) {
    case 'breakfast':
      return '早餐';
    case 'lunch':
      return '午餐';
    case 'dinner':
      return '晚餐';
    default:
      return '午晚餐';
  }
}

function getTaskRole(stage: string) {
  switch (stage) {
    case 'counselor':
      return '辅导员';
    case 'college':
      return '学院管理员';
    case 'funding_office':
      return '学生资助管理办公室';
    case 'student_affairs':
      return '学生处';
    default:
      return '系统';
  }
}

function getTaskStatus(workflowStatus: string): ReviewTask['status'] {
  if (workflowStatus.includes('overdue')) {
    return 'overdue';
  }

  if (workflowStatus.includes('rejected') || workflowStatus === 'not_included') {
    return 'reject';
  }

  if (workflowStatus === 'included' || workflowStatus.includes('approved')) {
    return 'approve';
  }

  return 'pending';
}

function uniqueTags(tags: string[]) {
  return Array.from(new Set(tags));
}

function resolveTagStage(tag: string) {
  const text = normalizeMojibakeText(String(tag ?? '').trim());
  if (!text) return '';
  if (text.includes('辅导员')) return 'counselor';
  if (text.includes('学院')) return 'college';
  if (text.includes('资助') || text.includes('办公室')) return 'funding_office';
  if (text.includes('学生处')) return 'student_affairs';
  if (text.startsWith('待')) return 'pending';
  return '';
}

function collapseActiveTagsByStage(
  tags: Array<{ tag: string; status: string; generatedAt: Date; id: string }>
) {
  const active = tags.filter((item) => item.status === 'active');
  const latestByStage = new Map<string, { tag: string; generatedAt: Date; id: string }>();
  const stageLess: string[] = [];

  for (const item of active) {
    const stage = resolveTagStage(item.tag);
    if (!stage) {
      stageLess.push(item.tag);
      continue;
    }
    const prev = latestByStage.get(stage);
    if (!prev || item.generatedAt.getTime() > prev.generatedAt.getTime()) {
      latestByStage.set(stage, { tag: item.tag, generatedAt: item.generatedAt, id: item.id });
    }
  }

  return uniqueTags([...stageLess, ...Array.from(latestByStage.values()).map((item) => item.tag)]);
}

function studentCollege(value: { departmentName: string }) {
  return value.departmentName || '-';
}

function studentClassName() {
  return '-';
}

function studentClassCode(value: { classCode: string }) {
  return value.classCode || '-';
}

function monthToTableName(month: string) {
  const compact = month.replace('-', '');
  if (!/^\d{6}$/.test(compact)) {
    return '';
  }
  return `card_transaction_${compact}`;
}

function safeNumber(value: unknown) {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isNaN(n) ? 0 : n;
}

function safeNullableNumber(value: unknown) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

function safeRate(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return Math.round(((numerator / denominator) + Number.EPSILON) * 10000) / 10000;
}

function buildMetricComparison(current: number, previous: number | null) {
  if (previous == null || !Number.isFinite(previous)) {
    return {
      current: roundAmount(current),
      previous: null,
      delta: null,
      deltaRate: null,
    };
  }
  const delta = roundAmount(current - previous);
  const deltaRate = previous === 0 ? null : roundAmount(delta / previous);
  return {
    current: roundAmount(current),
    previous: roundAmount(previous),
    delta,
    deltaRate,
  };
}

function formatAverageSpendLabel(breakfastAvg: number | null, lunchDinnerAvg: number | null) {
  if (breakfastAvg == null && lunchDinnerAvg == null) {
    return '无有效消费';
  }
  const breakfastText = breakfastAvg == null ? '-' : `¥${breakfastAvg.toFixed(1)}`;
  const lunchDinnerText = lunchDinnerAvg == null ? '-' : `¥${lunchDinnerAvg.toFixed(1)}`;
  return `早餐${breakfastText} / 午晚餐${lunchDinnerText}`;
}

function parseJsonArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [] as string[];
    }
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  } catch {
    return [] as string[];
  }
}

type StudentMonthStatFallback = {
  breakfastCount: number;
  breakfastTotal: number;
  breakfastAvg: number;
  breakfastDaysCount: number;
  lunchDinnerCount: number;
  lunchDinnerTotal: number;
  lunchDinnerAvg: number;
  lunchDinnerDaysCount: number;
  daysCount: number;
  totalAmount: number;
};

const CANDIDATE_RULE_VERSION = 'v2_special_and_potential_3m';

type MonthlyStudentMetric = {
  studentNo: string;
  breakfastCount: number;
  breakfastTotal: number;
  breakfastAvg: number | null;
  breakfastDaysCount: number;
  lunchDinnerCount: number;
  lunchDinnerTotal: number;
  lunchDinnerAvg: number | null;
  lunchDinnerDaysCount: number;
  daysCount: number;
  totalAmount: number;
  totalAvg: number;
};

type MonthlyMetricContext = {
  month: string;
  monthDays: number;
  metricsByStudentNo: Map<string, MonthlyStudentMetric>;
  breakfastStandard: number | null;
  lunchDinnerStandard: number | null;
  breakfastBase: number | null;
  lunchDinnerBase: number | null;
  breakfastBottom10: number | null;
  lunchDinnerBottom10: number | null;
};

type MonthlyP50Snapshot = {
  month: string;
  breakfastP50: number;
  lunchDinnerP50: number;
  computedAt: number;
};

let monthlyP50Cache: MonthlyP50Snapshot | null = null;

function parseMonthDate(month: string) {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    return null;
  }
  return new Date(year, monthIndex, 1);
}

function shiftMonth(month: string, delta: number) {
  const date = parseMonthDate(month);
  if (!date) {
    return '';
  }
  const shifted = new Date(date.getFullYear(), date.getMonth() + delta, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}`;
}

function daysInMonth(month: string) {
  const date = parseMonthDate(month);
  if (!date) {
    return 30;
  }
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function percentileThreshold(values: Array<number | null>, percentile: number) {
  const sorted = values.filter((item): item is number => item != null && Number.isFinite(item)).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return null;
  }
  const p = Math.min(1, Math.max(0, percentile));
  const index = Math.max(0, Math.ceil(sorted.length * p) - 1);
  return sorted[index] ?? sorted[sorted.length - 1];
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

export class CandidateRepository {
  private isCounselorScope(context?: AccessContext) {
    return context?.role === 'counselor' && Boolean(String(context.id ?? '').trim());
  }

  private canReviewStage(role: string | undefined, stage: string, context?: AccessContext) {
    if (stage === 'funding_office' && context?.canFundingOfficeReview) return true;
    if (stage === 'student_affairs' && context?.canFinalReview) return true;
    if (!role) return false;
    if (role === 'admin') return true;
    if (role === 'counselor') return stage === 'counselor';
    if (role === 'college_admin') return stage === 'college';
    if (role === 'student_affairs') {
      if (stage === 'funding_office') return Boolean(context?.canFundingOfficeReview);
      if (stage === 'student_affairs') return context?.canFinalReview !== false;
      return false;
    }
    return false;
  }

  private buildCandidateScopeWhere(context?: AccessContext) {
    const role = String(context?.role ?? '').trim();
    if (!role || role === 'admin' || role === 'student_affairs' || role === 'funding_office') return {};

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

  async searchCandidateStudents(keyword: string, context?: AccessContext): Promise<CandidateSearchItem[]> {
    const normalized = String(keyword ?? '').trim();
    if (normalized.length < 1) return [];

    const latestBatch = await prisma.subsidyBatch.findFirst({
      where: {
        candidateResults: {
          some: {},
        },
      },
      orderBy: { month: 'desc' },
      select: { month: true, id: true },
    });
    if (!latestBatch) return [];

    const scopeWhere = this.buildCandidateScopeWhere(context);
    const rows = await prisma.candidateResult.findMany({
      where: {
        month: latestBatch.month,
        batchId: latestBatch.id,
        ...scopeWhere,
        student: {
          ...(typeof (scopeWhere as { student?: object }).student === 'object'
            ? ((scopeWhere as { student?: object }).student as object)
            : {}),
          OR: [
            { studentId: { contains: normalized } },
            { name: { contains: normalized } },
          ],
        },
      },
      select: {
        month: true,
        student: {
          select: {
            studentId: true,
            name: true,
            departmentName: true,
            classCode: true,
          },
        },
      },
      take: 12,
      orderBy: [{ rank: 'asc' }, { studentId: 'asc' }],
    });

    return rows.map((item) => ({
      studentId: item.student.studentId,
      name: item.student.name,
      college: String(item.student.departmentName ?? '').trim() || '-',
      className: String(item.student.classCode ?? '').trim() || '-',
      month: item.month,
    }));
  }

  private isLikelyEmployeeNo(value: string) {
    const text = String(value ?? '').trim();
    if (!text) return false;
    if (/[\u4e00-\u9fa5]/.test(text)) return false;
    return /^[A-Za-z0-9_-]{6,}$/.test(text);
  }

  private async loadCounselorNameByEmployeeNo(employeeNos: string[]) {
    const normalized = Array.from(new Set(employeeNos.map((item) => String(item ?? '').trim()).filter(Boolean)));
    if (normalized.length === 0) return new Map<string, string>();
    const staffs = await prisma.facultyStaff.findMany({
      where: { employeeNo: { in: normalized } },
      select: { employeeNo: true, name: true },
    });
    return new Map(
      staffs
        .map((item) => [item.employeeNo, String(item.name ?? '').trim()] as const)
        .filter(([, name]) => !!name)
    );
  }

  private normalizeMonthInput(month?: string) {
    const value = String(month ?? '').trim();
    if (!value) return { value: undefined as string | undefined, valid: true };
    if (!/^\d{4}-\d{2}$/.test(value)) return { value: undefined as string | undefined, valid: false };
    return { value, valid: true };
  }

  private async rebuildCandidateListSnapshot(month: string, batchId?: string) {
    const batch = batchId
      ? await prisma.subsidyBatch.findUnique({ where: { id: batchId } })
      : await prisma.subsidyBatch.findUnique({ where: { month } });

    if (!batch) {
      return 0;
    }

    const sourceItems = await prisma.candidateResult.findMany({
      where: {
        month,
        batchId: batch.id,
      },
      include: {
        student: {
          include: {
            relations: {
              include: {
                counselor: true,
              },
              orderBy: {
                createdAt: 'desc',
              },
              take: 1,
            },
            tagRecords: {
              where: {
                batchId: batch.id,
                status: 'active',
              },
              select: {
                tag: true,
              },
            },
          },
        },
        hitRules: {
          select: {
            ruleText: true,
          },
        },
      },
      orderBy: [{ rank: 'asc' }, { studentId: 'asc' }],
    });

    const counselorEmployeeNos = sourceItems
      .map((item) => item.student.relations[0]?.counselor.employeeNo ?? '')
      .map((item) => String(item ?? '').trim())
      .filter(Boolean);
    const counselorNameByEmployeeNo = await this.loadCounselorNameByEmployeeNo(counselorEmployeeNos);

    const rows = sourceItems.map((item) => ({
      id: `candidate-snapshot-${month}-${item.student.studentId}`,
      month,
      batchId: item.batchId,
      studentId: item.student.studentId,
      name: item.student.name,
      college: studentCollege(item.student),
      className: studentClassCode(item.student),
      counselor: (() => {
        const relationCounselor = item.student.relations[0]?.counselor;
        if (!relationCounselor) return '-';
        const employeeNo = String(relationCounselor.employeeNo ?? '').trim();
        if (employeeNo && counselorNameByEmployeeNo.has(employeeNo)) {
          return counselorNameByEmployeeNo.get(employeeNo) as string;
        }
        const name = String(relationCounselor.name ?? '').trim();
        return name || employeeNo || '-';
      })(),
      type: item.candidateType,
      typeLabel: item.typeLabel,
      averageSpendLabel: item.averageSpendLabel ?? '-',
      daysCount: item.daysCount,
      workflowStatus: item.workflowStatus,
      workflowStatusLabel: item.workflowStatusLabel,
      currentStage: item.currentStage,
      rank: item.rank ?? 0,
      subsidyEstimate: item.subsidyEstimate,
      reviewDeadline: item.reviewDeadline,
      tagsJson: JSON.stringify(uniqueTags(item.student.tagRecords.map((tag) => tag.tag))),
      hitRulesJson: JSON.stringify(item.hitRules.map((rule) => rule.ruleText)),
    }));

    await prisma.$transaction([
      prisma.candidateListSnapshot.deleteMany({ where: { month } }),
      ...(rows.length > 0 ? [prisma.candidateListSnapshot.createMany({ data: rows })] : []),
    ]);

    return rows.length;
  }

  private async readCandidateListSnapshot(
    month: string,
    page: number,
    pageSize: number,
    context?: AccessContext,
    filters?: CandidateSnapshotFilters
  ) {
    if (context?.role === 'counselor' && !String(context.id ?? '').trim()) {
      return { total: 0, items: [] };
    }
    const skip = (page - 1) * pageSize;
    const scoped = this.isCounselorScope(context);
    const isCollegeAdminScope = String(context?.role ?? '').trim() === 'college_admin';
    const college = String(context?.college ?? '').trim();
    const scopeSql = scoped
      ? `
          AND EXISTS (
            SELECT 1
            FROM \`Student\` ss
            INNER JOIN \`CounselorStudentRelation\` csr ON csr.studentId = ss.id
            WHERE ss.studentId COLLATE utf8mb4_unicode_ci = cls.studentId COLLATE utf8mb4_unicode_ci
              AND csr.counselorId = ?
          )
        `
      : isCollegeAdminScope
        ? `
          AND cls.college = ?
        `
        : '';
    const scopeParams = scoped
      ? [String(context?.id ?? '').trim()]
      : isCollegeAdminScope
        ? [college || '__NO_MATCH__']
        : [];
    const normalizedCollege = String(filters?.college ?? '').trim();
    const normalizedCounselorEmployeeNo = String(filters?.counselorEmployeeNo ?? '').trim();
    const normalizedCounselorName = String(filters?.counselorName ?? '').trim();
    const candidateType =
      filters?.candidateType === 'special_difficulty' ? filters.candidateType : '';
    const sortBy = filters?.sortBy === 'college' ? 'college' : '';
    const sortDirection = filters?.sortDirection === 'desc' ? 'desc' : 'asc';

    const filterSqlParts: string[] = [];
    const filterParams: string[] = [];
    if (normalizedCollege) {
      filterSqlParts.push(`
        AND TRIM(cls.college) COLLATE utf8mb4_unicode_ci = CAST(? AS CHAR) COLLATE utf8mb4_unicode_ci
      `);
      filterParams.push(normalizedCollege);
    }
    if (candidateType) {
      filterSqlParts.push(`AND cls.type = ?`);
      filterParams.push(candidateType);
    }
    const counselorEmployeeNoSql = `
      EXISTS (
        SELECT 1
        FROM \`Student\` ss2
        INNER JOIN \`CounselorStudentRelation\` csr2 ON csr2.studentId = ss2.id
        INNER JOIN \`User\` u2 ON u2.id = csr2.counselorId
        WHERE ss2.studentId COLLATE utf8mb4_unicode_ci = cls.studentId COLLATE utf8mb4_unicode_ci
          AND u2.employeeNo LIKE ?
      )
    `;
    if (normalizedCounselorName && normalizedCounselorEmployeeNo) {
      filterSqlParts.push(`AND (cls.counselor LIKE ? OR ${counselorEmployeeNoSql})`);
      filterParams.push(`%${normalizedCounselorName}%`, `%${normalizedCounselorEmployeeNo}%`);
    } else if (normalizedCounselorName) {
      filterSqlParts.push(`AND cls.counselor LIKE ?`);
      filterParams.push(`%${normalizedCounselorName}%`);
    } else if (normalizedCounselorEmployeeNo) {
      filterSqlParts.push(`
        AND ${counselorEmployeeNoSql}
      `);
      filterParams.push(`%${normalizedCounselorEmployeeNo}%`);
    }
    const filterSql = filterSqlParts.join('\n');
    const orderBySql =
      sortBy === 'college'
        ? `
          ORDER BY
            TRIM(cls.college) COLLATE utf8mb4_unicode_ci ${sortDirection.toUpperCase()},
            CAST(COALESCE(fsr.totalSubsidy, cls.subsidyEstimate, 0) AS DECIMAL(12,2)) DESC,
            cls.rank ASC,
            cls.studentId ASC
        `
        : `
          ORDER BY
            CAST(COALESCE(fsr.totalSubsidy, cls.subsidyEstimate, 0) AS DECIMAL(12,2)) DESC,
            cls.rank ASC,
            cls.studentId ASC
        `;

    const [total, rows] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ total: unknown }>>(
        `
          SELECT COUNT(1) AS total
          FROM \`CandidateListSnapshot\` cls
          WHERE cls.month = ?
          ${scopeSql}
          ${filterSql}
        `,
        month,
        ...scopeParams,
        ...filterParams
      ),
      prisma.$queryRawUnsafe<
        Array<{
          id: string;
          studentId: string;
          month: string;
          batchId: string;
          name: string;
          college: string;
          className: string;
          counselor: string;
          type: string;
          typeLabel: string;
          averageSpendLabel: string;
          daysCount: number;
          breakfastDaysCount: number;
          lunchDinnerDaysCount: number;
          workflowStatus: string;
          workflowStatusLabel: string;
          currentStage: string;
          rank: number;
          displayRank: number;
          subsidyEstimate: unknown;
          reviewDeadline: Date | null;
          tagsJson: string;
          hitRulesJson: string;
        }>
      >(
        `
          SELECT
            cls.id,
            cls.studentId,
            cls.month,
            cls.batchId,
            cls.name,
            cls.college,
            cls.className,
            cls.counselor,
            cls.type,
            cls.typeLabel,
            cls.averageSpendLabel,
            cls.daysCount,
            COALESCE(sms.breakfastCount, 0) AS breakfastDaysCount,
            COALESCE(sms.lunchDinnerCount, 0) AS lunchDinnerDaysCount,
            cls.workflowStatus,
            cls.workflowStatusLabel,
            cls.currentStage,
            cls.rank,
            ROW_NUMBER() OVER (
              ORDER BY
                CAST(COALESCE(fsr.totalSubsidy, cls.subsidyEstimate, 0) AS DECIMAL(12,2)) DESC,
                cls.rank ASC,
                cls.studentId ASC
            ) AS displayRank,
            COALESCE(fsr.totalSubsidy, cls.subsidyEstimate, 0) AS subsidyEstimate,
            cls.reviewDeadline,
            cls.tagsJson,
            cls.hitRulesJson
          FROM \`CandidateListSnapshot\` cls
          LEFT JOIN \`Student\` s
            ON s.studentId COLLATE utf8mb4_unicode_ci = cls.studentId COLLATE utf8mb4_unicode_ci
          LEFT JOIN \`FinalSubsidyResult\` fsr
            ON fsr.batchId = cls.batchId
           AND fsr.studentId = s.id
          LEFT JOIN \`StudentMonthStat\` sms
            ON sms.batchId = cls.batchId
           AND sms.month = cls.month
           AND sms.studentId = s.id
          WHERE cls.month = ?
          ${scopeSql}
          ${filterSql}
          ${orderBySql}
          LIMIT ?
          OFFSET ?
        `,
        month,
        ...scopeParams,
        ...filterParams,
        pageSize,
        skip
      ),
    ]);
    const totalCount = Number(total[0]?.total ?? 0);
    const pageStudentNos = Array.from(new Set(rows.map((item) => String(item.studentId ?? '').trim()).filter(Boolean)));
    const resolvedDaysByStudentNo = new Map<string, { breakfastDaysCount: number; lunchDinnerDaysCount: number }>();
    const actualTransactionTableName = await this.resolveActualTransactionTableName(month);
    if (actualTransactionTableName && pageStudentNos.length > 0) {
      const placeholders = pageStudentNos.map(() => '?').join(', ');
      const dayRows = await prisma.$queryRawUnsafe<
        Array<{ studentNo: string; breakfastDaysCount: unknown; lunchDinnerDaysCount: unknown }>
      >(
        `
          SELECT
            ct.studentNo,
            COUNT(DISTINCT CASE WHEN ct.mealSlot = 'breakfast' THEN DATE(ct.occurredAt) END) AS breakfastDaysCount,
            COUNT(
              DISTINCT CASE
                WHEN ct.mealSlot = 'lunch'
                  OR ct.mealSlot IN ('dinner', 'night', 'night_snack', 'supper', 'late_night')
                  OR ct.mealSlot = 'lunch_dinner'
                THEN DATE(ct.occurredAt)
              END
            ) AS lunchDinnerDaysCount
          FROM \`${actualTransactionTableName}\` ct
          WHERE ct.amount > 0
            AND ct.mealSlot IN ('breakfast', 'lunch', 'dinner', 'lunch_dinner', 'night', 'night_snack', 'supper', 'late_night')
            AND ct.studentNo IN (${placeholders})
          GROUP BY ct.studentNo
        `,
        ...pageStudentNos
      );
      for (const row of dayRows) {
        resolvedDaysByStudentNo.set(String(row.studentNo), {
          breakfastDaysCount: Math.max(0, Math.floor(safeNumber(row.breakfastDaysCount))),
          lunchDinnerDaysCount: Math.max(0, Math.floor(safeNumber(row.lunchDinnerDaysCount))),
        });
      }
    }

    const missingCounselorStudentNos = rows
      .filter((item) => !item.counselor || item.counselor.trim() === '-')
      .map((item) => item.studentId)
      .filter(Boolean);
    const counselorByStudentNo = new Map<string, string>();
    if (missingCounselorStudentNos.length > 0) {
      const placeholders = missingCounselorStudentNos.map(() => '?').join(', ');
      const relationRows = await prisma.$queryRawUnsafe<Array<{ studentNo: string; counselorName: string | null }>>(
        `
          SELECT
            s.studentId AS studentNo,
            (
              SELECT u.name
              FROM \`CounselorStudentRelation\` csr
              INNER JOIN \`User\` u ON u.id = csr.counselorId
              WHERE csr.studentId = s.id
              ORDER BY csr.updatedAt DESC, csr.createdAt DESC
              LIMIT 1
            ) AS counselorName
          FROM \`Student\` s
          WHERE s.studentId IN (${placeholders})
        `,
        ...missingCounselorStudentNos
      );
      for (const row of relationRows) {
        const value = (row.counselorName ?? '').trim();
        if (value) {
          counselorByStudentNo.set(row.studentNo, value);
        }
      }
    }

    const rawCounselors = rows.map((item) =>
      item.counselor && item.counselor.trim() !== '-' ? item.counselor.trim() : (counselorByStudentNo.get(item.studentId) ?? '-')
    );
    const possibleEmployeeNos = rawCounselors.filter((item) => this.isLikelyEmployeeNo(item));
    const counselorNameByEmployeeNo = await this.loadCounselorNameByEmployeeNo(possibleEmployeeNos);

    return {
      total: totalCount,
      items: rows.map((item) => ({
      id: item.id,
      studentId: item.studentId,
      month: item.month,
      batchId: item.batchId,
      name: item.name,
      college: item.college,
      className: item.className,
      counselor: (() => {
        const raw = item.counselor && item.counselor.trim() !== '-' ? item.counselor.trim() : (counselorByStudentNo.get(item.studentId) ?? '-');
        if (this.isLikelyEmployeeNo(raw) && counselorNameByEmployeeNo.has(raw)) {
          return counselorNameByEmployeeNo.get(raw) as string;
        }
        return raw;
      })(),
      type: item.type as never,
      typeLabel: item.typeLabel,
      averageSpendLabel: item.averageSpendLabel || '-',
      daysCount: item.daysCount,
      breakfastDaysCount: resolvedDaysByStudentNo.get(item.studentId)?.breakfastDaysCount ?? Math.max(0, Number(item.breakfastDaysCount ?? 0)),
      lunchDinnerDaysCount: resolvedDaysByStudentNo.get(item.studentId)?.lunchDinnerDaysCount ?? Math.max(0, Number(item.lunchDinnerDaysCount ?? 0)),
      workflowStatus: item.workflowStatus as never,
      workflowStatusLabel: normalizeMojibakeText(item.workflowStatusLabel),
      tags: parseJsonArray(item.tagsJson).map((tag) => normalizeMojibakeText(tag)),
      hitRules: parseJsonArray(item.hitRulesJson),
      rank: Number(item.displayRank || item.rank || 0),
      subsidyEstimate: toAmount(item.subsidyEstimate),
      reviewDeadline: item.reviewDeadline ? formatDateTime(item.reviewDeadline) : '-',
      currentStage: item.currentStage as never,
      })),
    };
  }

  private async refreshCandidateSpendMetricsFromTransactions(month: string, batchId: string) {
    const tableName = monthToTableName(month);
    if (!tableName) {
      return 0;
    }

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
      return 0;
    }
    const actualTableName = tableRows[0].TABLE_NAME;

    const candidates = await prisma.candidateResult.findMany({
      where: {
        month,
        batchId,
      },
      include: {
        student: {
          select: {
            studentId: true,
          },
        },
      },
    });
    if (candidates.length === 0) {
      return 0;
    }

    const allStudentNos = Array.from(new Set(candidates.map((item) => item.student.studentId).filter(Boolean)));
    const metricMap = new Map<
      string,
      { breakfastAvg: number | null; lunchDinnerAvg: number | null; daysCount: number; breakfastDaysCount: number; lunchDinnerDaysCount: number }
    >();

    for (let i = 0; i < allStudentNos.length; i += 1000) {
      const studentNos = allStudentNos.slice(i, i + 1000);
      const placeholders = studentNos.map(() => '?').join(', ');
      const stats = await prisma.$queryRawUnsafe<
        Array<{
          studentNo: string;
          breakfastAvg: unknown;
          lunchDinnerAvg: unknown;
          breakfastDaysCount: unknown;
          lunchDinnerDaysCount: unknown;
          daysCount: unknown;
        }>
      >(
        `
          SELECT
            studentNo,
            CASE
              WHEN COUNT(DISTINCT CASE WHEN mealSlot = 'breakfast' THEN DATE(occurredAt) END) = 0 THEN NULL
              ELSE SUM(CASE WHEN mealSlot = 'breakfast' THEN amount ELSE 0 END)
                / COUNT(DISTINCT CASE WHEN mealSlot = 'breakfast' THEN DATE(occurredAt) END)
            END AS breakfastAvg,
            CASE
              WHEN (
                COUNT(DISTINCT CASE
                  WHEN mealSlot = 'lunch' OR (mealSlot = 'lunch_dinner' AND HOUR(occurredAt) >= 10 AND HOUR(occurredAt) < 15)
                  THEN DATE(occurredAt)
                END)
                + COUNT(DISTINCT CASE
                  WHEN mealSlot IN ('dinner', 'night', 'night_snack', 'supper', 'late_night')
                    OR (mealSlot = 'lunch_dinner' AND NOT (HOUR(occurredAt) >= 10 AND HOUR(occurredAt) < 15))
                  THEN DATE(occurredAt)
                END)
              ) = 0 THEN NULL
              ELSE (
                SUM(CASE WHEN mealSlot = 'lunch' OR (mealSlot = 'lunch_dinner' AND HOUR(occurredAt) >= 10 AND HOUR(occurredAt) < 15) THEN amount ELSE 0 END)
                + SUM(CASE
                  WHEN mealSlot IN ('dinner', 'night', 'night_snack', 'supper', 'late_night')
                    OR (mealSlot = 'lunch_dinner' AND NOT (HOUR(occurredAt) >= 10 AND HOUR(occurredAt) < 15))
                  THEN amount ELSE 0 END)
              ) / (
                COUNT(DISTINCT CASE
                  WHEN mealSlot = 'lunch' OR (mealSlot = 'lunch_dinner' AND HOUR(occurredAt) >= 10 AND HOUR(occurredAt) < 15)
                  THEN DATE(occurredAt)
                END)
                + COUNT(DISTINCT CASE
                  WHEN mealSlot IN ('dinner', 'night', 'night_snack', 'supper', 'late_night')
                    OR (mealSlot = 'lunch_dinner' AND NOT (HOUR(occurredAt) >= 10 AND HOUR(occurredAt) < 15))
                  THEN DATE(occurredAt)
                END)
              )
            END AS lunchDinnerAvg,
            COUNT(DISTINCT CASE WHEN mealSlot = 'breakfast' THEN DATE(occurredAt) END) AS breakfastDaysCount,
            COUNT(
              DISTINCT CASE
                WHEN mealSlot = 'lunch'
                  OR mealSlot IN ('dinner', 'night', 'night_snack', 'supper', 'late_night')
                  OR mealSlot = 'lunch_dinner'
                THEN DATE(occurredAt)
              END
            ) AS lunchDinnerDaysCount,
            COUNT(DISTINCT DATE(occurredAt)) AS daysCount
          FROM \`${actualTableName}\`
          WHERE amount > 0
            AND mealSlot IN ('breakfast', 'lunch', 'dinner', 'lunch_dinner', 'night', 'night_snack', 'supper', 'late_night')
            AND studentNo IN (${placeholders})
          GROUP BY studentNo
        `,
        ...studentNos
      );

      for (const row of stats) {
        metricMap.set(row.studentNo, {
          breakfastAvg: safeNullableNumber(row.breakfastAvg),
          lunchDinnerAvg: safeNullableNumber(row.lunchDinnerAvg),
          breakfastDaysCount: Math.max(0, Math.floor(safeNumber(row.breakfastDaysCount))),
          lunchDinnerDaysCount: Math.max(0, Math.floor(safeNumber(row.lunchDinnerDaysCount))),
          daysCount: Math.max(0, Math.floor(safeNumber(row.daysCount))),
        });
      }
    }

    let changed = 0;
    for (let i = 0; i < candidates.length; i += 200) {
      const chunk = candidates.slice(i, i + 200);
      const ops = chunk.map((item) => {
        const metrics = metricMap.get(item.student.studentId);
        const averageSpendLabel = metrics
          ? formatAverageSpendLabel(metrics.breakfastAvg, metrics.lunchDinnerAvg)
          : '无有效消费';
        const daysCount = metrics?.daysCount ?? 0;
        const shouldUpdate = item.averageSpendLabel !== averageSpendLabel || item.daysCount !== daysCount;
        if (shouldUpdate) {
          changed += 1;
        }
        return prisma.candidateResult.update({
          where: { id: item.id },
          data: {
            averageSpendLabel,
            daysCount,
          },
        });
      });
      await prisma.$transaction(ops);
    }

    return changed;
  }

  private async loadMonthlyMetricContext(
    month: string,
    activeStudentNoSet: Set<string>,
    standardPercentile: number,
    basePercentile = 0.5
  ): Promise<MonthlyMetricContext | null> {
    const tableName = monthToTableName(month);
    if (!tableName) {
      return null;
    }

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
      return null;
    }
    const actualTableName = tableRows[0].TABLE_NAME;

    const rows = await prisma.$queryRawUnsafe<
      Array<{
        studentNo: string;
        breakfastCount: unknown;
        breakfastTotal: unknown;
        breakfastAvg: unknown;
        breakfastDaysCount: unknown;
        lunchDinnerCount: unknown;
        lunchDinnerTotal: unknown;
        lunchDinnerAvg: unknown;
        lunchDinnerDaysCount: unknown;
        daysCount: unknown;
        totalAmount: unknown;
        totalAvg: unknown;
      }>
    >(
      `
        SELECT
          studentNo,
          COUNT(DISTINCT CASE WHEN mealSlot = 'breakfast' THEN DATE(occurredAt) END) AS breakfastCount,
          SUM(CASE WHEN mealSlot = 'breakfast' THEN amount ELSE 0 END) AS breakfastTotal,
          CASE
            WHEN COUNT(DISTINCT CASE WHEN mealSlot = 'breakfast' THEN DATE(occurredAt) END) = 0 THEN NULL
            ELSE SUM(CASE WHEN mealSlot = 'breakfast' THEN amount ELSE 0 END)
              / COUNT(DISTINCT CASE WHEN mealSlot = 'breakfast' THEN DATE(occurredAt) END)
          END AS breakfastAvg,
          COUNT(DISTINCT CASE WHEN mealSlot = 'breakfast' THEN DATE(occurredAt) END) AS breakfastDaysCount,
          (
            COUNT(DISTINCT CASE
              WHEN mealSlot = 'lunch' OR (mealSlot = 'lunch_dinner' AND HOUR(occurredAt) >= 10 AND HOUR(occurredAt) < 15)
              THEN DATE(occurredAt)
            END)
            + COUNT(DISTINCT CASE
              WHEN mealSlot IN ('dinner', 'night', 'night_snack', 'supper', 'late_night')
                OR (mealSlot = 'lunch_dinner' AND NOT (HOUR(occurredAt) >= 10 AND HOUR(occurredAt) < 15))
              THEN DATE(occurredAt)
            END)
          ) AS lunchDinnerCount,
          (
            SUM(CASE WHEN mealSlot = 'lunch' OR (mealSlot = 'lunch_dinner' AND HOUR(occurredAt) >= 10 AND HOUR(occurredAt) < 15) THEN amount ELSE 0 END)
            + SUM(CASE
              WHEN mealSlot IN ('dinner', 'night', 'night_snack', 'supper', 'late_night')
                OR (mealSlot = 'lunch_dinner' AND NOT (HOUR(occurredAt) >= 10 AND HOUR(occurredAt) < 15))
              THEN amount ELSE 0 END)
          ) AS lunchDinnerTotal,
          CASE
            WHEN (
              COUNT(DISTINCT CASE
                WHEN mealSlot = 'lunch' OR (mealSlot = 'lunch_dinner' AND HOUR(occurredAt) >= 10 AND HOUR(occurredAt) < 15)
                THEN DATE(occurredAt)
              END)
              + COUNT(DISTINCT CASE
                WHEN mealSlot IN ('dinner', 'night', 'night_snack', 'supper', 'late_night')
                  OR (mealSlot = 'lunch_dinner' AND NOT (HOUR(occurredAt) >= 10 AND HOUR(occurredAt) < 15))
                THEN DATE(occurredAt)
              END)
            ) = 0 THEN NULL
            ELSE (
              SUM(CASE WHEN mealSlot = 'lunch' OR (mealSlot = 'lunch_dinner' AND HOUR(occurredAt) >= 10 AND HOUR(occurredAt) < 15) THEN amount ELSE 0 END)
              + SUM(CASE
                WHEN mealSlot IN ('dinner', 'night', 'night_snack', 'supper', 'late_night')
                  OR (mealSlot = 'lunch_dinner' AND NOT (HOUR(occurredAt) >= 10 AND HOUR(occurredAt) < 15))
                THEN amount ELSE 0 END)
            ) / (
              COUNT(DISTINCT CASE
                WHEN mealSlot = 'lunch' OR (mealSlot = 'lunch_dinner' AND HOUR(occurredAt) >= 10 AND HOUR(occurredAt) < 15)
                THEN DATE(occurredAt)
              END)
              + COUNT(DISTINCT CASE
                WHEN mealSlot IN ('dinner', 'night', 'night_snack', 'supper', 'late_night')
                  OR (mealSlot = 'lunch_dinner' AND NOT (HOUR(occurredAt) >= 10 AND HOUR(occurredAt) < 15))
                THEN DATE(occurredAt)
              END)
            )
          END AS lunchDinnerAvg,
          COUNT(
            DISTINCT CASE
              WHEN mealSlot = 'lunch'
                OR mealSlot IN ('dinner', 'night', 'night_snack', 'supper', 'late_night')
                OR mealSlot = 'lunch_dinner'
              THEN DATE(occurredAt)
            END
          ) AS lunchDinnerDaysCount,
          COUNT(DISTINCT DATE(occurredAt)) AS daysCount,
          SUM(amount) AS totalAmount,
          AVG(amount) AS totalAvg
        FROM \`${actualTableName}\`
        WHERE amount > 0
          AND mealSlot IN ('breakfast', 'lunch', 'dinner', 'lunch_dinner', 'night', 'night_snack', 'supper', 'late_night')
        GROUP BY studentNo
      `
    );

    const metrics = rows
      .filter((row) => activeStudentNoSet.has(row.studentNo))
      .map((row) => ({
        studentNo: row.studentNo,
        breakfastCount: Math.max(0, Math.floor(safeNumber(row.breakfastCount))),
        breakfastTotal: safeNumber(row.breakfastTotal),
        breakfastAvg: safeNullableNumber(row.breakfastAvg),
        breakfastDaysCount: Math.max(0, Math.floor(safeNumber(row.breakfastDaysCount))),
        lunchDinnerCount: Math.max(0, Math.floor(safeNumber(row.lunchDinnerCount))),
        lunchDinnerTotal: safeNumber(row.lunchDinnerTotal),
        lunchDinnerAvg: safeNullableNumber(row.lunchDinnerAvg),
        lunchDinnerDaysCount: Math.max(0, Math.floor(safeNumber(row.lunchDinnerDaysCount))),
        daysCount: Math.max(0, Math.floor(safeNumber(row.daysCount))),
        totalAmount: safeNumber(row.totalAmount),
        totalAvg: safeNumber(row.totalAvg),
      }));
    if (metrics.length === 0) {
      return null;
    }

    const breakfastValues = metrics.map((item) => item.breakfastAvg);
    const lunchDinnerValues = metrics.map((item) => item.lunchDinnerAvg);
    return {
      month,
      monthDays: daysInMonth(month),
      metricsByStudentNo: new Map(metrics.map((item) => [item.studentNo, item])),
      breakfastStandard: percentileThreshold(breakfastValues, standardPercentile),
      lunchDinnerStandard: percentileThreshold(lunchDinnerValues, standardPercentile),
      breakfastBase: percentileThreshold(breakfastValues, basePercentile),
      lunchDinnerBase: percentileThreshold(lunchDinnerValues, basePercentile),
      breakfastBottom10: percentileThreshold(breakfastValues, 0.1),
      lunchDinnerBottom10: percentileThreshold(lunchDinnerValues, 0.1),
    };
  }

  private async refreshFinalSubsidyResults(batchId: string, month: string) {
    const [batch, systemConfig, activeStudents] = await Promise.all([
      prisma.subsidyBatch.findUnique({ where: { id: batchId } }),
      prisma.systemConfig.findUnique({ where: { id: 1 } }),
      prisma.student.findMany({
        where: activeStudentWhere(),
        select: { studentId: true },
      }),
    ]);

    if (!batch) {
      return;
    }
    if (!systemConfig) {
      return;
    }

    const standardPercentile = Math.min(1, Math.max(0.01, systemConfig.standardPercentile ?? 0.25));
    const basePercentile = Math.min(1, Math.max(0.01, systemConfig.basePercentile ?? 0.5));
    const subsidyLimit = Number(systemConfig.subsidyLimit);
    const finalRatio = Math.min(1, Math.max(0, batch.finalRatio ?? 0.015));

    const activeStudentNoSet = new Set(activeStudents.map((item) => item.studentId));
    const context = await this.loadMonthlyMetricContext(month, activeStudentNoSet, standardPercentile, basePercentile);
    if (!context) {
      return;
    }

    const measurableCandidates = await prisma.candidateResult.findMany({
      where: {
        batchId,
        month,
        workflowStatus: {
          notIn: ['counselor_rejected', 'college_rejected', 'final_rejected', 'not_included'],
        },
      },
      include: {
        student: true,
      },
      orderBy: [{ rank: 'asc' }, { studentId: 'asc' }],
    });

    const baseBreakfast = context.breakfastBase ?? 0;
    const baseLunchDinner = context.lunchDinnerBase ?? 0;
    const limit = Number.isFinite(subsidyLimit) ? Math.max(0, subsidyLimit) : 500;
    const minConsumeDays = Math.ceil(context.monthDays / 2);

    const computed = measurableCandidates.map((candidate) => {
      const studentNo = candidate.student.studentId;
      const metric = context.metricsByStudentNo.get(studentNo);
      const breakfastEligible = Boolean(metric && metric.breakfastDaysCount >= minConsumeDays);
      const lunchDinnerEligible = Boolean(metric && metric.lunchDinnerDaysCount >= minConsumeDays);
      const eligible = breakfastEligible || lunchDinnerEligible;
      const breakfastSubsidyRaw =
        metric && breakfastEligible && metric.breakfastCount > 0
          ? baseBreakfast * metric.breakfastCount - metric.breakfastTotal
          : 0;
      const lunchDinnerSubsidyRaw =
        metric && lunchDinnerEligible && metric.lunchDinnerCount > 0
          ? baseLunchDinner * metric.lunchDinnerCount - metric.lunchDinnerTotal
          : 0;

      const breakfastSubsidy = Math.max(0, breakfastSubsidyRaw);
      const lunchDinnerSubsidy = Math.max(0, lunchDinnerSubsidyRaw);
      const totalSubsidy = eligible ? Math.min(limit, breakfastSubsidy + lunchDinnerSubsidy) : 0;
      return {
        candidate,
        studentNo,
        eligible,
        breakfastSubsidy,
        lunchDinnerSubsidy,
        totalSubsidy,
      };
    });

    const ranked = computed.filter((item) => item.eligible).sort((a, b) => {
      if (b.totalSubsidy !== a.totalSubsidy) {
        return b.totalSubsidy - a.totalSubsidy;
      }
      if ((a.candidate.rank ?? 0) !== (b.candidate.rank ?? 0)) {
        return (a.candidate.rank ?? 0) - (b.candidate.rank ?? 0);
      }
      return a.studentNo.localeCompare(b.studentNo);
    });
    const selectedCount = ranked.length === 0 ? 0 : Math.max(1, Math.ceil(ranked.length * finalRatio));
    const selectedCandidateIds = new Set(ranked.slice(0, selectedCount).map((item) => item.candidate.id));
    const finalRankByCandidateId = new Map(ranked.map((item, index) => [item.candidate.id, index + 1]));

    const ops = computed.map((item) => {
      const { candidate, studentNo, eligible, breakfastSubsidy, lunchDinnerSubsidy, totalSubsidy } = item;
      const selected = eligible && (candidate.workflowStatus === 'included' ? true : selectedCandidateIds.has(candidate.id));
      const finalRank = eligible ? (finalRankByCandidateId.get(candidate.id) ?? candidate.rank) : null;

      return prisma.finalSubsidyResult.upsert({
        where: {
          batchId_studentId: {
            batchId,
            studentId: candidate.studentId,
          },
        },
        create: {
          id: `${studentNo}-${month}-final-live`,
          batchId,
          studentId: candidate.studentId,
          finalDecision: candidate.workflowStatus,
          selected,
          finalRank,
          breakfastSubsidy: breakfastSubsidy.toFixed(2),
          lunchDinnerSubsidy: lunchDinnerSubsidy.toFixed(2),
          totalSubsidy: totalSubsidy.toFixed(2),
        },
        update: {
          finalDecision: candidate.workflowStatus,
          selected,
          finalRank,
          breakfastSubsidy: breakfastSubsidy.toFixed(2),
          lunchDinnerSubsidy: lunchDinnerSubsidy.toFixed(2),
          totalSubsidy: totalSubsidy.toFixed(2),
        },
      });
    });

    if (ops.length > 0) {
      await prisma.$transaction(ops);
    }
  }

  private async clearBatchCandidates(batchId: string, month: string) {
    const existing = await prisma.candidateResult.findMany({
      where: {
        batchId,
        month,
      },
      select: { id: true },
    });
    const candidateIds = existing.map((item) => item.id);
    if (candidateIds.length > 0) {
      await prisma.candidateHitRule.deleteMany({
        where: {
          candidateResultId: {
            in: candidateIds,
          },
        },
      });
    }

    await prisma.candidateResult.deleteMany({
      where: {
        batchId,
        month,
      },
    });
    await prisma.candidateListSnapshot.deleteMany({
      where: { month },
    });
  }

  private async resolveMonthlyP50(month: string) {
    const now = Date.now();
    if (monthlyP50Cache && monthlyP50Cache.month === month && now - monthlyP50Cache.computedAt < 5 * 60 * 1000) {
      return {
        breakfastP50: monthlyP50Cache.breakfastP50,
        lunchDinnerP50: monthlyP50Cache.lunchDinnerP50,
      };
    }

    let breakfastP50 = 0;
    let lunchDinnerP50 = 0;
    const rows = await prisma.$queryRawUnsafe<Array<{ breakfastP50: unknown; lunchDinnerP50: unknown }>>(
      `
        SELECT
          (
            SELECT t.breakfastAvg
            FROM (
              SELECT
                sms.breakfastAvg,
                ROW_NUMBER() OVER (ORDER BY sms.breakfastAvg) AS rn,
                COUNT(*) OVER () AS cnt
              FROM \`StudentMonthStat\` sms
              WHERE sms.month = ?
                AND sms.breakfastCount > 0
            ) t
            WHERE t.rn = GREATEST(1, CEIL(t.cnt * 0.5))
            LIMIT 1
          ) AS breakfastP50,
          (
            SELECT t.lunchDinnerAvg
            FROM (
              SELECT
                sms.lunchDinnerAvg,
                ROW_NUMBER() OVER (ORDER BY sms.lunchDinnerAvg) AS rn,
                COUNT(*) OVER () AS cnt
              FROM \`StudentMonthStat\` sms
              WHERE sms.month = ?
                AND sms.lunchDinnerCount > 0
            ) t
            WHERE t.rn = GREATEST(1, CEIL(t.cnt * 0.5))
            LIMIT 1
          ) AS lunchDinnerP50
      `,
      month,
      month
    );
    breakfastP50 = toAmount(rows[0]?.breakfastP50);
    lunchDinnerP50 = toAmount(rows[0]?.lunchDinnerP50);

    if (breakfastP50 <= 0 && lunchDinnerP50 <= 0) {
      const tableName = monthToTableName(month);
      if (tableName) {
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
        const actualTableName = tableRows[0]?.TABLE_NAME;
        if (actualTableName) {
          const fallbackRows = await prisma.$queryRawUnsafe<Array<{ breakfastP50: unknown; lunchDinnerP50: unknown }>>(
            `
              WITH per_student AS (
                SELECT
                  studentNo,
                  CASE
                    WHEN COUNT(DISTINCT CASE WHEN mealSlot = 'breakfast' THEN DATE(occurredAt) END) = 0 THEN NULL
                    ELSE SUM(CASE WHEN mealSlot = 'breakfast' THEN amount ELSE 0 END)
                      / COUNT(DISTINCT CASE WHEN mealSlot = 'breakfast' THEN DATE(occurredAt) END)
                  END AS breakfastAvg,
                  CASE
                    WHEN (
                      COUNT(DISTINCT CASE
                        WHEN mealSlot = 'lunch' OR (mealSlot = 'lunch_dinner' AND HOUR(occurredAt) >= 10 AND HOUR(occurredAt) < 15)
                        THEN DATE(occurredAt)
                      END)
                      + COUNT(DISTINCT CASE
                        WHEN mealSlot IN ('dinner', 'night', 'night_snack', 'supper', 'late_night')
                          OR (mealSlot = 'lunch_dinner' AND NOT (HOUR(occurredAt) >= 10 AND HOUR(occurredAt) < 15))
                        THEN DATE(occurredAt)
                      END)
                    ) = 0 THEN NULL
                    ELSE (
                      SUM(CASE WHEN mealSlot = 'lunch' OR (mealSlot = 'lunch_dinner' AND HOUR(occurredAt) >= 10 AND HOUR(occurredAt) < 15) THEN amount ELSE 0 END)
                      + SUM(CASE
                        WHEN mealSlot IN ('dinner', 'night', 'night_snack', 'supper', 'late_night')
                          OR (mealSlot = 'lunch_dinner' AND NOT (HOUR(occurredAt) >= 10 AND HOUR(occurredAt) < 15))
                        THEN amount ELSE 0 END)
                    ) / (
                      COUNT(DISTINCT CASE
                        WHEN mealSlot = 'lunch' OR (mealSlot = 'lunch_dinner' AND HOUR(occurredAt) >= 10 AND HOUR(occurredAt) < 15)
                        THEN DATE(occurredAt)
                      END)
                      + COUNT(DISTINCT CASE
                        WHEN mealSlot IN ('dinner', 'night', 'night_snack', 'supper', 'late_night')
                          OR (mealSlot = 'lunch_dinner' AND NOT (HOUR(occurredAt) >= 10 AND HOUR(occurredAt) < 15))
                        THEN DATE(occurredAt)
                      END)
                    )
                  END AS lunchDinnerAvg
                FROM \`${actualTableName}\`
                WHERE amount > 0
                  AND mealSlot IN ('breakfast', 'lunch', 'dinner', 'lunch_dinner', 'night', 'night_snack', 'supper', 'late_night')
                GROUP BY studentNo
              )
              SELECT
                (
                  SELECT x.breakfastAvg
                  FROM (
                    SELECT breakfastAvg, ROW_NUMBER() OVER (ORDER BY breakfastAvg) AS rn, COUNT(*) OVER () AS cnt
                    FROM per_student
                    WHERE breakfastAvg IS NOT NULL
                  ) x
                  WHERE x.rn = GREATEST(1, CEIL(x.cnt * 0.5))
                  LIMIT 1
                ) AS breakfastP50,
                (
                  SELECT x.lunchDinnerAvg
                  FROM (
                    SELECT lunchDinnerAvg, ROW_NUMBER() OVER (ORDER BY lunchDinnerAvg) AS rn, COUNT(*) OVER () AS cnt
                    FROM per_student
                    WHERE lunchDinnerAvg IS NOT NULL
                  ) x
                  WHERE x.rn = GREATEST(1, CEIL(x.cnt * 0.5))
                  LIMIT 1
                ) AS lunchDinnerP50
            `
          );
          breakfastP50 = toAmount(fallbackRows[0]?.breakfastP50);
          lunchDinnerP50 = toAmount(fallbackRows[0]?.lunchDinnerP50);
        }
      }
    }

    monthlyP50Cache = {
      month,
      breakfastP50,
      lunchDinnerP50,
      computedAt: now,
    };

    return { breakfastP50, lunchDinnerP50 };
  }

  private async loadStudentMonthlySnapshot(studentRowId: string, studentNo: string, month: string) {
    const batch = await prisma.subsidyBatch.findUnique({
      where: { month },
      select: { id: true },
    });
    const monthStat = batch
      ? await prisma.studentMonthStat.findUnique({
          where: {
            batchId_studentId: {
              batchId: batch.id,
              studentId: studentRowId,
            },
          },
        })
      : null;
    const fallbackStat = await this.loadStudentMonthStatFromTransactions(studentNo, month);
    const resolved = monthStat ?? fallbackStat;
    if (!resolved) return null;
    const p50 = await this.resolveMonthlyP50(month);
    const breakfastDaysCount = fallbackStat?.breakfastDaysCount ?? (resolved.breakfastCount ?? 0);
    const lunchDinnerDaysCount = fallbackStat?.lunchDinnerDaysCount ?? (resolved.lunchDinnerCount ?? 0);
    return {
      month,
      label: `${month.slice(5)}月`,
      breakfastCount: resolved.breakfastCount ?? 0,
      breakfastTotal: toAmount(resolved.breakfastTotal),
      breakfastAvg: toAmount(resolved.breakfastAvg),
      breakfastDaysCount,
      lunchDinnerCount: resolved.lunchDinnerCount ?? 0,
      lunchDinnerTotal: toAmount(resolved.lunchDinnerTotal),
      lunchDinnerAvg: toAmount(resolved.lunchDinnerAvg),
      lunchDinnerDaysCount,
      breakfastP50: p50.breakfastP50,
      lunchDinnerP50: p50.lunchDinnerP50,
      daysCount: resolved.daysCount ?? 0,
      totalAmount: toAmount(resolved.totalAmount),
    };
  }

  async listStudents() {
    const students = await prisma.student.findMany({
      where: activeStudentWhere(),
      include: {
        relations: {
          include: {
            counselor: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
        },
      },
      orderBy: {
        studentId: 'asc',
      },
    });

    const counselorEmployeeNos = students
      .map((student) => student.relations[0]?.counselor.employeeNo ?? '')
      .map((item) => String(item ?? '').trim())
      .filter(Boolean);
    const counselorNameByEmployeeNo = await this.loadCounselorNameByEmployeeNo(counselorEmployeeNos);

    return students.map((student) => ({
      id: student.studentId,
      name: student.name,
      college: studentCollege(student),
      className: studentClassCode(student),
      counselor: (() => {
        const counselor = student.relations[0]?.counselor;
        if (!counselor) return '-';
        const employeeNo = String(counselor.employeeNo ?? '').trim();
        if (employeeNo && counselorNameByEmployeeNo.has(employeeNo)) {
          return counselorNameByEmployeeNo.get(employeeNo) as string;
        }
        const name = String(counselor.name ?? '').trim();
        return name || employeeNo || '-';
      })(),
      isSpecialDifficulty: false,
    }));
  }

  async getCandidateSnapshot(
    month: string,
    page = 1,
    pageSize = 100,
    context?: AccessContext,
    filters?: CandidateSnapshotFilters
  ): Promise<CandidateListResponse> {
    const normalizedPage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
    const normalizedPageSize = Number.isFinite(pageSize) ? Math.max(1, Math.min(500, Math.floor(pageSize))) : 100;
    const batch = await prisma.subsidyBatch.findUnique({ where: { month } });
    if (!batch) {
      throw new Error(`认定批次不存在：${month}。请先在“认定批次管理”发起该月份批次。`);
    }

    let candidateCount = await prisma.candidateResult.count({
      where: {
        month,
        batchId: batch.id,
      },
    });

    if (candidateCount > 0 && batch.ruleVersion !== CANDIDATE_RULE_VERSION) {
      const progressedCount = await prisma.candidateResult.count({
        where: {
          month,
          batchId: batch.id,
          workflowStatus: {
            not: 'pending_counselor',
          },
        },
      });
      if (progressedCount === 0) {
        await this.clearBatchCandidates(batch.id, month);
        candidateCount = 0;
      }
    }

    let subsidyNeedsRefresh = false;

    if (candidateCount === 0) {
      const generated = await this.generateCandidatesFromMonthlyTransactions(batch.id, month);
      if (generated > 0) {
        await prisma.subsidyBatch.update({
          where: { id: batch.id },
          data: {
            ruleVersion: CANDIDATE_RULE_VERSION,
          },
        });
        candidateCount = await prisma.candidateResult.count({
          where: {
            month,
            batchId: batch.id,
          },
        });
        await this.rebuildCandidateListSnapshot(month, batch.id);
        subsidyNeedsRefresh = true;
      } else {
      }
    }

    let needsSnapshotRebuild = false;
    if (candidateCount > 0) {
      const legacyLabelCount = await prisma.candidateResult.count({
        where: {
          month,
          batchId: batch.id,
          averageSpendLabel: {
            contains: '楼0.0',
          },
          daysCount: {
            gt: 0,
          },
        },
      });
      if (legacyLabelCount > 0) {
        const changed = await this.refreshCandidateSpendMetricsFromTransactions(month, batch.id);
        needsSnapshotRebuild = changed > 0;
      }
    }

    const snapshotCount = await prisma.candidateListSnapshot.count({ where: { month } });
    if (needsSnapshotRebuild || snapshotCount === 0 || snapshotCount !== candidateCount) {
      await this.rebuildCandidateListSnapshot(month, batch.id);
      subsidyNeedsRefresh = true;
    }

    if (candidateCount > 0 && subsidyNeedsRefresh) {
      await this.refreshFinalSubsidyResults(batch.id, month);
    }

    const [{ total, items }, pendingCount] = await Promise.all([
      this.readCandidateListSnapshot(month, normalizedPage, normalizedPageSize, context, filters),
      context?.role === 'counselor' && !String(context.id ?? '').trim()
        ? Promise.resolve(0)
        : this.isCounselorScope(context)
          ? prisma.$queryRawUnsafe<Array<{ total: unknown }>>(
              `
                SELECT COUNT(1) AS total
                FROM \`CandidateListSnapshot\` cls
                WHERE cls.month = ?
                  AND cls.workflowStatus IN ('pending_counselor', 'pending_college', 'pending_funding_office', 'pending_final')
                  AND EXISTS (
                    SELECT 1
                    FROM \`Student\` ss
                    INNER JOIN \`CounselorStudentRelation\` csr ON csr.studentId = ss.id
                    WHERE ss.studentId COLLATE utf8mb4_unicode_ci = cls.studentId COLLATE utf8mb4_unicode_ci
                      AND csr.counselorId = ?
                  )
              `,
              month,
              String(context?.id ?? '').trim()
            ).then((rows) => Number(rows[0]?.total ?? 0))
          : prisma.candidateListSnapshot.count({
              where: {
                month,
      workflowStatus: {
        in: ['pending_counselor', 'pending_college', 'pending_funding_office', 'pending_final'],
      },
              },
            }),
    ]);
    const totalPages = total === 0 ? 1 : Math.ceil(total / normalizedPageSize);

    return {
      month,
      batch: {
        id: batch.id,
        month: batch.month,
        status: batch.status as never,
        progress: batch.progress,
        startTime: formatDate(batch.startTime),
        endTime: batch.endTime ? formatDate(batch.endTime) : undefined,
        stats: {
          total,
          confirmed: total - pendingCount,
          pending: pendingCount,
        },
      },
      items,
      pagination: {
        page: normalizedPage,
        pageSize: normalizedPageSize,
        total,
        totalPages,
      },
    };
  }

  private async generateCandidatesFromMonthlyTransactions(batchId: string, month: string) {
    const batch = await prisma.subsidyBatch.findUnique({
      where: { id: batchId },
      select: {
        id: true,
        month: true,
        standardPercentile: true,
      },
    });
    if (!batch) {
      return 0;
    }

    const activeStudents = await prisma.student.findMany({
      where: activeStudentWhere(),
      select: {
        id: true,
        studentId: true,
      },
    });
    if (activeStudents.length === 0) {
      return 0;
    }

    const activeStudentNoSet = new Set(activeStudents.map((item) => item.studentId));
    const studentRowIdByStudentNo = new Map(activeStudents.map((item) => [item.studentId, item.id]));
    const standardPercentile = Math.min(1, Math.max(0.01, batch.standardPercentile || 0.25));
    const currentContext = await this.loadMonthlyMetricContext(month, activeStudentNoSet, standardPercentile);
    if (!currentContext || currentContext.metricsByStudentNo.size === 0) {
      return 0;
    }

    // Persist monthly snapshot for the recalculated month so historical runs are queryable from StudentMonthStat.
    await prisma.studentMonthStat.deleteMany({ where: { batchId, month } });
    const monthStatRows = Array.from(currentContext.metricsByStudentNo.values())
      .map((metric) => {
        const studentRowId = studentRowIdByStudentNo.get(metric.studentNo);
        if (!studentRowId) return null;
        return {
          batchId,
          studentId: studentRowId,
          month,
          breakfastCount: Math.max(0, Math.floor(metric.breakfastCount)),
          breakfastTotal: metric.breakfastTotal,
          breakfastAvg: metric.breakfastAvg ?? 0,
          lunchDinnerCount: Math.max(0, Math.floor(metric.lunchDinnerCount)),
          lunchDinnerTotal: metric.lunchDinnerTotal,
          lunchDinnerAvg: metric.lunchDinnerAvg ?? 0,
          daysCount: Math.max(0, Math.floor(metric.daysCount)),
          attendanceDays: currentContext.monthDays,
          totalAmount: metric.totalAmount,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
    for (let i = 0; i < monthStatRows.length; i += 1000) {
      await prisma.studentMonthStat.createMany({
        data: monthStatRows.slice(i, i + 1000),
      });
    }

    const activeStudentRowIds = activeStudents.map((item) => item.id);
    const difficultyRows = await prisma.undergraduateDifficultyRecognition.findMany({
      where: {
        studentId: {
          in: activeStudentRowIds,
        },
      },
      select: {
        studentId: true,
        difficultyLevel: true,
        startAcademicYear: true,
        endAcademicYear: true,
        semester: true,
        updatedAt: true,
      },
      orderBy: [
        { studentId: 'asc' },
        { updatedAt: 'desc' },
      ],
    });
    const latestDifficultyByStudentRowId = new Map<string, string>();
    const latestDifficultyRowByStudentRowId = new Map<
      string,
      {
        difficultyLevel: string;
        startAcademicYear: string;
        endAcademicYear: string;
        semester: string;
        updatedAt: Date;
      }
    >();

    // Determine the latest effective term from the whole difficulty table
    // (not only current active students), then apply that term to all candidate calculations.
    const currentTerm = await prisma.undergraduateDifficultyRecognition.findFirst({
      select: {
        startAcademicYear: true,
        endAcademicYear: true,
        semester: true,
      },
      orderBy: [
        { startAcademicYear: 'desc' },
        { endAcademicYear: 'desc' },
        { semester: 'desc' },
        { updatedAt: 'desc' },
      ],
    });

    for (const row of difficultyRows) {
      if (!currentTerm) {
        break;
      }
      if (
        row.startAcademicYear !== currentTerm.startAcademicYear ||
        row.endAcademicYear !== currentTerm.endAcademicYear ||
        row.semester !== currentTerm.semester
      ) {
        continue;
      }
      if (latestDifficultyRowByStudentRowId.has(row.studentId)) {
        continue;
      }
      latestDifficultyRowByStudentRowId.set(row.studentId, {
        difficultyLevel: row.difficultyLevel,
        startAcademicYear: row.startAcademicYear,
        endAcademicYear: row.endAcademicYear,
        semester: row.semester,
        updatedAt: row.updatedAt,
      });
    }

    for (const [studentRowId, row] of latestDifficultyRowByStudentRowId.entries()) {
      latestDifficultyByStudentRowId.set(studentRowId, row.difficultyLevel);
    }

    const difficultyDict = await prisma.dictionaryItem.findMany({
      where: {
        dictType: 'difficulty_level',
        enabled: true,
      },
      select: {
        code: true,
        isSpecialDifficulty: true,
      },
    });
    const specialDifficultyCodeSet = new Set(
      difficultyDict.filter((item) => item.isSpecialDifficulty).map((item) => (item.code ?? '').trim()).filter(Boolean)
    );

    const specialStudentRowIds = new Set(
      Array.from(latestDifficultyByStudentRowId.entries())
        .filter(([, level]) => {
          const normalizedLevel = (level ?? '').trim();
          if (normalizedLevel && specialDifficultyCodeSet.has(normalizedLevel)) {
            return true;
          }
          return false;
        })
        .map(([studentRowId]) => studentRowId)
    );

    const candidates: Array<{
      studentNo: string;
      studentRowId: string;
      candidateType: 'special_difficulty';
      typeLabel: string;
      averageSpendLabel: string;
      daysCount: number;
      totalAvg: number;
      hitRules: string[];
    }> = [];

    for (const [studentNo, currentMetric] of currentContext.metricsByStudentNo.entries()) {
      const studentRowId = studentRowIdByStudentNo.get(studentNo);
      if (!studentRowId) {
        continue;
      }
      const currentAttendanceDays = currentContext.monthDays;
      const currentHalfDays = Math.ceil(currentAttendanceDays / 2);
      const currentMealDayEligible =
        currentMetric.breakfastDaysCount >= currentHalfDays ||
        currentMetric.lunchDinnerDaysCount >= currentHalfDays;
      const isSpecial = specialStudentRowIds.has(studentRowId);
      const breakfastOk =
        currentMetric.breakfastAvg != null &&
        currentContext.breakfastStandard != null &&
        currentMetric.breakfastAvg <= currentContext.breakfastStandard;
      const lunchDinnerOk =
        currentMetric.lunchDinnerAvg != null &&
        currentContext.lunchDinnerStandard != null &&
        currentMetric.lunchDinnerAvg <= currentContext.lunchDinnerStandard;
      // Accept students who only have either breakfast or lunch/dinner consumption records.
      // If both slots have records, both must be under the standard threshold.
      const specialCond2 =
        (breakfastOk || lunchDinnerOk) &&
        (currentMetric.breakfastAvg == null || breakfastOk) &&
        (currentMetric.lunchDinnerAvg == null || lunchDinnerOk);
      const specialCond3 = currentMealDayEligible;

      if (isSpecial && specialCond2 && specialCond3) {
        candidates.push({
          studentNo,
          studentRowId,
          candidateType: 'special_difficulty',
          typeLabel: '特别困难',
          averageSpendLabel: formatAverageSpendLabel(currentMetric.breakfastAvg, currentMetric.lunchDinnerAvg),
          daysCount: currentMetric.daysCount,
          totalAvg: currentMetric.totalAvg,
          hitRules: [
            '学工系统登记为特别困难学生',
            '当月早餐、午晚餐单次平均消费不超过对应补助标准',
            '当月食堂消费天数达到当月总天数的一半及以上',
          ],
        });
        continue;
      }

    }

    if (candidates.length === 0) {
      await this.clearBatchCandidates(batchId, month);
      await this.rebuildCandidateListSnapshot(month, batchId);
      return 0;
    }

    candidates.sort((a, b) => {
      const typePriority = (type: string) => (type === 'special_difficulty' ? 0 : 1);
      return (a.totalAvg - b.totalAvg) || (typePriority(a.candidateType) - typePriority(b.candidateType)) || a.studentNo.localeCompare(b.studentNo);
    });

    await this.clearBatchCandidates(batchId, month);

    await prisma.candidateResult.createMany({
      data: candidates.map((item, index) => ({
        batchId,
        studentId: item.studentRowId,
        month,
        candidateType: item.candidateType,
        typeLabel: item.typeLabel,
        workflowStatus: 'pending_counselor',
        workflowStatusLabel: '待辅导员确认',
        currentStage: 'counselor',
        averageSpendLabel: item.averageSpendLabel,
        daysCount: item.daysCount,
        rank: index + 1,
        included: true,
      })),
    });

    const createdCandidates = await prisma.candidateResult.findMany({
      where: {
        batchId,
        month,
      },
      select: {
        id: true,
        student: {
          select: {
            studentId: true,
          },
        },
      },
    });
    const idByStudentNo = new Map(
      createdCandidates.map((item) => [item.student.studentId, item.id] as const)
    );
    const hitRuleRows: Array<{ candidateResultId: string; ruleCode: string; ruleText: string }> = [];
    for (const item of candidates) {
      const candidateId = idByStudentNo.get(item.studentNo);
      if (!candidateId) {
        continue;
      }
      for (let index = 0; index < item.hitRules.length; index += 1) {
        hitRuleRows.push({
          candidateResultId: candidateId,
          ruleCode: `${item.candidateType}_rule_${index + 1}`,
          ruleText: item.hitRules[index],
        });
      }
    }
    if (hitRuleRows.length > 0) {
      await prisma.candidateHitRule.createMany({
        data: hitRuleRows,
      });
    }

    await this.rebuildCandidateListSnapshot(month, batchId);

    return candidates.length;
  }

  async getStudentDetail(studentId: string, month?: string, context?: AccessContext): Promise<StudentDetail | null> {
    const targetMonthResult = this.normalizeMonthInput(month);
    if (!targetMonthResult.valid) {
      return null;
    }
    const targetMonth = targetMonthResult.value;
    const candidate = await prisma.candidateResult.findFirst({
      where: {
        student: {
          studentId,
          ...(this.isCounselorScope(context)
            ? {
                relations: {
                  some: {
                    counselorId: String(context?.id ?? '').trim(),
                  },
                },
              }
            : {}),
        },
        ...(targetMonth ? { month: targetMonth } : {}),
      },
      include: {
        student: {
          include: {
            relations: {
              include: {
                counselor: true,
              },
              orderBy: {
                createdAt: 'desc',
              },
              take: 1,
            },
            monthStats: {
              orderBy: {
                month: 'desc',
              },
              take: 1,
            },
            tagRecords: {
              orderBy: {
                generatedAt: 'desc',
              },
            },
            reviewRecords: {
              orderBy: {
                reviewedAt: 'desc',
              },
            },
            finalSubsidyResults: {
              orderBy: {
                createdAt: 'desc',
              },
              take: 1,
            },
          },
        },
        batch: true,
        hitRules: true,
      },
      orderBy: {
        month: 'desc',
      },
    });

    if (!candidate) {
      return null;
    }

    const monthStat = await prisma.studentMonthStat.findUnique({
      where: {
        batchId_studentId: {
          batchId: candidate.batchId,
          studentId: candidate.studentId,
        },
      },
    });
    const transactionMonthStat = await this.loadStudentMonthStatFromTransactions(
      candidate.student.studentId,
      candidate.month
    );
    const monthStatResolved = monthStat ?? transactionMonthStat;
    const breakfastDaysCountResolved =
      transactionMonthStat?.breakfastDaysCount ?? (monthStatResolved?.breakfastCount ?? 0);
    const lunchDinnerDaysCountResolved =
      transactionMonthStat?.lunchDinnerDaysCount ?? (monthStatResolved?.lunchDinnerCount ?? 0);
    const { breakfastP50, lunchDinnerP50 } = await this.resolveMonthlyP50(candidate.month);
    const finalResult = await prisma.finalSubsidyResult.findUnique({
      where: {
        batchId_studentId: {
          batchId: candidate.batchId,
          studentId: candidate.studentId,
        },
      },
    });
    const shouldRefreshFinalResult =
      !finalResult ||
      (
        candidate.workflowStatus !== 'counselor_rejected' &&
        candidate.workflowStatus !== 'college_rejected' &&
        candidate.workflowStatus !== 'final_rejected' &&
        candidate.workflowStatus !== 'not_included' &&
        (candidate.rank ?? 0) > 0 &&
        toAmount(finalResult.totalSubsidy) === 0
      );
    if (shouldRefreshFinalResult) {
      void this.refreshFinalSubsidyResults(candidate.batchId, candidate.month).catch(() => undefined);
    }

    const finalResultAfterRefresh = finalResult;
    const tags = candidate.student.tagRecords.filter((item) => item.batchId === candidate.batchId);
    const reviews = candidate.student.reviewRecords.filter((item) => item.batchId === candidate.batchId);
    const transactions = await this.loadMonthlyCafeteriaTransactions(candidate.student.studentId, candidate.month);
    const relationCounselor = candidate.student.relations[0]?.counselor;
    const relationCounselorEmployeeNo = String(relationCounselor?.employeeNo ?? '').trim();
    const relationCounselorNameMap = await this.loadCounselorNameByEmployeeNo(
      relationCounselorEmployeeNo ? [relationCounselorEmployeeNo] : []
    );
    const counselorDisplayName =
      relationCounselorEmployeeNo && relationCounselorNameMap.has(relationCounselorEmployeeNo)
        ? (relationCounselorNameMap.get(relationCounselorEmployeeNo) as string)
        : (String(relationCounselor?.name ?? '').trim() || relationCounselorEmployeeNo || '-');
    const trendMonths = Array.from(new Set([
      shiftMonth(candidate.month, -5),
      shiftMonth(candidate.month, -4),
      shiftMonth(candidate.month, -3),
      shiftMonth(candidate.month, -2),
      shiftMonth(candidate.month, -1),
      candidate.month,
      shiftMonth(candidate.month, -12),
    ].filter(Boolean)));
    const trendSnapshots = (
      await Promise.all(
        trendMonths.map((itemMonth) =>
          this.loadStudentMonthlySnapshot(candidate.studentId, candidate.student.studentId, itemMonth)
        )
      )
    ).filter((item): item is NonNullable<typeof item> => Boolean(item)).sort((a, b) => a.month.localeCompare(b.month));
    const currentTrend = trendSnapshots.find((item) => item.month === candidate.month) ?? {
      month: candidate.month,
      label: `${candidate.month.slice(5)}月`,
      breakfastCount: monthStatResolved?.breakfastCount ?? 0,
      breakfastTotal: toAmount(monthStatResolved?.breakfastTotal),
      breakfastAvg: toAmount(monthStatResolved?.breakfastAvg),
      breakfastDaysCount: breakfastDaysCountResolved,
      lunchDinnerCount: monthStatResolved?.lunchDinnerCount ?? 0,
      lunchDinnerTotal: toAmount(monthStatResolved?.lunchDinnerTotal),
      lunchDinnerAvg: toAmount(monthStatResolved?.lunchDinnerAvg),
      lunchDinnerDaysCount: lunchDinnerDaysCountResolved,
      breakfastP50,
      lunchDinnerP50,
      daysCount: monthStatResolved?.daysCount ?? 0,
      totalAmount: toAmount(monthStatResolved?.totalAmount),
    };
    const previousMonth = shiftMonth(candidate.month, -1);
    const yearAgoMonth = shiftMonth(candidate.month, -12);
    const previousTrend = trendSnapshots.find((item) => item.month === previousMonth) ?? null;
    const yearAgoTrend = trendSnapshots.find((item) => item.month === yearAgoMonth) ?? null;
    const recentMonths = trendSnapshots
      .filter((item) => item.month >= shiftMonth(candidate.month, -5))
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((item) => ({
        ...item,
        breakfastGapToP50: roundAmount(item.breakfastAvg - item.breakfastP50),
        lunchDinnerGapToP50: roundAmount(item.lunchDinnerAvg - item.lunchDinnerP50),
        breakfastActiveRate: safeRate(item.breakfastDaysCount, daysInMonth(item.month)),
        lunchDinnerActiveRate: safeRate(item.lunchDinnerDaysCount, daysInMonth(item.month)),
      }));

    return {
      id: candidate.id,
      studentId: candidate.student.studentId,
      month: candidate.month,
      batchId: candidate.batchId,
      name: candidate.student.name,
      college: studentCollege(candidate.student),
      className: studentClassCode(candidate.student),
      counselor: counselorDisplayName,
      type: candidate.candidateType as never,
      typeLabel: candidate.typeLabel,
      specialDifficulty: candidate.candidateType === 'special_difficulty',
      workflowStatus: candidate.workflowStatus as never,
      workflowStatusLabel: normalizeMojibakeText(candidate.workflowStatusLabel),
      currentStage: candidate.currentStage as never,
      monthlyStats: {
        breakfastCount: monthStatResolved?.breakfastCount ?? 0,
        breakfastTotal: toAmount(monthStatResolved?.breakfastTotal),
        breakfastAvg: toAmount(monthStatResolved?.breakfastAvg),
        breakfastDaysCount: breakfastDaysCountResolved,
        lunchDinnerCount: monthStatResolved?.lunchDinnerCount ?? 0,
        lunchDinnerTotal: toAmount(monthStatResolved?.lunchDinnerTotal),
        lunchDinnerAvg: toAmount(monthStatResolved?.lunchDinnerAvg),
        lunchDinnerDaysCount: lunchDinnerDaysCountResolved,
        breakfastP50,
        lunchDinnerP50,
        daysCount: monthStatResolved?.daysCount ?? 0,
        totalAmount: toAmount(monthStatResolved?.totalAmount),
      },
      consumptionAnalysis: {
        recentMonths,
        monthOverMonthBaseMonth: previousTrend?.month ?? null,
        yearOverYearBaseMonth: yearAgoTrend?.month ?? null,
        monthOverMonth: {
          totalAmount: buildMetricComparison(currentTrend.totalAmount, previousTrend?.totalAmount ?? null),
          breakfastAvg: buildMetricComparison(currentTrend.breakfastAvg, previousTrend?.breakfastAvg ?? null),
          lunchDinnerAvg: buildMetricComparison(currentTrend.lunchDinnerAvg, previousTrend?.lunchDinnerAvg ?? null),
          daysCount: buildMetricComparison(currentTrend.daysCount, previousTrend?.daysCount ?? null),
        },
        yearOverYear: {
          totalAmount: buildMetricComparison(currentTrend.totalAmount, yearAgoTrend?.totalAmount ?? null),
          breakfastAvg: buildMetricComparison(currentTrend.breakfastAvg, yearAgoTrend?.breakfastAvg ?? null),
          lunchDinnerAvg: buildMetricComparison(currentTrend.lunchDinnerAvg, yearAgoTrend?.lunchDinnerAvg ?? null),
          daysCount: buildMetricComparison(currentTrend.daysCount, yearAgoTrend?.daysCount ?? null),
        },
        latestInsights: {
          breakfastGapToP50: roundAmount(currentTrend.breakfastAvg - currentTrend.breakfastP50),
          lunchDinnerGapToP50: roundAmount(currentTrend.lunchDinnerAvg - currentTrend.lunchDinnerP50),
          breakfastActiveRate: safeRate(currentTrend.breakfastDaysCount, daysInMonth(currentTrend.month)),
          lunchDinnerActiveRate: safeRate(currentTrend.lunchDinnerDaysCount, daysInMonth(currentTrend.month)),
        },
      },
      hitRules: candidate.hitRules.map((item) => item.ruleText),
      tags: uniqueTags(collapseActiveTagsByStage(tags).map((item) => normalizeMojibakeText(item))),
      tagTimeline: tags.map((item) => ({
        id: item.id,
        tag: normalizeMojibakeText(item.tag),
        source: normalizeMojibakeText(item.sourceStage),
        status: item.status === 'active' ? 'active' : 'inactive',
        statusLabel: item.status === 'active' ? '生效中' : '已失效',
        createdAt: formatDateTime(item.generatedAt),
        invalidatedAt: item.invalidatedAt ? formatDateTime(item.invalidatedAt) : undefined,
      })),
      auditTrail: reviews.map((item) => ({
        id: item.id,
        stage: item.stage as never,
        nodeLabel: getStageLabel(item.stage),
        operator: normalizeMojibakeText(item.reviewerName ?? '系统') || '系统',
        result: normalizeMojibakeText(item.resultLabel ?? ''),
        comment: normalizeMojibakeText(item.comment ?? '无补充说明') || '无补充说明',
        time: formatDateTime(item.reviewedAt),
      })),
      transactions: transactions.map((item) => ({
        id: item.id,
        time: item.occurredAtText,
        slot: (item.mealSlot === 'lunch_dinner' ? 'dinner' : item.mealSlot || 'breakfast') as never,
        slotLabel: getSlotLabel(item.mealSlot ?? ''),
        location: item.location ?? '-',
        amount: toAmount(item.amount),
      })),
      subsidy: {
        breakfast: toAmount(finalResultAfterRefresh?.breakfastSubsidy),
        lunchDinner: toAmount(finalResultAfterRefresh?.lunchDinnerSubsidy),
        total: toAmount(finalResultAfterRefresh?.totalSubsidy),
        rank: finalResultAfterRefresh?.finalRank || 0,
        included: finalResultAfterRefresh?.selected ?? false,
      },
    };
  }

  async listReviewTasks(context?: AccessContext): Promise<ReviewTask[]> {
    if (context?.role === 'counselor' && !String(context.id ?? '').trim()) {
      return [];
    }
    const scoped = this.isCounselorScope(context);
    const isCollegeAdminScope = String(context?.role ?? '').trim() === 'college_admin';
    const college = String(context?.college ?? '').trim();
    const scopeSql = scoped
      ? `
          AND EXISTS (
            SELECT 1
            FROM \`CounselorStudentRelation\` csr
            WHERE csr.studentId = s.id
              AND csr.counselorId = ?
          )
        `
      : isCollegeAdminScope
        ? `
          AND s.departmentName = ?
        `
        : '';
    const scopeParams = scoped
      ? [String(context?.id ?? '').trim()]
      : isCollegeAdminScope
        ? [college || '__NO_MATCH__']
        : [];
    const items = await prisma.$queryRawUnsafe<
      Array<{
        id: string;
        month: string;
        currentStage: string;
        workflowStatus: string;
        reviewDeadline: Date | null;
        rank: number | null;
        studentNo: string;
        studentName: string;
        departmentName: string | null;
      }>
    >(
      `
        SELECT
          cr.id,
          cr.month,
          cr.currentStage,
          cr.workflowStatus,
          cr.reviewDeadline,
          cr.rank,
          s.studentId AS studentNo,
          s.name AS studentName,
          s.departmentName
        FROM \`CandidateResult\` cr
        INNER JOIN \`Student\` s
          ON s.id = cr.studentId
        LEFT JOIN \`FinalSubsidyResult\` fsr
          ON fsr.batchId = cr.batchId
         AND fsr.studentId = cr.studentId
        WHERE cr.workflowStatus IN (
          'pending_counselor',
          'pending_college',
          'pending_funding_office',
          'pending_final',
          'counselor_overdue',
          'college_overdue',
          'funding_office_overdue',
          'final_overdue'
        )
        ${scopeSql}
        ORDER BY
          CAST(COALESCE(fsr.totalSubsidy, 0) AS DECIMAL(12,2)) DESC,
          cr.rank ASC,
          s.studentId ASC
      `,
      ...scopeParams
    );

    return items.map((item) => ({
      id: `task-${item.id}`,
      studentId: item.studentNo,
      student: item.studentName,
      college: studentCollege({ departmentName: item.departmentName ?? '' }),
      month: item.month,
      role: getTaskRole(item.currentStage),
      status: getTaskStatus(item.workflowStatus),
      time: item.reviewDeadline ? formatDateTime(item.reviewDeadline) : '待处理',
    }));
  }

  private async loadMonthlyCafeteriaTransactions(studentNo: string, month: string) {
    const tableName = monthToTableName(month);
    if (!tableName) {
      return [] as Array<{
        id: string;
        occurredAt: Date;
        occurredAtText: string;
        mealSlot: string;
        location: string | null;
        amount: number;
      }>;
    }

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
      return [] as Array<{
        id: string;
        occurredAt: Date;
        occurredAtText: string;
        mealSlot: string;
        location: string | null;
        amount: number;
      }>;
    }

    const actualTableName = tableRows[0].TABLE_NAME;
    return prisma.$queryRawUnsafe<
      Array<{
        id: string;
        occurredAt: Date;
        occurredAtText: string;
        mealSlot: string;
        location: string | null;
        amount: number;
      }>
    >(
      `
        SELECT
          CAST(id AS CHAR) AS id,
          occurredAt,
          DATE_FORMAT(occurredAt, '%Y-%m-%d %H:%i:%s') AS occurredAtText,
          mealSlot,
          location,
          amount
        FROM \`${actualTableName}\`
        WHERE studentNo = ?
        ORDER BY occurredAt DESC
        LIMIT 200
      `,
      studentNo
    );
  }

  private async loadStudentMonthStatFromTransactions(studentNo: string, month: string): Promise<StudentMonthStatFallback | null> {
    const tableName = monthToTableName(month);
    if (!tableName) {
      return null;
    }

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
      return null;
    }
    const actualTableName = tableRows[0].TABLE_NAME;

    const rows = await prisma.$queryRawUnsafe<
      Array<{
        breakfastCount: unknown;
        breakfastTotal: unknown;
        breakfastAvg: unknown;
        breakfastDaysCount: unknown;
        lunchDinnerCount: unknown;
        lunchDinnerTotal: unknown;
        lunchDinnerAvg: unknown;
        lunchDinnerDaysCount: unknown;
        daysCount: unknown;
        totalAmount: unknown;
      }>
    >(
      `
        SELECT
          COUNT(DISTINCT CASE WHEN mealSlot = 'breakfast' THEN DATE(occurredAt) END) AS breakfastCount,
          COALESCE(SUM(CASE WHEN mealSlot = 'breakfast' THEN amount ELSE 0 END), 0) AS breakfastTotal,
          COALESCE(
            SUM(CASE WHEN mealSlot = 'breakfast' THEN amount ELSE 0 END)
              / NULLIF(COUNT(DISTINCT CASE WHEN mealSlot = 'breakfast' THEN DATE(occurredAt) END), 0),
            0
          ) AS breakfastAvg,
          COUNT(DISTINCT CASE WHEN mealSlot = 'breakfast' THEN DATE(occurredAt) END) AS breakfastDaysCount,
          (
            COUNT(DISTINCT CASE
              WHEN mealSlot = 'lunch' OR (mealSlot = 'lunch_dinner' AND HOUR(occurredAt) >= 10 AND HOUR(occurredAt) < 15)
              THEN DATE(occurredAt)
            END)
            + COUNT(DISTINCT CASE
              WHEN mealSlot IN ('dinner', 'night', 'night_snack', 'supper', 'late_night')
                OR (mealSlot = 'lunch_dinner' AND NOT (HOUR(occurredAt) >= 10 AND HOUR(occurredAt) < 15))
              THEN DATE(occurredAt)
            END)
          ) AS lunchDinnerCount,
          COALESCE(
            SUM(CASE WHEN mealSlot = 'lunch' OR (mealSlot = 'lunch_dinner' AND HOUR(occurredAt) >= 10 AND HOUR(occurredAt) < 15) THEN amount ELSE 0 END)
            + SUM(CASE
              WHEN mealSlot IN ('dinner', 'night', 'night_snack', 'supper', 'late_night')
                OR (mealSlot = 'lunch_dinner' AND NOT (HOUR(occurredAt) >= 10 AND HOUR(occurredAt) < 15))
              THEN amount ELSE 0 END),
            0
          ) AS lunchDinnerTotal,
          COALESCE(
            (
              SUM(CASE WHEN mealSlot = 'lunch' OR (mealSlot = 'lunch_dinner' AND HOUR(occurredAt) >= 10 AND HOUR(occurredAt) < 15) THEN amount ELSE 0 END)
              + SUM(CASE
                WHEN mealSlot IN ('dinner', 'night', 'night_snack', 'supper', 'late_night')
                  OR (mealSlot = 'lunch_dinner' AND NOT (HOUR(occurredAt) >= 10 AND HOUR(occurredAt) < 15))
                THEN amount ELSE 0 END)
            ) / NULLIF(
              COUNT(DISTINCT CASE
                WHEN mealSlot = 'lunch' OR (mealSlot = 'lunch_dinner' AND HOUR(occurredAt) >= 10 AND HOUR(occurredAt) < 15)
                THEN DATE(occurredAt)
              END)
              + COUNT(DISTINCT CASE
                WHEN mealSlot IN ('dinner', 'night', 'night_snack', 'supper', 'late_night')
                  OR (mealSlot = 'lunch_dinner' AND NOT (HOUR(occurredAt) >= 10 AND HOUR(occurredAt) < 15))
                THEN DATE(occurredAt)
              END),
              0
            ),
            0
          ) AS lunchDinnerAvg,
          COUNT(
            DISTINCT CASE
              WHEN mealSlot = 'lunch'
                OR mealSlot IN ('dinner', 'night', 'night_snack', 'supper', 'late_night')
                OR mealSlot = 'lunch_dinner'
              THEN DATE(occurredAt)
            END
          ) AS lunchDinnerDaysCount,
          COUNT(DISTINCT DATE(occurredAt)) AS daysCount,
          COALESCE(SUM(amount), 0) AS totalAmount
        FROM \`${actualTableName}\`
        WHERE studentNo = ?
          AND amount > 0
          AND mealSlot IN ('breakfast', 'lunch', 'dinner', 'lunch_dinner', 'night', 'night_snack', 'supper', 'late_night')
      `,
      studentNo
    );
    if (rows.length === 0) {
      return null;
    }
    const row = rows[0];
    return {
      breakfastCount: Math.max(0, Math.floor(safeNumber(row.breakfastCount))),
      breakfastTotal: safeNumber(row.breakfastTotal),
      breakfastAvg: safeNumber(row.breakfastAvg),
      breakfastDaysCount: Math.max(0, Math.floor(safeNumber(row.breakfastDaysCount))),
      lunchDinnerCount: Math.max(0, Math.floor(safeNumber(row.lunchDinnerCount))),
      lunchDinnerTotal: safeNumber(row.lunchDinnerTotal),
      lunchDinnerAvg: safeNumber(row.lunchDinnerAvg),
      lunchDinnerDaysCount: Math.max(0, Math.floor(safeNumber(row.lunchDinnerDaysCount))),
      daysCount: Math.max(0, Math.floor(safeNumber(row.daysCount))),
      totalAmount: safeNumber(row.totalAmount),
    };
  }

  async listTagRecords(): Promise<TagRecord[]> {
    const records = await prisma.tagRecord.findMany({
      include: {
        student: true,
        batch: true,
      },
      orderBy: {
        generatedAt: 'desc',
      },
    });

    return records.map((record) => ({
      id: record.id,
      studentId: record.student.studentId,
      studentName: record.student.name,
      month: record.batch.month,
      tag: record.tag,
      source: record.sourceStage,
      status: record.status === 'active' ? '生效中' : '已失效',
      time: formatDateTime(record.generatedAt),
    }));
  }

  async applyReview(studentId: string, payload: ReviewActionRequest, context?: AccessContext) {
    if (!this.canReviewStage(context?.role, payload.stage, context)) {
      throw new Error('当前账号无权执行该审核环节。');
    }

    const targetMonthResult = this.normalizeMonthInput(payload.month);
    if (!targetMonthResult.valid) {
      return null;
    }
    const targetMonth = targetMonthResult.value;
    const candidate = await prisma.candidateResult.findFirst({
      where: {
        student: {
          studentId,
          ...(this.isCounselorScope(context)
            ? {
                relations: {
                  some: {
                    counselorId: String(context?.id ?? '').trim(),
                  },
                },
              }
            : {}),
        },
        ...(targetMonth ? { month: targetMonth } : {}),
      },
      include: {
        student: {
          include: {
            relations: {
              include: {
                counselor: true,
              },
              orderBy: {
                createdAt: 'desc',
              },
              take: 1,
            },
          },
        },
      },
      orderBy: {
        month: 'desc',
      },
    });

    if (!candidate) {
      return null;
    }
    if (
      candidate.workflowStatus === 'included' ||
      candidate.workflowStatus === 'not_included' ||
      candidate.workflowStatus.includes('rejected')
    ) {
      throw new Error('该数据已终止审核，不能再通过或驳回。');
    }
    if (candidate.currentStage !== payload.stage) {
      throw new Error('当前审核环节已变化，请刷新后重试。');
    }

    const timestamp = new Date();
    const stageLabelMap = {
      counselor: '辅导员确认',
      college: '学院审核',
      funding_office: '学生资助管理办公室审核',
      student_affairs: '学生处终审',
    } as const;
    const approveLabelMap = {
      counselor: '辅导员通过',
      college: '学院通过',
      funding_office: '学生资助管理办公室通过',
      student_affairs: '学生处通过',
    } as const;
    const rejectLabelMap = {
      counselor: '辅导员驳回',
      college: '学院驳回',
      funding_office: '学生资助管理办公室驳回',
      student_affairs: '学生处驳回',
    } as const;
    const approvedStatusMap = {
      counselor: { workflowStatus: 'pending_college', workflowStatusLabel: '待学院审核', currentStage: 'college' },
      college: { workflowStatus: 'pending_funding_office', workflowStatusLabel: '待学生资助管理办公室审核', currentStage: 'funding_office' },
      funding_office: { workflowStatus: 'pending_final', workflowStatusLabel: '待学生处终审', currentStage: 'student_affairs' },
      student_affairs: { workflowStatus: 'included', workflowStatusLabel: '已纳入发放名单', currentStage: 'student_affairs' },
    } as const;
    const rejectedStatusMap = {
      counselor: { workflowStatus: 'counselor_rejected', workflowStatusLabel: '辅导员驳回', currentStage: 'counselor' },
      college: { workflowStatus: 'college_rejected', workflowStatusLabel: '学院驳回', currentStage: 'college' },
      funding_office: { workflowStatus: 'funding_office_rejected', workflowStatusLabel: '学生资助管理办公室驳回', currentStage: 'funding_office' },
      student_affairs: { workflowStatus: 'final_rejected', workflowStatusLabel: '学生处驳回', currentStage: 'student_affairs' },
    } as const;

    const tag = payload.decision === 'approve' ? approveLabelMap[payload.stage] : rejectLabelMap[payload.stage];
    const nextState = payload.decision === 'approve' ? approvedStatusMap[payload.stage] : rejectedStatusMap[payload.stage];
    const reviewerName =
      payload.stage === 'counselor'
        ? candidate.student.relations[0]?.counselor.name ?? '辅导员'
        : payload.stage === 'college'
          ? `${studentCollege(candidate.student)}管理员`
          : payload.stage === 'funding_office'
            ? '学生资助管理办公室'
          : '学生处管理员';
    const resultLabel = payload.decision === 'approve' ? '审核通过' : '审核驳回';

    await prisma.$transaction([
      prisma.candidateResult.update({
        where: { id: candidate.id },
        data: {
          workflowStatus: nextState.workflowStatus,
          workflowStatusLabel: nextState.workflowStatusLabel,
          currentStage: nextState.currentStage,
        },
      }),
      prisma.tagRecord.updateMany({
        where: {
          studentId: candidate.studentId,
          batchId: candidate.batchId,
          status: 'active',
          OR: [
            { tag: { startsWith: '待' } },
            ...(payload.stage === 'counselor'
              ? [{ tag: { contains: '辅导员' } }]
              : payload.stage === 'college'
                ? [{ tag: { contains: '学院' } }]
                : payload.stage === 'funding_office'
                  ? [{ tag: { contains: '资助' } }, { tag: { contains: '办公室' } }]
                : [{ tag: { contains: '学生处' } }]),
          ],
        },
        data: {
          status: 'inactive',
          invalidatedAt: timestamp,
        },
      }),
      prisma.tagRecord.create({
        data: {
          id: `tag-${studentId}-${Date.now()}`,
          batchId: candidate.batchId,
          studentId: candidate.studentId,
          tag,
          sourceStage: stageLabelMap[payload.stage],
          status: 'active',
          generatedAt: timestamp,
        },
      }),
      prisma.reviewRecord.create({
        data: {
          id: `audit-${studentId}-${Date.now()}`,
          batchId: candidate.batchId,
          studentId: candidate.studentId,
          stage: payload.stage,
          decision: payload.decision,
          resultLabel,
          comment: payload.comment || '无补充说明',
          reviewedAt: timestamp,
          reviewerName,
        },
      }),
      prisma.finalSubsidyResult.upsert({
        where: {
          batchId_studentId: {
            batchId: candidate.batchId,
            studentId: candidate.studentId,
          },
        },
        create: {
          id: `${studentId}-${candidate.month}-final-live`,
          batchId: candidate.batchId,
          studentId: candidate.studentId,
          finalDecision: nextState.workflowStatus,
          selected: nextState.workflowStatus === 'included',
          finalRank: candidate.rank,
          breakfastSubsidy: 0,
          lunchDinnerSubsidy: 0,
          totalSubsidy: 0,
        },
        update: {
          finalDecision: nextState.workflowStatus,
          selected: nextState.workflowStatus === 'included',
        },
      }),
    ]);

    await this.rebuildCandidateListSnapshot(candidate.month, candidate.batchId);

    if (payload.stage === 'student_affairs') {
      await this.refreshFinalSubsidyResults(candidate.batchId, candidate.month);
    }

    return this.getStudentDetail(studentId, candidate.month, context);
  }

  async listCandidateColleges(month: string, context?: AccessContext): Promise<string[]> {
    if (context?.role === 'counselor' && !String(context.id ?? '').trim()) {
      return [];
    }
    const scoped = this.isCounselorScope(context);
    const isCollegeAdminScope = String(context?.role ?? '').trim() === 'college_admin';
    const college = String(context?.college ?? '').trim();
    const scopeSql = scoped
      ? `
          AND EXISTS (
            SELECT 1
            FROM \`Student\` ss
            INNER JOIN \`CounselorStudentRelation\` csr ON csr.studentId = ss.id
            WHERE ss.studentId COLLATE utf8mb4_unicode_ci = cls.studentId COLLATE utf8mb4_unicode_ci
              AND csr.counselorId = ?
          )
        `
      : isCollegeAdminScope
        ? `
          AND cls.college = ?
        `
        : '';
    const scopeParams = scoped
      ? [String(context?.id ?? '').trim()]
      : isCollegeAdminScope
        ? [college || '__NO_MATCH__']
        : [];
    const rows = await prisma.$queryRawUnsafe<Array<{ college: string | null }>>(
      `
        SELECT DISTINCT cls.college
        FROM \`CandidateListSnapshot\` cls
        WHERE cls.month = ?
          AND cls.college IS NOT NULL
          AND TRIM(cls.college) <> ''
          ${scopeSql}
        ORDER BY cls.college ASC
      `,
      month,
      ...scopeParams
    );
    return rows
      .map((item) => String(item.college ?? '').trim())
      .filter(Boolean);
  }

  private async resolveActualTransactionTableName(month: string): Promise<string | null> {
    const tableName = monthToTableName(month);
    if (!tableName) return null;

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

    return tableRows[0]?.TABLE_NAME ?? null;
  }

  private async diagnoseCandidateEmptyReason(month: string): Promise<string> {
    const activeStudentCount = await prisma.student.count({ where: activeStudentWhere() });
    if (activeStudentCount === 0) {
      return '原因：当前学生基础数据为空或无在籍学生。';
    }

    const tableName = await this.resolveActualTransactionTableName(month);
    const missingMonths = tableName ? [] : [month];
    if (missingMonths.length > 0) {
      return `原因：缺少食堂消费流水表（${missingMonths.join('、')}）。`;
    }

    if (tableName) {
      const rows = await prisma.$queryRawUnsafe<Array<{ cnt: unknown }>>(
        `
          SELECT COUNT(*) AS cnt
          FROM \`${tableName}\`
          WHERE amount > 0
            AND mealSlot IN ('breakfast', 'lunch', 'dinner', 'lunch_dinner', 'night', 'night_snack', 'supper', 'late_night')
          LIMIT 1
        `
      );
      const cnt = Number(rows[0]?.cnt ?? 0);
      if (!Number.isFinite(cnt) || cnt <= 0) {
        return `原因：${month} 食堂消费流水为空（请确认流水数据已导入，且月份范围包含 ${month}）。`;
      }
    }

    return `原因：候选人生成前置条件不足（请检查 ${month} 的消费流水、困难认定和补助标准数据是否完整）。`;
  }

  async invalidateTag(tagRecordId: string) {
    const record = await prisma.tagRecord.findUnique({ where: { id: tagRecordId } });

    if (!record) {
      return false;
    }

    await prisma.tagRecord.update({
      where: { id: tagRecordId },
      data: {
        status: 'inactive',
        invalidatedAt: new Date(),
      },
    });

    const batch = await prisma.subsidyBatch.findUnique({
      where: { id: record.batchId },
      select: { month: true },
    });
    if (batch) {
      await this.rebuildCandidateListSnapshot(batch.month, record.batchId);
    }

    return true;
  }
}

export const candidateRepository = new CandidateRepository();
