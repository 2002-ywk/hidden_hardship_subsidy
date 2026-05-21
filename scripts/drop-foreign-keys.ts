import { PrismaClient } from "@prisma/client";

function requireEnv(name: string) {
  const value = (process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function ensureConfirmation() {
  requireEnv("DATABASE_URL");
  const confirm = (process.env.CONFIRM_DROP_FKS ?? "").trim();
  if (confirm !== "YES") {
    throw new Error("Refusing to drop foreign keys without confirmation. Set CONFIRM_DROP_FKS=YES.");
  }
}

async function main() {
  ensureConfirmation();

  const prisma = new PrismaClient();
  const startedAt = new Date();
  console.log(`[drop-fks] started_at=${startedAt.toISOString()}`);

  const constraints = await prisma.$queryRawUnsafe<
    Array<{
      table_name: string;
      constraint_name: string;
    }>
  >(
    `
    SELECT
      tc.TABLE_NAME AS table_name,
      tc.CONSTRAINT_NAME AS constraint_name
    FROM information_schema.TABLE_CONSTRAINTS tc
    WHERE tc.CONSTRAINT_SCHEMA = DATABASE()
      AND tc.CONSTRAINT_TYPE = 'FOREIGN KEY'
    ORDER BY tc.TABLE_NAME, tc.CONSTRAINT_NAME
    `
  );

  console.log(`[drop-fks] fk_count=${constraints.length}`);
  for (const row of constraints) {
    const table = row.table_name;
    const fk = row.constraint_name;
    await prisma.$executeRawUnsafe(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`${fk}\``);
    console.log(`[drop-fks] dropped ${table}.${fk}`);
  }

  const finishedAt = new Date();
  console.log(`[drop-fks] finished_at=${finishedAt.toISOString()}`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

