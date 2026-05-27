import React from 'react';
import { Bell, Eye } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { fetchBatches, fetchCandidateColleges, fetchCandidateList, fetchMe, lookupCounselors, remindAllCandidates, remindCandidate } from '@/src/lib/api';
import type { BatchSummary, CandidateListItem, CounselorLookupItem, UserRole } from '@/src/types';

function previousMonthKey(baseDate = new Date()) {
  let year = baseDate.getFullYear();
  let month = baseDate.getMonth() + 1;
  month -= 1;
  if (month <= 0) {
    year -= 1;
    month = 12;
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

function getStatusBadge(statusLabel: string, status: CandidateListItem['workflowStatus']) {
  const styleByStatus: Partial<Record<CandidateListItem['workflowStatus'], string>> = {
    pending_counselor: 'bg-amber-100 text-amber-700 hover:bg-amber-100 border-none',
    pending_college: 'bg-sky-100 text-sky-700 hover:bg-sky-100 border-none',
    pending_final: 'bg-indigo-100 text-indigo-700 hover:bg-indigo-100 border-none',
    counselor_rejected: 'bg-rose-100 text-rose-700 hover:bg-rose-100 border-none',
    college_rejected: 'bg-rose-100 text-rose-700 hover:bg-rose-100 border-none',
    final_rejected: 'bg-rose-100 text-rose-700 hover:bg-rose-100 border-none',
    counselor_overdue: 'bg-orange-100 text-orange-700 hover:bg-orange-100 border-none',
    college_overdue: 'bg-orange-100 text-orange-700 hover:bg-orange-100 border-none',
    final_overdue: 'bg-orange-100 text-orange-700 hover:bg-orange-100 border-none',
    included: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-none',
    not_included: 'bg-slate-200 text-slate-700 hover:bg-slate-200 border-none',
    counselor_approved: 'bg-cyan-100 text-cyan-700 hover:bg-cyan-100 border-none',
    college_approved: 'bg-blue-100 text-blue-700 hover:bg-blue-100 border-none',
    final_approved: 'bg-violet-100 text-violet-700 hover:bg-violet-100 border-none',
  };
  const badgeClass = styleByStatus[status];
  return badgeClass ? <Badge className={badgeClass}>{statusLabel}</Badge> : <Badge variant="outline">{statusLabel}</Badge>;
}

export default function CandidateList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const defaultMonth = React.useMemo(() => previousMonthKey(), []);
  const [month, setMonth] = React.useState(searchParams.get('month') ?? defaultMonth);
  const [items, setItems] = React.useState<CandidateListItem[]>([]);
  const [batches, setBatches] = React.useState<BatchSummary[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(10);
  const [total, setTotal] = React.useState(0);
  const [totalPages, setTotalPages] = React.useState(1);
  const [role, setRole] = React.useState<UserRole | null>(null);
  const [collegeOptions, setCollegeOptions] = React.useState<string[]>([]);
  const [collegeFilter, setCollegeFilter] = React.useState('');
  const [counselorFilter, setCounselorFilter] = React.useState('');
  const [counselorSuggestions, setCounselorSuggestions] = React.useState<CounselorLookupItem[]>([]);
  const [showCounselorSuggestions, setShowCounselorSuggestions] = React.useState(false);
  const [sendingAllReminder, setSendingAllReminder] = React.useState(false);
  const [sendingReminderStudentId, setSendingReminderStudentId] = React.useState<string | null>(null);
  const [actionMessage, setActionMessage] = React.useState<string | null>(null);
  const canUseAdvancedFilters = role === 'admin' || role === 'student_affairs';
  const [canFundingOfficeReview, setCanFundingOfficeReview] = React.useState(false);
  const [canFinalReview, setCanFinalReview] = React.useState(false);
  const canSendReminder = role === 'admin' || (role === 'student_affairs' && (canFundingOfficeReview || canFinalReview));

  React.useEffect(() => {
    fetchMe()
      .then((payload) => {
        setRole(payload.data.user.role);
        setCanFundingOfficeReview(Boolean(payload.data.user.canFundingOfficeReview));
        setCanFinalReview(payload.data.user.canFinalReview !== false);
      })
      .catch(() => {
        setRole(null);
        setCanFundingOfficeReview(false);
        setCanFinalReview(false);
      });
  }, []);

  React.useEffect(() => {
    fetchBatches()
      .then((data) => {
        setBatches(data);
      })
      .catch(() => {
        setBatches([]);
      });
  }, []);

  React.useEffect(() => {
    const queryMonth = searchParams.get('month');
    if (queryMonth && queryMonth !== month) {
      setMonth(queryMonth);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  React.useEffect(() => {
    setPage(1);
  }, [month]);

  React.useEffect(() => {
    if (!canUseAdvancedFilters) {
      setCollegeOptions([]);
      setCollegeFilter('');
      return;
    }
    let mounted = true;
    fetchCandidateColleges(month)
      .then((response) => {
        if (!mounted) return;
        const options = (response.items ?? []).filter((item) => String(item ?? '').trim().length > 0);
        setCollegeOptions(options);
        setCollegeFilter((prev) => (prev && options.includes(prev) ? prev : ''));
      })
      .catch(() => {
        if (!mounted) return;
        setCollegeOptions([]);
        setCollegeFilter('');
      });
    return () => {
      mounted = false;
    };
  }, [month, canUseAdvancedFilters]);

  React.useEffect(() => {
    setPage(1);
  }, [pageSize]);

  React.useEffect(() => {
    setPage(1);
  }, [collegeFilter, counselorFilter]);

  React.useEffect(() => {
    if (!canUseAdvancedFilters) {
      setCounselorSuggestions([]);
      return;
    }
    const keyword = counselorFilter.trim();
    if (keyword.length < 1) {
      setCounselorSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      lookupCounselors(keyword)
        .then((response) => setCounselorSuggestions(response.items ?? []))
        .catch(() => setCounselorSuggestions([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [counselorFilter, canUseAdvancedFilters]);

  React.useEffect(() => {
    let mounted = true;
    setIsLoading(true);

    fetchCandidateList(month, page, pageSize, {
      college: collegeFilter,
      counselorEmployeeNo: counselorFilter,
      counselorName: counselorFilter,
    })
      .then((response) => {
        if (!mounted) return;
        setItems(response.items);
        setTotal(response.pagination.total);
        setTotalPages(response.pagination.totalPages);
        setError(null);
      })
      .catch((err) => {
        if (!mounted) return;
        const message = err instanceof Error ? err.message : '候选名单加载失败';
        setError(message);
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [month, page, pageSize, collegeFilter, counselorFilter]);

  const handlePrev = () => setPage((p) => Math.max(1, p - 1));
  const handleNext = () => setPage((p) => Math.min(totalPages, p + 1));
  const handleRemindAll = async () => {
    setSendingAllReminder(true);
    setError(null);
    setActionMessage(null);
    try {
      const result = await remindAllCandidates(month);
      setActionMessage(`${result.message}（共 ${result.data.total} 人）`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量发送提醒失败');
    } finally {
      setSendingAllReminder(false);
    }
  };
  const handleRemindOne = async (item: CandidateListItem) => {
    setSendingReminderStudentId(item.studentId);
    setError(null);
    setActionMessage(null);
    try {
      const result = await remindCandidate(item.studentId, month);
      setActionMessage(result.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送提醒失败');
    } finally {
      setSendingReminderStudentId(null);
    }
  };
  const monthOptions = React.useMemo(() => {
    const values = batches
      .map((item) => item.month)
      .filter((month): month is string => typeof month === 'string' && month.length > 0);
    return Array.from(new Set(values)).sort((a, b) => String(b).localeCompare(String(a)));
  }, [batches]);

  const applyCounselorSuggestion = React.useCallback((item: CounselorLookupItem) => {
    setCounselorFilter(item.employeeNo);
    setShowCounselorSuggestions(false);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">候选名单管理</h1>
          <p className="text-slate-500">查看并管理指定月份的候选名单。</p>
        </div>
        {canSendReminder ? (
          <Button className="gap-2 bg-blue-600 hover:bg-blue-700" onClick={() => void handleRemindAll()} disabled={sendingAllReminder || isLoading}>
            <Bell size={16} />
            {sendingAllReminder ? '发送中..' : '一键推送审核提醒'}
          </Button>
        ) : null}
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle>候选名单</CardTitle>
          <CardDescription>月份：{month}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-600">月份</span>
              <select
                className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900"
                value={month}
                onChange={(e) => {
                  const next = e.target.value;
                  setMonth(next);
                  setSearchParams((prev) => {
                    const nextParams = new URLSearchParams(prev);
                    nextParams.set('month', next);
                    return nextParams;
                  });
                }}
              >
                {monthOptions.length === 0 ? <option value={month}>{month}</option> : null}
                {monthOptions.map((itemMonth) => (
                  <option key={itemMonth} value={itemMonth}>
                    {itemMonth}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-2">
              {canUseAdvancedFilters ? (
                <>
                  <select
                    className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900"
                    value={collegeFilter}
                    onChange={(e) => setCollegeFilter(e.target.value)}
                  >
                    <option value="">全部学院</option>
                    {collegeOptions.map((college) => (
                      <option key={college} value={college}>
                        {college}
                      </option>
                    ))}
                  </select>
                  <div className="relative">
                    <input
                      className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900"
                      placeholder="辅导员（工号/姓名）"
                      value={counselorFilter}
                      onChange={(e) => {
                        const next = e.target.value;
                        setCounselorFilter(next);
                        setShowCounselorSuggestions(true);
                      }}
                      onFocus={() => setShowCounselorSuggestions(true)}
                      onBlur={() => setTimeout(() => setShowCounselorSuggestions(false), 120)}
                    />
                    {showCounselorSuggestions && counselorSuggestions.length > 0 ? (
                      <div className="absolute left-0 right-0 top-10 z-20 max-h-60 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
                        {counselorSuggestions.map((item) => (
                          <button
                            key={`emp-${item.employeeNo}`}
                            type="button"
                            className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm hover:bg-slate-50"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => applyCounselorSuggestion(item)}
                          >
                            <span className="font-medium text-slate-900">{item.employeeNo}</span>
                            <span className="ml-2 text-slate-600">{item.name}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          </div>

          {error ? (
            <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          ) : null}
          {actionMessage ? (
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">{actionMessage}</div>
          ) : null}

          <div className="overflow-hidden rounded-lg border border-slate-100">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="w-[90px]">排名</TableHead>
                  <TableHead className="w-[140px]">学号</TableHead>
                  <TableHead>姓名</TableHead>
                  <TableHead>学院</TableHead>
                  <TableHead>班级</TableHead>
                  <TableHead>辅导员</TableHead>
                  <TableHead className="w-[120px]">次均消费</TableHead>
                  <TableHead className="w-[90px]">总天数</TableHead>
                  <TableHead className="w-[90px]">早餐天数</TableHead>
                  <TableHead className="w-[90px]">午晚餐天数</TableHead>
                  <TableHead className="w-[120px]">总补助</TableHead>
                  <TableHead className="w-[140px]">状态</TableHead>
                  <TableHead className="w-[220px] text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={13} className="py-10 text-center text-sm text-slate-500">
                      加载中...
                    </TableCell>
                  </TableRow>
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={13} className="py-10 text-center text-sm text-slate-500">
                      暂无数据
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item) => (
                    <TableRow key={item.id} className="hover:bg-slate-50/60">
                      <TableCell>{item.rank}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-700">{item.studentId}</TableCell>
                      <TableCell className="font-medium text-slate-900">{item.name}</TableCell>
                      <TableCell>{item.college}</TableCell>
                      <TableCell>{item.className}</TableCell>
                      <TableCell>{item.counselor}</TableCell>
                      <TableCell>{item.averageSpendLabel}</TableCell>
                      <TableCell>{item.daysCount}</TableCell>
                      <TableCell>{item.breakfastDaysCount}</TableCell>
                      <TableCell>{item.lunchDinnerDaysCount}</TableCell>
                      <TableCell>¥ {item.subsidyEstimate.toFixed(2)}</TableCell>
                      <TableCell>{getStatusBadge(item.workflowStatusLabel, item.workflowStatus)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {canSendReminder ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 px-2"
                              onClick={() => void handleRemindOne(item)}
                              disabled={sendingReminderStudentId === item.studentId}
                            >
                              <Bell size={14} />
                              {sendingReminderStudentId === item.studentId ? '发送中..' : '提醒'}
                            </Button>
                          ) : null}
                          <Button asChild variant="ghost" size="sm" className="h-8 px-2">
                            <Link to={`/students/${item.studentId}?month=${encodeURIComponent(item.month)}`} title="查看详情">
                              <Eye size={16} />
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-slate-600">
              总数：<span className="font-semibold text-slate-900">{total}</span>
            </div>
            <div className="flex items-center justify-end gap-3 text-sm text-slate-600">
              <div className="flex items-center gap-2">
                <span>每页</span>
                <select
                  className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-900"
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                >
                  {[10, 20, 50, 100].map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
                <span>条</span>
              </div>
              <span>
                第 <span className="font-semibold text-slate-900">{page}</span> / {totalPages} 页
              </span>
              <Button variant="outline" size="sm" onClick={handlePrev} disabled={page <= 1}>
                上一页
              </Button>
              <Button variant="outline" size="sm" onClick={handleNext} disabled={page >= totalPages}>
                下一页
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
