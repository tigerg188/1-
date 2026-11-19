import React, { useState, useEffect } from 'react';
import { BlueprintData, TopologyNode, TopologyEdge } from '../types';
import { EvidenceTagBadge } from '../components/EvidenceTagBadge';
import { ModelSelector } from '../components/ModelSelector';
import {
  Brain,
  Play,
  RefreshCw,
  Layers,
  GitBranch,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  FileCheck,
  HelpCircle,
  Code,
  Copy,
  Check,
  Zap,
  AlertTriangle,
} from 'lucide-react';

interface BlueprintPageProps {
  workspaceHash: string | null;
  onModelCallTriggered?: () => void;
}

export const BlueprintPage: React.FC<BlueprintPageProps> = ({
  workspaceHash,
  onModelCallTriggered,
}) => {
  const [blueprint, setBlueprint] = useState<BlueprintData | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<
    'l0' | 'l1' | 'l2' | 'l3' | 'reconcile' | 'verification' | 'counterexamples' | 'coverage'
  >('l0');

  const [copiedMermaid, setCopiedMermaid] = useState(false);

  const fetchBlueprint = async () => {
    if (!workspaceHash) return;
    setLoading(true);
    setError(null);
    try {
      const { safeFetchJson } = await import('../utils/safeFetch');
      const data = await safeFetchJson(`/api/blueprint/${workspaceHash}`);
      if (data.success && data.data) {
        setBlueprint(data.data);
      } else {
        setBlueprint(null);
      }
    } catch (err: any) {
      setError(err.message || '获取蓝图失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBlueprint();
  }, [workspaceHash]);

  const handleStartAnalysis = async (options?: { forceRetry?: boolean; modelId?: string }) => {
    if (!workspaceHash) return;
    setAnalyzing(true);
    setError(null);
    try {
      const { safeFetchJson } = await import('../utils/safeFetch');
      const data = await safeFetchJson('/api/blueprint/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceHash,
          forceRetry: Boolean(options?.forceRetry),
          modelId: options?.modelId,
        }),
      });
      if (!data.success) throw new Error(data.error || '蓝图分析失败');
      setBlueprint(data.data);
      if (onModelCallTriggered) onModelCallTriggered();
    } catch (err: any) {
      setError(err.message || '分析过程遭遇错误');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleQuickSwitchAndRetry = async (targetModelId: string) => {
    setAnalyzing(true);
    setError(null);
    try {
      const { safeFetchJson } = await import('../utils/safeFetch');
      await safeFetchJson('/api/models/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: targetModelId }),
      });
      await safeFetchJson('/api/models/reset-cooldown', { method: 'POST' });
      const data = await safeFetchJson('/api/blueprint/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceHash,
          forceRetry: true,
          modelId: targetModelId,
        }),
      });
      if (!data.success) throw new Error(data.error || '蓝图分析失败');
      setBlueprint(data.data);
      if (onModelCallTriggered) onModelCallTriggered();
    } catch (err: any) {
      setError(err.message || '重试分析失败');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleClearCooldownAndRetry = async () => {
    setAnalyzing(true);
    setError(null);
    try {
      const { safeFetchJson } = await import('../utils/safeFetch');
      await safeFetchJson('/api/models/reset-cooldown', { method: 'POST' });
      const data = await safeFetchJson('/api/blueprint/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceHash,
          forceRetry: true,
        }),
      });
      if (!data.success) throw new Error(data.error || '蓝图分析失败');
      setBlueprint(data.data);
      if (onModelCallTriggered) onModelCallTriggered();
    } catch (err: any) {
      setError(err.message || '重试分析失败');
    } finally {
      setAnalyzing(false);
    }
  };

  if (!workspaceHash) {
    return (
      <div className="max-w-4xl mx-auto py-12 text-center space-y-4">
        <Brain className="w-12 h-12 text-slate-600 mx-auto" />
        <h2 className="text-lg font-semibold text-slate-300">暂无载入的工作空间</h2>
        <p className="text-xs text-slate-500">请先在“导入”页面导入一个 Agent / Skill 项目。</p>
      </div>
    );
  }

  // 生成 Mermaid 流程拓扑文本
  const generateMermaidText = (nodes: TopologyNode[], edges: TopologyEdge[]) => {
    let text = 'graph TD\n';
    nodes.forEach((n) => {
      text += `  node_${n.id.replace(/[^a-zA-Z0-9]/g, '_')}["${n.label} (${n.role})"]\n`;
    });
    edges.forEach((e) => {
      const fromId = `node_${e.from.replace(/[^a-zA-Z0-9]/g, '_')}`;
      const toId = `node_${e.to.replace(/[^a-zA-Z0-9]/g, '_')}`;
      text += `  ${fromId} -->|${e.type}| ${toId}\n`;
    });
    return text;
  };

  const handleCopyMermaid = () => {
    if (!blueprint) return;
    const text = generateMermaidText(blueprint.l1_topology.nodes, blueprint.l1_topology.edges);
    navigator.clipboard.writeText(text);
    setCopiedMermaid(true);
    setTimeout(() => setCopiedMermaid(false), 2000);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* 头部标题与分析触发栏 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Brain className="w-6 h-6 text-sky-400" />
            蓝图理解与结构提取引擎 (Blueprint Engine)
          </h1>
          <p className="text-slate-400 text-xs mt-1">
            提取真实设计意图与逻辑架构 (L0~L3 分层隔离)，不假设 Pipeline
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <ModelSelector onModelChanged={() => {}} />

          <button
            onClick={() => handleStartAnalysis()}
            disabled={analyzing}
            className="px-5 py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-medium text-xs rounded-xl transition-colors flex items-center gap-2 shadow-lg shadow-sky-950"
          >
            {analyzing ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4 fill-white" />
            )}
            <span>{analyzing ? '正在逐单元分析与合成蓝图...' : '开始 / 重新生成蓝图分析'}</span>
          </button>
        </div>
      </div>

      {error && !error.includes('429') && !error.includes('限流') && (
        <div className="p-4 bg-rose-950 text-rose-300 text-xs rounded-xl">{error}</div>
      )}

      {/* 429 限流 / 冷却期快捷恢复面板 */}
      {((blueprint?.synthesisNote &&
        (blueprint.synthesisNote.includes('限流') ||
          blueprint.synthesisNote.includes('429') ||
          blueprint.synthesisNote.includes('冷却') ||
          blueprint.synthesisNote.includes('配额') ||
          blueprint.synthesisNote.includes('RESOURCE_EXHAUSTED'))) ||
        (error &&
          (error.includes('限流') ||
            error.includes('429') ||
            error.includes('冷却') ||
            error.includes('配额') ||
            error.includes('RESOURCE_EXHAUSTED')))) && (
        <div className="p-4 bg-amber-950/60 border border-amber-600/70 rounded-xl text-amber-200 text-xs space-y-3 shadow-lg">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-semibold text-amber-100 text-sm">
                模型限流保护提示与快捷恢复通道
              </div>
              <div className="text-amber-200/90 leading-relaxed">
                {blueprint?.synthesisNote || error}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-amber-800/50">
            <button
              onClick={() => handleClearCooldownAndRetry()}
              disabled={analyzing}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-medium text-xs rounded-lg transition-colors flex items-center gap-1.5 shadow"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${analyzing ? 'animate-spin' : ''}`} />
              <span>清除冷却锁并强制重试</span>
            </button>

            <button
              onClick={() => handleQuickSwitchAndRetry('gemini-3.1-flash-lite')}
              disabled={analyzing}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium text-xs rounded-lg transition-colors flex items-center gap-1.5 shadow"
            >
              <Zap className="w-3.5 h-3.5 text-white" />
              <span>切换为 Gemini 3.1 Flash Lite 并重试 (配额充裕/低延迟)</span>
            </button>

            <button
              onClick={() => handleQuickSwitchAndRetry('gemini-flash-latest')}
              disabled={analyzing}
              className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-medium text-xs rounded-lg transition-colors flex items-center gap-1.5 shadow"
            >
              <Play className="w-3.5 h-3.5 fill-white" />
              <span>切换为 Gemini Flash Latest 并重试</span>
            </button>
          </div>
          <div className="text-[11px] text-amber-300/70">
            提示：若免费层配额已耗尽，可前往界面右上角的 <strong>Settings &gt; Secrets</strong> 切换包含计费账户的 API Key 提升限制。
          </div>
        </div>
      )}

      {loading && !blueprint && (
        <div className="py-12 text-center text-slate-400 text-xs font-mono">
          <div className="inline-block animate-spin w-6 h-6 border-2 border-sky-400 border-t-transparent rounded-full mb-2" />
          <div>读取已有 blueprint.json...</div>
        </div>
      )}

      {!blueprint && !loading && !analyzing && (
        <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-8 text-center space-y-4">
          <Brain className="w-12 h-12 text-slate-600 mx-auto" />
          <h3 className="text-base font-semibold text-slate-300">当前工作空间尚未生成蓝图</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            点击上方“开始 / 重新生成蓝图分析”按钮，启动多步模型分析与代码校验对账流水线。
          </p>
        </div>
      )}

      {blueprint && (
        <div className="space-y-6">
          {blueprint.synthesisNote &&
            blueprint.synthesisStatus !== 'model' &&
            !blueprint.synthesisNote.includes('限流') &&
            !blueprint.synthesisNote.includes('429') &&
            !blueprint.synthesisNote.includes('冷却') && (
              <div className="p-4 bg-amber-950/50 border border-amber-700/60 rounded-xl text-amber-200 text-xs">
                <strong>蓝图状态说明：</strong> {blueprint.synthesisNote}
              </div>
            )}
          {/* 顶栏概览指标卡 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4">
              <div className="text-slate-400 font-sans">L1 拓扑节点 / 边</div>
              <div className="text-xl font-bold text-slate-100 mt-1">
                {blueprint.l1_topology.nodes.length} <span className="text-xs text-slate-500 font-sans">节点 /</span> {blueprint.l1_topology.edges.length} <span className="text-xs text-slate-500 font-sans">边</span>
              </div>
            </div>

            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4">
              <div className="text-slate-400 font-sans">证据强校验率</div>
              <div className="text-xl font-bold text-emerald-400 mt-1">
                [{blueprint.evidence_verification.verificationRate}%]
              </div>
            </div>

            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4">
              <div className="text-slate-400 font-sans">工程代码全读率</div>
              <div className="text-xl font-bold text-sky-400 mt-1">
                {blueprint.coverage_table.overallCoveragePercentage}%
              </div>
            </div>

            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4">
              <div className="text-slate-400 font-sans">LLM 分析调用数</div>
              <div className="text-xl font-bold text-indigo-400 mt-1">
                {blueprint.modelCallsCount} <span className="text-xs text-slate-500 font-sans">次</span>
              </div>
            </div>
          </div>

          {/* F3 诚实化汇总横幅 */}
          {blueprint.reconciliation_report && (
            <div className="p-4 bg-slate-900 border border-slate-700/80 rounded-xl flex flex-wrap items-center justify-between gap-4 text-xs font-mono">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-sans font-semibold text-slate-200">
                  共 {blueprint.reconciliation_report.totalUnitCandidates} 个单元：
                </span>
                <span className="text-emerald-400">
                  模型生成 {blueprint.reconciliation_report.modelGeneratedCount || blueprint.reconciliation_report.modelUnderstoodCount || 0} 个
                </span>
                <span className="text-amber-400">
                  代码规则回退 {blueprint.reconciliation_report.ruleFallbackCount || 0} 个
                </span>
                <span className="text-rose-400">
                  模型失败 {blueprint.reconciliation_report.failedCount || 0} 个
                </span>
              </div>
              <div className="text-slate-400 text-[11px]">
                未连接孤立单元: {blueprint.reconciliation_report.unconnectedUnits?.length || 0} 个
              </div>
            </div>
          )}

          {/* 子功能导航页签 */}
          <div className="flex items-center gap-1 bg-slate-900/80 p-1 border border-slate-800 rounded-xl text-xs overflow-x-auto no-scrollbar">
            <button
              onClick={() => setActiveSubTab('l0')}
              className={`px-3.5 py-2 font-medium rounded-lg transition-colors whitespace-nowrap ${
                activeSubTab === 'l0' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              L0 意图层
            </button>
            <button
              onClick={() => setActiveSubTab('l1')}
              className={`px-3.5 py-2 font-medium rounded-lg transition-colors whitespace-nowrap ${
                activeSubTab === 'l1' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              L1 包拓扑图 ({blueprint.l1_topology.nodes.length})
            </button>
            <button
              onClick={() => setActiveSubTab('l2')}
              className={`px-3.5 py-2 font-medium rounded-lg transition-colors whitespace-nowrap ${
                activeSubTab === 'l2' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              L2 单元工作流 ({Object.keys(blueprint.unit_cards).length})
            </button>
            <button
              onClick={() => setActiveSubTab('l3')}
              className={`px-3.5 py-2 font-medium rounded-lg transition-colors whitespace-nowrap ${
                activeSubTab === 'l3' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              L3 交付规则
            </button>
            <button
              onClick={() => setActiveSubTab('reconcile')}
              className={`px-3.5 py-2 font-medium rounded-lg transition-colors whitespace-nowrap ${
                activeSubTab === 'reconcile' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              代码对账报告
            </button>
            <button
              onClick={() => setActiveSubTab('verification')}
              className={`px-3.5 py-2 font-medium rounded-lg transition-colors whitespace-nowrap ${
                activeSubTab === 'verification' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              证据校验明细
            </button>
            <button
              onClick={() => setActiveSubTab('counterexamples')}
              className={`px-3.5 py-2 font-medium rounded-lg transition-colors whitespace-nowrap ${
                activeSubTab === 'counterexamples' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              反例与矛盾检索
            </button>
            <button
              onClick={() => setActiveSubTab('coverage')}
              className={`px-3.5 py-2 font-medium rounded-lg transition-colors whitespace-nowrap ${
                activeSubTab === 'coverage' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              覆盖率与探针
            </button>
          </div>

          {/* L0 意图层 */}
          {activeSubTab === 'l0' && (
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-6 space-y-6">
              <div className="space-y-2">
                <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                  <Brain className="w-5 h-5 text-sky-400" />
                  L0 核心意图与适用目标 (Intent)
                </h3>
                <p className="text-xs text-slate-400">项目作者显式声明的最终目标、使用者人群与非目标</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-2">
                  <div className="text-xs font-semibold text-sky-400">系统核心用途 (Purpose)</div>
                  <div className="text-sm text-slate-200">{blueprint.l0_intent.purpose}</div>
                </div>

                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-2">
                  <div className="text-xs font-semibold text-emerald-400">预期目标使用者 (Intended Users)</div>
                  <div className="flex flex-wrap gap-2">
                    {blueprint.l0_intent.intended_users.map((u, i) => (
                      <span key={i} className="px-2.5 py-1 bg-slate-800 text-slate-200 rounded-lg text-xs">
                        {u}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="text-xs font-semibold text-slate-300">作者显式原话声明 (Author Statements)</div>
                {blueprint.l0_intent.author_statements.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">未查找到明确原话声明</p>
                ) : (
                  <div className="space-y-2">
                    {blueprint.l0_intent.author_statements.map((st, idx) => (
                      <div key={idx} className="p-3 bg-slate-950 rounded-lg border border-slate-800/80 space-y-1.5">
                        <div className="text-xs text-slate-200 font-mono">"{st.statement}"</div>
                        <EvidenceTagBadge tag={st.evidence} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* L1 包拓扑图 */}
          {activeSubTab === 'l1' && (
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-6 space-y-6">
              <div className="flex items-center justify-between border-b border-slate-700/60 pb-3">
                <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                  <GitBranch className="w-5 h-5 text-sky-400" />
                  L1 包拓扑依赖关系 (Package Topology)
                </h3>
                <button
                  onClick={handleCopyMermaid}
                  className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs rounded-lg flex items-center gap-1.5 transition-colors"
                >
                  {copiedMermaid ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedMermaid ? '已复制 Mermaid' : '复制 Mermaid 语法'}</span>
                </button>
              </div>

              {/* SVG 可视化节点拓扑树 */}
              <div className="bg-slate-950 p-6 rounded-xl border border-slate-800 overflow-x-auto min-h-[220px] flex items-center justify-center">
                <div className="flex flex-wrap items-center justify-center gap-6 max-w-3xl">
                  {blueprint.l1_topology.nodes.map((node) => (
                    <div
                      key={node.id}
                      className="p-3 bg-slate-900 border border-slate-700 rounded-xl space-y-1 min-w-[140px] text-center shadow-lg"
                    >
                      <div className="text-xs font-bold text-slate-100">{node.label}</div>
                      <div className="text-[10px] font-mono px-2 py-0.5 bg-sky-950 text-sky-400 border border-sky-800 rounded inline-block">
                        {node.role}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 边关系表格 */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-slate-300 font-mono">
                  拓扑边依赖流 (Topology Edges)
                </h4>
                <div className="space-y-2 font-mono text-xs">
                  {blueprint.l1_topology.edges.length === 0 ? (
                    <p className="text-xs text-slate-500 italic">无显式跨模块边依赖</p>
                  ) : (
                    blueprint.l1_topology.edges.map((edge, idx) => (
                      <div
                        key={idx}
                        className="p-3 bg-slate-900 border border-slate-800 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sky-300 font-semibold">{edge.from}</span>
                          <span className="text-amber-400 text-[11px] px-2 py-0.5 bg-amber-950 border border-amber-800 rounded">
                            --{edge.type}--&gt;
                          </span>
                          <span className="text-emerald-300 font-semibold">{edge.to}</span>
                        </div>
                        <EvidenceTagBadge tag={edge.evidence} />
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* L2 单元工作流 */}
          {activeSubTab === 'l2' && (
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-6 space-y-6">
              <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                <Layers className="w-5 h-5 text-emerald-400" />
                L2 单元内部流程与属性 (Per-Unit Workflows)
              </h3>

              <div className="space-y-6">
                {Object.values(blueprint.unit_cards).map((card) => (
                  <div key={card.unitPath} className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                      <div>
                        <span className="text-sm font-bold text-emerald-400 font-mono">{card.unitPath}</span>
                        <div className="text-xs text-slate-400 mt-0.5">{card.purpose}</div>
                        {card.analysisNote && (
                          <div className="text-[11px] text-amber-300 mt-1">{card.analysisNote}</div>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-mono px-2.5 py-1 bg-slate-800 text-sky-300 border border-slate-700 rounded-lg">
                          Role: {card.role} {card.roleSource ? `[${card.roleSource}]` : ''}
                        </span>
                        <span className="text-xs font-mono px-2.5 py-1 bg-slate-800 text-purple-300 border border-slate-700 rounded-lg">
                          独立声明: {String(card.declared_independence ?? '未知')}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
                      <div className="p-3 bg-slate-950 rounded-lg space-y-1">
                        <div className="text-slate-400 font-sans font-semibold">触发/使用条件 (When to Use)</div>
                        <div className="text-slate-200">
                          {card.activation_conditions.when_to_use.join(', ') || '[未知]'}
                        </div>
                      </div>
                      <div className="p-3 bg-slate-950 rounded-lg space-y-1">
                        <div className="text-slate-400 font-sans font-semibold">不推荐条件 (When NOT to Use)</div>
                        <div className="text-slate-400">
                          {card.activation_conditions.when_not_to_use.join(', ') || '[未知]'}
                        </div>
                      </div>
                    </div>

                    {/* 单元内部步骤 (L2 Steps) */}
                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-slate-300 font-sans">
                        内部执行步骤 (Internal Workflow Steps)
                      </div>
                      {card.l2_internal_workflow.length === 0 ? (
                        <p className="text-xs text-slate-500 italic">无多步内部流程记录</p>
                      ) : (
                        <div className="space-y-2">
                          {card.l2_internal_workflow.map((st) => (
                            <div
                              key={st.stepIndex}
                              className="p-2.5 bg-slate-950 border border-slate-800/80 rounded-lg text-xs flex items-center justify-between"
                            >
                              <div className="flex items-center gap-2">
                                <span className="w-5 h-5 rounded-full bg-slate-800 text-sky-400 flex items-center justify-center font-bold text-[10px]">
                                  {st.stepIndex}
                                </span>
                                <span className="text-slate-200">{st.description}</span>
                              </div>
                              <EvidenceTagBadge tag={st.evidence} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* L3 交付规则 */}
          {activeSubTab === 'l3' && (
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-6 space-y-6">
              <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                <FileCheck className="w-5 h-5 text-indigo-400" />
                L3 交付物与验收规则 (Delivery Rules)
              </h3>

              <div className="space-y-4">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                  <div className="text-xs font-semibold text-slate-300">验收判定规则 (Acceptance Rules)</div>
                  {blueprint.l3_delivery_rules.acceptance_rules.length === 0 ? (
                    <p className="text-xs text-slate-500 italic">未找到明确验收规则声明</p>
                  ) : (
                    blueprint.l3_delivery_rules.acceptance_rules.map((ruleItem, idx) => (
                      <div key={idx} className="p-3 bg-slate-950 rounded-lg border border-slate-800 flex items-center justify-between text-xs">
                        <span className="text-slate-200">{ruleItem.rule}</span>
                        <EvidenceTagBadge tag={ruleItem.evidence} />
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 代码对账报告 */}
          {activeSubTab === 'reconcile' && (
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-6 space-y-6 font-mono text-xs">
              <h3 className="text-base font-semibold text-slate-100 font-sans flex items-center gap-2">
                <Code className="w-5 h-5 text-sky-400" />
                代码对账报告 (Reconciliation Report - Pure Code)
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-2">
                  <div className="text-slate-400 font-sans">单元候选归属度</div>
                  <div className="text-lg font-bold text-slate-100">
                    {blueprint.reconciliation_report.classifiedNodesCount} / {blueprint.reconciliation_report.totalUnitCandidates} <span className="text-xs font-sans text-slate-400">个候选匹配节点</span>
                  </div>
                </div>

                <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-2">
                  <div className="text-slate-400 font-sans">边端点合法性</div>
                  <div className="text-lg font-bold text-emerald-400">
                    {blueprint.reconciliation_report.allEdgeEndpointsExist ? '100% 端点合法' : `${blueprint.reconciliation_report.invalidEdgesCount} 处端点失效`}
                  </div>
                </div>
              </div>

              <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-3">
                <div className="text-slate-300 font-sans font-semibold">角色统计分布 (Role Counts)</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {Object.entries(blueprint.reconciliation_report.roleCounts).map(([role, count]) => (
                    <div key={role} className="p-2.5 bg-slate-950 border border-slate-800 rounded-lg">
                      <div className="text-sky-400 font-bold">{role}</div>
                      <div className="text-slate-200 mt-0.5">{count} 个模块</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 证据校验明细 */}
          {activeSubTab === 'verification' && (
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  证据强校验分析 (Evidence Verification Report)
                </h3>
                <span className="text-xs font-mono font-bold px-3 py-1 bg-emerald-950 border border-emerald-800 text-emerald-400 rounded-lg">
                  验证通过率: {blueprint.evidence_verification.verificationRate}%
                </span>
              </div>

              <div className="space-y-2 font-mono text-xs">
                {blueprint.evidence_verification.tags.map((item, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded-lg border ${
                      item.verified
                        ? 'bg-emerald-950/30 border-emerald-800/60 text-slate-200'
                        : 'bg-slate-900 border-slate-800 text-slate-400'
                    } space-y-1`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {item.verified ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 text-slate-500 shrink-0" />
                        )}
                        <span className="font-bold">{item.tag.filePath || '全局/表达'}</span>
                      </div>
                      <span className="text-[11px] text-slate-400">{item.reason}</span>
                    </div>
                    {item.tag.quote && (
                      <div className="text-[11px] text-slate-300 bg-slate-950 p-2 rounded border border-slate-800">
                        "{item.tag.quote}"
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 反例与矛盾检索 */}
          {activeSubTab === 'counterexamples' && (
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-6 space-y-4">
              <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                <HelpCircle className="w-5 h-5 text-amber-400" />
                硬性依赖反例与矛盾检索 (Counterexample Pass)
              </h3>

              <div className="space-y-3 font-mono text-xs">
                {blueprint.counterexamples.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">未发现必须反向搜索的顺序或依赖拓扑</p>
                ) : (
                  blueprint.counterexamples.map((ce, idx) => (
                    <div
                      key={idx}
                      className={`p-4 rounded-xl border space-y-2 ${
                        ce.contradictionFound
                          ? 'bg-rose-950/40 border-rose-800 text-rose-200'
                          : 'bg-slate-900 border-slate-800 text-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sky-400">{ce.claim}</span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            ce.status === '未测试' || ce.status === '模型调用失败'
                              ? 'bg-slate-800 border border-slate-700 text-slate-300'
                              : ce.contradictionFound
                              ? 'bg-rose-950 border border-rose-800 text-rose-400'
                              : 'bg-emerald-950 border border-emerald-800 text-emerald-400'
                          }`}
                        >
                          {ce.status === '未测试'
                            ? '未测试'
                            : ce.status === '模型调用失败'
                            ? '模型调用失败'
                            : ce.contradictionFound
                            ? '发现反例'
                            : '已检索未见冲突'}
                        </span>
                      </div>
                      <div className="text-slate-400 text-[11px] font-sans">{ce.explanation}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* 覆盖率与探针 */}
          {activeSubTab === 'coverage' && (
            <div className="space-y-6">
              {/* 文件全读率 */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-6 space-y-4 font-mono text-xs">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <h3 className="text-base font-semibold text-slate-100 font-sans">
                    工程文件阅读覆盖率 (File Coverage Table)
                  </h3>
                  <span className="text-sm font-bold text-sky-400">
                    总体全读率: {blueprint.coverage_table.overallCoveragePercentage}%
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-700 text-slate-400 text-[11px]">
                        <th className="py-2 px-3">文件路径</th>
                        <th className="py-2 px-3">状态</th>
                        <th className="py-2 px-3">已读 / 总行数</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {blueprint.coverage_table.files.map((file) => (
                        <tr key={file.filePath}>
                          <td className="py-2 px-3 text-sky-300">{file.filePath}</td>
                          <td className="py-2 px-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] ${
                                file.status === '已读全文'
                                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                  : file.status === '已读部分'
                                  ? 'bg-amber-950 text-amber-400 border border-amber-800'
                                  : 'bg-slate-900 text-slate-500 border border-slate-800'
                              }`}
                            >
                              {file.status}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-slate-400">
                            {file.linesRead} / {file.totalLines} 行
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 意图双路探针 */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-6 space-y-4">
                <h3 className="text-base font-semibold text-slate-100">
                  意图双路探针对比 (Intent Probes)
                </h3>
                <div className="space-y-3 font-mono text-xs">
                  {blueprint.intent_probes.map((probe, idx) => (
                    <div key={idx} className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="font-bold text-sky-300 font-sans">Q: {probe.question}</div>
                        <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 border border-slate-700 text-slate-300">
                          {probe.status || (probe.agrees === null ? '无法判断' : probe.agrees ? '一致' : '不一致')}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
                        <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                          <div className="text-slate-500 font-sans">基于蓝图 JSON 的推导回答:</div>
                          <div className="text-slate-200 mt-0.5">{probe.answerFromBlueprint}</div>
                        </div>
                        <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                          <div className="text-slate-500 font-sans">基于原始源码文件的对齐回答:</div>
                          <div className="text-slate-200 mt-0.5">{probe.answerFromRawFiles}</div>
                        </div>
                      </div>
                      {probe.notes && (
                        <div className="text-[11px] text-amber-300 font-sans">{probe.notes}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
