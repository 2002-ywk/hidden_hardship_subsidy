import React from 'react';
import { AlertTriangle, CheckCircle2, Database, RefreshCcw, TimerReset } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { fetchSyncJobs, runDataSync, terminateAllSyncJobs, terminateSyncJob } from '@/src/lib/api';
import { cn } from '@/src/lib/utils';
import type { SyncJobRecord } from '@/src/types';

const statusMeta = {
  success: { label: '同步成功', className: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
  running: { label: '同步中', className: 'bg-blue-100 text-blue-700', icon: RefreshCcw },
  failed: { label: '同步失败', className: 'bg-red-100 text-red-700', icon: AlertTriangle },
} as const;

type SyncSource =
  | 'jmu_student_basic'
  | 'jmu_staff_basic'
  | 'jmu_counselor_relation'
  | 'jmu_undergrad_difficulty'
  | 'jmu_cafeteria_transaction'
  | 'jmu_org_unit'
  | 'jmu_org_post'
  | 'jmu_org_person_relation';

const syncCards: Array<{
  source: SyncSource;
  title: string;
  description: string;
}> = [
  {
    source: 'jmu_student_basic',
    title: '学生基本信息同步',
    description: '同步学生基础信息，用于候选人名单与审核流程关联。',
  },
  {
    source: 'jmu_staff_basic',
    title: '教职工基本信息同步',
    description: '同步教职工信息，用于辅导员/学院管理员等账号数据。',
  },
  {
    source: 'jmu_counselor_relation',
    title: '辅导员带班关系同步',
    description: '同步辅导员与班级/学生的关联关系，用于审核权限与数据范围。',
  },
  {
    source: 'jmu_undergrad_difficulty',
    title: '本科生困难认定同步',
    description: '同步本科生困难认定数据，用于困难标签与规则命中。',
  },
  {
    source: 'jmu_cafeteria_transaction',
    title: '一卡通食堂消费同步',
    description: '同步一卡通食堂消费流水；可按月份范围批量同步。',
  },
  {
    source: 'jmu_org_unit',
    title: '院系所单位信息同步',
    description: '同步组织机构树中的单位节点信息。',
  },
  {
    source: 'jmu_org_post',
    title: '院系所岗位信息同步',
    description: '同步组织机构树中的岗位信息。',
  },
  {
    source: 'jmu_org_person_relation',
    title: '院系所人员关联同步',
    description: '同步人员与单位、岗位的关联关系。',
  },
];

function normalizeMonthInput(value: string) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(text) ? text : '';
}

