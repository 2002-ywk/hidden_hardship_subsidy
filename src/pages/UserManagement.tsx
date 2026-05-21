import React from 'react';
import { Users } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  createUserRole,
  deleteUserRole,
  fetchCollegeAdminAssignments,
  fetchMe,
  fetchUserRoles,
  lookupStaffByEmployeeNo,
  updateUserRole,
} from '@/src/lib/api';
import type { UserRole, UserRoleCreateRequest, UserRoleRecord } from '@/src/types';

const ROLE_OPTIONS: Array<{ value: UserRole; label: string }> = [
  { value: 'admin', label: '系统管理员' },
  { value: 'student_affairs', label: '学生处管理员' },
  { value: 'college_admin', label: '学院管理员' },
  { value: 'counselor', label: '辅导员' },
];

function normalizeRoleValue(input: unknown): UserRole {
  const value = String(input ?? '').trim();
  if (value === 'admin' || value === 'student_affairs' || value === 'college_admin' || value === 'counselor') return value;
  return 'counselor';
}

function roleLabel(role: UserRole) {
  return ROLE_OPTIONS.find((item) => item.value === role)?.label ?? role;
}

function statusLabel(status: string) {
  const normalized = String(status ?? '').trim().toLowerCase();
  if (normalized === 'active') return '启用';
  if (normalized === 'inactive') return '停用';
  return status || '-';
}

