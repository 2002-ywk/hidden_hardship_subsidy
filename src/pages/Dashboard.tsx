import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, TrendingDown, Users } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useAuthUser } from '@/src/components/AuthUserContext';
import { fetchDashboardAnalytics, fetchDashboardSummary } from '@/src/lib/api';
import { cn } from '@/src/lib/utils';
import type { ActivityItem, ConsumptionAnalytics, DashboardStatItem, TrendItem } from '@/src/types';

const statIcons = {
  users: Users,
  trend: TrendingDown,
  alert: AlertCircle,
};

export default function Dashboard() {
  const navigate = useNavigate();
  const me = useAuthUser();
  const allActivitiesPageSize = 10;
  const [stats, setStats] = React.useState<DashboardStatItem[]>([]);
  const [trends, setTrends] = React.useState<TrendItem[]>([]);
  const [consumptionAnalytics, setConsumptionAnalytics] = React.useState<ConsumptionAnalytics>({ series: [], latest: null });
  const [activityItems, setActivityItems] = React.useState<ActivityItem[]>([]);
  const [isSummaryLoading, setIsSummaryLoading] = React.useState(true);
  const [isAnalyticsLoading, setIsAnalyticsLoading] = React.useState(true);
  const [summaryError, setSummaryError] = React.useState<string | null>(null);
  const [analyticsError, setAnalyticsError] = React.useState<string | null>(null);
  const [isAllActivityOpen, setIsAllActivityOpen] = React.useState(false);
  const [allActivitiesPage, setAllActivitiesPage] = React.useState(1);
  const canCreateBatch = me?.role === 'admin' || me?.role === 'student_affairs';
  const visibleActivities = activityItems.slice(0, 4);
  const allActivitiesTotalPages = Math.max(1, Math.ceil(activityItems.length / allActivitiesPageSize));
  const allActivitiesStart = (allActivitiesPage - 1) * allActivitiesPageSize;
  const allActivitiesCurrentPageItems = activityItems.slice(
    allActivitiesStart,
    allActivitiesStart + allActivitiesPageSize
  );

  React.useEffect(() => {
    let mounted = true;
    setIsSummaryLoading(true);

    fetchDashboardSummary()
      .then((data) => {
        if (!mounted) return;
        setStats(data.stats);
        setActivityItems(data.activities);
        setSummaryError(null);
      })
      .catch((err) => {
        if (!mounted) return;
        const message =
          err instanceof Error && err.message
            ? err.message
            : '首页数据加载失败，请检查后端服务和数据库配置。';
        setSummaryError(message);
      })
      .finally(() => {
        if (mounted) {
          setIsSummaryLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  React.useEffect(() => {
    let mounted = true;
    setIsAnalyticsLoading(true);

    fetchDashboardAnalytics()
      .then((data) => {
        if (!mounted) return;
        setTrends(data.trends);
        setConsumptionAnalytics(data.consumptionAnalytics);
        setAnalyticsError(null);
      })
      .catch((err) => {
        if (!mounted) return;
        const message =
          err instanceof Error && err.message
            ? err.message
            : '首页图表加载失败，请稍后重试。';
        setAnalyticsError(message);
      })
      .finally(() => {
        if (mounted) {
          setIsAnalyticsLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">首页</h1>
          <p className="text-slate-500">欢迎回来，这是您今天的隐形资助系统运行情况。</p>
        </div>
        {canCreateBatch ? (
          <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => navigate('/batches')}>
            发起月度认定
          </Button>
        ) : null}
      </div>

      {summaryError ? (
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{summaryError}</div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {isSummaryLoading ? (
          <Card className="border-none shadow-sm md:col-span-2 lg:col-span-3 xl:col-span-6">
            <CardContent className="p-6 text-center text-slate-500">正在加载首页数据...</CardContent>
          </Card>
        ) : (
          stats.map((stat) => {
            const Icon = statIcons[stat.icon];
            return (
              <Card key={stat.name} className="border-none shadow-sm">
                <CardContent className="p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className={cn('rounded-lg p-2', stat.bg)}>
                      <Icon className={stat.color} size={18} />
                    </div>
                    <span
                      className={cn(
                        'text-[10px] font-medium px-1.5 py-0.5 rounded-full',
                        stat.change.startsWith('+')
                          ? 'bg-emerald-50 text-emerald-600'
                          : 'bg-red-50 text-red-600'
                      )}
                    >
                      {stat.change}
                    </span>
                  </div>
                  <div>
                    <p className="truncate text-xs font-medium text-slate-500" title={stat.name}>
                      {stat.name}
                    </p>
                    <h3 className="mt-1 text-xl font-bold text-slate-900">{stat.value}</h3>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="border-none shadow-sm lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">补助趋势分析</CardTitle>
            <CardDescription>过去 4 个月的候选人数与补助总额变化</CardDescription>
          </CardHeader>
          <CardContent>
            {analyticsError ? (
              <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{analyticsError}</div>
            ) : isAnalyticsLoading ? (
              <div className="flex h-[300px] items-center justify-center text-sm text-slate-500">正在加载趋势图...</div>
            ) : (
              <>
                <div className="mb-3 flex items-center gap-4 text-xs text-slate-600">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-500"></span>
                    <span>候选人数</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
                    <span>补助总额</span>
                  </div>
                </div>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trends}>
                      <defs>
                        <linearGradient id="colorStudents" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                      <YAxis
                        yAxisId="left"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: '#64748b', fontSize: 12 }}
                        allowDecimals={false}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: '#64748b', fontSize: 12 }}
                        tickFormatter={(value) => `¥${Number(value).toLocaleString('zh-CN')}`}
                      />
                      <Tooltip
                        formatter={(value, name) => {
                          if (name === '补助总额') {
                            return [`¥ ${(Number(value) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, name];
                          }
                          return [value, name];
                        }}
                        contentStyle={{
                          backgroundColor: '#fff',
                          borderRadius: '8px',
                          border: 'none',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="students"
                        name="候选人数"
                        yAxisId="left"
                        stroke="#3b82f6"
                        fillOpacity={1}
                        fill="url(#colorStudents)"
                        strokeWidth={2}
                      />
                      <Line
                        type="monotone"
                        dataKey="amount"
                        name="补助总额"
                        yAxisId="right"
                        stroke="#10b981"
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        activeDot={{ r: 4 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">最近动态</CardTitle>
            <CardDescription>系统关键业务流转记录</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {visibleActivities.map((item, i) => (
                <div key={i} className="flex gap-4">
                  <div className="relative">
                    <div className="mt-1.5 h-2 w-2 rounded-full bg-blue-500"></div>
                    {i !== visibleActivities.length - 1 ? (
                      <div className="absolute left-[3px] top-4 h-10 w-[2px] bg-slate-100"></div>
                    ) : null}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      <span className="text-blue-600">{item.user}</span> {item.action}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">{item.time}</p>
                  </div>
                </div>
              ))}
            </div>
            <Dialog
              open={isAllActivityOpen}
              onOpenChange={(open) => {
                setIsAllActivityOpen(open);
                if (open) {
                  setAllActivitiesPage(1);
                }
              }}
            >
              <DialogTrigger asChild>
                <Button variant="ghost" className="mt-6 w-full text-blue-600 hover:bg-blue-50 hover:text-blue-700">
                  显示全部动态
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[80vh] sm:max-w-2xl flex flex-col">
                <DialogHeader>
                  <DialogTitle>全部动态</DialogTitle>
                  <DialogDescription>系统关键业务流转记录</DialogDescription>
                </DialogHeader>
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
                  {allActivitiesCurrentPageItems.map((item, index) => (
                    <div key={`${item.user}-${item.time}-${index}`} className="rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-100">
                      <p className="text-sm font-medium text-slate-900">
                        <span className="text-blue-600">{item.user}</span> {item.action}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">{item.time}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-3">
                  <p className="text-xs text-slate-500">
                    共 {activityItems.length} 条 · 第 {allActivitiesPage} / {allActivitiesTotalPages} 页
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={allActivitiesPage <= 1}
                      onClick={() => setAllActivitiesPage((prev) => Math.max(1, prev - 1))}
                    >
                      上一页
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={allActivitiesPage >= allActivitiesTotalPages}
                      onClick={() => setAllActivitiesPage((prev) => Math.min(allActivitiesTotalPages, prev + 1))}
                    >
                      下一页
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">全校消费分析</CardTitle>
          <CardDescription>按月观察早餐与午晚餐的分位数、均值、参与率和消费活跃度。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {analyticsError ? (
            <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{analyticsError}</div>
          ) : isAnalyticsLoading ? (
            <div className="flex h-[240px] items-center justify-center text-sm text-slate-500">正在加载消费分析...</div>
          ) : consumptionAnalytics.latest ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
              <InsightCard title="最新月份样本" value={`${consumptionAnalytics.latest.sampleStudents} 人`} hint={`${consumptionAnalytics.latest.latestMonth} 统计口径`} />
              <InsightCard title="早餐参与率" value={`${(consumptionAnalytics.latest.breakfastParticipationRate * 100).toFixed(1)}%`} hint={`P25 ¥${consumptionAnalytics.latest.breakfastP25.toFixed(1)} / P50 ¥${consumptionAnalytics.latest.breakfastP50.toFixed(1)}`} />
              <InsightCard title="早餐平均次均" value={`¥${consumptionAnalytics.latest.breakfastAvg.toFixed(1)}`} hint="有早餐消费学生口径" />
              <InsightCard title="午晚餐参与率" value={`${(consumptionAnalytics.latest.lunchDinnerParticipationRate * 100).toFixed(1)}%`} hint={`P25 ¥${consumptionAnalytics.latest.lunchDinnerP25.toFixed(1)} / P50 ¥${consumptionAnalytics.latest.lunchDinnerP50.toFixed(1)}`} />
              <InsightCard title="午晚餐平均次均" value={`¥${consumptionAnalytics.latest.lunchDinnerAvg.toFixed(1)}`} hint="有午晚餐消费学生口径" />
              <InsightCard title="月均总消费 / 天数" value={`¥${consumptionAnalytics.latest.totalAvg.toFixed(1)}`} hint={`消费 ${consumptionAnalytics.latest.daysAvg.toFixed(1)} 天 / 在校 ${consumptionAnalytics.latest.attendanceDaysAvg.toFixed(1)} 天`} />
            </div>
          ) : null}

          {!analyticsError && !isAnalyticsLoading ? (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <ChartShell title="早餐消费分布变化" description="观察低位学生、中位水平和整体均值之间的移动趋势。">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={consumptionAnalytics.series}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} tickFormatter={(value) => `¥${value}`} />
                  <Tooltip formatter={(value, name) => [`¥${Number(value).toFixed(2)}`, name]} contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                  <Legend />
                  <Line type="monotone" dataKey="breakfastP25" name="25%分位" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} />
                  <Line type="monotone" dataKey="breakfastP50" name="50%分位" stroke="#3b82f6" strokeWidth={2} dot={{ r: 2 }} />
                  <Line type="monotone" dataKey="breakfastAvg" name="平均值" stroke="#10b981" strokeWidth={2} dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartShell>

            <ChartShell title="午晚餐消费分布变化" description="午餐、晚餐与夜宵口径合并后的核心消费趋势。">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={consumptionAnalytics.series}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} tickFormatter={(value) => `¥${value}`} />
                  <Tooltip formatter={(value, name) => [`¥${Number(value).toFixed(2)}`, name]} contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                  <Legend />
                  <Line type="monotone" dataKey="lunchDinnerP25" name="25%分位" stroke="#f97316" strokeWidth={2} dot={{ r: 2 }} />
                  <Line type="monotone" dataKey="lunchDinnerP50" name="50%分位" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 2 }} />
                  <Line type="monotone" dataKey="lunchDinnerAvg" name="平均值" stroke="#059669" strokeWidth={2} dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartShell>
          </div>
          ) : null}

          {!analyticsError && !isAnalyticsLoading ? (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <ChartShell title="消费参与率变化" description="反映不同月份中发生早餐或午晚餐消费的学生覆盖比例。">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={consumptionAnalytics.series}>
                  <defs>
                    <linearGradient id="breakfastRateFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.22} />
                      <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} tickFormatter={(value) => `${Math.round(Number(value) * 100)}%`} />
                  <Tooltip formatter={(value, name) => [`${(Number(value) * 100).toFixed(2)}%`, name]} contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                  <Legend />
                  <Area type="monotone" dataKey="breakfastParticipationRate" name="早餐参与率" stroke="#3b82f6" fill="url(#breakfastRateFill)" strokeWidth={2} />
                  <Line type="monotone" dataKey="lunchDinnerParticipationRate" name="午晚餐参与率" stroke="#10b981" strokeWidth={2} dot={{ r: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartShell>

            <ChartShell title="总消费与消费天数" description="辅助判断整体消费水平与在校活跃度是否同步变化。">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={consumptionAnalytics.series}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                  <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} tickFormatter={(value) => `¥${value}`} />
                  <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                  <Tooltip
                    formatter={(value, name) => {
                      if (name === '月均总消费') return [`¥${Number(value).toFixed(2)}`, name];
                      return [`${Number(value).toFixed(2)} 天`, name];
                    }}
                    contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="totalAvg" name="月均总消费" yAxisId="left" stroke="#0f766e" strokeWidth={2} dot={{ r: 2 }} />
                  <Line type="monotone" dataKey="daysAvg" name="平均消费天数" yAxisId="right" stroke="#dc2626" strokeWidth={2} dot={{ r: 2 }} />
                  <Line type="monotone" dataKey="attendanceDaysAvg" name="平均在校天数" yAxisId="right" stroke="#7c3aed" strokeWidth={2} dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartShell>
          </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function InsightCard({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 px-4 py-4 ring-1 ring-slate-100">
      <p className="text-xs font-medium text-slate-500">{title}</p>
      <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
      <p className="mt-2 text-xs leading-5 text-slate-500">{hint}</p>
    </div>
  );
}

function ChartShell({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <p className="text-xs text-slate-500">{description}</p>
      </div>
      <div className="h-[280px] w-full">{children}</div>
    </div>
  );
}




