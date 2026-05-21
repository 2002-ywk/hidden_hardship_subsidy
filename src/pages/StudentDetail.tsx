import React from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ReceiptText, ShieldCheck, Tags, UserRound } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { fetchMe, fetchStudentDetail, submitReview } from '@/src/lib/api';
import type { ReviewStage, StudentDetail as StudentDetailModel, UserRole } from '@/src/types';

export default function StudentDetail() {
  const { studentId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [detail, setDetail] = React.useState<StudentDetailModel | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [actionMessage, setActionMessage] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [currentRole, setCurrentRole] = React.useState<UserRole | null>(null);
  const [canFundingOfficeReview, setCanFundingOfficeReview] = React.useState(false);
  const [canFinalReview, setCanFinalReview] = React.useState(false);
  const actionLockRef = React.useRef(false);
  const [activeTab, setActiveTab] = React.useState(() => {
    const tab = searchParams.get('tab');
    return tab === 'transactions' || tab === 'audit' || tab === 'rules' || tab === 'stats' ? tab : 'stats';
  });

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
    const tab = searchParams.get('tab');
    if (tab === 'transactions' || tab === 'audit' || tab === 'rules' || tab === 'stats') {
      setActiveTab(tab);
    }
  }, [searchParams]);

  const sortedTransactions = React.useMemo(() => {
    if (!detail) return [];
    return [...detail.transactions].sort((a, b) => String(b.time).localeCompare(String(a.time)));
  }, [detail]);

  React.useEffect(() => {
    if (!studentId) {
      setError('缺少学生编号。');
      setIsLoading(false);
      return;
    }

    const month = searchParams.get('month');
    if (!month) {
      setError('缺少月份参数，请从候选名单或审核中心进入。');
      setIsLoading(false);
      return;
    }

    let mounted = true;
    fetchStudentDetail(studentId, month)
      .then((response) => {
        if (!mounted) return;
        setDetail(response.data);
        setError(null);
      })
      .catch(() => {
        if (!mounted) return;
        setError('学生详情加载失败，请稍后重试。');
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [studentId, searchParams]);

  const handleReview = async (decision: 'approve' | 'reject') => {
    if (!studentId || !detail || actionLockRef.current) return;

    actionLockRef.current = true;
    setIsSubmitting(true);
    setActionMessage(null);

    try {
      const response = await submitReview(studentId, {
        stage: detail.currentStage,
        decision,
        comment: decision === 'approve' ? '按当前业务流程流转到下一审核环节。' : '演示驳回动作。',
        month: detail.month,
      });
      setDetail(response.data);
      setActionMessage(response.message);
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      const normalized = message.toLowerCase();
      const isPermissionError =
        message.includes('无权限') ||
        message.includes('无权') ||
        normalized.includes('forbidden') ||
        normalized.includes('403');
      setActionMessage(isPermissionError ? '无审核权限。' : '审核动作提交失败，请稍后重试。');
    } finally {
      actionLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <Card className="border-none shadow-sm">
        <CardContent className="p-10 text-center text-slate-500">正在加载学生详情...</CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-none shadow-sm">
        <CardContent className="p-10 text-center">
          <p className="text-lg font-medium text-slate-900">加载失败</p>
          <p className="mt-2 text-sm text-slate-500">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!detail) {
    return (
      <Card className="border-none shadow-sm">
        <CardContent className="p-10 text-center">
          <p className="text-lg font-medium text-slate-900">未找到学生详情</p>
          <p className="mt-2 text-sm text-slate-500">请从候选名单重新进入。</p>
        </CardContent>
      </Card>
    );
  }

  const canReviewStatus = detail.workflowStatus.startsWith('pending') || detail.workflowStatus.includes('overdue');
  const canRoleReviewCurrentStage = canReviewStageByRole(currentRole, detail.currentStage, {
    canFundingOfficeReview,
    canFinalReview,
  });
  const canReview = canReviewStatus && canRoleReviewCurrentStage;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <Button variant="outline" size="icon" className="mt-1 h-9 w-9" onClick={() => navigate(-1)}>
            <ArrowLeft size={16} />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">学生详情</h1>
            <p className="text-slate-500">查看基础信息、消费统计、规则命中、审核轨迹与补助测算。</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {detail.tags.map((tag) => (
            <Badge key={tag} className="border-none bg-blue-50 text-blue-700 hover:bg-blue-50">
              {tag}
            </Badge>
          ))}
        </div>
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-900">当前审核环节：{getStageLabel(detail.currentStage)}</p>
            <p className="mt-1 text-sm text-slate-500">状态：{detail.workflowStatusLabel}</p>
            <p className="mt-1 text-xs text-slate-400">批次：{detail.batchId} · 月份：{detail.month}</p>
            {actionMessage ? <p className="mt-2 text-sm text-blue-700">{actionMessage}</p> : null}
          </div>
          {canReview ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => handleReview('reject')} disabled={isSubmitting}>驳回</Button>
              <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => handleReview('approve')} disabled={isSubmitting}>
                {isSubmitting ? '提交中...' : '通过并流转'}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="border-none shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-2">
              <UserRound className="text-blue-600" size={18} />
              <CardTitle className="text-lg">学生基础信息</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Info label="姓名" value={detail.name} />
            <Info label="学号" value={detail.studentId} />
            <Info label="学生类型" value={detail.typeLabel} />
            <Info label="学院" value={detail.college} />
            <Info label="班级" value={detail.className} />
            <Info label="辅导员" value={detail.counselor} />
          </CardContent>
        </Card>

        <Card className="border-none bg-blue-600 text-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">本月补助测算</CardTitle>
            <CardDescription className="text-blue-100">分项补助与总额展示。</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Metric label="早餐补助" value={`¥ ${detail.subsidy.breakfast.toFixed(2)}`} />
            <Metric label="午晚餐补助" value={`¥ ${detail.subsidy.lunchDinner.toFixed(2)}`} />
            <Metric label="总补助" value={`¥ ${detail.subsidy.total.toFixed(2)}`} />
            <Metric label="终审排名" value={`#${detail.subsidy.rank}`} />
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="border border-slate-200 bg-white p-1">
          <TabsTrigger value="stats" className="data-[state=active]:bg-slate-100">消费统计</TabsTrigger>
          <TabsTrigger value="rules" className="data-[state=active]:bg-slate-100">规则与标签</TabsTrigger>
          <TabsTrigger value="audit" className="data-[state=active]:bg-slate-100">确认与审核</TabsTrigger>
          <TabsTrigger value="transactions" className="data-[state=active]:bg-slate-100">消费明细</TabsTrigger>
        </TabsList>

        <TabsContent value="stats" className="mt-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-9">
            <StatCard label="早餐次数" value={`${detail.monthlyStats.breakfastCount} 次`} />
            <StatCard label="早餐总额" value={`¥ ${detail.monthlyStats.breakfastTotal.toFixed(2)}`} />
            <StatCard label="午晚餐次数" value={`${detail.monthlyStats.lunchDinnerCount} 次`} />
            <StatCard label="午晚餐总额" value={`¥ ${detail.monthlyStats.lunchDinnerTotal.toFixed(2)}`} />
            <StatCard label="消费天数" value={`${detail.monthlyStats.daysCount} 天`} />
            <StatCard label="早餐天数" value={`${detail.monthlyStats.breakfastDaysCount} 天`} />
            <StatCard label="午晚餐天数" value={`${detail.monthlyStats.lunchDinnerDaysCount} 天`} />
            <StatCard label="早餐50%分位" value={`¥ ${detail.monthlyStats.breakfastP50.toFixed(2)}`} />
            <StatCard label="午晚餐50%分位" value={`¥ ${detail.monthlyStats.lunchDinnerP50.toFixed(2)}`} />
          </div>
        </TabsContent>

        <TabsContent value="rules" className="mt-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="border-none shadow-sm">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <AlertCircle className="text-amber-600" size={18} />
                  <CardTitle className="text-lg">命中规则</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-slate-600">
                {detail.hitRules.map((rule) => (
                  <div key={rule} className="rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-100">{rule}</div>
                ))}
              </CardContent>
            </Card>
            <Card className="border-none shadow-sm">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Tags className="text-blue-600" size={18} />
                  <CardTitle className="text-lg">标签历史</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {detail.tagTimeline.map((item) => (
                  <div key={`${item.tag}-${item.createdAt}`} className="flex items-start justify-between gap-4 rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-100">
                    <div>
                      <p className="font-medium text-slate-900">{item.tag}</p>
                      <p className="text-xs text-slate-500">{item.source}</p>
                    </div>
                    <div className="text-right text-xs text-slate-500">
                      <p>{item.statusLabel}</p>
                      <p className="mt-1">{item.createdAt}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="audit" className="mt-6">
          <Card className="border-none shadow-sm">
            <CardHeader>
              <div className="flex items-center gap-2">
                <ShieldCheck className="text-emerald-600" size={18} />
                <CardTitle className="text-lg">审核轨迹</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {detail.auditTrail.map((item) => (
                <div key={`${item.nodeLabel}-${item.time}`} className="rounded-2xl bg-slate-50 px-4 py-4 ring-1 ring-slate-100">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium text-slate-900">{item.nodeLabel} · {item.result}</p>
                      <p className="text-sm text-slate-500">操作人：{item.operator}</p>
                    </div>
                    <p className="text-xs text-slate-500">{item.time}</p>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{item.comment}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="transactions" className="mt-6">
          <Card className="border-none shadow-sm">
            <CardHeader>
              <div className="flex items-center gap-2">
                <ReceiptText className="text-slate-700" size={18} />
                <CardTitle className="text-lg">消费明细</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-lg border border-slate-100">
                <Table>
                  <TableHeader className="bg-slate-50">
                    <TableRow>
                      <TableHead>交易时间</TableHead>
                      <TableHead>消费时段</TableHead>
                      <TableHead>地点</TableHead>
                      <TableHead className="text-right">金额</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedTransactions.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{item.time}</TableCell>
                        <TableCell>{item.slotLabel}</TableCell>
                        <TableCell>{item.location}</TableCell>
                        <TableCell className="text-right">¥ {item.amount.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function getStageLabel(stage: ReviewStage) {
  switch (stage) {
    case 'counselor':
      return '辅导员确认';
    case 'college':
      return '学院审核';
    case 'funding_office':
      return '学生资助办审核';
    case 'student_affairs':
      return '学生处终审';
    default:
      return stage;
  }
}

function canReviewStageByRole(
  role: UserRole | null,
  stage: ReviewStage,
  capabilities?: { canFundingOfficeReview?: boolean; canFinalReview?: boolean }
) {
  if (!role) return false;
  if (role === 'admin') return true;
  if (stage === 'funding_office' && capabilities?.canFundingOfficeReview) return true;
  if (stage === 'student_affairs' && capabilities?.canFinalReview) return true;
  if (role === 'counselor') return stage === 'counselor';
  if (role === 'college_admin') return stage === 'college';
  if (role === 'student_affairs') {
    if (stage === 'funding_office') return Boolean(capabilities?.canFundingOfficeReview);
    if (stage === 'student_affairs') return capabilities?.canFinalReview !== false;
    return false;
  }
  return false;
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-100">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 font-medium text-slate-900">{value}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/10 px-4 py-3 ring-1 ring-white/10">
      <p className="text-xs text-blue-100">{label}</p>
      <p className="mt-2 text-xl font-bold text-white">{value}</p>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="border-none shadow-sm">
      <CardContent className="p-6">
        <p className="text-sm text-slate-500">{label}</p>
        <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
      </CardContent>
    </Card>
  );
}
