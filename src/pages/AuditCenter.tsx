import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Building2, CheckCircle2, ChevronRight, GraduationCap } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { fetchAuditTasks, fetchMe, submitReview } from '@/src/lib/api';
import type { ReviewTask, UserRole } from '@/src/types';

type ReviewStageKey = 'counselor' | 'college' | 'funding_office' | 'student_affairs';

function resolveReviewStage(role: string): ReviewStageKey {
  const normalizedRole = String(role ?? '').trim().toLowerCase();
  if (normalizedRole.includes('辅导员') || normalizedRole.includes('counselor')) return 'counselor';
  if (normalizedRole.includes('学院') || normalizedRole.includes('college')) return 'college';
  if (normalizedRole.includes('资助') || normalizedRole.includes('办公室') || normalizedRole.includes('funding')) return 'funding_office';
  return 'student_affairs';
}

function getMonthLabel(month: string) {
  if (!month) return '未设置月份';
  const [year, mon] = month.split('-');
  if (!year || !mon) return month;
  return `${year}年${mon}月`;
}

const TaskCard: React.FC<{
  icon: React.ReactNode;
  task: ReviewTask;
  isSubmitting: boolean;
  onQuickApprove: (task: ReviewTask) => void;
  onOpenDetail: (task: ReviewTask) => void;
}> = ({ icon, task, isSubmitting, onQuickApprove, onOpenDetail }) => {
  return (
    <Card
      className="border-none shadow-sm transition-shadow hover:shadow-md cursor-pointer"
      onClick={() => onOpenDetail(task)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenDetail(task);
        }
      }}
    >
      <CardContent className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center text-slate-600">{icon}</div>
          <div>
            <h4 className="font-bold text-slate-900">{task.student} 的补助申请</h4>
            <p className="text-xs text-slate-500">{task.college} | {task.time}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right hidden sm:block">
            <p className="text-xs text-slate-500">当前环节</p>
            <p className="text-sm font-medium text-slate-900">{task.role}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={isSubmitting}
            onClick={(e) => {
              e.stopPropagation();
              onQuickApprove(task);
            }}
          >
            {isSubmitting ? '处理中...' : '快速通过'}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-9 w-9"
            aria-label="打开详情"
            onClick={(e) => {
              e.stopPropagation();
              onOpenDetail(task);
            }}
          >
            <ChevronRight className="text-slate-400" size={20} />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default function AuditCenter() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialMonth = searchParams.get('month') ?? '';
  const [selectedMonth, setSelectedMonth] = React.useState(initialMonth);

  const [currentRole, setCurrentRole] = React.useState<UserRole | null>(null);
  const [canFundingOfficeReview, setCanFundingOfficeReview] = React.useState(false);
  const [canFinalReview, setCanFinalReview] = React.useState(false);

  const [activeTab, setActiveTab] = React.useState('');
  const [auditTasks, setAuditTasks] = React.useState<ReviewTask[]>([]);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [submittingTaskIds, setSubmittingTaskIds] = React.useState<Set<string>>(new Set());

  const loadTasks = React.useCallback(() => {
    fetchAuditTasks().then(setAuditTasks);
  }, []);

  React.useEffect(() => {
    fetchMe()
      .then((payload) => {
        setCurrentRole(payload.data.user.role);
        setCanFundingOfficeReview(Boolean((payload.data.user as { canFundingOfficeReview?: boolean }).canFundingOfficeReview));
        setCanFinalReview((payload.data.user as { canFinalReview?: boolean }).canFinalReview !== false);
      })
      .catch(() => {
        setCurrentRole(null);
        setCanFundingOfficeReview(false);
        setCanFinalReview(false);
      });
  }, []);

  React.useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const monthOptions = React.useMemo(() => {
    const months = auditTasks.map((task) => task.month).filter((m): m is string => typeof m === 'string' && m.length > 0);
    return Array.from(new Set(months)).sort((a, b) => String(b).localeCompare(String(a)));
  }, [auditTasks]);

  React.useEffect(() => {
    if (monthOptions.length === 0) {
      if (selectedMonth) setSelectedMonth('');
      return;
    }
    if (selectedMonth && monthOptions.includes(selectedMonth)) return;
    const queryMonth = searchParams.get('month');
    if (queryMonth && monthOptions.includes(queryMonth)) {
      setSelectedMonth(queryMonth);
      return;
    }
    setSelectedMonth(monthOptions[0]);
  }, [monthOptions, searchParams, selectedMonth]);

  const handleMonthChange = React.useCallback((month: string) => {
    setSelectedMonth(month);
    const next = new URLSearchParams(searchParams);
    if (month) next.set('month', month);
    else next.delete('month');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const handleQuickApprove = React.useCallback(async (task: ReviewTask) => {
    setError(null);
    setMessage(null);
    setSubmittingTaskIds((prev) => new Set(prev).add(task.id));
    try {
      const stage = resolveReviewStage(task.role);
      const response = await submitReview(task.studentId, {
        stage,
        decision: 'approve',
        comment: '在审核中心执行快速通过。',
        month: task.month,
      });
      setMessage(response.message);
      loadTasks();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '快速通过失败';
      setError(msg);
    } finally {
      setSubmittingTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
    }
  }, [loadTasks]);

  const tasksByMonth = React.useMemo(() => (selectedMonth ? auditTasks.filter((task) => task.month === selectedMonth) : auditTasks), [auditTasks, selectedMonth]);

  const counselorTasks = tasksByMonth.filter((task) => resolveReviewStage(task.role) === 'counselor');
  const collegeTasks = tasksByMonth.filter((task) => resolveReviewStage(task.role) === 'college');
  const fundingOfficeTasks = tasksByMonth.filter((task) => resolveReviewStage(task.role) === 'funding_office');
  const finalTasks = tasksByMonth.filter((task) => resolveReviewStage(task.role) === 'student_affairs');

  const canAccessStage = React.useCallback((stage: ReviewStageKey) => {
    if (currentRole === 'admin') return true;
    if (stage === 'funding_office') return canFundingOfficeReview;
    if (stage === 'student_affairs') return canFinalReview;
    if (stage === 'counselor') return currentRole === 'counselor';
    if (stage === 'college') return currentRole === 'college_admin';
    return false;
  }, [currentRole, canFundingOfficeReview, canFinalReview]);

  const visibleTabs = React.useMemo(() => {
    const tabs: Array<{ value: string; stage: ReviewStageKey; label: string }> = [];
    if (canAccessStage('counselor')) tabs.push({ value: 'counselor', stage: 'counselor', label: '辅导员确认' });
    if (canAccessStage('college')) tabs.push({ value: 'college', stage: 'college', label: '学院审核' });
    if (canAccessStage('funding_office')) tabs.push({ value: 'funding_office', stage: 'funding_office', label: '学生资助办审核' });
    if (canAccessStage('student_affairs')) tabs.push({ value: 'final', stage: 'student_affairs', label: '学生处终审' });
    return tabs;
  }, [canAccessStage]);

  React.useEffect(() => {
    if (visibleTabs.length === 0) {
      if (activeTab !== '') setActiveTab('');
      return;
    }
    if (!visibleTabs.some((tab) => tab.value === activeTab)) {
      setActiveTab(visibleTabs[0].value);
    }
  }, [activeTab, visibleTabs]);

  const handleOpenDetail = React.useCallback((task: ReviewTask) => {
    navigate(`/students/${task.studentId}?month=${encodeURIComponent(task.month)}&tab=transactions`);
  }, [navigate]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">审核中心</h1>
          <p className="text-slate-500">只展示当前账号可处理的审核环节。</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-500">认定月份</span>
          <select
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-400"
            value={selectedMonth}
            onChange={(e) => handleMonthChange(e.target.value)}
          >
            {monthOptions.length === 0 ? <option value="">暂无月份</option> : null}
            {monthOptions.map((month) => <option key={month} value={month}>{getMonthLabel(month)}</option>)}
          </select>
        </div>
      </div>

      {message ? <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">{message}</div> : null}
      {error ? <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      {visibleTabs.length === 0 ? (
        <div className="bg-white p-12 rounded-lg border border-dashed border-slate-200 text-center text-slate-500">当前账号无可处理审核环节</div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="bg-white border border-slate-200 p-1 mb-6">
            {visibleTabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="data-[state=active]:bg-slate-100">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="counselor" className="space-y-4">
            {counselorTasks.map((task) => (
              <TaskCard key={task.id} icon={<GraduationCap size={20} />} task={task} isSubmitting={submittingTaskIds.has(task.id)} onQuickApprove={(t) => void handleQuickApprove(t)} onOpenDetail={handleOpenDetail} />
            ))}
            {counselorTasks.length === 0 ? <div className="bg-white p-12 rounded-lg border border-dashed border-slate-200 text-center text-slate-500">暂无待处理任务</div> : null}
          </TabsContent>

          <TabsContent value="college" className="space-y-4">
            {collegeTasks.map((task) => (
              <TaskCard key={task.id} icon={<Building2 size={20} />} task={task} isSubmitting={submittingTaskIds.has(task.id)} onQuickApprove={(t) => void handleQuickApprove(t)} onOpenDetail={handleOpenDetail} />
            ))}
            {collegeTasks.length === 0 ? <div className="bg-white p-12 rounded-lg border border-dashed border-slate-200 text-center text-slate-500">暂无待处理任务</div> : null}
          </TabsContent>

          <TabsContent value="funding_office" className="space-y-4">
            {fundingOfficeTasks.map((task) => (
              <TaskCard key={task.id} icon={<Building2 size={20} />} task={task} isSubmitting={submittingTaskIds.has(task.id)} onQuickApprove={(t) => void handleQuickApprove(t)} onOpenDetail={handleOpenDetail} />
            ))}
            {fundingOfficeTasks.length === 0 ? <div className="bg-white p-12 rounded-lg border border-dashed border-slate-200 text-center text-slate-500">暂无待处理任务</div> : null}
          </TabsContent>

          <TabsContent value="final" className="space-y-4">
            {finalTasks.map((task) => (
              <TaskCard key={task.id} icon={<CheckCircle2 size={20} />} task={task} isSubmitting={submittingTaskIds.has(task.id)} onQuickApprove={(t) => void handleQuickApprove(t)} onOpenDetail={handleOpenDetail} />
            ))}
            {finalTasks.length === 0 ? <div className="bg-white p-12 rounded-lg border border-dashed border-slate-200 text-center text-slate-500">暂无待处理任务</div> : null}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
