import React, { useState } from 'react';
import { Download, Github, Upload, FolderCheck, AlertCircle, ArrowRight, CheckCircle2 } from 'lucide-react';
import { IngestResult } from '../types';

interface ImportPageProps {
  onIngestSuccess: (result: IngestResult) => void;
  activeResult: IngestResult | null;
  onGoToInventory: () => void;
}

export const ImportPage: React.FC<ImportPageProps> = ({
  onIngestSuccess,
  activeResult,
  onGoToInventory,
}) => {
  const [repoUrl, setRepoUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleGithubSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const { safeFetchJson } = await import('../utils/safeFetch');
      const data = await safeFetchJson('/api/ingest/github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: repoUrl.trim() }),
      });
      if (!data.success) {
        throw new Error(data.error || 'GitHub 导入失败');
      }
      onIngestSuccess(data.data);
    } catch (err: any) {
      setError(err.message || '导入遇到错误');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    if (!file.name.endsWith('.zip')) {
      setError('仅支持 .zip 格式压缩包');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const { safeFetchJson } = await import('../utils/safeFetch');
      const data = await safeFetchJson('/api/ingest/zip', {
        method: 'POST',
        body: formData,
      });
      if (!data.success) {
        throw new Error(data.error || 'Zip 导入失败');
      }
      onIngestSuccess(data.data);
    } catch (err: any) {
      setError(err.message || '上传解压过程失败');
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* 头部标题区 */}
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <Download className="w-6 h-6 text-sky-400" />
          项目空间运行时导入
        </h1>
        <p className="text-slate-400 text-sm">
          支持导入任意未知工程项目，系统将在隔离工作空间解压并生成唯一内容哈希。
        </p>
      </div>

      {error && (
        <div className="p-4 bg-rose-950/60 border border-rose-800/80 rounded-xl flex items-start gap-3 text-rose-200 text-sm">
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-rose-300">导入失败</div>
            <div className="mt-0.5">{error}</div>
          </div>
        </div>
      )}

      {/* 导入模式选项区域 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* GitHub 仓库导入 */}
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-6 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-slate-200 font-semibold">
              <Github className="w-5 h-5 text-sky-400" />
              <span>公开 GitHub 仓库</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              输入公开 GitHub 仓库地址（支持完整链接、分支链接、SSH 地址或“用户名/仓库名”短路径），服务端将自动下载归档并安全解压。
            </p>
          </div>

          <form onSubmit={handleGithubSubmit} className="space-y-3">
            <input
              type="text"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="在此粘贴仓库地址（支持完整链接或 用户名/仓库名）"
              disabled={loading}
              className="w-full px-3.5 py-2.5 bg-slate-900/90 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent font-mono"
            />
            <button
              type="submit"
              disabled={loading || !repoUrl.trim()}
              className="w-full py-2.5 px-4 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {loading ? '正在下载解压...' : '解析并导入 GitHub 仓库'}
            </button>
          </form>
        </div>

      {/* 本地 Zip 压缩包上传 */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`bg-slate-800/60 border ${
            dragOver ? 'border-sky-500 bg-sky-950/20' : 'border-slate-700/60'
          } rounded-xl p-6 flex flex-col justify-between space-y-4 transition-all`}
        >
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-slate-200 font-semibold">
              <Upload className="w-5 h-5 text-emerald-400" />
              <span>Zip 归档包上传</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              拖拽或选择本地 .zip 压缩包上传，解压前将自动校验路径安全性与 100MB 大小限制。
            </p>
          </div>

          <div className="border-2 border-dashed border-slate-700 hover:border-slate-600 rounded-lg p-4 text-center transition-colors">
            <input
              type="file"
              accept=".zip"
              id="zip-file-input"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  handleFileUpload(e.target.files[0]);
                }
              }}
            />
            <label
              htmlFor="zip-file-input"
              className="cursor-pointer flex flex-col items-center justify-center space-y-2 py-2"
            >
              <Upload className="w-8 h-8 text-slate-400 hover:text-emerald-400 transition-colors" />
              <span className="text-xs font-medium text-slate-300">
                点击选择 .zip 文件或拖拽至此处
              </span>
            </label>
          </div>
        </div>
      </div>

      {/* 当前已导入空间卡片 */}
      {activeResult && (
        <div className="bg-slate-800/80 border border-emerald-500/40 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-700/60 pb-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <span className="font-semibold text-slate-100">已就绪的工作空间</span>
            </div>
            <span className="text-xs font-mono px-2 py-0.5 bg-emerald-950 text-emerald-400 border border-emerald-800/60 rounded">
              工作空间哈希：{activeResult.workspaceHash.slice(0, 12)}...
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono text-slate-300">
            <div>
              <div className="text-slate-500 text-[11px]">文件总数</div>
              <div className="text-base font-semibold text-slate-100 mt-0.5">{activeResult.fileCount} 个</div>
            </div>
            <div>
              <div className="text-slate-500 text-[11px]">项目容量</div>
              <div className="text-base font-semibold text-slate-100 mt-0.5">
                {(activeResult.totalSize / 1024).toFixed(1)} KB
              </div>
            </div>
            <div>
              <div className="text-slate-500 text-[11px]">来源类型</div>
              <div className="text-base font-semibold text-slate-100 mt-0.5 capitalize">
                {activeResult.sourceType}
              </div>
            </div>
            <div>
              <div className="text-slate-500 text-[11px]">完整 SHA256</div>
              <div className="text-xs text-slate-400 truncate mt-1" title={activeResult.workspaceHash}>
                {activeResult.workspaceHash}
              </div>
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              onClick={onGoToInventory}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs rounded-lg transition-colors flex items-center gap-2"
            >
              <span>生成并查看确定性清单</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
