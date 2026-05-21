import test from "node:test";
import assert from "node:assert/strict";
import {
  addBusinessDays,
  businessDaysElapsed,
  calculateSubsidyAmount,
  computeMonthlyStats,
  computeThresholds,
  findSpecialDifficultyCandidates,
  isOverdue,
  nearestRankPercentile
} from "../src/domain.js";

test("nearest-rank percentile returns the expected sorted rank", () => {
  assert.equal(nearestRankPercentile([10, 2, 6, 4], 25), 2);
  assert.equal(nearestRankPercentile([10, 2, 6, 4], 50), 4);
  assert.equal(nearestRankPercentile([10, 2, 6, 4], 100), 10);
});

test("special difficulty candidates must meet difficulty, low-consumption and day-count rules", () => {
  const students = [
    student("S1", true),
    student("S2", true),
    student("S3", false),
    student("S4", true)
  ];
  const transactions = [
    ...monthlyTransactions("S1", 16, 2, 5),
    ...monthlyTransactions("S2", 16, 7, 14),
    ...monthlyTransactions("S3", 16, 2.2, 5.2),
    ...monthlyTransactions("S4", 8, 2, 5)
  ];
  const config = { validPosIds: ["POS-A01"], subsidyMedianScope: "school" };
  const stats = computeMonthlyStats(students, transactions, "2026-04", config);
  const thresholds = computeThresholds(stats, config);
  const candidates = findSpecialDifficultyCandidates(stats, thresholds, "2026-04");

  assert.deepEqual(
    candidates.map((candidate) => candidate.student.id),
    ["S1"]
  );
});

test("business day overdue excludes weekends and flags records after the 7 day limit", () => {
  assert.equal(addBusinessDays("2026-04-03", 7), "2026-04-14");
  assert.equal(businessDaysElapsed("2026-04-03", "2026-04-15"), 8);
  assert.equal(isOverdue("2026-04-03", "2026-04-15", 7), true);
});

test("subsidy calculation floors negative meal subsidies and caps total monthly amount", () => {
  const candidate = {
    breakfastCount: 40,
    breakfastTotal: 40,
    lunchDinnerCount: 100,
    lunchDinnerTotal: 100
  };
  const thresholds = {
    breakfastP50: 8,
    lunchDinnerP50: 10
  };
  const result = calculateSubsidyAmount(candidate, thresholds, { monthlySubsidyCap: 500 });

  assert.equal(result.breakfastSubsidy, 280);
  assert.equal(result.lunchDinnerSubsidy, 900);
  assert.equal(result.totalSubsidy, 500);
});

function student(id, isSpecialDifficulty) {
  return {
    id,
    name: id,
    college: "测试学院",
    className: "测试班",
    counselorId: "T1",
    counselorName: "测试老师",
    studentType: "本科生",
    status: "在籍在校",
    isSpecialDifficulty,
    inSchoolDaysByMonth: {
      "2026-04": 30
    }
  };
}

function monthlyTransactions(studentId, days, breakfastAmount, lunchDinnerAmount) {
  const rows = [];

  for (let day = 1; day <= days; day += 1) {
    const date = `2026-04-${String(day).padStart(2, "0")}`;
    rows.push({ studentId, date, mealType: "breakfast", amount: breakfastAmount, posId: "POS-A01" });
    rows.push({ studentId, date, mealType: "lunch", amount: lunchDinnerAmount, posId: "POS-A01" });
  }

  return rows;
}
