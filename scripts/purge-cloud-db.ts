import { PrismaClient } from "@prisma/client";

function requireEnv(name: string) {
  const value = (process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function ensureConfirmation() {
  // Two-step confirmation to reduce accidental runs.
  requireEnv("DATABASE_URL");
  const confirm1 = (process.env.CONFIRM_DB_PURGE ?? "").trim();
  const confirm2 = (process.env.CONFIRM_DB_PURGE_2 ?? "").trim();
  if (confirm1 !== "YES" || confirm2 !== "DELETE_ALL_DATA") {
    throw new Error(
      "Refusing to purge DB without explicit confirmation. Set CONFIRM_DB_PURGE=YES and CONFIRM_DB_PURGE_2=DELETE_ALL_DATA."
    );
  }
}

async function main() {
  ensureConfirmation();

  const prisma = new PrismaClient();

  const startedAt = new Date();
  console.log(`[purge] started_at=${startedAt.toISOString()}`);

  // 1) Stop all running sync jobs so UI won't be blocked.
  const stopResult = await prisma.syncJob.updateMany({
    where: { status: "running" },
    data: {
      status: "failed",
      delta: "purged",
      note: "Stopped by purge script",
      finishedAt: startedAt,
      lastRunAt: startedAt,
    },
  });
  console.log(`[purge] stopped_running_jobs=${stopResult.count}`);

  // 2) Drop dynamic cafeteria monthly tables (created by sync).
  // They are not part of Prisma models.
  const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `
    SELECT table_name AS name
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name LIKE 'card_transaction\\_%'
    `
  );
  for (const row of tables) {
    const name = row.name;
    // Defensive: allow only expected prefix.
    if (!/^card_transaction_\d{6}$/.test(name)) {
      console.warn(`[purge] skip_unexpected_table=${name}`);
      continue;
    }
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS \`${name}\``);
    console.log(`[purge] dropped_table=${name}`);
  }

  // 3) Delete data from Prisma-managed tables in dependency order.
  // This matches the seed reset order but without recreating data.
  await prisma.operationLog.deleteMany();
  await prisma.syncJob.deleteMany();
  await prisma.rolePermission.deleteMany();
  await prisma.finalSubsidyResult.deleteMany();
  await prisma.tagRecord.deleteMany();
  await prisma.reviewRecord.deleteMany();
  await prisma.candidateHitRule.deleteMany();
  await prisma.candidateResult.deleteMany();
  await prisma.studentMonthStat.deleteMany();
  await prisma.counselorStudentRelation.deleteMany();
  await prisma.subsidyBatch.deleteMany();
  await prisma.facultyStaff.deleteMany();
  await prisma.undergraduateDifficultyRecognition.deleteMany();
  await prisma.student.deleteMany();
  await prisma.user.deleteMany();
  await prisma.dictionaryItem.deleteMany();
  await prisma.dictionaryType.deleteMany();
  await prisma.systemConfig.deleteMany();
  await (prisma as any).cafeteriaMonthlySnapshot?.deleteMany?.();
  await prisma.candidateListSnapshot.deleteMany();

  const finishedAt = new Date();
  console.log(`[purge] finished_at=${finishedAt.toISOString()}`);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
