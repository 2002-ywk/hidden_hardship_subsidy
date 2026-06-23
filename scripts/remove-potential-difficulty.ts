import { prisma } from '@/src/server/db/client';
import { candidateRepository } from '@/src/server/repositories/candidateRepository';

async function main() {
  const potentialRows = await prisma.candidateResult.findMany({
    where: {
      candidateType: 'potential_difficulty',
    },
    select: {
      id: true,
      batchId: true,
      month: true,
      studentId: true,
    },
    orderBy: [{ month: 'asc' }, { rank: 'asc' }, { studentId: 'asc' }],
  });

  if (potentialRows.length === 0) {
    console.log('No potential difficulty candidates found.');
    return;
  }

  const affectedKeys = Array.from(new Set(potentialRows.map((item) => `${item.batchId}::${item.month}`)));
  const affected = affectedKeys.map((key) => {
    const [batchId, month] = key.split('::');
    return { batchId, month };
  });

  await prisma.$transaction(async (tx) => {
    await tx.candidateHitRule.deleteMany({
      where: {
        candidateResultId: {
          in: potentialRows.map((item) => item.id),
        },
      },
    });

    await tx.reviewRecord.deleteMany({
      where: {
        OR: potentialRows.map((item) => ({
          batchId: item.batchId,
          studentId: item.studentId,
        })),
      },
    });

    await tx.tagRecord.deleteMany({
      where: {
        OR: potentialRows.map((item) => ({
          batchId: item.batchId,
          studentId: item.studentId,
        })),
      },
    });

    await tx.finalSubsidyResult.deleteMany({
      where: {
        OR: potentialRows.map((item) => ({
          batchId: item.batchId,
          studentId: item.studentId,
        })),
      },
    });

    await tx.candidateResult.deleteMany({
      where: {
        id: {
          in: potentialRows.map((item) => item.id),
        },
      },
    });
  });

  for (const { batchId, month } of affected) {
    const remaining = await prisma.candidateResult.findMany({
      where: { batchId, month },
      select: { id: true },
      orderBy: [{ rank: 'asc' }, { studentId: 'asc' }],
    });

    if (remaining.length > 0) {
      await prisma.$transaction(
        remaining.map((item, index) =>
          prisma.candidateResult.update({
            where: { id: item.id },
            data: { rank: index + 1 },
          })
        )
      );
    }

    await (candidateRepository as any).rebuildCandidateListSnapshot(month, batchId);
    await (candidateRepository as any).refreshFinalSubsidyResults(batchId, month);
  }

  console.log(
    `Removed ${potentialRows.length} potential difficulty candidate rows across ${affected.length} batch-month groups.`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
