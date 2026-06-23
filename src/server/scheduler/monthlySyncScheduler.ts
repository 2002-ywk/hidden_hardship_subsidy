import { prisma } from '@/src/server/db/client';
import { dataSyncRepository } from '@/src/server/repositories/dataSyncRepository';
import { getDateTimePartsInTimeZone } from '@/src/server/time';

const TIME_ZONE = process.env.APP_TIME_ZONE?.trim() || 'Asia/Shanghai';
const CHECK_INTERVAL_MS = 60 * 1000;
const RUN_HOUR = 1;
const RUN_MINUTE = 0;
const LOCK_ID_PREFIX = 'system-monthly-full-sync';
const LOCK_SOURCE = 'system_monthly_full_sync';
const LOCK_NAME = '每月全量数据同步';
const LOCK_FREQUENCY = 'monthly';

function getScheduledMonth(now = new Date()) {
  const parts = getDateTimePartsInTimeZone(now, TIME_ZONE);
  let year = Number(parts.year);
  let month = Number(parts.month) - 1;
  if (month <= 0) {
    year -= 1;
    month = 12;
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

function shouldRunNow(now = new Date()) {
  const parts = getDateTimePartsInTimeZone(now, TIME_ZONE);
  return Number(parts.day) === 1 && Number(parts.hour) === RUN_HOUR && Number(parts.minute) === RUN_MINUTE;
}

function isPastScheduledWindow(now = new Date()) {
  const parts = getDateTimePartsInTimeZone(now, TIME_ZONE);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return day === 1 && (hour > RUN_HOUR || (hour === RUN_HOUR && minute >= RUN_MINUTE));
}

async function acquireLock(targetMonth: string) {
  const lockId = `${LOCK_ID_PREFIX}-${targetMonth.replace('-', '')}`;
  try {
    const job = await prisma.syncJob.create({
      data: {
        id: lockId,
        name: LOCK_NAME,
        source: LOCK_SOURCE,
        jobType: 'scheduler_sync',
        frequency: LOCK_FREQUENCY,
        status: 'running',
        delta: '运行中',
        note: `调度任务已触发，目标月份=${targetMonth}`,
        startedAt: new Date(),
      },
    });
    return { acquired: true, jobId: job.id };
  } catch {
    return { acquired: false, jobId: lockId };
  }
}

async function releaseLock(lockId: string, success: boolean, note: string, delta: string) {
  const finishedAt = new Date();
  await prisma.syncJob.updateMany({
    where: { id: lockId, source: LOCK_SOURCE, status: 'running' },
    data: {
      status: success ? 'success' : 'failed',
      finishedAt,
      lastRunAt: finishedAt,
      note,
      delta,
    },
  });
}

async function runMonthlySync() {
  const now = new Date();
  const targetMonth = getScheduledMonth(now);
  const existing = await prisma.syncJob.findFirst({
    where: {
      source: LOCK_SOURCE,
      frequency: LOCK_FREQUENCY,
      lastRunAt: {
        gte: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0),
      },
      status: 'success',
    },
    orderBy: { lastRunAt: 'desc' },
  });
  if (existing) return;

  if (!shouldRunNow(now) && !isPastScheduledWindow(now)) return;

  const lock = await acquireLock(targetMonth);
  if (!lock.acquired) return;

  try {
    if (await dataSyncRepository.hasRunningSyncJobs()) {
      await releaseLock(lock.jobId, false, '发现其他同步任务正在执行，已跳过本次月度调度', '已跳过');
      return;
    }

    await dataSyncRepository.runSyncAndWait({ source: 'jmu_student_basic' });
    await dataSyncRepository.runSyncAndWait({ source: 'jmu_staff_basic' });
    await dataSyncRepository.runSyncAndWait({ source: 'jmu_counselor_relation' });
    await dataSyncRepository.runSyncAndWait({ source: 'jmu_undergrad_difficulty' });
    await dataSyncRepository.runSyncAndWait({ source: 'jmu_org_unit' });
    await dataSyncRepository.runSyncAndWait({ source: 'jmu_org_post' });
    await dataSyncRepository.runSyncAndWait({ source: 'jmu_org_person_relation' });
    await dataSyncRepository.runSyncAndWait({ source: 'jmu_cafeteria_transaction', syncMonth: targetMonth });

    await releaseLock(lock.jobId, true, `月度全量同步完成，目标月份=${targetMonth}`, '月度同步完成');
    console.log(`[scheduler] monthly sync finished for ${targetMonth}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : '月度同步失败';
    await releaseLock(lock.jobId, false, `月度全量同步失败，目标月份=${targetMonth}，原因：${message}`, '月度同步失败');
    console.error('[scheduler] monthly sync failed:', message);
  }
}

export function startMonthlySyncScheduler() {
  const timer = setInterval(() => {
    void runMonthlySync();
  }, CHECK_INTERVAL_MS);
  timer.unref?.();

  void runMonthlySync();
  console.log('[scheduler] monthly sync scheduler started');

  return () => clearInterval(timer);
}
