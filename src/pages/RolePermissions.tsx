import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { deleteAuditReviewer, fetchAuditReviewers, lookupStaffByEmployeeNo, upsertAuditReviewer } from '@/src/lib/api';
import type { AuditReviewerAssignment, AuditReviewerStage, StaffLookupItem } from '@/src/types';

const ALL_COLLEGES_VALUE = '__ALL__';

function stageTitle(stage: AuditReviewerStage) {
  if (stage === 'college') return '学院审核';
  if (stage === 'funding_office') return '资助办审核';
  return '学生处终审';
}

type ReviewerTableProps = {
  rows: AuditReviewerAssignment[];
  showCollege?: boolean;
  submitting: boolean;
  onRemove: (id: string) => void;
};

function ReviewerTable({ rows, showCollege = false, submitting, onRemove }: ReviewerTableProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-100">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            {showCollege ? <th className="px-3 py-2 text-left">学院</th> : null}
            <th className="px-3 py-2 text-left">工号</th>
            <th className="px-3 py-2 text-left">姓名</th>
            <th className="px-3 py-2 text-left">状态</th>
            <th className="px-3 py-2 text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="px-3 py-6 text-center text-slate-500" colSpan={showCollege ? 5 : 4}>暂无数据</td>
            </tr>
          ) : (
            rows.map((item) => (
              <tr key={item.id} className="border-t border-slate-100">
                {showCollege ? <td className="px-3 py-2">{item.college || '-'}</td> : null}
                <td className="px-3 py-2">{item.employeeNo}</td>
                <td className="px-3 py-2">{item.name}</td>
                <td className="px-3 py-2"><Badge className="border-none bg-blue-50 text-blue-700 hover:bg-blue-50">{item.status}</Badge></td>
                <td className="px-3 py-2 text-right"><Button variant="outline" size="sm" disabled={submitting} onClick={() => onRemove(item.id)}>移除</Button></td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

type StagePanelProps = {
  stage: AuditReviewerStage;
  colleges: string[];
  rows: AuditReviewerAssignment[];
  submitting: boolean;
  onOpenCreate: (stage: AuditReviewerStage) => void;
  onRemove: (id: string) => Promise<void>;
};

function StagePanel({ stage, colleges, rows, submitting, onOpenCreate, onRemove }: StagePanelProps) {
  const [filterCollege, setFilterCollege] = React.useState(ALL_COLLEGES_VALUE);

  const visibleRows = stage === 'college' && filterCollege !== ALL_COLLEGES_VALUE
    ? rows.filter((row) => String(row.college ?? '').trim() === filterCollege)
    : rows;

  return (
    <Card className="border-none shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>{stageTitle(stage)}审核人列表</CardTitle>
            <CardDescription>主界面仅展示已配置审核人。</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {stage === 'college' ? (
              <div className="w-72">
                <Select value={filterCollege} onValueChange={setFilterCollege}>
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue>{filterCollege === ALL_COLLEGES_VALUE ? '全部学院' : filterCollege}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_COLLEGES_VALUE}>全部学院</SelectItem>
                    {colleges.map((item) => <SelectItem key={`f-${item}`} value={item}>{item}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => onOpenCreate(stage)}>新增审核人</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ReviewerTable
          rows={visibleRows}
          showCollege={stage === 'college'}
          submitting={submitting}
          onRemove={(id) => void onRemove(id)}
        />
      </CardContent>
    </Card>
  );
}

export default function RolePermissions() {
  const [activeTab, setActiveTab] = React.useState<AuditReviewerStage>('college');
  const [colleges, setColleges] = React.useState<string[]>([]);
  const [collegeReviewers, setCollegeReviewers] = React.useState<AuditReviewerAssignment[]>([]);
  const [fundingOfficeReviewers, setFundingOfficeReviewers] = React.useState<AuditReviewerAssignment[]>([]);
  const [finalReviewers, setFinalReviewers] = React.useState<AuditReviewerAssignment[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [globalError, setGlobalError] = React.useState<string | null>(null);
  const [globalSuccess, setGlobalSuccess] = React.useState<string | null>(null);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [createStage, setCreateStage] = React.useState<AuditReviewerStage>('college');
  const [createCollege, setCreateCollege] = React.useState('');
  const [createEmployeeNo, setCreateEmployeeNo] = React.useState('');
  const [createName, setCreateName] = React.useState('');
  const [createCandidates, setCreateCandidates] = React.useState<StaffLookupItem[]>([]);
  const [showCreateCandidates, setShowCreateCandidates] = React.useState(false);

  const loadData = React.useCallback(async () => {
    setLoading(true);
    try {
      const reviewers = await fetchAuditReviewers();
      setColleges(reviewers.colleges);
      setCollegeReviewers(reviewers.collegeReviewers);
      setFundingOfficeReviewers(reviewers.fundingOfficeReviewers);
      setFinalReviewers(reviewers.finalReviewers);
      setCreateCollege((prev) => (prev && reviewers.colleges.includes(prev) ? prev : reviewers.colleges[0] ?? ''));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadData().catch((e) => setGlobalError(e instanceof Error ? e.message : '加载审核权限失败'));
  }, [loadData]);

  React.useEffect(() => {
    if (!createOpen) return;
    const keyword = `${createEmployeeNo.trim()} ${createName.trim()}`.trim();
    if (!keyword) {
      setCreateCandidates([]);
      setShowCreateCandidates(false);
      return;
    }
    const timer = setTimeout(() => {
      lookupStaffByEmployeeNo(keyword)
        .then((list) => {
          setCreateCandidates(list);
          setShowCreateCandidates(list.length > 0);
        })
        .catch(() => {
          setCreateCandidates([]);
          setShowCreateCandidates(false);
        });
    }, 220);
    return () => clearTimeout(timer);
  }, [createOpen, createEmployeeNo, createName]);

  const openCreateDialog = (stage: AuditReviewerStage) => {
    setCreateStage(stage);
    setCreateEmployeeNo('');
    setCreateName('');
    setCreateCandidates([]);
    setShowCreateCandidates(false);
    setCreateOpen(true);
  };

  const handleCreateSave = async () => {
    setGlobalError(null);
    setGlobalSuccess(null);
    if (!createEmployeeNo.trim()) {
      setGlobalError('请填写工号');
      return;
    }
    if (createStage === 'college' && !createCollege.trim()) {
      setGlobalError('请选择学院');
      return;
    }
    setSubmitting(true);
    try {
      await upsertAuditReviewer({
        stage: createStage,
        employeeNo: createEmployeeNo.trim(),
        name: createName.trim() || undefined,
        college: createStage === 'college' ? createCollege.trim() : undefined,
      });
      setGlobalSuccess('审核人已保存');
      setCreateOpen(false);
      await loadData();
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = async (id: string) => {
    setGlobalError(null);
    setGlobalSuccess(null);
    setSubmitting(true);
    try {
      await deleteAuditReviewer(id);
      setGlobalSuccess('审核人已移除');
      await loadData();
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : '移除失败');
      throw e;
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">审核权限管理</h1>
        <p className="text-slate-500">分表管理不同审核环节的审核人。</p>
      </div>

      {globalError ? <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{globalError}</div> : null}
      {globalSuccess ? <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{globalSuccess}</div> : null}

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as AuditReviewerStage)} className="w-full">
        <TabsList className="bg-white border border-slate-200 p-1">
          <TabsTrigger value="college" className="data-[state=active]:bg-slate-100">学院审核</TabsTrigger>
          <TabsTrigger value="funding_office" className="data-[state=active]:bg-slate-100">资助办审核</TabsTrigger>
          <TabsTrigger value="student_affairs" className="data-[state=active]:bg-slate-100">学生处终审</TabsTrigger>
        </TabsList>

        <TabsContent value="college" className="mt-4">
          <StagePanel stage="college" colleges={colleges} rows={collegeReviewers} submitting={submitting || loading} onOpenCreate={openCreateDialog} onRemove={handleRemove} />
        </TabsContent>

        <TabsContent value="funding_office" className="mt-4">
          <StagePanel stage="funding_office" colleges={colleges} rows={fundingOfficeReviewers} submitting={submitting || loading} onOpenCreate={openCreateDialog} onRemove={handleRemove} />
        </TabsContent>

        <TabsContent value="student_affairs" className="mt-4">
          <StagePanel stage="student_affairs" colleges={colleges} rows={finalReviewers} submitting={submitting || loading} onOpenCreate={openCreateDialog} onRemove={handleRemove} />
        </TabsContent>
      </Tabs>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新增审核人</DialogTitle>
            <DialogDescription>{stageTitle(createStage)}：填写人员后保存。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm text-slate-600">审核环节</label>
              <Select value={createStage} onValueChange={(value) => setCreateStage(value as AuditReviewerStage)}>
                <SelectTrigger className="h-10 w-full rounded-md border-slate-200 px-3">
                  <SelectValue>{stageTitle(createStage)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="college">学院审核</SelectItem>
                  <SelectItem value="funding_office">资助办审核</SelectItem>
                  <SelectItem value="student_affairs">学生处终审</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {createStage === 'college' ? (
              <div className="space-y-1">
                <label className="text-sm text-slate-600">学院</label>
                <Select value={createCollege || '__empty__'} onValueChange={(value) => setCreateCollege(value === '__empty__' ? '' : value)}>
                  <SelectTrigger className="h-10 w-full rounded-md border-slate-200 px-3"><SelectValue placeholder="请选择学院" /></SelectTrigger>
                  <SelectContent>
                    {colleges.map((item) => <SelectItem key={`c-${item}`} value={item}>{item}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="space-y-1 relative">
              <label className="text-sm text-slate-600">工号</label>
              <input
                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                value={createEmployeeNo}
                onChange={(e) => setCreateEmployeeNo(e.target.value)}
                onFocus={() => { if (createCandidates.length > 0) setShowCreateCandidates(true); }}
                onBlur={() => setTimeout(() => setShowCreateCandidates(false), 120)}
                placeholder="输入工号或姓名"
              />
              {showCreateCandidates && createCandidates.length > 0 ? (
                <div className="absolute left-0 right-0 top-[68px] z-20 max-h-60 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
                  {createCandidates.map((item) => (
                    <button
                      key={`create-${item.employeeNo}`}
                      type="button"
                      className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm hover:bg-slate-50"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setCreateEmployeeNo(item.employeeNo);
                        setCreateName(item.name);
                        setShowCreateCandidates(false);
                      }}
                    >
                      <span className="font-medium text-slate-900">{item.employeeNo}</span>
                      <span className="ml-2 text-slate-600">{item.name}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="space-y-1">
              <label className="text-sm text-slate-600">姓名（可选）</label>
              <input className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm" value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="输入姓名" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button className="bg-blue-600 hover:bg-blue-700" disabled={submitting || loading} onClick={() => void handleCreateSave()}>{submitting ? '保存中...' : '保存审核人'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
