import React from 'react';
import { Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  deleteDictionaryType,
  fetchDictionaryItems,
  fetchDictionaryTypes,
  saveDictionaryItems,
  upsertDictionaryType,
} from '@/src/lib/api';
import type { DictionaryItemRecord, DictionaryTypeRecord } from '@/src/types';

type DifficultyDictionaryRow = DictionaryItemRecord & {
  key: string;
};

function createRow(partial?: Partial<DifficultyDictionaryRow>): DifficultyDictionaryRow {
  return {
    key: partial?.key ?? `row-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    code: partial?.code ?? '',
    label: partial?.label ?? '',
    isSpecialDifficulty: partial?.isSpecialDifficulty ?? false,
    sortOrder: partial?.sortOrder ?? 0,
    enabled: partial?.enabled ?? true,
    description: partial?.description ?? '',
  };
}

export default function TagManagement() {
  const [dictionaryTypes, setDictionaryTypes] = React.useState<DictionaryTypeRecord[]>([]);
  const [selectedDictType, setSelectedDictType] = React.useState('difficulty_level');
  const [newDictType, setNewDictType] = React.useState('');
  const [newDictLabel, setNewDictLabel] = React.useState('');
  const [newDictDescription, setNewDictDescription] = React.useState('');
  const [rows, setRows] = React.useState<DifficultyDictionaryRow[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isCreatingType, setIsCreatingType] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [typeLabel, setTypeLabel] = React.useState('');
  const [typeDescription, setTypeDescription] = React.useState('');
  const [typeSortOrder, setTypeSortOrder] = React.useState(0);
  const [typeEnabled, setTypeEnabled] = React.useState(true);
  const [isSavingType, setIsSavingType] = React.useState(false);
  const [isDeletingType, setIsDeletingType] = React.useState(false);
  const [isEditTypeOpen, setIsEditTypeOpen] = React.useState(false);
  const [isCreateTypeOpen, setIsCreateTypeOpen] = React.useState(false);

  const selectedTypeMeta = React.useMemo(
    () => dictionaryTypes.find((item) => item.dictType === selectedDictType) ?? null,
    [dictionaryTypes, selectedDictType]
  );
  const isDifficultyDictionary = selectedDictType === 'difficulty_level';

  React.useEffect(() => {
    if (!selectedTypeMeta) {
      return;
    }
    setTypeLabel(selectedTypeMeta.label ?? '');
    setTypeDescription(selectedTypeMeta.description ?? '');
    setTypeSortOrder(Number.isFinite(selectedTypeMeta.sortOrder) ? selectedTypeMeta.sortOrder : 0);
    setTypeEnabled(Boolean(selectedTypeMeta.enabled));
  }, [selectedTypeMeta]);

  const loadTypes = React.useCallback(async () => {
    const response = await fetchDictionaryTypes();
    const items = response.items || [];
    setDictionaryTypes(items);
    if (items.length > 0 && !items.some((item) => item.dictType === selectedDictType)) {
      setSelectedDictType(items[0].dictType);
    }
  }, [selectedDictType]);

  const loadDictionary = React.useCallback(async (dictType: string) => {
    setIsLoading(true);
    try {
      const response = await fetchDictionaryItems(dictType);
      setRows(response.items.map((item) => createRow(item)));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '字典项加载失败');
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await loadTypes();
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : '字典类型加载失败');
      }
    })();
    return () => {
      mounted = false;
    };
  }, [loadTypes]);

  React.useEffect(() => {
    loadDictionary(selectedDictType);
  }, [selectedDictType, loadDictionary]);

  const updateRow = (key: string, patch: Partial<DifficultyDictionaryRow>) => {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const addRow = () => {
    setRows((prev) => [...prev, createRow({ sortOrder: prev.length + 1 })]);
  };

  const removeRow = (key: string) => {
    setRows((prev) => prev.filter((row) => row.key !== key));
  };

  const handleSave = async () => {
    setIsSaving(true);
    setMessage(null);
    setError(null);
    try {
      const payload = {
        items: rows.map((row) => ({
          code: row.code.trim(),
          label: row.label.trim(),
          isSpecialDifficulty: isDifficultyDictionary ? row.isSpecialDifficulty : false,
          sortOrder: Number.isFinite(row.sortOrder) ? row.sortOrder : 0,
          enabled: row.enabled,
          description: row.description.trim(),
        })),
      };
      const response = await saveDictionaryItems(selectedDictType, payload);
      setRows(response.data.items.map((item) => createRow(item)));
      setMessage(response.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateDictionaryType = async () => {
    const dictType = newDictType.trim();
    const label = newDictLabel.trim();
    if (!dictType || !label) {
      setError('请输入字典编码和字典名称');
      return false;
    }
    setIsCreatingType(true);
    setMessage(null);
    setError(null);
    try {
      const response = await upsertDictionaryType({
        dictType,
        label,
        description: newDictDescription.trim(),
        sortOrder: dictionaryTypes.length + 1,
        enabled: true,
      });
      await loadTypes();
      setSelectedDictType(response.data.dictType);
      setNewDictType('');
      setNewDictLabel('');
      setNewDictDescription('');
      setMessage(response.message);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '新建字典失败');
      return false;
    } finally {
      setIsCreatingType(false);
    }
  };

  const handleSaveDictionaryType = async () => {
    if (!selectedTypeMeta) return;
    setIsSavingType(true);
    setMessage(null);
    setError(null);
    try {
      const response = await upsertDictionaryType({
        dictType: selectedDictType,
        label: typeLabel.trim(),
        description: typeDescription.trim(),
        sortOrder: Number.isFinite(typeSortOrder) ? Math.floor(typeSortOrder) : 0,
        enabled: Boolean(typeEnabled),
      });
      await loadTypes();
      setSelectedDictType(response.data.dictType);
      setMessage(response.message);
      setIsEditTypeOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setIsSavingType(false);
    }
  };

  const handleDeleteSelectedType = async () => {
    if (!selectedTypeMeta) return;
    if (selectedDictType === 'difficulty_level') {
      setError('difficulty_level 为系统字典，禁止删除');
      return;
    }
    const confirmed = window.confirm(`确认删除字典类型 ${selectedDictType}？该字典下的字典项也会被删除。`);
    if (!confirmed) return;

    setIsDeletingType(true);
    setMessage(null);
    setError(null);
    try {
      const response = await deleteDictionaryType(selectedDictType);
      await loadTypes();
      setMessage(response.message);
      setIsEditTypeOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    } finally {
      setIsDeletingType(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">字典管理</h1>
        </div>
        <div className="flex gap-2 flex-wrap" style={{ display: 'none' }}>
          <Button variant="outline" onClick={addRow}>
            <Plus size={16} className="mr-2" />
            新增字典项
          </Button>
          <Button className="bg-blue-600 hover:bg-blue-700" onClick={handleSave} disabled={isSaving || isLoading}>
            <Save size={16} className="mr-2" />
            {isSaving ? '保存中...' : '保存字典'}
          </Button>
        </div>
      </div>

      {message ? <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">{message}</div> : null}
      {error ? <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
        <Card className="border-none shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-lg">字典列表</CardTitle>
                <CardDescription>选择字典类型进行维护。</CardDescription>
              </div>
              <div className="flex gap-2">
                <Dialog open={isEditTypeOpen} onOpenChange={setIsEditTypeOpen}>
                  <DialogTrigger render={<Button variant="outline" size="sm" disabled={!selectedTypeMeta} />}>
                    <Pencil size={16} className="mr-2" />
                    编辑
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle>编辑字典类型</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-3">
                      <div className="grid gap-1.5">
                        <Label>字典编码</Label>
                        <Input value={selectedDictType} disabled />
                      </div>
                      <div className="grid gap-1.5">
                        <Label>字典名称</Label>
                        <Input value={typeLabel} onChange={(e) => setTypeLabel(e.target.value)} placeholder="例如：性别" />
                      </div>
                      <div className="grid gap-1.5">
                        <Label>说明</Label>
                        <Input
                          value={typeDescription}
                          onChange={(e) => setTypeDescription(e.target.value)}
                          placeholder="可选，例如：用于展示/导入映射"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="grid gap-1.5">
                          <Label>排序</Label>
                          <Input
                            type="number"
                            value={String(typeSortOrder)}
                            onChange={(e) => setTypeSortOrder(Number(e.target.value || 0))}
                          />
                        </div>
                        <div className="grid gap-1.5">
                          <Label>启用</Label>
                          <div className="flex h-10 items-center justify-between rounded-md border border-slate-200 px-3">
                            <span className="text-sm text-slate-600">{typeEnabled ? '启用' : '停用'}</span>
                            <Switch checked={typeEnabled} onCheckedChange={(checked) => setTypeEnabled(Boolean(checked))} />
                          </div>
                        </div>
                      </div>
                    </div>
                    <DialogFooter className="flex-col sm:flex-row sm:justify-between gap-2 sm:gap-0">
                      <Button
                        variant="outline"
                        onClick={handleDeleteSelectedType}
                        disabled={isDeletingType || selectedDictType === 'difficulty_level'}
                      >
                        {isDeletingType ? '删除中...' : '删除类型'}
                      </Button>
                      <div className="flex gap-2 sm:justify-end">
                        <DialogClose render={<Button variant="ghost" />}>
                          取消
                        </DialogClose>
                        <Button onClick={handleSaveDictionaryType} disabled={isSavingType}>
                          {isSavingType ? '保存中...' : '保存'}
                        </Button>
                      </div>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <Dialog open={isCreateTypeOpen} onOpenChange={setIsCreateTypeOpen}>
                  <DialogTrigger render={<Button size="sm" />}>
                    <Plus size={16} className="mr-2" />
                    新建
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle>新建字典类型</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-3">
                      <div className="grid gap-1.5">
                        <Label>字典编码</Label>
                        <Input value={newDictType} onChange={(e) => setNewDictType(e.target.value)} placeholder="例如：gender" />
                      </div>
                      <div className="grid gap-1.5">
                        <Label>字典名称</Label>
                        <Input value={newDictLabel} onChange={(e) => setNewDictLabel(e.target.value)} placeholder="例如：性别" />
                      </div>
                      <div className="grid gap-1.5">
                        <Label>说明</Label>
                        <Input
                          value={newDictDescription}
                          onChange={(e) => setNewDictDescription(e.target.value)}
                          placeholder="可选"
                        />
                      </div>
                    </div>
                    <DialogFooter className="gap-2 sm:gap-0">
                      <DialogClose render={<Button variant="ghost" />}>
                        取消
                      </DialogClose>
                      <Button
                        onClick={async () => {
                          const ok = await handleCreateDictionaryType();
                          if (ok) {
                            setIsCreateTypeOpen(false);
                          }
                        }}
                        disabled={isCreatingType}
                      >
                        {isCreatingType ? '创建中...' : '创建'}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {dictionaryTypes.map((item) => (
              <button
                key={item.dictType}
                className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                  selectedDictType === item.dictType ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
                onClick={() => setSelectedDictType(item.dictType)}
              >
                <p className="text-sm font-medium text-slate-900">{item.label}</p>
                <p className="text-xs text-slate-500">{item.dictType}</p>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">
              字典项维护：{selectedTypeMeta?.label ?? selectedDictType} ({selectedDictType})
            </CardTitle>
            <CardDescription>
              {selectedTypeMeta?.description?.trim()
                ? selectedTypeMeta.description
                : '字段说明：编码(code)唯一；可通过“启用”控制是否生效。'}
              {isDifficultyDictionary ? '（困难等级字典中勾选“特别困难”会参与特别困难候选判定）' : ''}
            </CardDescription>
            <div className="mt-3 flex gap-2">
              <Button variant="outline" size="sm" onClick={addRow} disabled={isLoading}>
                <Plus size={16} className="mr-2" />
                新增字典项
              </Button>
              <Button className="bg-blue-600 hover:bg-blue-700" size="sm" onClick={handleSave} disabled={isSaving || isLoading}>
                <Save size={16} className="mr-2" />
                {isSaving ? '保存中...' : '保存字典'}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-lg border border-slate-100">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="w-[140px]">编码</TableHead>
                    <TableHead className="w-[220px]">名称</TableHead>
                    <TableHead className="w-[120px]">排序</TableHead>
                    {isDifficultyDictionary ? <TableHead className="w-[140px] text-center">特别困难</TableHead> : null}
                    <TableHead className="w-[120px] text-center">启用</TableHead>
                    <TableHead>备注</TableHead>
                    <TableHead className="text-right w-[100px]">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={isDifficultyDictionary ? 7 : 6} className="h-32 text-center text-slate-500">
                        正在加载字典...
                      </TableCell>
                    </TableRow>
                  ) : rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={isDifficultyDictionary ? 7 : 6} className="h-32 text-center text-slate-500">
                        当前无字典项，请点击“新增字典项”。
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((row) => (
                      <TableRow key={row.key} className="hover:bg-slate-50/60">
                        <TableCell>
                          <Input value={row.code} onChange={(e) => updateRow(row.key, { code: e.target.value })} placeholder="编码" />
                        </TableCell>
                        <TableCell>
                          <Input value={row.label} onChange={(e) => updateRow(row.key, { label: e.target.value })} placeholder="名称" />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={String(row.sortOrder)}
                            onChange={(e) => updateRow(row.key, { sortOrder: Number(e.target.value || 0) })}
                          />
                        </TableCell>
                        {isDifficultyDictionary ? (
                          <TableCell className="text-center">
                            <input
                              type="checkbox"
                              checked={row.isSpecialDifficulty}
                              onChange={(e) => updateRow(row.key, { isSpecialDifficulty: e.target.checked })}
                            />
                          </TableCell>
                        ) : null}
                        <TableCell className="text-center">
                          <input type="checkbox" checked={row.enabled} onChange={(e) => updateRow(row.key, { enabled: e.target.checked })} />
                        </TableCell>
                        <TableCell>
                          <Input value={row.description} onChange={(e) => updateRow(row.key, { description: e.target.value })} placeholder="备注" />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" onClick={() => removeRow(row.key)} className="h-8 w-8 text-slate-500 hover:text-red-600">
                            <Trash2 size={16} />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
