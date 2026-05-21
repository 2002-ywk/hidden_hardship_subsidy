import React from 'react';
import { Search, Filter, FileText, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fetchBatches, fetchSubsidyRecords } from '@/src/lib/api';
import type { BatchSummary, SubsidyRecord } from '@/src/types';

export default function SubsidyForms() {
  const [subsidyData, setSubsidyData] = React.useState<SubsidyRecord[]>([]);
  const [batches, setBatches] = React.useState<BatchSummary[]>([]);
  const [selectedMonth, setSelectedMonth] = React.useState('');
  const [searchText, setSearchText] = React.useState('');
  const [collegeFilter, setCollegeFilter] = React.useState('all');

  React.useEffect(() => {
    fetchBatches().then((items) => {
      setBatches(items);
      if (!selectedMonth && items.length > 0) {
        setSelectedMonth(items[0].month);
      }
    });
  }, [selectedMonth]);

  React.useEffect(() => {
    if (!selectedMonth) return;
    fetchSubsidyRecords(selectedMonth).then(setSubsidyData);
  }, [selectedMonth]);

  const colleges = React.useMemo(() => {
    const set = new Set<string>(subsidyData.map((item) => item.college).filter((value): value is string => Boolean(value)));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [subsidyData]);

  const filteredData = React.useMemo(() => {
    const keyword = searchText.trim();
    return subsidyData.filter((item) => {
      const matchesCollege = collegeFilter === 'all' ? true : item.college === collegeFilter;
      const matchesKeyword =
        keyword.length === 0 ? true : item.name.includes(keyword) || item.id.includes(keyword) || item.className.includes(keyword);
      return matchesCollege && matchesKeyword;
    });
  }, [collegeFilter, searchText, subsidyData]);

  const totalAmount = React.useMemo(() => filteredData.reduce((sum, item) => sum + item.total, 0), [filteredData]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">补助发放表单</h1>
          <p className="text-slate-500">查看并导出本月最终确认的资助名单及发放金额明细。</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="border-none shadow-sm bg-blue-600 text-white">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-white/20 rounded-xl">
                <FileText size={24} />
              </div>
              <div>
                <p className="text-blue-100 text-sm font-medium">本月预计发放总额</p>
                <h3 className="text-2xl font-bold">¥ {totalAmount.toFixed(2)}</h3>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-emerald-50 rounded-xl text-emerald-600">
                <CheckCircle2 size={24} />
              </div>
              <div>
                <p className="text-slate-500 text-sm font-medium">已入选资助人数</p>
                <h3 className="text-2xl font-bold text-slate-900">{filteredData.length} 人</h3>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-slate-50 rounded-xl text-slate-600">
                <Filter size={24} />
              </div>
              <div>
                <p className="text-slate-500 text-sm font-medium">学院覆盖数</p>
                <h3 className="text-2xl font-bold text-slate-900">{new Set(filteredData.map((i) => i.college)).size}</h3>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex flex-1 items-center gap-2 max-w-md">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <Input
                  placeholder="输入姓名或学号定位..."
                  className="pl-10 h-9"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Select value={collegeFilter} onValueChange={setCollegeFilter}>
                <SelectTrigger className="w-[180px] h-9">
                  <SelectValue>{collegeFilter === 'all' ? '全部学院' : collegeFilter}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部学院</SelectItem>
                  {colleges.map((college) => (
                    <SelectItem key={college} value={college}>
                      {college}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger className="w-[140px] h-9">
                  <SelectValue placeholder="选择批次" />
                </SelectTrigger>
                <SelectContent>
                  {batches.map((batch) => (
                    <SelectItem key={batch.id} value={batch.month}>
                      {batch.month}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div className="rounded-lg border border-slate-100 overflow-hidden">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="w-[120px]">
                    <div className="flex items-center gap-1">学号</div>
                  </TableHead>
                  <TableHead>姓名</TableHead>
                  <TableHead>学院/班级</TableHead>
                  <TableHead className="text-right">早餐补助</TableHead>
                  <TableHead className="text-right">午晚餐补助</TableHead>
                  <TableHead className="text-right">
                    <div className="flex items-center justify-end gap-1 font-bold text-slate-900">总补助金额</div>
                  </TableHead>
                  <TableHead className="text-center">状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredData.map((item) => (
                  <TableRow key={item.id} className="hover:bg-slate-50/50 transition-colors">
                    <TableCell className="font-mono text-slate-600 text-sm">{item.id}</TableCell>
                    <TableCell className="font-medium text-slate-900">{item.name}</TableCell>
                    <TableCell>
                      <div className="text-xs">
                        <p className="text-slate-900">{item.college}</p>
                        <p className="text-slate-500">{item.className}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-slate-600">¥ {item.breakfast.toFixed(2)}</TableCell>
                    <TableCell className="text-right text-slate-600">¥ {item.lunchDinner.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-bold text-blue-600">¥ {item.total.toFixed(2)}</TableCell>
                    <TableCell className="text-center">
                      <Badge className="bg-emerald-50 text-emerald-600 hover:bg-emerald-50 border-none font-normal text-[10px]">审核通过</Badge>
                    </TableCell>
                  </TableRow>
                ))}

                {filteredData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-slate-500">
                      暂无数据
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
