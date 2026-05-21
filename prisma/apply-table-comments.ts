import { PrismaClient } from '@prisma/client';

const tableComments: Record<string, string> = {
  User: '系统用户表：账号、角色、组织与状态信息',
  Student: '学生基本信息表：按学号对比更新',
  CounselorStudentRelation: '辅导员与学生关系表：数据范围授权来源',
  SubsidyBatch: '月度认定批次表：流程状态与规则参数快照',
  StudentMonthStat: '学生月度统计表：早餐/午晚餐次数与金额聚合',
  CandidateResult: '候选结果表：筛选结果、流程状态与排名',
  CandidateHitRule: '候选命中规则明细表：规则命中解释',
  CandidateListSnapshot: '候选名单快照表：按月物化缓存前端列表查询',
  ReviewRecord: '审核记录表：辅导员/学院/学生处审核轨迹',
  TagRecord: '标签流转表：通过/驳回/逾期标签生命周期',
  FinalSubsidyResult: '终审与发放结果表：是否入选及补助金额',
  SystemConfig: '系统参数表：时段、比例、阈值与超时配置',
  RolePermission: '角色权限表：权限点与数据范围配置',
  OperationLog: '操作审计日志表：关键动作留痕',
  FacultyStaff: '教职工基本信息表：工号主键及人员基础属性',
  UndergraduateDifficultyRecognition: '本科生困难认定表：按学号+学年+学期记录困难等级',
  CafeteriaMonthlySnapshot: '食堂消费月度快照表：首页统计缓存',
  DictionaryType: '字典类型表：维护可配置字典目录',
  DictionaryItem: '系统字典表：维护困难等级等可配置字典项',
  SyncJob: '同步任务表：任务状态、增量与执行信息',
};

function escapeSqlString(input: string) {
  return input.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function main() {
  const prisma = new PrismaClient();
  try {
    for (const [logicalName, comment] of Object.entries(tableComments)) {
      const rows = await prisma.$queryRawUnsafe<Array<{ TABLE_NAME: string }>>(
        `
          SELECT TABLE_NAME
          FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE()
            AND LOWER(TABLE_NAME) = LOWER(?)
          LIMIT 1
        `,
        logicalName
      );

      if (rows.length === 0) {
        continue;
      }

      const actualTableName = rows[0].TABLE_NAME;
      const sql = `ALTER TABLE \`${actualTableName}\` COMMENT = '${escapeSqlString(comment)}'`;
      await prisma.$executeRawUnsafe(sql);
    }
    console.log('Table comments applied');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
