export const MEAL_GROUPS = {
  breakfast: "breakfast",
  lunchDinner: "lunchDinner"
};

export const LABELS = {
  pending: "待确认",
  need: "需补助",
  noNeed: "不补助",
  overdue: "逾期未确认",
  final: "确认补助"
};

export function monthDays(month) {
  const [year, monthIndex] = month.split("-").map(Number);
  return new Date(year, monthIndex, 0).getDate();
}

export function previousMonths(month, count) {
  const [year, monthIndex] = month.split("-").map(Number);
  const result = [];
  const cursor = new Date(year, monthIndex - 1, 1);

  for (let index = count - 1; index >= 0; index -= 1) {
    const current = new Date(cursor.getFullYear(), cursor.getMonth() - index, 1);
    result.push(formatMonth(current));
  }

  return result;
}

export function formatMonth(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function getMealGroup(mealType) {
  if (mealType === "breakfast") return MEAL_GROUPS.breakfast;
  if (mealType === "lunch" || mealType === "dinner") return MEAL_GROUPS.lunchDinner;
  return null;
}

export function isActiveUndergraduate(student) {
  return student.studentType === "本科生" && student.status === "在籍在校";
}

export function isSpecialDifficulty(student) {
  return isActiveUndergraduate(student) && student.isSpecialDifficulty === true;
}

export function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function safeAverage(total, count) {
  if (!count) return null;
  return roundMoney(total / count);
}

export function nearestRankPercentile(values, percentile) {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .slice()
    .sort((left, right) => left - right);

  if (sorted.length === 0) return null;
  const rank = Math.max(1, Math.ceil((percentile / 100) * sorted.length));
  return sorted[rank - 1];
}

export function computeMonthlyStats(students, transactions, month, config) {
  const validPosIds = new Set(config.validPosIds || []);
  const studentById = new Map(students.map((student) => [student.id, student]));
  const statsByStudent = new Map();

  for (const student of students) {
    if (!isActiveUndergraduate(student)) continue;
    statsByStudent.set(student.id, createEmptyStudentStats(student, month));
  }

  for (const transaction of transactions) {
    if (!transaction.date.startsWith(`${month}-`)) continue;
    if (validPosIds.size > 0 && !validPosIds.has(transaction.posId)) continue;

    const student = studentById.get(transaction.studentId);
    if (!student || !isActiveUndergraduate(student)) continue;

    const mealGroup = getMealGroup(transaction.mealType);
    if (!mealGroup) continue;

    const stats = statsByStudent.get(student.id);
    const amount = Number(transaction.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    stats.totalAmount = roundMoney(stats.totalAmount + amount);
    stats.totalCount += 1;
    stats.consumeDateSet.add(transaction.date);

    if (mealGroup === MEAL_GROUPS.breakfast) {
      stats.breakfastTotal = roundMoney(stats.breakfastTotal + amount);
      stats.breakfastCount += 1;
    } else {
      stats.lunchDinnerTotal = roundMoney(stats.lunchDinnerTotal + amount);
      stats.lunchDinnerCount += 1;
    }
  }

  return Array.from(statsByStudent.values()).map(finalizeStudentStats);
}

export function computeThresholds(stats, config = {}) {
  const subsidyMedianScope = config.subsidyMedianScope || "school";
  const thresholdPopulation = stats.filter((row) => isActiveUndergraduate(row.student));
  const medianPopulation =
    subsidyMedianScope === "special"
      ? thresholdPopulation.filter((row) => isSpecialDifficulty(row.student))
      : thresholdPopulation;

  return {
    breakfastSchoolAverage: safeAverage(
      sumBy(thresholdPopulation, "breakfastTotal"),
      sumBy(thresholdPopulation, "breakfastCount")
    ),
    lunchDinnerSchoolAverage: safeAverage(
      sumBy(thresholdPopulation, "lunchDinnerTotal"),
      sumBy(thresholdPopulation, "lunchDinnerCount")
    ),
    breakfastP10: nearestRankPercentile(pluckFinite(thresholdPopulation, "breakfastAverage"), 10),
    lunchDinnerP10: nearestRankPercentile(pluckFinite(thresholdPopulation, "lunchDinnerAverage"), 10),
    breakfastP25: nearestRankPercentile(pluckFinite(thresholdPopulation, "breakfastAverage"), 25),
    lunchDinnerP25: nearestRankPercentile(pluckFinite(thresholdPopulation, "lunchDinnerAverage"), 25),
    breakfastP50: nearestRankPercentile(pluckFinite(medianPopulation, "breakfastAverage"), 50),
    lunchDinnerP50: nearestRankPercentile(pluckFinite(medianPopulation, "lunchDinnerAverage"), 50),
    subsidyMedianScope
  };
}

export function findSpecialDifficultyCandidates(stats, thresholds, month) {
  const minimumConsumeDays = Math.ceil(monthDays(month) / 2);

  return stats
    .filter((row) => isSpecialDifficulty(row.student))
    .filter((row) => row.breakfastAverage !== null && row.lunchDinnerAverage !== null)
    .filter(
      (row) =>
        row.breakfastAverage <= thresholds.breakfastP25 &&
        row.lunchDinnerAverage <= thresholds.lunchDinnerP25 &&
        row.consumeDays >= minimumConsumeDays
    )
    .map((row) => ({
      ...row,
      candidateType: "特别困难补助筛查",
      matchedMonths: [month],
      reason: `特别困难；早餐和午晚餐均不高于25%标准；消费${row.consumeDays}天`
    }));
}

export function mergeCandidates(...candidateGroups) {
  const candidateByStudent = new Map();

  for (const group of candidateGroups) {
    for (const candidate of group) {
      const existing = candidateByStudent.get(candidate.student.id);
      if (!existing) {
        candidateByStudent.set(candidate.student.id, candidate);
        continue;
      }

      candidateByStudent.set(candidate.student.id, {
        ...existing,
        candidateType: `${existing.candidateType} / ${candidate.candidateType}`,
        reason: `${existing.reason}；${candidate.reason}`,
        matchedMonths: Array.from(new Set([...existing.matchedMonths, ...candidate.matchedMonths]))
      });
    }
  }

  return Array.from(candidateByStudent.values());
}

export function confirmationKey(month, studentId) {
  return `${month}:${studentId}`;
}

export function addBusinessDays(startDate, days) {
  const date = parseDate(startDate);
  let added = 0;

  while (added < days) {
    date.setDate(date.getDate() + 1);
    if (isBusinessDay(date)) added += 1;
  }

  return formatDate(date);
}

export function businessDaysElapsed(startDate, endDate) {
  const cursor = parseDate(startDate);
  const end = parseDate(endDate);
  let elapsed = 0;

  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1);
    if (cursor <= end && isBusinessDay(cursor)) elapsed += 1;
  }

  return elapsed;
}

