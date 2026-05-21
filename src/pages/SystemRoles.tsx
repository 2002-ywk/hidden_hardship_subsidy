import React from 'react';
import { Shield } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

type RoleDefinition = {
  id: 'admin' | 'student_affairs' | 'college_admin' | 'counselor';
  label: string;
  description: string;
  features: string[];
};

const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    id: 'admin',
    label: '系统管理员',
    description: '固定工号账号，拥有全局系统管理能力。',
    features: ['系统配置', '数据同步', '批次管理', '全流程审核', '角色与权限配置', '全校数据查看'],
  },
  {
    id: 'student_affairs',
    label: '学生处管理员',
    description: '单位号 00000009 下账号，负责学生处相关审核与管理。',
    features: ['全校数据查看', '学生处终审', '审核中心', '补助结果查看', '系统参数查看'],
  },
  {
    id: 'college_admin',
    label: '学院管理员',
    description: '学院副书记岗位账号，处理学院环节审核。',
    features: ['本学院数据查看', '学院审核', '候选名单查看', '审核记录查看'],
  },
  {
    id: 'counselor',
    label: '辅导员',
    description: '有带生关系的辅导员账号，处理辅导员环节审核。',
    features: ['所带学生数据查看', '辅导员审核', '学生详情查看', '审核记录查看'],
  },
];

export default function SystemRoles() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">系统角色</h1>
        <p className="text-slate-500">仅展示系统角色定义及其功能范围。</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {ROLE_DEFINITIONS.map((role) => (
          <Card key={role.id} className="border-none shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-blue-50 p-2 text-blue-600">
                  <Shield size={18} />
                </div>
                <div>
                  <CardTitle className="text-lg">{role.label}</CardTitle>
                  <CardDescription>{role.description}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {role.features.map((feature) => (
                  <Badge key={`${role.id}-${feature}`} className="border-none bg-blue-50 text-blue-700 hover:bg-blue-50">
                    {feature}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
