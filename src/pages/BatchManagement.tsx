import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { createBatch, fetchBatches } from '@/src/lib/api';
import type { BatchSummary } from '@/src/types';

function normalizeMonthInput(value: string) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(text) ? text : '';
}

function previousMonthKey(baseDate = new Date()) {
  const year = baseDate.getFullYear();
  const monthIndex = baseDate.getMonth();
  const date = new Date(year, monthIndex - 1, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthRangeInclusive(start: string, end: string) {
  const startMatch = start.match(/^(\d{4})-(\d{2})$/);
  const endMatch = end.match(/^(\d{4})-(\d{2})$/);
  if (!startMatch || !endMatch) return [];

  const startDate = new Date(Number(startMatch[1]), Number(startMatch[2]) - 1, 1);
  const endDate = new Date(Number(endMatch[1]), Number(endMatch[2]) - 1, 1);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return [];
  if (startDate.getTime() > endDate.getTime()) return [];

  const months: string[] = [];
  let cursor = new Date(startDate.getTime());
  while (cursor.getTime() <= endDate.getTime()) {
    months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return months;
}

export default function BatchManagement() {
  const navigate = useNavigate();
  const [batches, setBatches] = React.useState<BatchSummary[]>([]);
  const [message, setMessage] = React.useState<string | null>(null);
  const [customMonth, setCustomMonth] = React.useState(previousMonthKey());
  const [rangeStart, setRangeStart] = React.useState(previousMonthKey());
  const [rangeEnd, setRangeEnd] = React.useState(previousMonthKey());
  const [isCreating, setIsCreating] = React.useState(false);

  const loadBatches = React.useCallback(() => {
    fetchBatches().then(setBatches);
  }, []);

  React.useEffect(() => {
    loadBatches();
  }, [loadBatches]);

  const handleCreatePreviousMonth = async () => {
    const month = previousMonthKey();
    setIsCreating(true);
    try {
      const response = await createBatch({ month });
      setMessage(response.message);
      loadBatches();
    } catch (err) {
      const tip = err instanceof Error ? err.message : '发起批次失败';
      setMessage(tip);
    } finally {
      setIsCreating(false);
    }
  };

  const handleCreateCustomMonth = async () => {
    const month = normalizeMonthInput(customMonth);
    if (!month) {
      setMessage('请选择正确的月份（YYYY-MM）。');
      return;
    }

    setIsCreating(true);
    try {
      const response = await createBatch({ month, force: true });
      setMessage(response.message);
      loadBatches();
    } catch (err) {
      const tip = err instanceof Error ? err.message : '补发批次失败';
      setMessage(tip);
    } finally {
      setIsCreating(false);
    }
  };

  const handleCreateRange = async () => {
    const start = normalizeMonthInput(rangeStart);
    const end = normalizeMonthInput(rangeEnd);
    const months = monthRangeInclusive(start, end);
    if (months.length === 0) {
      setMessage('请选择正确的月份范围（YYYY-MM），且开始月份不能大于结束月份。');
      return;
    }

    setIsCreating(true);
    try {
      const results: string[] = [];
      for (const month of months) {
        const response = await createBatch({ month, force: true });
        results.push(response.message);
      }
      setMessage(results.join('；'));
      loadBatches();
    } catch (err) {
      const tip = err instanceof Error ? err.message : '批量补发失败';
      setMessage(tip);
    } finally {
      setIsCreating(false);
    }
  };

  const handleViewDetail = (batch: BatchSummary) => {
    navigate(`/candidates?month=${batch.month}`);
  };

  const handleEnterAudit = (batch: BatchSummary) => {
    navigate(`/audit?month=${batch.month}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">认定批次管理</h1>
          <p className="text-slate-500">按月发起、跟踪并管理全校补助认定流程。</p>
        </div>
        <Button className="flex gap-2 bg-blue-600 hover:bg-blue-700" onClick={() => void handleCreatePreviousMonth()} disabled={isCreating}>
          <Plus size={18} />
          {isCreating ? '处理中...' : '发起上个月批次'}
        </Button>
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">补发批次</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <div className="text-xs text-slate-500">单个月份</div>
              <Input type="month" className="h-9 w-[160px]" value={customMonth} onChange={(e) => setCustomMonth(e.target.value)} disabled={isCreating} />
            </div>
            <Button variant="outline" onClick={() => void handleCreateCustomMonth()} disabled={isCreating}>
              补发该月
            </Button>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <div className="text-xs text-slate-500">范围开始</div>
              <Input type="month" className="h-9 w-[160px]" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} disabled={isCreating} />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-slate-500">范围结束</div>
              <Input type="month" className="h-9 w-[160px]" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} disabled={isCreating} />
            </div>
            <Button variant="outline" onClick={() => void handleCreateRange()} disabled={isCreating}>
              批量补发
            </Button>
          </div>

        </CardContent>
      </Card>

      {message ? (
        <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">{message}</div>
      ) : null}

      <div className="grid grid-cols-1 gap-6">
        {batches.map((batch) => (
          <Card key={batch.id} className="overflow-hidden border-none shadow-sm">
            <div className="flex flex-col md:flex-row">
              <div className="flex-1 p-6">
                <div className="mb-4 flex items-center gap-3">
                  <div className="rounded-lg bg-slate-100 p-2">
                    <Calendar className="text-slate-600" size={20} />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">{batch.month} 认定批次</h3>
                    <p className="text-xs text-slate-500">ID: {batch.id} · 发起时间: {batch.startTime}</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => handleViewDetail(batch)}>查看候选人</Button>
                  <Button variant="outline" onClick={() => handleEnterAudit(batch)}>进入审核</Button>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
