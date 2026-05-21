import React from 'react';
import { 
  Users, 
  TrendingDown, 
  AlertCircle, 
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { fetchDashboardData } from '@/src/lib/api';
import { cn } from '@/src/lib/utils';
import type { ActivityItem, DashboardStatItem, TrendItem } from '@/src/types';

const statIcons = {
  users: Users,
  trend: TrendingDown,
  alert: AlertCircle,
};

export default function Dashboard() {
  const [stats, setStats] = React.useState<DashboardStatItem[]>([]);
  const [trends, setTrends] = React.useState<TrendItem[]>([]);
  const [activityItems, setActivityItems] = React.useState<ActivityItem[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

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
      .catch(() => {
        if (!mounted) return;
        setError('棣栭〉鏁版嵁鍔犺浇澶辫触锛岃妫€鏌ュ悗绔湇鍔″拰鏁版嵁搴撻厤缃€?);
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">棣栭〉</h1>
          <p className="text-slate-500">娆㈣繋鍥炴潵锛岃繖鏄偍浠婂ぉ鐨勮ˉ鍔╃郴缁熻繍琛屾儏鍐点€?/p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline">涓嬭浇鎶ヨ〃</Button>
          <Button className="bg-blue-600 hover:bg-blue-700">鍙戣捣鏈堝害璁ゅ畾</Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {isLoading ? (
          <Card className="border-none shadow-sm md:col-span-2 lg:col-span-3 xl:col-span-6">
            <CardContent className="p-6 text-center text-slate-500">姝ｅ湪鍔犺浇棣栭〉鏁版嵁...</CardContent>
          </Card>
        ) : stats.map((stat) => {
          const Icon = statIcons[stat.icon];
          return (
          <Card key={stat.name} className="border-none shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className={cn("p-2 rounded-lg", stat.bg)}>
                  <Icon className={stat.color} size={18} />
                </div>
                <span className={cn(
                  "text-[10px] font-medium px-1.5 py-0.5 rounded-full",
                  stat.change.startsWith('+') ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"
                )}>
                  {stat.change}
                </span>
              </div>
              <div>
                <p className="text-xs text-slate-500 font-medium truncate" title={stat.name}>{stat.name}</p>
                <h3 className="text-xl font-bold text-slate-900 mt-1">{stat.value}</h3>
              </div>
            </CardContent>
          </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Chart */}
        <Card className="lg:col-span-2 border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">璧勫姪瓒嬪娍鍒嗘瀽</CardTitle>
            <CardDescription>杩囧幓4涓湀鐨勮祫鍔╀汉鏁颁笌閲戦鍙樺寲</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trends}>
                  <defs>
                    <linearGradient id="colorStudents" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                  <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                  />
                  <Area type="monotone" dataKey="students" stroke="#3b82f6" fillOpacity={1} fill="url(#colorStudents)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">鏈€杩戝姩鎬?/CardTitle>
            <CardDescription>绯荤粺鍏抽敭涓氬姟娴佽浆璁板綍</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {activityItems.map((item, i) => (
                <div key={i} className="flex gap-4">
                  <div className="relative">
                    <div className="w-2 h-2 bg-blue-500 rounded-full mt-1.5"></div>
                    {i !== 3 && <div className="absolute top-4 left-[3px] w-[2px] h-10 bg-slate-100"></div>}
                  </div>
                  <div>
                    <p className="text-sm text-slate-900 font-medium">
                      <span className="text-blue-600">{item.user}</span> {item.action}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">{item.time}</p>
                  </div>
                </div>
              ))}
            </div>
            <Button variant="ghost" className="w-full mt-6 text-blue-600 hover:text-blue-700 hover:bg-blue-50">
              鏌ョ湅鍏ㄩ儴鍔ㄦ€?            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