function previousMonthKey(baseDate = new Date()) {
  const year = baseDate.getFullYear();
  const monthIndex = baseDate.getMonth();
  const date = new Date(year, monthIndex - 1, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthRangeInclusive(start: string, end: string) {
  const startMatch = start.match(/^(\d{4})-(\d{2})$/);
  const endMatch = end.match(/^(\d{4})-(\d{2})$/);
  if (!startMatch || !endMatch) return [];

  const startDate = new Date(Number(startMatch[1]), Number(startMatch[2]) - 1, 1);
  const endDate = new Date(Number(endMatch[1]), Number(endMatch[2]) - 1, 1);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return [];
  if (startDate.getTime() > endDate.getTime()) return [];

  const months: string[] = [];
  let cursor = new Date(startDate.getTime());
  while (cursor.getTime() <= endDate.getTime()) {
    months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return months;
}

export default function DataSync() {
  const [syncJobs, setSyncJobs] = React.useState<SyncJobRecord[]>([]);
  const [isSyncing, setIsSyncing] = React.useState(false);
  const [activeJobId, setActiveJobId] = React.useState<string | null>(null);
  const [terminatingJobId, setTerminatingJobId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [cafeteriaStartMonth, setCafeteriaStartMonth] = React.useState(previousMonthKey());
  const [cafeteriaEndMonth, setCafeteriaEndMonth] = React.useState(previousMonthKey());

  const loadJobs = React.useCallback(() => {
    fetchSyncJobs()
      .then(setSyncJobs)
      .catch(() => {
        setError('同步任务加载失败，请稍后重试。');
      });
  }, []);

  React.useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  React.useEffect(() => {
    if (!activeJobId) return;

    const timer = setInterval(() => {
      loadJobs();
    }, 3000);

    return () => {
      clearInterval(timer);
    };
  }, [activeJobId, loadJobs]);

  React.useEffect(() => {
    if (!activeJobId) return;
    const target = syncJobs.find((job) => job.id === activeJobId);
    if (!target) return;

    if (target.status === 'success') {
      setSuccess(`同步任务已完成：${target.delta}`);
      setActiveJobId(null);
      return;
    }

    if (target.status === 'failed') {
      setError(`同步任务失败：${target.note}`);
      setActiveJobId(null);
    }
  }, [activeJobId, syncJobs]);

  const dashboardStats = React.useMemo(() => {
    const now = new Date();
    const todayText = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const todayJobs = syncJobs.filter((job) => job.lastRun !== '-' && job.lastRun.startsWith(todayText));
    const runningCount = syncJobs.filter((job) => job.status === 'running').length;
    const failedCount = todayJobs.filter((job) => job.status === 'failed').length;
    const successCount = todayJobs.filter((job) => job.status === 'success').length;
    const latestSuccess = syncJobs.find((job) => job.status === 'success');
    return {
      todayCount: todayJobs.length,
      runningCount,
      failedCount,
      successCount,
      latestSuccessRun: latestSuccess?.lastRun ?? '-',
    };
  }, [syncJobs]);

  const handleRunSync = async (source: SyncSource, label: string) => {
    setIsSyncing(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await runDataSync({ source });
      setActiveJobId(result.data.jobId);
      setSuccess(`${label} 任务已启动（任务ID: ${result.data.jobId}），正在后台执行。`);
      loadJobs();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : '同步执行失败。请检查中台令牌配置、权限范围和接口权限。';
      setError(`同步执行失败：${message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleRunCafeteriaSync = async () => {
    setIsSyncing(true);
    setError(null);
    setSuccess(null);

    const startMonth = normalizeMonthInput(cafeteriaStartMonth);
    const endMonth = normalizeMonthInput(cafeteriaEndMonth);
    const months = monthRangeInclusive(startMonth, endMonth);
    if (months.length === 0) {
      setIsSyncing(false);
      setError('请选择正确的同步月份范围（YYYY-MM），且开始月份不能大于结束月份。');
      return;
    }

    try {
      const result = await runDataSync({ source: 'jmu_cafeteria_transaction', syncMonths: months });
      setActiveJobId(result.data.jobId);
      setSuccess(`食堂消费同步任务已启动（月：${months.join(', ')}；任务ID: ${result.data.jobId}），正在后台执行。`);
      loadJobs();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : '同步执行失败。请检查中台令牌配置、权限范围和接口权限。';
      setError(`同步执行失败：${message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleTerminateJob = async (jobId: string) => {
    setTerminatingJobId(jobId);
    setError(null);
    setSuccess(null);
    try {
      const result = await terminateSyncJob(jobId);
      setSuccess(`${result.message}（任务ID: ${jobId}）`);
      loadJobs();
    } catch (err) {
      const message = err instanceof Error ? err.message : '终止任务失败';
      setError(`终止任务失败：${message}`);
    } finally {
      setTerminatingJobId(null);
    }
  };

  const handleTerminateAllJobs = async () => {
    setTerminatingJobId('all');
    setError(null);
    setSuccess(null);
    try {
      const result = await terminateAllSyncJobs();
      setSuccess(`${result.message}`);
      loadJobs();
    } catch (err) {
      const message = err instanceof Error ? err.message : '终止任务失败';
      setError(`终止任务失败：${message}`);
    } finally {
      setTerminatingJobId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">数据同步</h1>
          <p className="text-slate-500">从中台同步学生/教职工/关系/困难认定/食堂消费等数据。</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            className="gap-2"
            variant="destructive"
            onClick={handleTerminateAllJobs}
            disabled={terminatingJobId != null}
          >
            <TimerReset size={16} className={terminatingJobId ? 'animate-spin' : ''} />
            {terminatingJobId ? '处理中..' : '终止所有同步'}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}
      {success ? (
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="border-none shadow-sm">
          <CardContent className="p-6">
            <p className="text-sm text-slate-500">今日同步任务</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">{dashboardStats.todayCount}</p>
            <p className="mt-1 text-xs text-emerald-600">
              {dashboardStats.successCount} 项已完成，{dashboardStats.runningCount} 项运行中
            </p>
          </CardContent>
        </Card>
        <Card className="border-none shadow-sm">
          <CardContent className="p-6">
            <p className="text-sm text-slate-500">异常记录</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">{dashboardStats.failedCount}</p>
            <p className="mt-1 text-xs text-red-600">今日失败任务数（可在下方查看失败原因并重试）</p>
          </CardContent>
        </Card>
        <Card className="border-none shadow-sm bg-blue-600 text-white">
          <CardContent className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm text-blue-100">最近成功执行</p>
                <p className="mt-2 text-2xl font-bold">{dashboardStats.latestSuccessRun === '-' ? '暂无' : dashboardStats.latestSuccessRun}</p>
                <p className="mt-1 text-xs text-blue-100">状态卡片为实时统计</p>
              </div>
              <Database size={22} className="text-blue-100" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">同步任务</CardTitle>
          <CardDescription>每类同步只保留 1 张状态卡片；在卡片内可直接发起同步或终止正在执行的任务。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {syncCards.map((card) => {
            const job = syncJobs.find((item) => item.source === card.source);
            const meta = job ? statusMeta[job.status] : statusMeta.success;
            const Icon = meta.icon;
            const isRunning = job?.status === 'running';

            return (
              <div key={card.source} className="rounded-xl border border-slate-100 bg-white p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="text-base font-semibold text-slate-900">{card.title}</h2>
                      {job ? (
                        <Badge className={cn('border-none', meta.className)}>
                          <Icon size={14} className={job.status === 'running' ? 'animate-spin' : ''} />
                          {meta.label}
                        </Badge>
                      ) : (
                        <Badge className="border-none bg-slate-100 text-slate-600">
                          <CheckCircle2 size={14} />
                          未执行
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-slate-500">{card.description}</p>

                    <div className="grid gap-3 text-sm text-slate-600 sm:grid-cols-3">
                      <div>
                        <p className="text-xs text-slate-400">最近执行</p>
                        <p className="mt-1 font-medium text-slate-900">{job?.lastRun ?? '-'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400">本次增量</p>
                        <p className="mt-1 font-medium text-slate-900">{job?.delta ?? '-'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400">备注</p>
                        <p className="mt-1 font-medium text-slate-900">{job?.note ?? '-'}</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 lg:items-end">
                    {card.source === 'jmu_cafeteria_transaction' ? (
                      <div className="flex flex-wrap items-center justify-end gap-2 rounded-lg border border-slate-200 bg-white px-2 py-2">
                        <Input
                          type="month"
                          className="h-9 w-[140px]"
                          value={cafeteriaStartMonth}
                          onChange={(e) => setCafeteriaStartMonth(e.target.value)}
                          disabled={isSyncing || isRunning}
                        />
                        <span className="text-xs text-slate-500">至</span>
                        <Input
                          type="month"
                          className="h-9 w-[140px]"
                          value={cafeteriaEndMonth}
                          onChange={(e) => setCafeteriaEndMonth(e.target.value)}
                          disabled={isSyncing || isRunning}
                        />
                        <Button
                          className="gap-2"
                          variant="outline"
                          onClick={() => void handleRunCafeteriaSync()}
                          disabled={isSyncing || isRunning}
                        >
                          <RefreshCcw size={16} className={isSyncing ? 'animate-spin' : ''} />
                          {isSyncing ? '同步中..' : '立即同步'}
                        </Button>
                      </div>
                    ) : (
                      <Button
                        className="gap-2 bg-blue-600 hover:bg-blue-700"
                        onClick={() => handleRunSync(card.source, card.title)}
                        disabled={isSyncing || isRunning}
                      >
                        <RefreshCcw size={16} className={isSyncing ? 'animate-spin' : ''} />
                        {isSyncing ? '同步中..' : '立即同步'}
                      </Button>
                    )}

                    <Button
                      variant="outline"
                      className="gap-2"
                      disabled={!isRunning || !job || terminatingJobId === job.id}
                      onClick={() => job && void handleTerminateJob(job.id)}
                    >
                      <TimerReset size={16} />
                      {job && terminatingJobId === job.id ? '终止中..' : '终止任务'}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
