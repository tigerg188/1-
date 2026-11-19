import React, { useState, useEffect } from 'react';
import { X, ScrollText } from 'lucide-react';

interface CharterModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CharterModal: React.FC<CharterModalProps> = ({ isOpen, onClose }) => {
  const [content, setContent] = useState<string>('正在加载 /CHARTER.md...');

  useEffect(() => {
    if (isOpen) {
      fetch('/api/charter')
        .then((res) => {
          if (!res.ok) throw new Error(`状态异常 (${res.status})`);
          return res.text();
        })
        .then((text) => setContent(text))
        .catch((err) => setContent('读取 CHARTER.md 失败: ' + err.message));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-2xl">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-100 font-bold text-base">
            <ScrollText className="w-5 h-5 text-sky-400" />
            <span>判定与运行引擎宪章 (/CHARTER.md)</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto font-mono text-xs text-slate-300 leading-relaxed space-y-4">
          <pre className="whitespace-pre-wrap font-sans">{content}</pre>
        </div>

        <div className="p-4 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};
