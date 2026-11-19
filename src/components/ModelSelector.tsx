import React, { useState, useEffect } from 'react';
import { ModelOption } from '../types';
import { Cpu, RefreshCw, AlertTriangle, Check, ChevronDown, Zap } from 'lucide-react';

interface ModelSelectorProps {
  onModelChanged?: (modelId: string) => void;
  compact?: boolean;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  onModelChanged,
  compact = false,
}) => {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [activeModelId, setActiveModelId] = useState<string>('gemini-4-hydrogen');
  const [cooldownRemainingMs, setCooldownRemainingMs] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [open, setOpen] = useState<boolean>(false);

  const fetchModels = async () => {
    try {
      const { safeFetchJson } = await import('../utils/safeFetch');
      const res = await safeFetchJson('/api/models');
      if (res.success && res.data) {
        setModels(res.data.availableModels || []);
        setActiveModelId(res.data.activeModelId || 'gemini-4-hydrogen');
        setCooldownRemainingMs(res.data.cooldownRemainingMs || 0);
      }
    } catch {
      // 保持安静，不阻断主流程
    }
  };

  useEffect(() => {
    fetchModels();
    const interval = setInterval(fetchModels, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleSelectModel = async (modelId: string) => {
    if (modelId === activeModelId && cooldownRemainingMs === 0) {
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      const { safeFetchJson } = await import('../utils/safeFetch');
      const res = await safeFetchJson('/api/models/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId }),
      });
      if (res.success && res.data) {
        setActiveModelId(res.data.activeModelId);
        setCooldownRemainingMs(0);
        if (onModelChanged) onModelChanged(res.data.activeModelId);
      }
    } catch (err) {
      console.error('切换模型出错', err);
    } finally {
      setLoading(false);
      setOpen(false);
    }
  };

  const handleResetCooldown = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setLoading(true);
    try {
      const { safeFetchJson } = await import('../utils/safeFetch');
      await safeFetchJson('/api/models/reset-cooldown', { method: 'POST' });
      setCooldownRemainingMs(0);
      if (onModelChanged) onModelChanged(activeModelId);
    } catch (err) {
      console.error('重置冷却时间出错', err);
    } finally {
      setLoading(false);
    }
  };

  const currentModel = models.find((m) => m.id === activeModelId);
  const cooldownSec = Math.ceil(cooldownRemainingMs / 1000);

  return (
    <div className="relative inline-block text-left">
      <button
        onClick={() => setOpen(!open)}
        disabled={loading}
        type="button"
        className={`flex items-center gap-2 rounded-lg border transition-colors ${
          compact
            ? 'px-2.5 py-1 text-[11px] font-mono bg-slate-900 border-slate-700/80 hover:border-slate-500 text-slate-200'
            : 'px-3 py-1.5 text-xs bg-slate-800 border-slate-700 hover:border-sky-500 text-slate-100'
        }`}
        title={`当前模型: ${currentModel?.name || activeModelId}`}
      >
        <Cpu className="w-3.5 h-3.5 text-sky-400 shrink-0" />
        <span className="font-medium truncate max-w-[140px] sm:max-w-[200px]">
          {currentModel?.name || activeModelId}
        </span>

        {cooldownSec > 0 ? (
          <span
            onClick={handleResetCooldown}
            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.2 bg-amber-950/80 text-amber-300 border border-amber-700/60 rounded cursor-pointer hover:bg-amber-900"
            title="点击立即清除冷却"
          >
            <AlertTriangle className="w-2.5 h-2.5 text-amber-400" />
            <span>冷却中 ({cooldownSec}s)</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.2 bg-emerald-950/60 text-emerald-300 border border-emerald-800/40 rounded">
            正常
          </span>
        )}

        <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-80 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-2 z-50 text-xs space-y-1">
            <div className="px-2 py-1.5 text-[11px] font-medium text-slate-400 border-b border-slate-800 flex items-center justify-between">
              <span>选择执行与分析模型</span>
              {cooldownSec > 0 && (
                <button
                  onClick={handleResetCooldown}
                  className="text-amber-400 hover:text-amber-300 flex items-center gap-1 text-[10px]"
                >
                  <RefreshCw className="w-2.5 h-2.5" />
                  <span>清除冷却</span>
                </button>
              )}
            </div>

            <div className="max-h-72 overflow-y-auto space-y-1 py-1">
              {models.map((m) => {
                const isSelected = m.id === activeModelId;
                return (
                  <button
                    key={m.id}
                    onClick={() => handleSelectModel(m.id)}
                    className={`w-full text-left p-2.5 rounded-lg transition-colors flex items-start justify-between gap-2 ${
                      isSelected
                        ? 'bg-sky-950/70 border border-sky-700/80 text-slate-100'
                        : 'hover:bg-slate-800/70 text-slate-300'
                    }`}
                  >
                    <div className="space-y-0.5">
                      <div className="font-semibold text-slate-100 flex items-center gap-1.5">
                        <span>{m.name}</span>
                        {m.id === 'gemini-3.1-flash-lite' && (
                          <span className="text-[9px] px-1.5 py-0.2 bg-emerald-950 text-emerald-300 border border-emerald-800 rounded flex items-center gap-0.5">
                            <Zap className="w-2 h-2" />
                            高配额/恢复首选
                          </span>
                        )}
                        {m.id === 'gemini-4-hydrogen' && (
                          <span className="text-[9px] px-1.5 py-0.2 bg-sky-950 text-sky-300 border border-sky-800 rounded">
                            推荐
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        {m.description}
                      </p>
                      <div className="text-[10px] text-slate-500 font-mono">
                        ID: {m.id} · {m.supportsThinking ? '支持思考推理' : '直出超低时延'}
                      </div>
                    </div>
                    {isSelected && (
                      <Check className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="pt-2 border-t border-slate-800 px-2 py-1 text-[10px] text-slate-500 leading-normal">
              提示：若遇 429 配额用尽，可切换为「Gemini 3.1 Flash Lite」或在 Settings &gt; Secrets 切换绑定计费账户的密钥。
            </div>
          </div>
        </>
      )}
    </div>
  );
};
