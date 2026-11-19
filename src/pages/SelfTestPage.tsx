import React, { useState, useEffect } from 'react';
import { SelfTestResult, AcceptanceRunReport, AcceptanceStatus } from '../types';
import {
  CheckCircle2,
  XCircle,
  Play,
  ShieldCheck,
  FileSearch,
  RefreshCw,
  AlertTriangle,
  ClipboardCheck,
  FileText,
  UserCheck,
  RotateCcw,
} from 'lucide-react';

interface SelfTestPageProps {
  workspaceHash: string | null;
}

function getStatusBadgeClass(status: AcceptanceStatus): string {
  switch (status) {
    case '机械通过':
      return 'bg-emerald-950 border-emerald-700 text-emerald-300';
    case '机械失败':
      return 'bg-rose-950 border-rose-700 text-rose-300';
    case '模型判断':
      return 'bg-indigo-950 border-indigo-700 text-indigo-300';
    case '不适用':
      return 'bg-slate-800 border-slate-600 text-slate-300';
    default:
      return 'bg-amber-950/60 border-amber-700/70 text-amber-300';
  }
}

export const SelfTestPage: React.FC<SelfTestPageProps> = ({ workspaceHash }) => {
  const [result, setResult] = useState<SelfTestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [acceptanceReport, setAcceptanceReport] = useState<AcceptanceRunReport | null>(null);
  const [runningAcceptance, setRunningAcceptance] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [acceptanceError, setAcceptanceError] = useState<string | null>(null);
  const [rawModalData, setRawModalData] = useState<{ path: string; content: unknown } | null>(null);

  const fetchLatestAcceptance = async () => {
    try {
      const { safeFetchJson } = await import('../utils/safeFetch');
      const data = await safeFetchJson('/api/acceptance/report');
      if (data.success && data.data && data.data.thresholds && data.data.biasDeclaration) {
        setAcceptanceReport(data.data);
      }
    } catch {
      // 忽略初次无报告读取异常
    }
  };

  useEffect(() => {
    fetchLatestAcceptance();
  }, []);

  const handleRunSelfTest = async () => {
    setLoading(true);
    setError(null);
    try {
      const { safeFetchJson } = await import('../utils/safeFetch');
      const data = await safeFetchJson('/api/selftest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceHash }),
      });
      if (!data.success) throw new Error(data.error || '自检失败');
      setResult(data.data);
    } catch (err: any) {
      setError(err.message || '触发自检遇到错误');
    } finally {
      setLoading(false);
    }
  };

  const handleRunAcceptance = async () => {
    setRunningAcceptance(true);
    setAcceptanceError(null);
    try {
      const { safeFetchJson } = await import('../utils/safeFetch');
      const data = await safeFetchJson('/api/acceptance/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceHash }),
      });
      if (!data.success) throw new Error(data.error || '运行全量验收失败');
      setAcceptanceReport(data.data);
    } catch (err: any) {
      setAcceptanceError(err.message || '执行全量验收遇到错误');
    } finally {
      setRunningAcceptance(false);
    }
  };

  const handleManualReview = async (confirmed: boolean, dimensionKey?: string) => {
    setReviewLoading(true);
    setAcceptanceError(null);
    try {
      const { safeFetchJson } = await import('../utils/safeFetch');
      const data = await safeFetchJson('/api/acceptance/manual-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed, dimensionKey }),
      });
      if (!data.success) throw new Error(data.error || '更新人工复核状态失败');
      if (data.data) setAcceptanceReport(data.data);
    } catch (err: any) {
      setAcceptanceError(err.message || '保存人工复核确认失败');
    } finally {
      setReviewLoading(false);
    }
  };

  const handleInspectRaw = async (rawOutputPath: string) => {
    const fileName = rawOutputPath.split('/').pop() || '';
    if (!fileName) return;
    try {
      const { safeFetchJson } = await import('../utils/safeFetch');
      const data = await safeFetchJson(`/api/acceptance/raw/${encodeURIComponent(fileName)}`);
      if (data.success) {
        setRawModalData({ path: rawOutputPath, content: data.data });
      }
    } catch (err: any) {
      setAcceptanceError(err.message || '读取原始输出失败');
    }
  };

  const tests = acceptanceReport?.acceptanceTests || [];
  const passCount = tests.filter((t) => t.status === '机械通过').length;
  const failCount = tests.filter((t) => t.status === '机械失败').length;
  const naCount = tests.filter((t) => t.status === '不适用').length;
  const untestedCount = tests.filter((t) => t.status === '未测试').length;

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* 标题栏 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-sky-400" />
            系统确定性自检与全量验收中心
          </h1>
          <p className="text-slate-400 text-xs mt-1">
            纯代码自动化检验：违禁词与项目标识符审查 (C1/C2) · 清单确定性对比 (C5) · 账本完整性 (C4/C8) · A0–A16 全量验收与规则自评
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleRunSelfTest}
            disabled={loading}
            className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white font-medium text-xs rounded-xl transition-colors flex items-center gap-2"
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-white" />}
            <span>{loading ? '正在执行三大自检...' : '立即运行确定性自检'}</span>
          </button>

          <button
            onClick={handleRunAcceptance}
            disabled={runningAcceptance}
            className="px-5 py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-medium text-xs rounded-xl transition-colors flex items-center gap-2 shadow-lg shadow-sky-950"
          >
            {runningAcceptance ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ClipboardCheck className="w-4 h-4" />}
            <span>{runningAcceptance ? '正在运行 A0–A16 验收...' : '运行全量验收与自动自评 (A0–A16)'}</span>
          </button>
        </div>
      </div>

      {error && <div className="p-4 bg-rose-950 text-rose-300 text-xs rounded-xl">{error}</div>}
      {acceptanceError && <div className="p-4 bg-rose-950 text-rose-300 text-xs rounded-xl">{acceptanceError}</div>}

      {/* 三大确定性自检区块 */}
      {!result && !loading && (
        <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-6 text-center space-y-2">
          <FileSearch className="w-9 h-9 text-slate-600 mx-auto" />
          <h3 className="text-sm font-semibold text-slate-300">尚未运行快速确定性自检</h3>
          <p className="text-xs text-slate-500 max-w-lg mx-auto">
            点击“立即运行确定性自检”可执行违禁词扫描、清单确定性校验及账本完整性检验；点击“运行全量验收与自动自评”可从界面直接生成全部 A0–A16 原始输出与报告。
          </p>
        </div>
      )}

      {result && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div
              className={`p-5 rounded-xl border flex flex-col justify-between space-y-3 ${
                result.forbiddenScan.passed
                  ? 'bg-emerald-950/30 border-emerald-800/60'
                  : 'bg-rose-950/30 border-rose-800/60'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300">源码违禁词检测 (C1, C2)</span>
                {result.forbiddenScan.passed ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                ) : (
                  <XCircle className="w-5 h-5 text-rose-400" />
                )}
              </div>
              <div>
                <div className="text-xl font-bold font-mono">
                  {result.forbiddenScan.passed ? '通过 (0 违规)' : `失败 (${result.forbiddenScan.hitCount} 违规)`}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  扫描了 {result.forbiddenScan.scannedFilesCount} 个源码与配置文件
                </div>
              </div>
            </div>

            <div
              className={`p-5 rounded-xl border flex flex-col justify-between space-y-3 ${
                result.inventoryDeterminism.passed
                  ? 'bg-emerald-950/30 border-emerald-800/60'
                  : result.inventoryDeterminism.tested
                  ? 'bg-rose-950/30 border-rose-800/60'
                  : 'bg-slate-900/40 border-slate-800'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300">清单提取确定性对比 (C5)</span>
                {result.inventoryDeterminism.passed ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                ) : result.inventoryDeterminism.tested ? (
                  <XCircle className="w-5 h-5 text-rose-400" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-slate-500" />
                )}
              </div>
              <div>
                <div className="text-xl font-bold font-mono">
                  {result.inventoryDeterminism.passed
                    ? '字节完全一致'
                    : result.inventoryDeterminism.tested
                    ? '哈希不一致'
                    : '未测试'}
                </div>
                <div className="text-[11px] text-slate-400 mt-1 truncate">
                  {result.inventoryDeterminism.message}
                </div>
              </div>
            </div>

            <div
              className={`p-5 rounded-xl border flex flex-col justify-between space-y-3 ${
                result.ledgerIntegrity.passed
                  ? 'bg-emerald-950/30 border-emerald-800/60'
                  : 'bg-rose-950/30 border-rose-800/60'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300">证据账本只增不减校验 (C4, C8)</span>
                {result.ledgerIntegrity.passed ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                ) : (
                  <XCircle className="w-5 h-5 text-rose-400" />
                )}
              </div>
              <div>
                <div className="text-xl font-bold font-mono">
                  {result.ledgerIntegrity.passed ? '校验通过' : '账本破损'}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">{result.ledgerIntegrity.message}</div>
              </div>
            </div>
          </div>

          <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-200">(a) 源码违禁词扫描明细</h3>
            {result.forbiddenScan.hits.length === 0 ? (
              <div className="p-3 bg-emerald-950/40 border border-emerald-800/60 rounded-lg text-emerald-300 text-xs font-mono">
                未发现任何预置违禁词命中。
              </div>
            ) : (
              <div className="space-y-2">
                {result.forbiddenScan.hits.map((hit, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 bg-slate-900 border border-rose-800/60 rounded-lg text-xs font-mono space-y-1"
                  >
                    <div className="flex items-center justify-between text-rose-400">
                      <span>
                        {hit.file}:{hit.line}
                      </span>
                      <span className="px-1.5 py-0.5 bg-rose-950 border border-rose-800 text-[10px] rounded font-bold">
                        命中: {hit.keyword}
                      </span>
                    </div>
                    <div className="text-slate-300 bg-slate-950 p-2 rounded text-[11px]">{hit.text}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {result.inventoryDeterminism.tested && (
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 space-y-3 font-mono text-xs">
              <h3 className="text-sm font-semibold text-slate-200 font-sans">(b) 清单确定性校验细节</h3>
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2 text-slate-300">
                <div>
                  <span className="text-slate-500 font-sans">工作空间哈希：</span>
                  <span className="text-sky-300">{result.inventoryDeterminism.workspaceHash}</span>
                </div>
                <div>
                  <span className="text-slate-500 font-sans">第一次提取哈希：</span>
                  <span className="text-emerald-400">{result.inventoryDeterminism.run1Hash}</span>
                </div>
                <div>
                  <span className="text-slate-500 font-sans">第二次提取哈希：</span>
                  <span className="text-emerald-400">{result.inventoryDeterminism.run2Hash}</span>
                </div>
                <div className="pt-2 text-slate-400 font-sans border-t border-slate-800 text-[11px]">
                  结论：{result.inventoryDeterminism.message}
                </div>
              </div>
            </div>
          )}

          <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 space-y-2">
            <h3 className="text-xs font-semibold text-slate-400 font-mono">
              自检原始 JSON 输出 ({result.timestamp})
            </h3>
            <pre className="p-3 bg-slate-950 text-slate-300 text-[11px] font-mono rounded-lg overflow-x-auto max-h-60">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {/* 全量验收与规则自评区块 */}
      {acceptanceReport && (
        <div className="space-y-6 border-t border-slate-800 pt-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                <ClipboardCheck className="w-5 h-5 text-sky-400" />
                全量验收报告（A0–A16）与规则自动自评
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                生成时间：{acceptanceReport.timestamp} · 已自动同步写入 ACCEPTANCE_REPORT.md / ACCEPTANCE_REPORT.json
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs font-mono">
              <span className="px-2.5 py-1 bg-emerald-950/60 border border-emerald-800 rounded text-emerald-300">
                机械通过: {passCount}
              </span>
              <span className="px-2.5 py-1 bg-rose-950/60 border border-rose-800 rounded text-rose-300">
                机械失败: {failCount}
              </span>
              <span className="px-2.5 py-1 bg-slate-800 border border-slate-600 rounded text-slate-300">
                不适用: {naCount}
              </span>
              <span className="px-2.5 py-1 bg-amber-950/60 border border-amber-800 rounded text-amber-300">
                未测试: {untestedCount}
              </span>
            </div>
          </div>

          {/* 1. 客观基准指标与自评偏差声明 */}
          <div className="bg-slate-800/60 border border-amber-700/50 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-amber-300">自评偏差声明与客观基准数字</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-lg space-y-1">
                <div className="text-slate-400">蓝图证据校验率</div>
                <div className="text-xl font-bold font-mono text-sky-300">
                  {acceptanceReport.biasDeclaration.objectiveMetrics.blueprintEvidenceVerificationRate !== null
                    ? `${acceptanceReport.biasDeclaration.objectiveMetrics.blueprintEvidenceVerificationRate}%`
                    : '未知'}
                </div>
                <div className="text-[11px] text-slate-400">
                  {acceptanceReport.biasDeclaration.objectiveMetrics.blueprintEvidenceDetail}
                </div>
              </div>

              <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-lg space-y-1">
                <div className="text-slate-400">文件读取覆盖率（真实读取行数）</div>
                <div className="text-xl font-bold font-mono text-amber-300">
                  {acceptanceReport.biasDeclaration.objectiveMetrics.fileReadCoverageRate !== null
                    ? `${acceptanceReport.biasDeclaration.objectiveMetrics.fileReadCoverageRate}%`
                    : '未知'}
                </div>
                <div className="text-[11px] text-slate-400">
                  {acceptanceReport.biasDeclaration.objectiveMetrics.fileReadCoverageDetail}
                </div>
              </div>

              <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-lg space-y-1">
                <div className="text-slate-400">代码规则兜底生成的单元占比</div>
                <div className="text-xl font-bold font-mono text-rose-300">
                  {acceptanceReport.biasDeclaration.objectiveMetrics.codeRuleFallbackUnitRatio !== null
                    ? `${acceptanceReport.biasDeclaration.objectiveMetrics.codeRuleFallbackUnitRatio}%`
                    : '未知'}
                </div>
                <div className="text-[11px] text-slate-400">
                  {acceptanceReport.biasDeclaration.objectiveMetrics.codeRuleFallbackDetail}
                </div>
              </div>
            </div>

            {acceptanceReport.biasDeclaration.cappedDimensions.length > 0 && (
              <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-lg space-y-1.5 text-xs">
                <div className="font-semibold text-slate-200">被规则封顶维度清单：</div>
                {acceptanceReport.biasDeclaration.cappedDimensions.map((c) => (
                  <div key={c.key} className="text-slate-300">
                    <span className="font-semibold text-amber-300">{c.label}</span>（当前 {c.score} 分）：{c.reason}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 2. 规则计算自评分与人工复核确认 */}
          <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-100">按规则自动计算的自评分（满分为 5 分）</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  封顶规则：任一支撑测试机械失败最高 1 分 · 任一未测试最高 2 分 · 仅测 1 项目最高 3 分 · ≥2 项目且 A8 通过最高 4 分 · 5 分仅可在满足 4 分条件后由用户点击“人工复核确认”
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => handleManualReview(true)}
                  disabled={reviewLoading}
                  className="px-3.5 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg flex items-center gap-1.5"
                >
                  <UserCheck className="w-3.5 h-3.5" />
                  <span>人工复核确认</span>
                </button>
                {acceptanceReport.manualReviews.confirmed && (
                  <button
                    onClick={() => handleManualReview(false)}
                    disabled={reviewLoading}
                    className="px-3 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 text-xs rounded-lg flex items-center gap-1"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>撤销确认</span>
                  </button>
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-700 text-slate-400">
                    <th className="py-2 px-3">评估维度</th>
                    <th className="py-2 px-3">当前分数</th>
                    <th className="py-2 px-3">自动封顶</th>
                    <th className="py-2 px-3">引用测试</th>
                    <th className="py-2 px-3">封顶原因 / 依据</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {Object.values(acceptanceReport.selfAssessment).map((dim) => (
                    <tr key={dim.key}>
                      <td className="py-2.5 px-3 font-medium text-slate-200 whitespace-nowrap">{dim.label}</td>
                      <td className="py-2.5 px-3 font-mono font-bold text-sky-300 whitespace-nowrap">
                        {dim.score} / 5
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-400 whitespace-nowrap">{dim.autoCappedScore}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-400 whitespace-nowrap">{dim.cites.join(', ')}</td>
                      <td className="py-2.5 px-3 text-slate-300">{dim.capReason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 3. A0-A16 明细表 */}
          <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-slate-100">A0–A16 验收测试结果与原始输出路径</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-700 text-slate-400">
                    <th className="py-2 px-3">编号</th>
                    <th className="py-2 px-3">测试名称与方法</th>
                    <th className="py-2 px-3">判定标准</th>
                    <th className="py-2 px-3">状态</th>
                    <th className="py-2 px-3">原始输出路径</th>
                    <th className="py-2 px-3">依据与明细</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {tests.map((rec) => (
                    <tr key={rec.id} className="align-top">
                      <td className="py-2.5 px-3 font-mono font-bold text-sky-400 whitespace-nowrap">{rec.id}</td>
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-slate-200">{rec.name}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">{rec.method}</div>
                      </td>
                      <td className="py-2.5 px-3 text-slate-300 font-mono text-[11px]">{rec.mechanicalPassCriterion}</td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded border text-[11px] font-bold ${getStatusBadgeClass(rec.status)}`}>
                          {rec.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px] whitespace-nowrap">
                        <button
                          onClick={() => handleInspectRaw(rec.rawOutputPath)}
                          className="text-sky-400 hover:text-sky-300 underline flex items-center gap-1"
                        >
                          <FileText className="w-3 h-3" />
                          <span>{rec.rawOutputPath}</span>
                        </button>
                      </td>
                      <td className="py-2.5 px-3 text-slate-300">{rec.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 4. 集中阈值清单 */}
          <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-bold text-slate-100">集中机械判定阈值配置（禁止自行放宽）</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
              {Object.entries(acceptanceReport.thresholds).map(([k, item]) => (
                <div key={k} className="p-2.5 bg-slate-900 border border-slate-800 rounded-lg flex items-center justify-between gap-2">
                  <span className="text-slate-300">{item.label}</span>
                  <span className="font-mono font-bold text-sky-400 shrink-0">{String(item.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 原始输出查看窗 */}
      {rawModalData && (
        <div className="bg-slate-900 border border-sky-700/60 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-mono font-bold text-sky-300">原始输出内容：{rawModalData.path}</h3>
            <button
              onClick={() => setRawModalData(null)}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded"
            >
              关闭预览
            </button>
          </div>
          <pre className="p-3 bg-slate-950 text-slate-300 text-[11px] font-mono rounded-lg overflow-x-auto max-h-80">
            {JSON.stringify(rawModalData.content, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};
