import React from 'react';
import { Link } from 'react-router-dom';
import { Database, Settings, ShieldCheck, Tags, UserCog, Users } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const systemEntries = [
  {
    title: '数据同步',
    description: '管理学生、教职工、关系与消费数据的同步任务。',
    href: '/sync',
    icon: Database,
  },
  {
    title: '字典管理',
    description: '维护业务标签与字典项，用于规则判断和展示。',
    href: '/tags',
    icon: Tags,
  },
  {
    title: '审核权限',
    description: '查看各审核角色权限范围与可访问功能。',
    href: '/roles',
    icon: UserCog,
  },
  {
    title: '用户管理',
    description: '管理用户角色，可直接配置用户角色。',
    href: '/user-management',
    icon: Users,
  },
];

export default function SystemConfig() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="text-blue-600" size={24} />
        <div>
          <h1 className="text-2xl font-bold text-slate-900">系统设置</h1>
          <p className="text-slate-500">请选择要进入的系统管理模块。</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {systemEntries.map((entry) => {
          const Icon = entry.icon;
          return (
            <Link key={entry.href} to={entry.href}>
              <Card className="h-full border-none shadow-sm transition hover:shadow-md">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Icon className="text-blue-600" size={18} />
                    <CardTitle className="text-lg">{entry.title}</CardTitle>
                  </div>
                  <CardDescription>{entry.description}</CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-blue-700 flex items-center gap-2">
                  <ShieldCheck size={14} />
                  进入模块
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
