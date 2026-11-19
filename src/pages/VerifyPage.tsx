import React, { useState, useEffect } from 'react';
import { VerificationReport, VerificationCriterion } from '../types';
import { EvidenceTagBadge } from '../components/EvidenceTagBadge';
import {
  ShieldCheck,
  Play,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Download,
  FileCode,
  FileText,
  Archive,
  Code,
} from 'lucide-react';

interface VerifyPageProps {
  workspaceHash: string | null;
  onModelCallTriggered?: () => void;
}

export const VerifyPage: React.FC<VerifyPageProps> = ({
  workspaceHash,
  onModelCallTriggered,
}) => {
  const [criteria, setCriteria] = useState<VerificationCriterion[]>([]);
  const [report, setReport] = useState<VerificationReport | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewPayload, setViewPayload] = useState(false);

  const fetchInitialCriteria = async () => {
    if (!workspaceHash) return;
    try {
      const { safeFetchJson } = await import('../utils/safeFetch');
      const data = await safeFetchJson('/api/verify/criteria', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceHash, taskText: '运行标准验证' }),
      });
      if (data.success) {
        setCriteria(data.data || []);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchExistingReport = async () => {
    if (!workspaceHash) return;
    try {
      const { safeFetchJson } = await import('../utils/safeFetch');
      const data = await safeFetchJson(`/api/verify/result/${workspaceHash}`);
      if (data.success && data.data) {
        setReport(data.data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchInitialCriteria();
    fetchExistingReport();
  }, [workspaceHash]);

  const handleRunVerification = async () => {
    if (!workspaceHash) return;
    setVerifying(true);
    setError(null);
    try {
      const { safeFetchJson } = await import('../utils/safeFetch');
      const data = await safeFetchJson('/api/verify/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceHash, taskText: '标准任务验收' }),
      });
      if (!data.success) throw new Error(data.error || '独立验证失败');
      setReport(data.data);
      if (onModelCallTriggered) onModelCallTriggered();
    } catch (err: any) {
      setError(err.message || '双路验证过程出错');
    } finally {
      setVerifying(false);
    }
  };

  const handleDownloadReport = (format: 'md' | 'html' | 'json' | 'zip') => {
    if (!workspaceHash) return;
    const a = document.createElement('a');
    a.href = `/api/report/export/${workspaceHash}/${format}`;
    a.download = `report_${workspaceHash.slice(0, 8)}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (!workspaceHash) {
    return (
      <div className="max-w-4xl mx-auto py-12 text-center space-y-4">
        <ShieldCheck className="w-12 h-12 text-slate-600 mx-auto" />
        <h2 className="text-lg font-semibold text-slate-300">暂无载入的工作空间</h2>
        <p className="text-xs text-slate-500">请先在“导入”页面导入一个项目空间。</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* 标题栏 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-sky-400" />
            独立双路验证与比对引擎 (Independent Verification)
          </h1>
          <p className="text-slate-400 text-xs mt-1">
            独立的审计模块与专属 System Prompt，拒绝接收执行器的自我评估与推理
          </p>
        </div>

        <button
          onClick={handleRunVerification}
          disabled={verifying}
          className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium text-xs rounded-xl transition-colors flex items-center gap-2 shadow-lg shadow-emerald-950"
        >
          {verifying ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4 fill-white" />
          )}
          <span>{verifying ? '正在执行双路验证...' : '运行独立双路验证'}</span>
        </button>
      </div>

      {error && <div className="p-4 bg-rose-950 text-rose-300 text-xs rounded-xl">{error}</div>}

      {/* 1. 验证启动前展示推导的验收标准项 (Pre-Verification Criteria) */}
      <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 space-y-3 font-mono text-xs">
        <div className="flex items-center justify-between border-b border-slate-700/60 pb-2">
          <h3 className="font-semibold text-slate-200 font-sans flex items-center gap-2">
            <Code className="w-4 h-4 text-sky-400" />
            <span>1. 验证前推导的验收标准列表 (Derived Criteria - Pre-Show)</span>
          </h3>
          <span className="text-[11px] text-slate-400">衍生自蓝图 L3 规则与任务</span>
        </div>

        <div className="space-y-2">
          {criteria.map((c) => (
            <div key={c.id} className="p-3 bg-slate-900 border border-slate-800 rounded-lg flex items-center justify-between">
              <div>
                <span className="text-sky-300 font-bold mr-2">[{c.id}]</span>
                <span className="text-slate-200 font-sans">{c.description}</span>
              </div>
              <span className="text-[10px] px-2 py-0.5 bg-slate-800 text-slate-400 rounded">
                Source: {c.source}
              </span>
            </div>
          ))}
        </div>
      </div>

      {report && (
        <div className="space-y-6">
          {/* 2. 纯代码确定性校验卡片 */}
          <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 space-y-3 font-mono text-xs">
            <h3 className="font-semibold text-slate-200 font-sans flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>2. 纯代码确定性强校验 (Code Checks First)</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {report.codeChecks.details.map((detail, idx) => (
                <div key={idx} className="p-3 bg-slate-900 border border-slate-800 rounded-lg text-slate-200">
                  {detail}
                </div>
              ))}
            </div>
          </div>

          {/* 3. 逐条判定结果表 */}
          <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-700/60 pb-3">
              <h3 className="font-semibold text-slate-200 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <span>3. 逐条标准独立判定 (Per-Criterion Judgement)</span>
              </h3>

              <span
                className={`px-3 py-1 rounded-lg text-xs font-bold font-mono border ${
                  report.overallPass
                    ? 'bg-emerald-950 border-emerald-800 text-emerald-300'
                    : report.hasUndecidedCriteria
                    ? 'bg-amber-950 border-amber-800 text-amber-300'
                    : 'bg-rose-950 border-rose-800 text-rose-300'
                }`}
              >
                {report.overallPass
                  ? '[全量标准通过 PASS]'
                  : report.hasUndecidedCriteria
                  ? '[包含无法判断项]'
                  : '[未完全通过]'}
              </span>
            </div>

            <div className="space-y-3 font-mono text-xs">
              {report.judgements.map((j) => (
                <div key={j.criterionId} className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-2">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="font-bold text-slate-200 font-sans">{j.description}</span>
                    <span
                      className={`px-2.5 py-0.5 rounded text-[11px] font-bold ${
                        j.verdict === '满足'
                          ? 'bg-emerald-950 border border-emerald-800 text-emerald-400'
                          : j.verdict === '不满足'
                          ? 'bg-rose-950 border border-rose-800 text-rose-400'
                          : 'bg-amber-950 border border-amber-800 text-amber-400'
                      }`}
                    >
                      {j.verdict}
                    </span>
                  </div>

                  <div className="text-slate-300 font-sans text-xs bg-slate-950 p-2.5 rounded border border-slate-800/80">
                    依据: {j.reason}
                  </div>
                </div>
              ))}
            </div>

            {/* 总体评语 */}
            <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-300 font-sans">
              {report.summaryNote}
            </div>
          </div>

          {/* 4. 独立 Request Payload 审计透视 */}
          <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-300 font-mono">
                验证器独立 Request Payload 审计日志 (verification_payload.json)
              </h3>
              <button
                onClick={() => setViewPayload(!viewPayload)}
                className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded transition-colors"
              >
                {viewPayload ? '隐藏记录路径' : '查看 Payload 记录路径说明'}
              </button>
            </div>

            {viewPayload && (
              <pre className="p-4 bg-slate-950 text-emerald-400 text-xs font-mono rounded-xl border border-slate-800 overflow-x-auto max-h-60">
                {JSON.stringify(
                  {
                    payloadFile: report.payloadLoggedPath,
                    note: '请求 Payload 已写入工作空间磁盘文件（前端未单独拉取展示全文）',
                  },
                  null,
                  2
                )}
              </pre>
            )}
          </div>

          {/* 5. 综合评估报告一键导出 (Report Exporter) */}
          <div className="bg-slate-800/80 border border-sky-500/40 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-700/60 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                  <Download className="w-5 h-5 text-sky-400" />
                  综合评估报告导出 (Report Exporter)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  支持一键导出标准中文评估报告，包含完整的证据链与 JSONL 账本归档
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <button
                onClick={() => handleDownloadReport('md')}
                className="p-3 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-xl text-xs font-mono flex flex-col items-center justify-center gap-2 text-sky-300 transition-colors"
              >
                <FileText className="w-6 h-6 text-sky-400" />
                <span>Markdown 报告 (.md)</span>
              </button>

              <button
                onClick={() => handleDownloadReport('html')}
                className="p-3 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-xl text-xs font-mono flex flex-col items-center justify-center gap-2 text-emerald-300 transition-colors"
              >
                <FileCode className="w-6 h-6 text-emerald-400" />
                <span>HTML 格式报告 (.html)</span>
              </button>

              <button
                onClick={() => handleDownloadReport('json')}
                className="p-3 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-xl text-xs font-mono flex flex-col items-center justify-center gap-2 text-indigo-300 transition-colors"
              >
                <Code className="w-6 h-6 text-indigo-400" />
                <span>JSON 格式数据 (.json)</span>
              </button>

              <button
                onClick={() => handleDownloadReport('zip')}
                className="p-3 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-xl text-xs font-mono flex flex-col items-center justify-center gap-2 text-amber-300 transition-colors"
              >
                <Archive className="w-6 h-6 text-amber-400" />
                <span>全量 ZIP 归档包 (含账本)</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
