import React, { useState, useEffect } from 'react';
import { LedgerEntry } from '../types';
import { Database, Download, Search, ShieldCheck, RefreshCw, FileCode } from 'lucide-react';

export const LedgerPage: React.FC = () => {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [integrity, setIntegrity] = useState<{ valid: boolean; totalEntries: number; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState('');
  const [viewMode, setViewMode] = useState<'table' | 'raw'>('table');

  const fetchLedger = async () => {
    setLoading(true);
    setError(null);
    try {
      const { safeFetchJson } = await import('../utils/safeFetch');
      const data = await safeFetchJson('/api/ledger');
      if (!data.success) throw new Error(data.error || '读取账本失败');
      setEntries(data.entries || []);
      setIntegrity(data.integrity || null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLedger();
  }, []);

  const filteredEntries = entries.filter((e) => {
    const q = filterQuery.toLowerCase();
    return (
      e.id.toLowerCase().includes(q) ||
      e.action.toLowerCase().includes(q) ||
      e.stage.toLowerCase().includes(q) ||
      (e.ref?.details && e.ref.details.toLowerCase().includes(q))
    );
  });

  const handleExport = () => {
    const a = document.createElement('a');
    a.href = '/api/ledger/export';
    a.download = 'ledger.jsonl';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* 头部标题与控制栏 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Database className="w-6 h-6 text-sky-400" />
            证据账本 (Evidence Ledger)
          </h1>
          <p className="text-slate-400 text-xs mt-1">
            只增不减 (Append-only) 审计日志，记录系统发起的每一项确切操作与计算哈希
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchLedger}
            disabled={loading}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs transition-colors"
            title="刷新账本"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={handleExport}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs rounded-lg transition-colors flex items-center gap-1.5"
          >
            <Download className="w-4 h-4" />
            <span>导出账本 (JSONL)</span>
          </button>
        </div>
      </div>

      {/* 完整性校验卡片 */}
      {integrity && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between ${
            integrity.valid
              ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
              : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
            <div>
              <div className="font-semibold text-xs flex items-center gap-2">
                <span>{integrity.valid ? '[账本完整无篡改]' : '[账本完整性异常]'}</span>
                <span className="text-[11px] font-mono text-slate-400">({integrity.totalEntries} 条记录)</span>
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">{integrity.message}</div>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-1 rounded transition-colors ${
                viewMode === 'table' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              列表视图
            </button>
            <button
              onClick={() => setViewMode('raw')}
              className={`px-3 py-1 rounded transition-colors ${
                viewMode === 'raw' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              JSONL 原始流
            </button>
          </div>
        </div>
      )}

      {error && <div className="p-4 bg-rose-950 text-rose-300 text-xs rounded-xl">{error}</div>}

      {/* 搜索与卡片流 */}
      {viewMode === 'table' ? (
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 space-y-4">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="按记录 ID, Action, Stage 或描述检索账本..."
              className="w-full pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500 font-mono"
            />
          </div>

          <div className="space-y-2.5">
            {filteredEntries.length === 0 ? (
              <p className="text-xs text-slate-500 italic py-6 text-center">账本中暂无匹配的记录</p>
            ) : (
              filteredEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="p-3 bg-slate-900/90 border border-slate-800 rounded-lg space-y-2 text-xs font-mono"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 bg-sky-950 text-sky-400 border border-sky-800 rounded font-bold text-[11px]">
                        {entry.stage}
                      </span>
                      <span className="text-slate-100 font-semibold">{entry.action}</span>
                      <span className="text-slate-500 text-[11px]">({entry.id})</span>
                    </div>
                    <span className="text-slate-500 text-[11px] font-sans">{new Date(entry.time).toLocaleString()}</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-400">
                    <div>
                      <span className="text-slate-500">Inputs Hash: </span>
                      <span className="text-slate-300">{entry.inputs_hash.slice(0, 20)}...</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Outputs Hash: </span>
                      <span className="text-emerald-400">{entry.outputs_hash.slice(0, 20)}...</span>
                    </div>
                  </div>

                  {entry.ref?.details && (
                    <div className="text-[11px] text-slate-300 font-sans bg-slate-950 p-2 rounded border border-slate-800/80">
                      {entry.ref.details}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-xs text-slate-300 font-mono">
            <FileCode className="w-4 h-4 text-sky-400" />
            <span>ledger.jsonl 原始格式</span>
          </div>
          <pre className="p-4 bg-slate-950 rounded-xl border border-slate-800 text-xs text-emerald-400 font-mono overflow-x-auto max-h-[600px] leading-relaxed">
            {entries.map((e) => JSON.stringify(e)).join('\n')}
          </pre>
        </div>
      )}
    </div>
  );
};
