import { PrismaClient } from '@prisma/client';

/**
 * Seed script intentionally does nothing.
 *
 * This project is meant to run on real synced data instead of local mock/seed data.
 * Use the data sync module to import Faculty/Student/Cafeteria transactions.
 */
async function main() {
  const prisma = new PrismaClient();
  await prisma.$disconnect();
  console.log('[seed] skipped (no seed data)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});