export function isOverdue(pushedAt, currentDate, limitBusinessDays) {
  return businessDaysElapsed(pushedAt, currentDate) > limitBusinessDays;
}

export function getCandidateLabel(candidate, confirmation, finalStudentIds, config) {
  if (finalStudentIds.has(candidate.student.id)) return LABELS.final;
  if (confirmation?.decision === "need") return LABELS.need;
  if (confirmation?.decision === "noNeed") return LABELS.noNeed;
  if (isOverdue(config.pushedAt, config.currentDate, config.confirmationLimitBusinessDays)) {
    return LABELS.overdue;
  }
  return LABELS.pending;
}

export function rankFinalSubsidyStudents(candidates, confirmations, config, totalActiveUndergraduates) {
  const limit = Math.ceil(totalActiveUndergraduates * (config.finalSupportPercent / 100));

  if (limit <= 0) return [];

  return candidates
    .filter((candidate) => confirmations[confirmationKey(config.month, candidate.student.id)]?.decision === "need")
    .slice()
    .sort(compareCandidateHardship)
    .slice(0, limit);
}

export function compareCandidateHardship(left, right) {
  const leftAverage = combinedAverage(left);
  const rightAverage = combinedAverage(right);

  if (leftAverage !== rightAverage) return leftAverage - rightAverage;
  if (left.totalAmount !== right.totalAmount) return left.totalAmount - right.totalAmount;
  return right.consumeDays - left.consumeDays;
}

