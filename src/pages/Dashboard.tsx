import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, TrendingDown, Users } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { fetchDashboardData, fetchMe } from '@/src/lib/api';
import { cn } from '@/src/lib/utils';
import type { ActivityItem, DashboardStatItem, TrendItem } from '@/src/types';

const statIcons = {
  users: Users,
  trend: TrendingDown,
  alert: AlertCircle,
};

export default function Dashboard() {
  const navigate = useNavigate();
  const allActivitiesPageSize = 10;
  const [stats, setStats] = React.useState<DashboardStatItem[]>([]);
  const [trends, setTrends] = React.useState<TrendItem[]>([]);
  const [activityItems, setActivityItems] = React.useState<ActivityItem[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [isAllActivityOpen, setIsAllActivityOpen] = React.useState(false);
  const [allActivitiesPage, setAllActivitiesPage] = React.useState(1);
  const [canCreateBatch, setCanCreateBatch] = React.useState(false);
  const visibleActivities = activityItems.slice(0, 4);
  const allActivitiesTotalPages = Math.max(1, Math.ceil(activityItems.length / allActivitiesPageSize));
  const allActivitiesStart = (allActivitiesPage - 1) * allActivitiesPageSize;
  const allActivitiesCurrentPageItems = activityItems.slice(
    allActivitiesStart,
    allActivitiesStart + allActivitiesPageSize
  );

  React.useEffect(() => {
    let mounted = true;
    setIsLoading(true);

    fetchDashboardData()
      .then((data) => {
        if (!mounted) return;
        setStats(data.stats);
        setTrends(data.trends);
        setActivityItems(data.activities);
        setError(null);
      })
      .catch((err) => {
        if (!mounted) return;
        const message =
          err instanceof Error && err.message
            ? err.message
            : '首页数据加载失败，请检查后端服务和数据库配置。';
        setError(message);
      })
      .finally(() => {
        if (mounted) {
          setIsLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  React.useEffect(() => {
    let mounted = true;
    fetchMe()
      .then((payload) => {
        if (!mounted) return;
        const role = payload.data.user.role;
        setCanCreateBatch(role === 'admin' || role === 'student_affairs');
      })
      .catch(() => {
        if (!mounted) return;
        setCanCreateBatch(false);
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
          <p className="text-slate-500">欢迎回来，这是您今天的饮食补助系统运行情况。</p>
        </div>
        {canCreateBatch ? (
          <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => navigate('/batches')}>
            发起月度认定
          </Button>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {isLoading ? (
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
    </div>
  );
}




