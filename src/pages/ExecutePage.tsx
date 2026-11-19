import React, { useState, useEffect, useRef } from 'react';
import { ExecutionState } from '../types';
import {
  Play,
  RefreshCw,
  Terminal,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileCode,
  Download,
  Eye,
} from 'lucide-react';

interface ExecutePageProps {
  workspaceHash: string | null;
  onModelCallTriggered?: () => void;
}

const STATUS_LABEL_MAP: Record<ExecutionState['status'], string> = {
  running: '运行中',
  completed: '已完成',
  paused_quota: '额度暂停',
  incomplete: '未完成',
  failed: '执行失败',
};

const STEP_TYPE_LABEL_MAP: Record<string, string> = {
  user_input: '用户输入',
  thought: '进度调度',
  tool_call: '工具调用',
  model_output: '模型生成',
  artifact_generated: '产物落盘',
  error: '执行异常',
};

export const ExecutePage: React.FC<ExecutePageProps> = ({
  workspaceHash,
  onModelCallTriggered,
}) => {
  const [taskText, setTaskText] = useState('');
  const [testMode, setTestMode] = useState(true);
  const [tokenBudget, setTokenBudget] = useState(10000);
  const [execState, setExecState] = useState<ExecutionState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewArtifact, setPreviewArtifact] = useState<{
    fileName: string;
    content: string;
  } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const prevStatusRef = useRef<ExecutionState['status'] | null>(null);

  const fetchStatus = async (): Promise<ExecutionState | null> => {
    if (!workspaceHash) return null;
    try {
      const { safeFetchJson } = await import('../utils/safeFetch');
      const data = await safeFetchJson(`/api/execute/status/${workspaceHash}`);
      if (data.success && data.data) {
        const nextState = data.data as ExecutionState;
        setExecState(nextState);
        if (nextState.taskText) {
          setTaskText((prev) => (prev.trim() ? prev : nextState.taskText));
        }
        return nextState;
      }
    } catch (err) {
      console.error(err);
    }
    return null;
  };

  useEffect(() => {
    setExecState(null);
    setError(null);
    setPreviewArtifact(null);
    prevStatusRef.current = null;
    fetchStatus();
  }, [workspaceHash]);

  // 当任务处于 running 状态时自动轮询后端进度，避免同步长请求超时
  useEffect(() => {
    if (!workspaceHash || execState?.status !== 'running') return;

    const timer = setInterval(async () => {
      const next = await fetchStatus();
      if (next && next.status !== 'running') {
        if (prevStatusRef.current === 'running' && onModelCallTriggered) {
          onModelCallTriggered();
        }
      }
    }, 1200);

    return () => clearInterval(timer);
  }, [workspaceHash, execState?.status]);

  useEffect(() => {
    prevStatusRef.current = execState?.status ?? null;
  }, [execState?.status]);

  const isRunning = submitting || execState?.status === 'running';

  const handleStartTask = async () => {
    if (!workspaceHash || !taskText.trim() || isRunning) return;
    setSubmitting(true);
    setError(null);
    setPreviewArtifact(null);
    try {
      const { safeFetchJson } = await import('../utils/safeFetch');
      const data = await safeFetchJson('/api/execute/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceHash,
          taskText: taskText.trim(),
          testMode,
          tokenBudget,
        }),
      });
      if (!data.success) throw new Error(data.error || '启动任务失败');
      setExecState(data.data);
      if (data.data?.status !== 'running' && onModelCallTriggered) {
        onModelCallTriggered();
      }
    } catch (err: any) {
      setError(err.message || '执行过程出现异常');
    } finally {
      setSubmitting(false);
    }
  };

  const handleContinueTask = async () => {
    if (!workspaceHash || isRunning) return;
    setSubmitting(true);
    setError(null);
    try {
      const { safeFetchJson } = await import('../utils/safeFetch');
      const data = await safeFetchJson('/api/execute/continue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceHash }),
      });
      if (!data.success) throw new Error(data.error || '继续运行失败');
      setExecState(data.data);
      if (data.data?.status !== 'running' && onModelCallTriggered) {
        onModelCallTriggered();
      }
    } catch (err: any) {
      setError(err.message || '继续运行出现异常');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePreviewArtifact = async (fileName: string) => {
    if (!workspaceHash) return;
    if (previewArtifact?.fileName === fileName) {
      setPreviewArtifact(null);
      return;
    }
    setLoadingPreview(true);
    try {
      const { safeFetchJson } = await import('../utils/safeFetch');
      const data = await safeFetchJson(
        `/api/execute/artifact/${workspaceHash}/${encodeURIComponent(fileName)}`
      );
      if (!data.success) throw new Error(data.error || '读取交付物内容失败');
      setPreviewArtifact({ fileName: data.data.fileName, content: data.data.content });
    } catch (err: any) {
      setError(err.message || '读取交付物失败');
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleDownloadArtifact = async (fileName: string) => {
    if (!workspaceHash) return;
    try {
      const { safeFetchJson } = await import('../utils/safeFetch');
      const data = await safeFetchJson(
        `/api/execute/artifact/${workspaceHash}/${encodeURIComponent(fileName)}`
      );
      if (!data.success) throw new Error(data.error || '下载交付物失败');
      const blob = new Blob([data.data.content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = data.data.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || '下载交付物失败');
    }
  };

  if (!workspaceHash) {
    return (
      <div className="max-w-4xl mx-auto py-12 text-center space-y-4">
        <Terminal className="w-12 h-12 text-slate-600 mx-auto" />
        <h2 className="text-lg font-semibold text-slate-300">暂无载入的工作空间</h2>
        <p className="text-xs text-slate-500">请先在“导入”页面导入一个项目空间。</p>
      </div>
    );
  }

  const budgetDenominator = Math.max(1, execState?.tokenBudget || tokenBudget || 1);
  const budgetPercentage = execState
    ? Math.min(100, Math.round((execState.tokensUsed / budgetDenominator) * 100))
    : 0;

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* 标题栏 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Terminal className="w-6 h-6 text-sky-400" />
            用户任务适配运行引擎
          </h1>
          <p className="text-slate-400 text-xs mt-1">
            纯模型单轮生成执行（注：托管沙盒与真实项目代码执行尚未实现），支持异步进度追踪、账本记录与 429 额度避退
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {(execState?.status === 'paused_quota' || execState?.status === 'incomplete') && (
            <button
              onClick={handleContinueTask}
              disabled={isRunning}
              className="px-4 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-medium text-xs rounded-xl transition-colors flex items-center gap-2 shadow-lg shadow-amber-950"
            >
              <RefreshCw className={`w-4 h-4 ${isRunning ? 'animate-spin' : ''}`} />
              <span>继续运行保存的进度</span>
            </button>
          )}
          <button
            onClick={handleStartTask}
            disabled={isRunning || !taskText.trim()}
            className="px-5 py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-medium text-xs rounded-xl transition-colors flex items-center gap-2 shadow-lg shadow-sky-950"
          >
            {isRunning ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4 fill-white" />
            )}
            <span>{isRunning ? '正在运行纯模型生成...' : '启动纯模型执行'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-950/90 border border-rose-700/70 text-rose-200 text-xs rounded-xl flex items-center gap-3">
          <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {/* 后端失败状态明确提示 */}
      {execState?.status === 'failed' && (
        <div className="p-4 bg-rose-950/80 border border-rose-500/60 rounded-xl flex items-center justify-between gap-4 text-rose-200 text-xs">
          <div className="flex items-center gap-3">
            <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
            <div>
              <div className="font-semibold">任务执行失败</div>
              <div className="text-rose-300 mt-0.5">{execState.statusMessage}</div>
            </div>
          </div>
          {taskText.trim() && (
            <button
              onClick={handleStartTask}
              disabled={isRunning}
              className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-bold shrink-0"
            >
              重新运行
            </button>
          )}
        </div>
      )}

      {/* 未完成中断提示横幅 */}
      {execState?.status === 'incomplete' && (
        <div className="p-4 bg-amber-950/70 border border-amber-500/50 rounded-xl flex items-center justify-between gap-4 text-amber-200 text-xs">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
            <div>
              <div className="font-semibold">检测到未完成的运行进度</div>
              <div className="text-amber-300 mt-0.5">{execState.statusMessage}</div>
            </div>
          </div>
          <button
            onClick={handleContinueTask}
            disabled={isRunning}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-bold shrink-0"
          >
            继续运行
          </button>
        </div>
      )}

      {/* 额度用完中断警告横幅 (遵从 429 规格) */}
      {execState?.status === 'paused_quota' && (
        <div className="p-4 bg-amber-950/80 border border-amber-500/60 rounded-xl flex items-center justify-between gap-4 text-amber-200 text-xs">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
            <div>
              <div className="font-semibold">额度已用完，进度已保存，可稍后继续</div>
              {execState.statusMessage && (
                <div className="text-amber-300/90 mt-0.5">{execState.statusMessage}</div>
              )}
            </div>
          </div>
          <button
            onClick={handleContinueTask}
            disabled={isRunning}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-bold shrink-0"
          >
            继续重试
          </button>
        </div>
      )}

      {/* 运行中实时状态提示条 */}
      {execState?.status === 'running' && (
        <div className="p-4 bg-sky-950/70 border border-sky-500/50 rounded-xl flex items-center gap-3 text-sky-200 text-xs">
          <RefreshCw className="w-5 h-5 text-sky-400 animate-spin shrink-0" />
          <div>
            <div className="font-semibold">任务正在后台运行中，界面将自动刷新最新状态</div>
            <div className="text-sky-300 mt-0.5">{execState.statusMessage}</div>
          </div>
        </div>
      )}

      {/* 任务输入与配置面板 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* 任务输入框 */}
        <div className="md:col-span-2 bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 space-y-3">
          <label className="text-xs font-semibold text-slate-200 flex items-center justify-between">
            <span>用户输入任务描述</span>
            <span className="text-[11px] text-slate-500 font-mono">运行时自由文本</span>
          </label>
          <textarea
            value={taskText}
            onChange={(e) => setTaskText(e.target.value)}
            disabled={isRunning}
            rows={4}
            placeholder="在此输入自定义用户运行任务描述..."
            className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500 font-mono"
          />
        </div>

        {/* 运行参数与实时 Token 仪表 */}
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 space-y-4 font-mono text-xs">
          <h3 className="font-semibold text-slate-200 font-sans flex items-center gap-1.5">
            <Cpu className="w-4 h-4 text-sky-400" />
            <span>运行参数与 Token 预算</span>
          </h3>

          <div className="flex items-center justify-between p-3 bg-slate-900 rounded-lg border border-slate-800">
            <span className="text-slate-300 font-sans">测试模式</span>
            <button
              onClick={() => setTestMode(!testMode)}
              disabled={isRunning}
              className={`px-2.5 py-1 rounded text-[11px] font-bold ${
                testMode
                  ? 'bg-emerald-950 border border-emerald-800 text-emerald-400'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {testMode ? '已开启 (缩减范围)' : '关闭'}
            </button>
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between text-slate-400 font-sans">
              <span>Token 预算上限</span>
              <span>{tokenBudget} Tokens</span>
            </div>
            <input
              type="range"
              min={2000}
              max={50000}
              step={1000}
              disabled={isRunning}
              value={tokenBudget}
              onChange={(e) => setTokenBudget(Number(e.target.value))}
              className="w-full accent-sky-500"
            />
          </div>

          {/* 实时 Token 使用指示条 */}
          {execState && (
            <div className="space-y-1.5 pt-2 border-t border-slate-800">
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-400 font-sans">实时使用进度</span>
                <span className="text-sky-400 font-bold">
                  {execState.tokensUsed} / {execState.tokenBudget} ({budgetPercentage}%)
                </span>
              </div>
              <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden border border-slate-800">
                <div
                  className="bg-sky-500 h-full transition-all duration-300"
                  style={{ width: `${budgetPercentage}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 实时执行终端 */}
      {execState && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3 font-mono text-xs">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-emerald-400" />
              <span className="font-bold text-slate-200 font-sans">执行步骤实时打卡记录</span>
            </div>
            <div className="flex items-center gap-2">
              {execState.statusMessage && (
                <span className="text-[11px] text-slate-400 font-sans truncate max-w-md">
                  {execState.statusMessage}
                </span>
              )}
              <span
                className={`px-2.5 py-0.5 rounded text-[11px] font-bold font-sans ${
                  execState.status === 'completed'
                    ? 'bg-emerald-950 border border-emerald-800 text-emerald-400'
                    : execState.status === 'paused_quota' || execState.status === 'incomplete'
                    ? 'bg-amber-950 border border-amber-800 text-amber-400'
                    : execState.status === 'failed'
                    ? 'bg-rose-950 border border-rose-800 text-rose-400'
                    : 'bg-sky-950 border border-sky-800 text-sky-400'
                }`}
              >
                状态：{STATUS_LABEL_MAP[execState.status] || execState.status}
              </span>
            </div>
          </div>

          <div className="space-y-2.5 font-mono text-xs max-h-96 overflow-y-auto">
            {execState.steps.map((st) => (
              <div
                key={st.stepIndex}
                className={`p-3 bg-slate-950 border rounded-lg space-y-1.5 ${
                  st.stepType === 'error' ? 'border-rose-800/70' : 'border-slate-800/80'
                }`}
              >
                <div className="flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 bg-slate-800 text-sky-400 rounded font-sans">
                      步骤 #{st.stepIndex}
                    </span>
                    <span
                      className={`font-bold font-sans ${
                        st.stepType === 'error' ? 'text-rose-400' : 'text-slate-200'
                      }`}
                    >
                      {STEP_TYPE_LABEL_MAP[st.stepType] || st.stepType}
                    </span>
                  </div>
                  <span className="text-slate-500">{new Date(st.timestamp).toLocaleTimeString()}</span>
                </div>

                <div className="text-slate-300 font-sans text-xs bg-slate-900/90 p-2 rounded border border-slate-800 whitespace-pre-wrap">
                  {st.truncatedInputOutput}
                </div>

                <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1">
                  <span className="font-sans">完整哈希：{st.fullContentHash.slice(0, 16)}...</span>
                  <span>Tokens: {st.tokensUsed}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 产出交付物列表 */}
      {execState && execState.artifacts.length > 0 && (
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 space-y-3 font-mono text-xs">
          <h3 className="font-semibold text-slate-200 font-sans flex items-center gap-2">
            <FileCode className="w-4 h-4 text-emerald-400" />
            <span>收集的产出交付物与哈希登记</span>
          </h3>

          <div className="space-y-2">
            {execState.artifacts.map((art) => (
              <div
                key={art.fileName}
                className="p-3 bg-slate-900 border border-slate-800 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div>
                    <div className="text-slate-200 font-bold">{art.fileName}</div>
                    <div className="text-[11px] text-slate-500">SHA256: {art.sha256}</div>
                  </div>
                </div>

                <div className="flex items-center gap-3 self-end sm:self-center">
                  <div className="text-slate-400 text-right mr-2">
                    <div>{art.size} B</div>
                    <div className="text-[10px] text-slate-500">
                      {new Date(art.createdAt).toLocaleTimeString()}
                    </div>
                  </div>
                  <button
                    onClick={() => handlePreviewArtifact(art.fileName)}
                    disabled={loadingPreview}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-sans text-xs flex items-center gap-1.5 border border-slate-700"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>{previewArtifact?.fileName === art.fileName ? '收起预览' : '查看内容'}</span>
                  </button>
                  <button
                    onClick={() => handleDownloadArtifact(art.fileName)}
                    className="px-3 py-1.5 bg-sky-700 hover:bg-sky-600 text-white rounded-lg font-sans text-xs flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>下载</span>
                  </button>
                </div>
              </div>
            ))}
          </div>

          {previewArtifact && (
            <div className="mt-3 p-4 bg-slate-950 border border-slate-700 rounded-lg space-y-2">
              <div className="flex items-center justify-between text-[11px] text-slate-400 border-b border-slate-800 pb-2">
                <span className="font-bold text-slate-200">{previewArtifact.fileName}</span>
                <button
                  onClick={() => setPreviewArtifact(null)}
                  className="text-slate-400 hover:text-slate-200 font-sans"
                >
                  关闭预览
                </button>
              </div>
              <pre className="text-xs text-slate-200 whitespace-pre-wrap font-sans max-h-96 overflow-y-auto leading-relaxed">
                {previewArtifact.content}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