export default function UserManagement() {
  const [currentRole, setCurrentRole] = React.useState<UserRole | null>(null);
  const [items, setItems] = React.useState<UserRoleRecord[]>([]);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [total, setTotal] = React.useState(0);
  const [totalPages, setTotalPages] = React.useState(1);
  const [keyword, setKeyword] = React.useState('');
  const [filterRole, setFilterRole] = React.useState<'all' | UserRole>('all');
  const [filterUnitOrCollege, setFilterUnitOrCollege] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const [editing, setEditing] = React.useState<UserRoleRecord | null>(null);
  const [editRole, setEditRole] = React.useState<UserRole>('counselor');
  const [editCollege, setEditCollege] = React.useState('');

  const [creating, setCreating] = React.useState(false);
  const [staffCandidates, setStaffCandidates] = React.useState<Array<{ employeeNo: string; name: string }>>([]);
  const [showStaffCandidates, setShowStaffCandidates] = React.useState(false);
  const [candidateAnchor, setCandidateAnchor] = React.useState<'employeeNo' | 'name'>('employeeNo');
  const [collegeOptions, setCollegeOptions] = React.useState<string[]>([]);
  const [createForm, setCreateForm] = React.useState<UserRoleCreateRequest>({
    employeeNo: '',
    name: '',
    role: 'counselor',
    college: '',
  });

  React.useEffect(() => {
    fetchMe().then((payload) => setCurrentRole(payload.data.user.role)).catch(() => setCurrentRole(null));
  }, []);

  React.useEffect(() => {
    fetchCollegeAdminAssignments()
      .then((payload) => {
        const options = Array.from(new Set((payload.colleges ?? []).map((item) => String(item ?? '').trim()).filter(Boolean)));
        setCollegeOptions(options);
      })
      .catch(() => setCollegeOptions([]));
  }, []);

  React.useEffect(() => {
    if (!creating) {
      setStaffCandidates([]);
      setShowStaffCandidates(false);
      setCandidateAnchor('employeeNo');
      return;
    }
    const employeeNoKeyword = String(createForm.employeeNo ?? '').trim();
    const nameKeyword = String(createForm.name ?? '').trim();
    const lookupKeyword = candidateAnchor === 'name' ? nameKeyword : employeeNoKeyword || nameKeyword;
    if (!lookupKeyword) {
      setStaffCandidates([]);
      setShowStaffCandidates(false);
      return;
    }
    const timer = setTimeout(() => {
      lookupStaffByEmployeeNo(lookupKeyword)
        .then((rows) => {
          setStaffCandidates(rows);
          setShowStaffCandidates(rows.length > 0);
        })
        .catch(() => {
          setStaffCandidates([]);
          setShowStaffCandidates(false);
        });
    }, 220);
    return () => clearTimeout(timer);
  }, [candidateAnchor, createForm.employeeNo, createForm.name, creating]);

  const assignableRoleOptions = React.useMemo(
    () => (currentRole === 'admin' ? ROLE_OPTIONS : ROLE_OPTIONS.filter((item) => item.value !== 'admin')),
    [currentRole]
  );
  const canManageTargetUser = React.useCallback(
    (targetRole: UserRole) => !(currentRole !== 'admin' && targetRole === 'admin'),
    [currentRole]
  );

  const loadData = React.useCallback(
    async (
      targetPage = page,
      targetPageSize = pageSize,
      nextRole: 'all' | UserRole = filterRole,
      nextUnitOrCollege: string = filterUnitOrCollege,
      nextKeyword: string = keyword
    ) => {
      const result = await fetchUserRoles(targetPage, targetPageSize, {
        role: nextRole === 'all' ? '' : nextRole,
        unitOrCollege: nextUnitOrCollege,
        keyword: nextKeyword,
      });
      setItems(result.items);
      setPage(result.pagination.page);
      setPageSize(result.pagination.pageSize);
      setTotal(result.pagination.total);
      setTotalPages(result.pagination.totalPages);
    },
    [filterRole, filterUnitOrCollege, keyword, page, pageSize]
  );

  React.useEffect(() => {
    loadData(page, pageSize, filterRole, filterUnitOrCollege, keyword).catch((e) => {
      setError(e instanceof Error ? e.message : '加载用户失败');
    });
  }, [loadData, page, pageSize, filterRole, filterUnitOrCollege, keyword]);

  const openEdit = (item: UserRoleRecord) => {
    if (!canManageTargetUser(normalizeRoleValue(item.role))) {
      setError('学生处管理员不能修改系统管理员权限');
      return;
    }
    setEditing(item);
    setEditRole(normalizeRoleValue(item.role));
    setEditCollege(String(item.college ?? ''));
  };

  const handleEditSave = async () => {
    if (!editing) return;
    setError(null);
    setSuccess(null);
    if (editRole === 'admin' && currentRole !== 'admin') {
      setError('仅系统管理员可授予系统管理员角色');
      return;
    }
    if (editRole === 'college_admin' && !editCollege.trim()) {
      setError('学院管理员必须选择学院');
      return;
    }
    setSubmitting(true);
    try {
      await updateUserRole(editing.userId, {
        role: editRole,
        college: editRole === 'college_admin' ? editCollege.trim() : undefined,
      });
      setSuccess(`已更新 ${editing.name} 的角色`);
      setEditing(null);
      await loadData(page, pageSize);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (item: UserRoleRecord) => {
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await deleteUserRole(item.userId);
      setSuccess(`已删除 ${item.name}`);
      await loadData(page, pageSize);
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreate = async () => {
    setError(null);
    setSuccess(null);
    if (createForm.role === 'admin' && currentRole !== 'admin') {
      setError('仅系统管理员可授予系统管理员角色');
      return;
    }
    if (!createForm.employeeNo.trim()) {
      setError('工号必填');
      return;
    }
    if (createForm.role === 'college_admin' && !String(createForm.college ?? '').trim()) {
      setError('学院管理员必须选择学院');
      return;
    }
    setSubmitting(true);
    try {
      await createUserRole({
        employeeNo: createForm.employeeNo.trim(),
        name: String(createForm.name ?? '').trim() || undefined,
        role: createForm.role,
        college: createForm.role === 'college_admin' ? String(createForm.college ?? '').trim() : undefined,
      });
      setSuccess('角色用户已新增');
      setCreating(false);
      setStaffCandidates([]);
      setShowStaffCandidates(false);
      setCandidateAnchor('employeeNo');
      setCreateForm({ employeeNo: '', name: '', role: 'counselor', college: '' });
      await loadData(1, pageSize);
    } catch (e) {
      setError(e instanceof Error ? e.message : '新增失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="text-blue-600" size={24} />
          <div>
            <h1 className="text-2xl font-bold text-slate-900">用户管理</h1>
            <p className="text-slate-500">管理用户角色配置。</p>
          </div>
        </div>
        <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => setCreating(true)}>新增角色用户</Button>
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle>用户角色配置</CardTitle>
          <CardDescription>角色显示中文，支持编辑和删除。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
          {success ? <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div> : null}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <label className="text-sm text-slate-600">工号/姓名筛选</label>
              <input
                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                value={keyword}
                onChange={(e) => {
                  const next = e.target.value;
                  setKeyword(next);
                  void loadData(1, pageSize, filterRole, filterUnitOrCollege, next);
                }}
                placeholder="输入工号或姓名"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm text-slate-600">角色筛选</label>
              <Select
                value={filterRole}
                onValueChange={(value) => {
                  const next = value as 'all' | UserRole;
                  setFilterRole(next);
                  void loadData(1, pageSize, next, filterUnitOrCollege, keyword);
                }}
              >
                <SelectTrigger className="h-10 w-full rounded-md border-slate-200 px-3">
                  <SelectValue>{filterRole === 'all' ? '全部角色' : roleLabel(normalizeRoleValue(filterRole))}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部角色</SelectItem>
                  {assignableRoleOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm text-slate-600">学院/单位筛选</label>
              <input
                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                value={filterUnitOrCollege}
                onChange={(e) => {
                  const next = e.target.value;
                  setFilterUnitOrCollege(next);
                  void loadData(1, pageSize, filterRole, next, keyword);
                }}
                placeholder="输入学院或单位名称"
              />
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-100">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">工号</th>
                  <th className="px-4 py-3 text-left font-medium">姓名</th>
                  <th className="px-4 py-3 text-left font-medium">角色</th>
                  <th className="px-4 py-3 text-left font-medium">学院/单位</th>
                  <th className="px-4 py-3 text-left font-medium">状态</th>
                  <th className="px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-slate-500" colSpan={6}>
                      暂无用户数据
                    </td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr key={item.userId} className="border-t border-slate-100">
                      <td className="px-4 py-3">{item.employeeNo}</td>
                      <td className="px-4 py-3">{item.name}</td>
                      <td className="px-4 py-3">{roleLabel(normalizeRoleValue(item.role))}</td>
                      <td className="px-4 py-3">{item.college || '-'}</td>
                      <td className="px-4 py-3">
                        <Badge className="border-none bg-blue-50 text-blue-700 hover:bg-blue-50">{statusLabel(item.status)}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!canManageTargetUser(normalizeRoleValue(item.role))}
                            onClick={() => openEdit(item)}
                          >
                            编辑
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={submitting || !canManageTargetUser(normalizeRoleValue(item.role))}
                            onClick={() => void handleDelete(item)}
                          >
                            删除
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between pt-1 text-sm text-slate-600">
            <div>
              共 {total} 条，当前第 {page} / {totalPages} 页
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={String(pageSize)}
                onValueChange={(value) => {
                  const next = Number(value);
                  setPage(1);
                  setPageSize(next);
                  void loadData(1, next, filterRole, filterUnitOrCollege, keyword);
                }}
              >
                <SelectTrigger className="h-9 w-24 rounded-md border-slate-200 px-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10/页</SelectItem>
                  <SelectItem value="20">20/页</SelectItem>
                  <SelectItem value="50">50/页</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => void loadData(page - 1, pageSize, filterRole, filterUnitOrCollege, keyword)}>
                上一页
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => void loadData(page + 1, pageSize, filterRole, filterUnitOrCollege, keyword)}>
                下一页
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>编辑角色</DialogTitle>
            <DialogDescription>修改 {editing?.name} 的角色信息。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-slate-600">工号：{editing?.employeeNo}</div>
            <div className="text-sm text-slate-600">姓名：{editing?.name}</div>
            <div className="space-y-1">
              <label className="text-sm text-slate-600">角色</label>
              <Select value={editRole} onValueChange={(value) => setEditRole(value as UserRole)}>
                <SelectTrigger className="h-10 w-full rounded-md border-slate-200 px-3">
                  <SelectValue>{roleLabel(editRole)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {assignableRoleOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {editRole === 'college_admin' ? (
              <div className="space-y-1">
                <label className="text-sm text-slate-600">学院</label>
                <Select value={editCollege || '__empty__'} onValueChange={(value) => setEditCollege(value === '__empty__' ? '' : value)}>
                  <SelectTrigger className="h-10 w-full rounded-md border-slate-200 px-3">
                    <SelectValue>{editCollege || '请选择学院'}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__empty__">请选择学院</SelectItem>
                    {collegeOptions.map((item) => (
                      <SelectItem key={`edit-college-${item}`} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>取消</Button>
            <Button className="bg-blue-600 hover:bg-blue-700" disabled={submitting} onClick={() => void handleEditSave()}>
              {submitting ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新增角色用户</DialogTitle>
            <DialogDescription>输入工号或姓名并配置角色。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm text-slate-600">工号</label>
              <div className="relative">
                <input
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                  value={createForm.employeeNo}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, employeeNo: e.target.value }))}
                  onFocus={() => {
                    setCandidateAnchor('employeeNo');
                    if (staffCandidates.length > 0) setShowStaffCandidates(true);
                  }}
                  onBlur={() => setTimeout(() => setShowStaffCandidates(false), 120)}
                />
                {showStaffCandidates && candidateAnchor === 'employeeNo' && staffCandidates.length > 0 ? (
                  <div className="absolute left-0 right-0 top-[42px] z-20 max-h-60 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
                    {staffCandidates.map((item) => (
                      <button
                        key={item.employeeNo}
                        type="button"
                        className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm hover:bg-slate-50"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          setCreateForm((prev) => ({ ...prev, employeeNo: item.employeeNo, name: item.name }));
                          setShowStaffCandidates(false);
                        }}
                      >
                        <span className="font-medium text-slate-900">{item.employeeNo}</span>
                        <span className="ml-2 text-slate-600">{item.name}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm text-slate-600">姓名（可选）</label>
              <div className="relative">
                <input
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                  value={String(createForm.name ?? '')}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))}
                  onFocus={() => {
                    setCandidateAnchor('name');
                    if (staffCandidates.length > 0) setShowStaffCandidates(true);
                  }}
                  onBlur={() => setTimeout(() => setShowStaffCandidates(false), 120)}
                />
                {showStaffCandidates && candidateAnchor === 'name' && staffCandidates.length > 0 ? (
                  <div className="absolute left-0 right-0 top-[42px] z-20 max-h-60 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
                    {staffCandidates.map((item) => (
                      <button
                        key={`name-${item.employeeNo}`}
                        type="button"
                        className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm hover:bg-slate-50"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          setCreateForm((prev) => ({ ...prev, employeeNo: item.employeeNo, name: item.name }));
                          setShowStaffCandidates(false);
                        }}
                      >
                        <span className="font-medium text-slate-900">{item.employeeNo}</span>
                        <span className="ml-2 text-slate-600">{item.name}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm text-slate-600">角色</label>
              <Select value={createForm.role} onValueChange={(value) => setCreateForm((prev) => ({ ...prev, role: value as UserRole }))}>
                <SelectTrigger className="h-10 w-full rounded-md border-slate-200 px-3">
                  <SelectValue>{roleLabel(normalizeRoleValue(createForm.role))}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {assignableRoleOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {createForm.role === 'college_admin' ? (
              <div className="space-y-1">
                <label className="text-sm text-slate-600">学院</label>
                <Select
                  value={String(createForm.college ?? '') || '__empty__'}
                  onValueChange={(value) => setCreateForm((prev) => ({ ...prev, college: value === '__empty__' ? '' : value }))}
                >
                  <SelectTrigger className="h-10 w-full rounded-md border-slate-200 px-3">
                    <SelectValue>{String(createForm.college ?? '') || '请选择学院'}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__empty__">请选择学院</SelectItem>
                    {collegeOptions.map((item) => (
                      <SelectItem key={`create-college-${item}`} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>取消</Button>
            <Button className="bg-blue-600 hover:bg-blue-700" disabled={submitting} onClick={() => void handleCreate()}>
              {submitting ? '提交中...' : '新增'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
