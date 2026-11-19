import React from 'react';
import { AlertTriangle, Lock, ShieldAlert } from 'lucide-react';

interface UnimplementedPageProps {
  stageNumber: number;
  stageTitle: string;
  plannedScope: string[];
}

export const UnimplementedPage: React.FC<UnimplementedPageProps> = ({
  stageNumber,
  stageTitle,
  plannedScope,
}) => {
  return (
    <div className="max-w-4xl mx-auto py-8 space-y-6">
      {/* 未实现状态横幅 (遵从 C3 绝对诚实原则) */}
      <div className="p-6 bg-slate-800/80 border border-amber-500/40 rounded-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-700/60 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-950 text-amber-400 rounded-xl border border-amber-800/60">
              <Lock className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold px-2 py-0.5 bg-amber-500 text-slate-950 rounded">
                  未实现
                </span>
                <span className="text-xs font-mono text-slate-400">STAGE {stageNumber}</span>
              </div>
              <h2 className="text-xl font-bold text-slate-100 mt-1">{stageTitle}</h2>
            </div>
          </div>
          <ShieldAlert className="w-8 h-8 text-amber-500/40 hidden sm:block" />
        </div>

        <p className="text-sm text-slate-300 leading-relaxed">
          根据《宪章》规则 <strong>C3 (No Fake Completion)</strong>
          ，本模块属于阶段 {stageNumber} 规划内容，当前阶段尚未实现。系统严格禁止任何形式的模拟输出或假完成。
        </p>

        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-2">
          <div className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <span>已知缺口 (Gap Log) & 规划范围</span>
          </div>
          <ul className="space-y-1.5 text-xs text-slate-300 list-disc list-inside">
            {plannedScope.map((item, idx) => (
              <li key={idx} className="leading-relaxed">
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};