export function combinedAverage(candidate) {
  const values = [candidate.breakfastAverage, candidate.lunchDinnerAverage].filter((value) => value !== null);
  if (values.length === 0) return Number.POSITIVE_INFINITY;
  return roundMoney(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function calculateSubsidyAmount(candidate, thresholds, config) {
  const breakfastBenchmark = thresholds.breakfastP50 || 0;
  const lunchDinnerBenchmark = thresholds.lunchDinnerP50 || 0;

  const breakfastSubsidy = Math.max(
    0,
    breakfastBenchmark * candidate.breakfastCount - candidate.breakfastTotal
  );
  const lunchDinnerSubsidy = Math.max(
    0,
    lunchDinnerBenchmark * candidate.lunchDinnerCount - candidate.lunchDinnerTotal
  );

  const total = Math.min(config.monthlySubsidyCap, breakfastSubsidy + lunchDinnerSubsidy);

  return {
    breakfastSubsidy: roundMoney(breakfastSubsidy),
    lunchDinnerSubsidy: roundMoney(lunchDinnerSubsidy),
    totalSubsidy: roundMoney(total)
  };
}

export function buildAnalysis(students, transactions, selectedMonth, config) {
  const monthConfig = { ...config, month: selectedMonth };
  const stats = computeMonthlyStats(students, transactions, selectedMonth, monthConfig);
  const thresholds = computeThresholds(stats, monthConfig);
  const specialCandidates = findSpecialDifficultyCandidates(stats, thresholds, selectedMonth);
  const candidates = mergeCandidates(specialCandidates).sort(compareCandidateHardship);
  const totalActiveUndergraduates = stats.length;
  const finalCandidates = rankFinalSubsidyStudents(
    candidates,
    config.confirmations || {},
    monthConfig,
    totalActiveUndergraduates
  );
  const finalStudentIds = new Set(finalCandidates.map((candidate) => candidate.student.id));

  return {
    month: selectedMonth,
    stats,
    thresholds,
    specialCandidates,
    candidates,
    totalActiveUndergraduates,
    finalCandidates,
    finalStudentIds,
    dueDate: addBusinessDays(config.pushedAt, config.confirmationLimitBusinessDays)
  };
}

function createEmptyStudentStats(student, month) {
  return {
    month,
    student,
    breakfastTotal: 0,
    breakfastCount: 0,
    breakfastAverage: null,
    lunchDinnerTotal: 0,
    lunchDinnerCount: 0,
    lunchDinnerAverage: null,
    totalAmount: 0,
    totalCount: 0,
    totalAverage: null,
    consumeDateSet: new Set(),
    consumeDays: 0
  };
}

function finalizeStudentStats(stats) {
  return {
    ...stats,
    breakfastAverage: safeAverage(stats.breakfastTotal, stats.breakfastCount),
    lunchDinnerAverage: safeAverage(stats.lunchDinnerTotal, stats.lunchDinnerCount),
    totalAverage: safeAverage(stats.totalAmount, stats.totalCount),
    consumeDays: stats.consumeDateSet.size,
    consumeDateSet: undefined
  };
}

function sumBy(rows, property) {
  return rows.reduce((sum, row) => sum + (Number(row[property]) || 0), 0);
}

function pluckFinite(rows, property) {
  return rows.map((row) => row[property]).filter((value) => Number.isFinite(value));
}

function parseDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function isBusinessDay(date) {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}
