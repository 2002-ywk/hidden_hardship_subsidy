import { PrismaClient } from '@prisma/client';

type ColumnCommentMap = Record<string, Record<string, string>>;

const columnComments: ColumnCommentMap = {
  User: {
    id: '用户主键ID',
    account: '登录账号',
    employeeNo: '工号',
    name: '姓名',
    email: '邮箱',
    role: '角色编码',
    college: '所属学院',
    status: '状态（active/inactive）',
    createdAt: '创建时间',
    updatedAt: '更新时间',
    createdById: '创建人用户ID',
  },
  Student: {
    id: '学生记录主键ID',
    studentId: '学号（业务唯一键）',
    name: '姓名（XM）',
    classCode: '所在班号（SZBH）',
    personTypeCode: '人员类别码（RYLBM）',
    isReadingCode: '是否在读（SFZD）',
    isRegisteredCode: '是否在籍（SFZJ）',
    genderCode: '性别码（XBM）',
    departmentName: '院系所名称（YXSMC）',
    createdAt: '创建时间',
    updatedAt: '更新时间',
  },
  CounselorStudentRelation: {
    id: '关系记录主键ID',
    counselorId: '辅导员用户ID',
    studentId: '学生记录ID',
    relationType: '关系类型（student/class）',
    effectiveFrom: '生效开始时间',
    effectiveTo: '生效结束时间',
    createdAt: '创建时间',
    updatedAt: '更新时间',
  },
  SubsidyBatch: {
    id: '批次主键ID',
    month: '认定月份（YYYY-MM）',
    status: '批次状态',
    progress: '批次进度（0-100）',
    startTime: '批次开始时间',
    deadline: '处理截止时间',
    finalReviewTime: '终审完成时间',
    endTime: '批次结束时间',
    ruleVersion: '规则版本号',
    standardPercentile: '补助标准分位值',
    basePercentile: '补助基准分位值',
    finalRatio: '最终资助比例',
    createdAt: '创建时间',
    updatedAt: '更新时间',
  },
  StudentMonthStat: {
    id: '月统计主键ID',
    batchId: '批次ID',
    studentId: '学生ID',
    month: '统计月份',
    breakfastCount: '早餐消费次数',
    breakfastTotal: '早餐消费总额',
    breakfastAvg: '早餐均次消费',
    lunchDinnerCount: '午晚餐消费次数',
    lunchDinnerTotal: '午晚餐消费总额',
    lunchDinnerAvg: '午晚餐均次消费',
    daysCount: '消费天数',
    attendanceDays: '在校天数',
    totalAmount: '月消费总额',
    createdAt: '创建时间',
    updatedAt: '更新时间',
  },
  CandidateResult: {
    id: '候选结果主键ID',
    batchId: '批次ID',
    studentId: '学生ID',
    month: '认定月份',
    candidateType: '候选类型',
    typeLabel: '候选类型标签',
    workflowStatus: '流程状态码',
    workflowStatusLabel: '流程状态文案',
    currentStage: '当前审核阶段',
    averageSpendLabel: '均次消费展示文本',
    daysCount: '消费天数',
    rank: '排序名次',
    subsidyEstimate: '预估补助金额',
    reviewDeadline: '审核截止时间',
    included: '是否纳入候选',
    createdAt: '创建时间',
    updatedAt: '更新时间',
  },
  CandidateHitRule: {
    id: '命中规则主键ID',
    candidateResultId: '候选结果ID',
    ruleCode: '规则编码',
    ruleText: '规则说明文本',
    createdAt: '创建时间',
  },
  CandidateListSnapshot: {
    id: '快照主键ID',
    month: '认定月份（YYYY-MM）',
    batchId: '批次ID',
    studentId: '学号',
    name: '姓名',
    college: '学院',
    className: '班级',
    counselor: '辅导员姓名',
    type: '候选类型',
    typeLabel: '候选类型标签',
    averageSpendLabel: '均次消费展示文本',
    daysCount: '消费天数',
    workflowStatus: '流程状态码',
    workflowStatusLabel: '流程状态文案',
    currentStage: '当前审核阶段',
    rank: '排序名次',
    subsidyEstimate: '预估补助金额',
    reviewDeadline: '审核截止时间',
    tagsJson: '标签JSON数组',
    hitRulesJson: '命中规则JSON数组',
    createdAt: '创建时间',
    updatedAt: '更新时间',
  },
  ReviewRecord: {
    id: '审核记录主键ID',
    batchId: '批次ID',
    studentId: '学生ID',
    stage: '审核阶段',
    decision: '审核决策',
    resultLabel: '审核结果文案',
    comment: '审核意见',
    isTimeout: '是否超时处理',
    reviewedAt: '审核时间',
    reviewerId: '审核人用户ID',
    reviewerName: '审核人姓名',
    createdAt: '创建时间',
  },
  TagRecord: {
    id: '标签记录主键ID',
    batchId: '批次ID',
    studentId: '学生ID',
    tag: '标签名称',
    sourceStage: '标签来源环节',
    status: '标签状态（active/inactive）',
    generatedAt: '标签生成时间',
    invalidatedAt: '标签失效时间',
    createdAt: '创建时间',
  },
  FinalSubsidyResult: {
    id: '终审结果主键ID',
    batchId: '批次ID',
    studentId: '学生ID',
    finalDecision: '终审决策',
    finalRank: '终审排名',
    selected: '是否入选发放名单',
    breakfastSubsidy: '早餐补助金额',
    lunchDinnerSubsidy: '午晚餐补助金额',
    totalSubsidy: '总补助金额',
    createdAt: '创建时间',
    updatedAt: '更新时间',
  },
  SystemConfig: {
    id: '配置主键（固定1）',
    breakfastStart: '早餐开始时间',
    breakfastEnd: '早餐结束时间',
    lunchStart: '午餐开始时间',
    lunchEnd: '午餐结束时间',
    dinnerStart: '晚餐开始时间',
    dinnerEnd: '晚餐结束时间',
    subsidyLimit: '补助上限金额',
    finalRatio: '最终资助比例',
    standardPercentile: '补助标准分位值',
    basePercentile: '补助基准分位值',
    timeoutWorkdays: '超时工作日阈值',
    createdAt: '创建时间',
    updatedAt: '更新时间',
  },
  RolePermission: {
    id: '角色权限主键ID',
    role: '角色编码',
    permission: '权限编码',
    dataScope: '数据范围',
    createdAt: '创建时间',
    updatedAt: '更新时间',
  },
  OperationLog: {
    id: '操作日志主键ID',
    operatorId: '操作人用户ID',
    operatorRole: '操作人角色',
    targetType: '操作对象类型',
    targetId: '操作对象ID',
    action: '操作动作',
    content: '操作内容',
    createdAt: '创建时间',
  },
  FacultyStaff: {
    id: '教职工记录主键ID',
    employeeNo: '工号（GH，业务唯一键）',
    name: '姓名（XM）',
    genderCode: '性别码（XB）',
    unitName: '单位名称（DWMC）',
    staffCategoryCode: '教职工类别码（JZGLBM）',
    currentStatusCode: '当前状态码（DQZTM）',
    createdAt: '创建时间',
    updatedAt: '更新时间',
  },
  UndergraduateDifficultyRecognition: {
    id: '困难认定记录主键ID',
    studentId: '学生记录ID',
    startAcademicYear: '开始学年（KSXN）',
    endAcademicYear: '结束学年（JSXN）',
    semester: '学期（XQ）',
    difficultyLevel: '困难等级（KNDJ）',
    createdAt: '创建时间',
    updatedAt: '更新时间',
  },
  CafeteriaMonthlySnapshot: {
    id: '快照主键ID',
    month: '统计月份（YYYY-MM）',
    sampleCount: '样本学生数',
    candidateCount: '候选学生数',
    breakfastAverage: '早餐平均消费',
    lunchDinnerAverage: '午晚餐平均消费',
    standardPercentile: '候选比例分位值',
    calculatedAt: '统计计算时间',
    createdAt: '创建时间',
    updatedAt: '更新时间',
  },
  DictionaryType: {
    id: '字典类型主键ID',
    dictType: '字典类型编码',
    label: '字典类型名称',
    description: '字典类型说明',
    sortOrder: '排序值',
    enabled: '是否启用',
    createdAt: '创建时间',
    updatedAt: '更新时间',
  },
  DictionaryItem: {
    id: '字典项主键ID',
    dictType: '字典类型',
    code: '字典编码',
    label: '字典名称',
    isSpecialDifficulty: '是否特别困难等级',
    sortOrder: '排序值',
    enabled: '是否启用',
    description: '备注说明',
    createdAt: '创建时间',
    updatedAt: '更新时间',
  },
  SyncJob: {
    id: '同步任务主键ID',
    name: '任务名称',
    source: '数据来源',
    jobType: '任务类型',
    frequency: '执行频率',
    status: '任务状态',
    delta: '本次增量说明',
    note: '任务备注',
    lastRunAt: '最近执行时间',
    startedAt: '开始执行时间',
    finishedAt: '完成时间',
    triggeredById: '触发人用户ID',
    createdAt: '创建时间',
    updatedAt: '更新时间',
  },
};

