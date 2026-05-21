export const appConfig = {
  validPosIds: ["POS-A01", "POS-A02", "POS-B01", "POS-C01"],
  pushedAt: "2026-04-03",
  currentDate: "2026-04-15",
  confirmationLimitBusinessDays: 7,
  finalSupportPercent: 1.5,
  monthlySubsidyCap: 500,
  subsidyMedianScope: "school"
};

export const availableMonths = ["2026-01", "2026-02", "2026-03"];

export const counselors = [
  { id: "T001", name: "张老师", college: "计算机学院" },
  { id: "T002", name: "李老师", college: "计算机学院" },
  { id: "T003", name: "王老师", college: "机械学院" },
  { id: "T004", name: "赵老师", college: "管理学院" }
];

export const students = [
  createStudent("20230001", "林一诺", "计算机学院", "计科2301", "T001", "张老师", true, 25, 24, 26),
  createStudent("20230002", "陈安", "计算机学院", "计科2301", "T001", "张老师", true, 24, 23, 25),
  createStudent("20230003", "周明", "计算机学院", "计科2302", "T002", "李老师", true, 20, 20, 22),
  createStudent("20230004", "唐静", "计算机学院", "计科2302", "T002", "李老师", true, 10, 11, 10),
  createStudent("20230005", "何远", "计算机学院", "软工2301", "T002", "李老师", false, 24, 23, 25),
  createStudent("20230006", "马晓", "机械学院", "机械2301", "T003", "王老师", false, 25, 24, 25),
  createStudent("20230007", "许宁", "机械学院", "机械2301", "T003", "王老师", false, 24, 24, 26),
  createStudent("20230008", "蒋禾", "管理学院", "工商2301", "T004", "赵老师", false, 23, 22, 24),
  createStudent("20230009", "郭航", "管理学院", "工商2301", "T004", "赵老师", false, 22, 20, 23),
  createStudent("20230010", "宋青", "计算机学院", "软工2301", "T002", "李老师", false, 20, 18, 21),
  createStudent("20230011", "魏然", "机械学院", "机械2302", "T003", "王老师", false, 26, 24, 26),
  createStudent("20230012", "沈嘉", "管理学院", "会计2301", "T004", "赵老师", false, 24, 23, 24),
  createStudent("20230013", "郑南", "计算机学院", "计科2301", "T001", "张老师", false, 21, 20, 22),
  createStudent("20230014", "白露", "机械学院", "机械2302", "T003", "王老师", true, 23, 22, 24),
  createStudent("20230015", "梁辰", "管理学院", "会计2301", "T004", "赵老师", false, 23, 22, 23),
  createStudent("20230016", "韩越", "计算机学院", "计科2302", "T002", "李老师", false, 23, 21, 24),
  createStudent("20230017", "曹悦", "机械学院", "机械2301", "T003", "王老师", false, 24, 22, 24),
  createStudent("20230018", "邵雨", "管理学院", "工商2301", "T004", "赵老师", false, 22, 22, 23),
  createStudent("20230019", "潘书", "计算机学院", "软工2301", "T002", "李老师", false, 25, 23, 25),
  createStudent("20230020", "孟可", "机械学院", "机械2302", "T003", "王老师", false, 24, 23, 24),
  createStudent("20230021", "秦川", "管理学院", "会计2301", "T004", "赵老师", false, 21, 20, 22),
  createStudent("20230022", "陆星", "计算机学院", "计科2301", "T001", "张老师", false, 24, 23, 24),
  createStudent("20230023", "严杉", "机械学院", "机械2302", "T003", "王老师", false, 22, 21, 23),
  createStudent("20230024", "杜若", "管理学院", "工商2301", "T004", "赵老师", false, 25, 24, 25)
];

