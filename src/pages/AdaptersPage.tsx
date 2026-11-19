import React, { useState, useEffect } from 'react';
import {
  CapabilityEntry,
  FeasibilityEvaluationResult,
  UnitFeasibilityVerdict,
} from '../types';
import { EvidenceTagBadge } from '../components/EvidenceTagBadge';
import {
  Cpu,
  Play,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  HelpCircle,
  Terminal,
  ShieldCheck,
  ShieldAlert,
  Layers,
  Code,
  Lock,
  ArrowRight,
} from 'lucide-react';

interface AdaptersPageProps {
  workspaceHash: string | null;
  onModelCallTriggered?: () => void;
}

export const AdaptersPage: React.FC<AdaptersPageProps> = ({
  workspaceHash,
  onModelCallTriggered,
}) => {
  const [capabilityModel, setCapabilityModel] = useState<Record<string, CapabilityEntry>>({});
  const [feasibility, setFeasibility] = useState<FeasibilityEvaluationResult | null>(null);
  const [dryRunResult, setDryRunResult] = useState<any>(null);

  const [loadingModel, setLoadingModel] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [probingKey, setProbingKey] = useState<string | null>(null);
  const [dryRunning, setDryRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCapabilityModel = async () => {
    setLoadingModel(true);
    try {
      const { safeFetchJson } = await import('../utils/safeFetch');
      const data = await safeFetchJson('/api/feasibility/capability-model');
      if (data.success) {
        setCapabilityModel(data.data);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingModel(false);
    }
  };

  const fetchFeasibilityResult = async () => {
    if (!workspaceHash) return;
    try {
      const { safeFetchJson } = await import('../utils/safeFetch');
      const data = await safeFetchJson(`/api/feasibility/result/${workspaceHash}`);
      if (data.success && data.data) {
        setFeasibility(data.data);
      } else {
        setFeasibility(null);
      }
    } catch (err: any) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchCapabilityModel();
    fetchFeasibilityResult();
  }, [workspaceHash]);

  const handleRunProbe = async (key?: string) => {
    setProbingKey(key || 'all');
    setError(null);
    try {
      const { safeFetchJson } = await import('../utils/safeFetch');
      const data = await safeFetchJson('/api/feasibility/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      if (data.success) {
        setCapabilityModel(data.model || data.data);
      }
    } catch (err: any) {
      setError(err.message || '运行探针出现错误');
    } finally {
      setProbingKey(null);
    }
  };

  const handleEvaluateFeasibility = async () => {
    if (!workspaceHash) return;
    setEvaluating(true);
    setError(null);
    try {
      const { safeFetchJson } = await import('../utils/safeFetch');
      const data = await safeFetchJson('/api/feasibility/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceHash }),
      });
      if (!data.success) throw new Error(data.error || '评估可移植性失败');
      setFeasibility(data.data);
      if (onModelCallTriggered) onModelCallTriggered();
    } catch (err: any) {
      setError(err.message || '评估过程出错');
    } finally {
      setEvaluating(false);
    }
  };

  const handleRunDryRun = async () => {
    if (!workspaceHash) return;
    setDryRunning(true);
    setError(null);
    try {
      const { safeFetchJson } = await import('../utils/safeFetch');
      const data = await safeFetchJson('/api/adapters/dry-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceHash }),
      });
      if (!data.success) throw new Error(data.error || 'DRY-RUN 校验失败');
      setDryRunResult(data.data);
    } catch (err: any) {
      setError(err.message || 'DRY-RUN 预演失败');
    } finally {
      setDryRunning(false);
    }
  };

  if (!workspaceHash) {
    return (
      <div className="max-w-4xl mx-auto py-12 text-center space-y-4">
        <Cpu className="w-12 h-12 text-slate-600 mx-auto" />
        <h2 className="text-lg font-semibold text-slate-300">暂无载入的工作空间</h2>
        <p className="text-xs text-slate-500">请先在“导入”页面导入一个项目空间。</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* 头部标题与全量测试控制 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Cpu className="w-6 h-6 text-sky-400" />
            平台可移植性判定与适配器引擎 (Adapters & Feasibility)
          </h1>
          <p className="text-slate-400 text-xs mt-1">
            由数据和格式驱动的可移植性决策，支持实时探针、整包裁决与 DRY-RUN 预演
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => handleRunProbe()}
            disabled={probingKey !== null}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-medium rounded-xl transition-colors flex items-center gap-2"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${probingKey === 'all' ? 'animate-spin' : ''}`} />
            <span>全量运行探针</span>
          </button>

          <button
            onClick={handleEvaluateFeasibility}
            disabled={evaluating}
            className="px-5 py-2 py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-medium text-xs rounded-xl transition-colors flex items-center gap-2 shadow-lg shadow-sky-950"
          >
            {evaluating ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4 fill-white" />
            )}
            <span>{evaluating ? '正在计算移植性裁决...' : '重新执行全量移植性评估'}</span>
          </button>
        </div>
      </div>

      {error && <div className="p-4 bg-rose-950 text-rose-300 text-xs rounded-xl">{error}</div>}

      {/* 1. 声明式平台能力拓扑字典 (Capability Model) */}
      <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-700/60 pb-3">
          <div>
            <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              <Layers className="w-5 h-5 text-sky-400" />
              1. 声明式平台能力拓扑字典 (Capability Model)
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              必须具备官方文档引用 (Doc) 或实时探针测试 (Probe) 结果才能标记为 [已支持]
            </p>
          </div>
          <span className="text-xs font-mono text-slate-400">
            已载入 {Object.keys(capabilityModel).length} 项能力定义
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs font-mono">
            <thead>
              <tr className="border-b border-slate-700 text-slate-400 text-[11px]">
                <th className="py-2.5 px-3">能力标识 (Key)</th>
                <th className="py-2.5 px-3">名称与分类</th>
                <th className="py-2.5 px-3">当前状态</th>
                <th className="py-2.5 px-3">依据来源</th>
                <th className="py-2.5 px-3">文档引用 / 探针结果</th>
                <th className="py-2.5 px-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {Object.values(capabilityModel).map((cap) => (
                <tr key={cap.key} className="hover:bg-slate-900/50 transition-colors">
                  <td className="py-2.5 px-3 font-bold text-sky-300">{cap.key}</td>
                  <td className="py-2.5 px-3">
                    <div className="font-sans text-slate-200 font-semibold">{cap.name}</div>
                    <div className="text-[10px] text-slate-500">{cap.category}</div>
                  </td>
                  <td className="py-2.5 px-3">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        cap.status === 'supported'
                          ? 'bg-emerald-950 border border-emerald-800 text-emerald-400'
                          : cap.status === 'unsupported'
                          ? 'bg-rose-950 border border-rose-800 text-rose-400'
                          : 'bg-slate-900 border border-slate-800 text-slate-400'
                      }`}
                    >
                      {cap.status === 'supported'
                        ? '[已支持]'
                        : cap.status === 'unsupported'
                        ? '[未支持]'
                        : '[未知]'}
                    </span>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="px-2 py-0.5 bg-slate-900 border border-slate-800 rounded text-[10px] text-slate-400">
                      {cap.source === 'doc' ? '官方文档' : cap.source === 'probe' ? '实时探针' : '配置声明'}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-[11px] text-slate-400 max-w-xs truncate" title={cap.probe_result || cap.doc_ref}>
                    {cap.probe_result || cap.doc_ref || '无凭据引用'}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <button
                      onClick={() => handleRunProbe(cap.key)}
                      disabled={probingKey !== null}
                      className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-sky-300 rounded text-[11px] font-sans transition-colors"
                    >
                      {probingKey === cap.key ? '测试中...' : '运行探针'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 2. 整包移植性裁决 & 用户功能损失列表 */}
      {feasibility && (
        <div className="space-y-6">
          <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-700/60 pb-4">
              <div>
                <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  2. 确定性整包移植性判定 (Package Verdict & User Loss List)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  由代码确定性聚合逐单元裁决计算得出
                </p>
              </div>

              <span
                className={`px-4 py-1.5 rounded-xl font-mono text-sm font-bold border ${
                  feasibility.packageVerdict === '可直接移植'
                    ? 'bg-emerald-950 border-emerald-800 text-emerald-300'
                    : feasibility.packageVerdict === '需改写'
                    ? 'bg-amber-950 border-amber-800 text-amber-300'
                    : 'bg-rose-950 border-rose-800 text-rose-300'
                }`}
              >
                整包判定: {feasibility.packageVerdict}
              </span>
            </div>

            {/* 总体数据汇总 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
              <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
                <div className="text-slate-400 font-sans">可直接移植单元</div>
                <div className="text-2xl font-bold text-emerald-400 mt-1">
                  {feasibility.summary.directPortableCount} <span className="text-xs font-sans text-slate-500">个</span>
                </div>
              </div>

              <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
                <div className="text-slate-400 font-sans">需改写单元</div>
                <div className="text-2xl font-bold text-amber-400 mt-1">
                  {feasibility.summary.needRewriteCount} <span className="text-xs font-sans text-slate-500">个</span>
                </div>
              </div>

              <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
                <div className="text-slate-400 font-sans">不可移植单元</div>
                <div className="text-2xl font-bold text-rose-400 mt-1">
                  {feasibility.summary.nonPortableCount} <span className="text-xs font-sans text-slate-500">个</span>
                </div>
              </div>

              <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
                <div className="text-slate-400 font-sans">未知状态单元</div>
                <div className="text-2xl font-bold text-slate-400 mt-1">
                  {feasibility.summary.unknownCount} <span className="text-xs font-sans text-slate-500">个</span>
                </div>
              </div>
            </div>

            {/* 用户功能损失列表 */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
              <h4 className="text-xs font-semibold text-amber-400 font-mono flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" />
                <span>用户功能损失列表 (What the User Loses)</span>
              </h4>
              {feasibility.userLossList.length === 0 ? (
                <div className="p-3 bg-emerald-950/40 border border-emerald-800/60 rounded-lg text-emerald-300 text-xs">
                  ✓ 纯天然匹配：项目可在本平台完整运行，无任何已知功能损失！
                </div>
              ) : (
                <ul className="space-y-2 text-xs text-slate-300 font-mono list-disc list-inside">
                  {feasibility.userLossList.map((loss: string, idx: number) => (
                    <li key={idx} className="p-2.5 bg-slate-950 rounded-lg border border-slate-800">
                      {loss}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* 3. 逐单元判定明细 */}
          <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              <Code className="w-5 h-5 text-sky-400" />
              3. 逐单元可移植性判定明细 (Per-Unit Verdicts)
            </h3>

            <div className="space-y-4">
              {feasibility.unitVerdicts.map((uv: UnitFeasibilityVerdict) => (
                <div key={uv.unitPath} className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                    <div>
                      <span className="text-sm font-bold text-sky-300 font-mono">{uv.unitPath}</span>
                      <div className="text-xs text-slate-400 mt-0.5">{uv.reason}</div>
                    </div>

                    <span
                      className={`px-3 py-1 rounded-lg text-xs font-bold font-mono border self-start sm:self-auto ${
                        uv.verdict === '可直接移植'
                          ? 'bg-emerald-950 border-emerald-800 text-emerald-400'
                          : uv.verdict === '需改写'
                          ? 'bg-amber-950 border-amber-800 text-amber-400'
                          : 'bg-rose-950 border-rose-800 text-rose-400'
                      }`}
                    >
                      {uv.verdict}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                    <span className="text-slate-500 font-sans">所需能力依赖:</span>
                    {uv.requiredCapabilities.map((req: string) => (
                      <span
                        key={req}
                        className={`px-2 py-0.5 rounded text-[11px] ${
                          req === uv.blockingCapability
                            ? 'bg-rose-950 text-rose-300 border border-rose-800 font-bold'
                            : 'bg-slate-950 text-slate-300 border border-slate-800'
                        }`}
                      >
                        {req}
                      </span>
                    ))}
                  </div>

                  {uv.rewritePlan && (
                    <div className="p-3 bg-amber-950/20 border border-amber-800/60 rounded-lg text-xs text-amber-200 font-mono space-y-1">
                      <div className="font-bold text-amber-400 font-sans">改写方案指示 (Rewrite Plan)</div>
                      {uv.rewritePlan.map((p: string, i: number) => (
                        <div key={i}>{p}</div>
                      ))}
                    </div>
                  )}

                  <div className="pt-1 flex items-center justify-between">
                    <EvidenceTagBadge tag={uv.evidenceTags[0]} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 4. 执行后端与 DRY-RUN 验证预演 */}
      <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-700/60 pb-4">
          <div>
            <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              <Terminal className="w-5 h-5 text-indigo-400" />
              4. 适配器模式生成与 DRY-RUN 配置校验
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              按格式标记构建适配规则，预演生成 Backend Config JSON 并安全检查硬编码密钥
            </p>
          </div>

          <button
            onClick={handleRunDryRun}
            disabled={dryRunning}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-xs rounded-xl transition-colors flex items-center gap-2 shadow-lg shadow-indigo-950"
          >
            {dryRunning ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4 fill-white" />
            )}
            <span>{dryRunning ? '正在预演 DRY-RUN 校验...' : '执行 DRY-RUN 预演校验'}</span>
          </button>
        </div>

        {dryRunResult && (
          <div className="space-y-6 font-mono text-xs">
            {/* 选定后端与安全审计卡片 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-2">
                <div className="text-slate-400 font-sans">选定执行后端 (Execution Backend)</div>
                <div className="text-base font-bold text-sky-400 capitalize">
                  {dryRunResult.plan.selectedBackend}
                </div>
                {dryRunResult.plan.fallbackReason && (
                  <div className="text-[11px] text-amber-400 font-sans">
                    回退原因: {dryRunResult.plan.fallbackReason}
                  </div>
                )}
              </div>

              <div
                className={`p-4 rounded-xl border flex flex-col justify-between space-y-2 ${
                  dryRunResult.backendConfig.security_audit.no_embedded_secrets
                    ? 'bg-emerald-950/30 border-emerald-800/60'
                    : 'bg-rose-950/30 border-rose-800/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-slate-300 font-sans font-semibold">安全与密钥嵌入审计</span>
                  {dryRunResult.backendConfig.security_audit.no_embedded_secrets ? (
                    <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  ) : (
                    <ShieldAlert className="w-5 h-5 text-rose-400" />
                  )}
                </div>
                <div className="text-sm font-bold">
                  {dryRunResult.backendConfig.security_audit.no_embedded_secrets
                    ? '[未硬编码密钥 · 安全无虞]'
                    : `[检出 ${dryRunResult.backendConfig.security_audit.literal_secrets_found.length} 处密钥明文]`}
                </div>
              </div>
            </div>

            {/* 校验消息汇总 */}
            <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-1 text-slate-300 font-sans">
              <div className="font-semibold text-slate-400 mb-2">DRY-RUN 校验报告项:</div>
              {dryRunResult.messages.map((msg: string, i: number) => (
                <div key={i} className="text-xs">
                  {msg}
                </div>
              ))}
            </div>

            {/* Backend Config JSON */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-300 font-sans">
                生成的 Backend Config JSON (Dry-Run Configuration)
              </div>
              <pre className="p-4 bg-slate-950 text-emerald-400 rounded-xl border border-slate-800 overflow-x-auto max-h-72">
                {JSON.stringify(dryRunResult.backendConfig, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
