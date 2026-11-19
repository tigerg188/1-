import React from 'react';
import { EvidenceTag } from '../types';
import { FileText, HelpCircle, Lightbulb } from 'lucide-react';

interface EvidenceTagBadgeProps {
  tag?: EvidenceTag;
}

export const EvidenceTagBadge: React.FC<EvidenceTagBadgeProps> = ({ tag }) => {
  if (!tag) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-900 border border-slate-800 text-slate-500 rounded text-[11px] font-mono">
        <HelpCircle className="w-3 h-3 text-slate-500" />
        <span>[未知]</span>
      </span>
    );
  }

  if (tag.type === 'evidence') {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-950/80 border border-emerald-800/80 text-emerald-300 rounded text-[11px] font-mono"
        title={tag.quote ? `Quote: "${tag.quote}"` : '强证据引用'}
      >
        <FileText className="w-3 h-3 text-emerald-400 shrink-0" />
        <span>
          [证据 {tag.filePath || 'file'}:{tag.lineStart || 1} {tag.quote ? `"${tag.quote.slice(0, 20)}..."` : ''}]
        </span>
      </span>
    );
  }

  if (tag.type === 'inference') {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-950/80 border border-amber-800/80 text-amber-300 rounded text-[11px] font-mono"
        title={tag.reason ? `Reason: ${tag.reason}` : '模型合理推断'}
      >
        <Lightbulb className="w-3 h-3 text-amber-400 shrink-0" />
        <span>[推断 + {tag.reason ? tag.reason.slice(0, 15) : '模型逻辑推演'}]</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-900 border border-slate-800 text-slate-500 rounded text-[11px] font-mono">
      <HelpCircle className="w-3 h-3 text-slate-500" />
      <span>[未知]</span>
    </span>
  );
};