const consumptionProfiles = {
  "20230001": { breakfast: 2.1, lunchDinner: 5.1 },
  "20230002": { breakfast: 2.4, lunchDinner: 5.4 },
  "20230003": { breakfast: 4.8, lunchDinner: 9.2 },
  "20230004": { breakfast: 2.2, lunchDinner: 5.0 },
  "20230005": { breakfast: 2.0, lunchDinner: 7.0 },
  "20230006": { breakfast: 2.6, lunchDinner: 4.9 },
  "20230007": { breakfast: 2.8, lunchDinner: 5.0 },
  "20230008": { breakfast: 3.5, lunchDinner: 8.2 },
  "20230009": { breakfast: 3.8, lunchDinner: 8.8 },
  "20230010": { breakfast: 4.0, lunchDinner: 9.0 },
  "20230011": { breakfast: 4.2, lunchDinner: 9.4 },
  "20230012": { breakfast: 4.4, lunchDinner: 9.7 },
  "20230013": { breakfast: 4.6, lunchDinner: 10.0 },
  "20230014": { breakfast: 4.7, lunchDinner: 9.9 },
  "20230015": { breakfast: 4.9, lunchDinner: 10.3 },
  "20230016": { breakfast: 5.0, lunchDinner: 10.4 },
  "20230017": { breakfast: 5.2, lunchDinner: 10.8 },
  "20230018": { breakfast: 5.4, lunchDinner: 11.1 },
  "20230019": { breakfast: 5.6, lunchDinner: 11.3 },
  "20230020": { breakfast: 5.8, lunchDinner: 11.6 },
  "20230021": { breakfast: 6.0, lunchDinner: 11.9 },
  "20230022": { breakfast: 6.2, lunchDinner: 12.2 },
  "20230023": { breakfast: 6.4, lunchDinner: 12.4 },
  "20230024": { breakfast: 6.6, lunchDinner: 12.8 }
};

export const transactions = generateTransactions();

function createStudent(id, name, college, className, counselorId, counselorName, isSpecialDifficulty, jan, feb, mar) {
  return {
    id,
    name,
    college,
    className,
    counselorId,
    counselorName,
    studentType: "本科生",
    status: "在籍在校",
    isSpecialDifficulty,
    inSchoolDaysByMonth: {
      "2026-01": jan,
      "2026-02": feb,
      "2026-03": mar
    }
  };
}

function generateTransactions() {
  const rows = [];

  for (const month of availableMonths) {
    for (const student of students) {
      const days = student.inSchoolDaysByMonth[month];
      const profile = consumptionProfiles[student.id];
      addMonthlyTransactions(rows, month, student.id, days, profile);
    }
  }

  rows.push({
    id: "IGNORED-001",
    studentId: "20230001",
    date: "2026-03-08",
    mealType: "breakfast",
    amount: 99,
    posId: "SHOP-X99"
  });

  return rows;
}

function addMonthlyTransactions(rows, month, studentId, days, profile) {
  for (let day = 1; day <= days; day += 1) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const breakfastAmount = varyAmount(profile.breakfast, day, 0.15);
    const lunchAmount = varyAmount(profile.lunchDinner, day, 0.3);
    const dinnerAmount = varyAmount(profile.lunchDinner, day + 1, 0.25);
    const posId = day % 3 === 0 ? "POS-B01" : day % 2 === 0 ? "POS-A02" : "POS-A01";

    rows.push({
      id: `${studentId}-${date}-B`,
      studentId,
      date,
      mealType: "breakfast",
      amount: breakfastAmount,
      posId
    });

    rows.push({
      id: `${studentId}-${date}-L`,
      studentId,
      date,
      mealType: "lunch",
      amount: lunchAmount,
      posId
    });

    if (day % 2 === 1) {
      rows.push({
        id: `${studentId}-${date}-D`,
        studentId,
        date,
        mealType: "dinner",
        amount: dinnerAmount,
        posId: "POS-C01"
      });
    }
  }
}

function varyAmount(base, seed, spread) {
  const offset = ((seed % 3) - 1) * spread;
  return Math.round((base + offset) * 100) / 100;
}