const numericDataTypes = new Set([
  'tinyint',
  'smallint',
  'mediumint',
  'int',
  'integer',
  'bigint',
  'decimal',
  'numeric',
  'float',
  'double',
  'real',
  'bit',
]);

function escapeSqlString(input: string) {
  return input.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function buildDefaultClause(dataType: string, columnDefault: string | null) {
  if (columnDefault == null) {
    return '';
  }

  const upper = columnDefault.toUpperCase();
  if (upper.startsWith('CURRENT_TIMESTAMP')) {
    return ` DEFAULT ${columnDefault}`;
  }

  if (numericDataTypes.has(dataType.toLowerCase())) {
    return ` DEFAULT ${columnDefault}`;
  }

  return ` DEFAULT '${escapeSqlString(columnDefault)}'`;
}

function buildExtraClause(extra: string | null | undefined) {
  if (!extra) {
    return '';
  }

  const cleaned = extra.replace(/\bDEFAULT_GENERATED\b/gi, '').replace(/\s+/g, ' ').trim();
  return cleaned ? ` ${cleaned}` : '';
}

async function main() {
  const prisma = new PrismaClient();
  try {
    for (const [tableName, columns] of Object.entries(columnComments)) {
      for (const [columnName, comment] of Object.entries(columns)) {
        const rows = await prisma.$queryRawUnsafe<
          Array<{
            TABLE_NAME: string;
            COLUMN_NAME: string;
            COLUMN_TYPE: string;
            IS_NULLABLE: 'YES' | 'NO';
            COLUMN_DEFAULT: string | null;
            EXTRA: string;
            CHARACTER_SET_NAME: string | null;
            COLLATION_NAME: string | null;
            DATA_TYPE: string;
          }>
        >(
          `
            SELECT
              TABLE_NAME,
              COLUMN_NAME,
              COLUMN_TYPE,
              IS_NULLABLE,
              COLUMN_DEFAULT,
              EXTRA,
              CHARACTER_SET_NAME,
              COLLATION_NAME,
              DATA_TYPE
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND LOWER(TABLE_NAME) = LOWER(?)
              AND LOWER(COLUMN_NAME) = LOWER(?)
            LIMIT 1
          `,
          tableName,
          columnName
        );

        if (rows.length === 0) {
          continue;
        }

        const meta = rows[0];
        const actualTableName = meta.TABLE_NAME;
        const actualColumnName = meta.COLUMN_NAME;
        if (!actualTableName || !actualColumnName) {
          continue;
        }
        const charsetClause = meta.CHARACTER_SET_NAME ? ` CHARACTER SET ${meta.CHARACTER_SET_NAME}` : '';
        const collationClause = meta.COLLATION_NAME ? ` COLLATE ${meta.COLLATION_NAME}` : '';
        const nullableClause = meta.IS_NULLABLE === 'NO' ? ' NOT NULL' : ' NULL';
        const defaultClause = buildDefaultClause(meta.DATA_TYPE, meta.COLUMN_DEFAULT);
        const extraClause = buildExtraClause(meta.EXTRA);
        const commentClause = ` COMMENT '${escapeSqlString(comment)}'`;

        const sql = `ALTER TABLE \`${actualTableName}\` MODIFY COLUMN \`${actualColumnName}\` ${meta.COLUMN_TYPE}${charsetClause}${collationClause}${nullableClause}${defaultClause}${extraClause}${commentClause}`;
        await prisma.$executeRawUnsafe(sql);
      }
    }

    console.log('Column comments applied');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
