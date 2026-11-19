import React, { useState } from 'react';
import { InventoryData } from '../types';
import {
  FileText,
  CheckCircle,
  XCircle,
  Code,
  FolderTree,
  GitCommit,
  Copy,
  Check,
  ListTree,
  Search,
  ExternalLink,
  Layers,
} from 'lucide-react';

interface InventoryPageProps {
  inventory: InventoryData | null;
  loading: boolean;
  workspaceHash: string | null;
  onRefresh: () => void;
}

export const InventoryPage: React.FC<InventoryPageProps> = ({
  inventory,
  loading,
  workspaceHash,
  onRefresh,
}) => {
  const [subTab, setSubTab] = useState<'overview' | 'files' | 'headings' | 'steps' | 'links' | 'raw'>('overview');
  const [copied, setCopied] = useState(false);
  const [filterText, setFilterText] = useState('');

  if (!workspaceHash) {
    return (
      <div className="max-w-4xl mx-auto py-12 text-center space-y-4">
        <FileText className="w-12 h-12 text-slate-600 mx-auto" />
        <h2 className="text-lg font-semibold text-slate-300">暂无载入的工作空间</h2>
        <p className="text-xs text-slate-500">请先在“导入”页面选择 GitHub 仓库或上传 Zip 压缩包。</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto py-12 text-center space-y-3">
        <div className="inline-block animate-spin w-8 h-8 border-2 border-sky-400 border-t-transparent rounded-full" />
        <p className="text-sm text-slate-400 font-mono">正在执行纯代码确定性清单提取 (NO model)...</p>
      </div>
    );
  }

  if (!inventory) {
    return (
      <div className="max-w-4xl mx-auto py-12 text-center space-y-4">
        <p className="text-rose-400 text-sm">清单数据读取失败</p>
        <button
          onClick={onRefresh}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded-lg"
        >
          重新提取清单
        </button>
      </div>
    );
  }

  const handleCopyRaw = () => {
    navigator.clipboard.writeText(JSON.stringify(inventory, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const filteredFiles = inventory.files.filter((f) =>
    f.relPath.toLowerCase().includes(filterText.toLowerCase())
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* 页头 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <ListTree className="w-6 h-6 text-sky-400" />
            确定性提取清单 (Deterministic Inventory)
          </h1>
          <p className="text-slate-400 text-xs mt-1 font-mono">
            Pure code parse (NO model) · Workspace Hash: {workspaceHash.slice(0, 16)}...
          </p>
        </div>

        {/* 子切换页签 */}
        <div className="flex items-center gap-1 bg-slate-900/80 p-1 border border-slate-800 rounded-lg text-xs">
          <button
            onClick={() => setSubTab('overview')}
            className={`px-3 py-1.5 font-medium rounded-md transition-colors ${
              subTab === 'overview' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            全貌概览
          </button>
          <button
            onClick={() => setSubTab('files')}
            className={`px-3 py-1.5 font-medium rounded-md transition-colors ${
              subTab === 'files' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            文件树 ({inventory.files.length})
          </button>
          <button
            onClick={() => setSubTab('headings')}
            className={`px-3 py-1.5 font-medium rounded-md transition-colors ${
              subTab === 'headings' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Markdown 标题 ({inventory.headings.length})
          </button>
          <button
            onClick={() => setSubTab('steps')}
            className={`px-3 py-1.5 font-medium rounded-md transition-colors ${
              subTab === 'steps' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            步骤与箭头 ({inventory.step_and_arrow_lines.length})
          </button>
          <button
            onClick={() => setSubTab('links')}
            className={`px-3 py-1.5 font-medium rounded-md transition-colors ${
              subTab === 'links' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            相对链接 ({inventory.relative_links.length})
          </button>
          <button
            onClick={() => setSubTab('raw')}
            className={`px-3 py-1.5 font-medium rounded-md transition-colors ${
              subTab === 'raw' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            JSON 源码
          </button>
        </div>
      </div>

      {/* 选项卡内容 1: 全貌概览 */}
      {subTab === 'overview' && (
        <div className="space-y-6">
          {/* 顶栏卡片概览 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4">
              <div className="text-xs text-slate-400">总文件数</div>
              <div className="text-2xl font-bold font-mono text-slate-100 mt-1">
                {inventory.stats.totalFiles} <span className="text-xs text-slate-400 font-sans">个</span>
              </div>
            </div>
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4">
              <div className="text-xs text-slate-400">项目容量</div>
              <div className="text-2xl font-bold font-mono text-slate-100 mt-1">
                {(inventory.stats.totalSize / 1024).toFixed(1)} <span className="text-xs text-slate-400 font-sans">KB</span>
              </div>
            </div>
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4">
              <div className="text-xs text-slate-400">候选入口点</div>
              <div className="text-2xl font-bold font-mono text-sky-400 mt-1">
                {inventory.candidate_entry_points.length} <span className="text-xs text-slate-400 font-sans">个</span>
              </div>
            </div>
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4">
              <div className="text-xs text-slate-400">单元候选目录</div>
              <div className="text-2xl font-bold font-mono text-emerald-400 mt-1">
                {inventory.unit_candidates.length} <span className="text-xs text-slate-400 font-sans">个</span>
              </div>
            </div>
          </div>

          {/* 标准格式匹配矩阵 */}
          <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <Code className="w-4 h-4 text-sky-400" />
              标准规范格式与文件匹配矩阵 (Standard Format Flags)
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 font-mono text-xs">
              {Object.entries(inventory.standard_format_flags).map(([fileName, present]) => (
                <div
                  key={fileName}
                  className={`p-2.5 rounded-lg border flex items-center justify-between ${
                    present
                      ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                      : 'bg-slate-900/60 border-slate-800 text-slate-500'
                  }`}
                >
                  <span className="truncate">{fileName}</span>
                  {present ? (
                    <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 ml-1" />
                  ) : (
                    <XCircle className="w-4 h-4 text-slate-600 shrink-0 ml-1" />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 候选入口 & 单元候选 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <GitCommit className="w-4 h-4 text-sky-400" />
                候选入口点 (Candidate Entry Points)
              </h3>
              {inventory.candidate_entry_points.length === 0 ? (
                <p className="text-xs text-slate-500 italic">未匹配到常见入口文件规则</p>
              ) : (
                <div className="space-y-2">
                  {inventory.candidate_entry_points.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 bg-slate-900/80 border border-slate-800 rounded-lg text-xs space-y-1 font-mono"
                    >
                      <div className="text-sky-300 font-semibold">{item.file}</div>
                      <div className="text-slate-400 font-sans text-[11px]">{item.reason}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-400" />
                单元候选目录 (Unit Candidates)
              </h3>
              {inventory.unit_candidates.length === 0 ? (
                <p className="text-xs text-slate-500 italic">未发现包含规范指令文件的目录单元</p>
              ) : (
                <div className="space-y-2">
                  {inventory.unit_candidates.map((uc, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 bg-slate-900/80 border border-slate-800 rounded-lg text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between text-slate-200 font-mono">
                        <span className="text-emerald-300 font-semibold">{uc.dirPath}</span>
                        <span className="text-[11px] text-slate-500">{uc.lineCount} 行</span>
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        文件: {uc.instructionFile} {uc.title && `· "${uc.title}"`}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 文件扩展名分布表 */}
          <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <FolderTree className="w-4 h-4 text-sky-400" />
              文件后缀统计与存储类型
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
              {Object.entries(inventory.stats.byExtension).map(([ext, stat]) => (
                <div key={ext} className="p-3 bg-slate-900/80 border border-slate-800 rounded-lg text-xs font-mono">
                  <div className="text-sky-400 font-bold">{ext}</div>
                  <div className="text-slate-300 mt-1">{stat.count} 个文件</div>
                  <div className="text-[11px] text-slate-500 font-sans">{(stat.totalSize / 1024).toFixed(1)} KB</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 选项卡内容 2: 文件树全清单 */}
      {subTab === 'files' && (
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
              <input
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="按文件名搜索路径..."
                className="w-full pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500 font-mono"
              />
            </div>
            <div className="text-xs text-slate-400 font-mono">
              匹配: {filteredFiles.length} / {inventory.files.length}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse font-mono text-xs">
              <thead>
                <tr className="border-b border-slate-700/80 text-slate-400 text-[11px]">
                  <th className="py-2.5 px-3">相对路径 (Relative Path)</th>
                  <th className="py-2.5 px-3">大小</th>
                  <th className="py-2.5 px-3">SHA256 哈希</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {filteredFiles.map((file) => (
                  <tr key={file.relPath} className="hover:bg-slate-900/50 transition-colors">
                    <td className="py-2 px-3 text-sky-300">{file.relPath}</td>
                    <td className="py-2 px-3 text-slate-400">{file.size} B</td>
                    <td className="py-2 px-3 text-slate-500 text-[11px]">{file.sha256}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 选项卡内容 3: Markdown 标题结构 */}
      {subTab === 'headings' && (
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-200">
            Markdown 标题解析列表 (Line-by-line Headings)
          </h3>
          <div className="space-y-2">
            {inventory.headings.length === 0 ? (
              <p className="text-xs text-slate-500 italic">未包含 Markdown 标题</p>
            ) : (
              inventory.headings.map((h, idx) => (
                <div
                  key={idx}
                  className="p-2.5 bg-slate-900/80 border border-slate-800 rounded-lg text-xs font-mono flex items-start gap-3"
                >
                  <span className="px-2 py-0.5 bg-slate-800 text-sky-400 rounded text-[11px] shrink-0">
                    {h.file}:{h.line}
                  </span>
                  <div className="space-x-2 font-sans text-slate-200">
                    <span className="font-mono text-slate-500">{'#'.repeat(h.level)}</span>
                    <span className="font-medium">{h.text}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 选项卡内容 4: 步骤与箭头行 */}
      {subTab === 'steps' && (
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-200">
            步骤指示与箭头表达式提取 (Step & Arrow Lines)
          </h3>
          <div className="space-y-2">
            {inventory.step_and_arrow_lines.length === 0 ? (
              <p className="text-xs text-slate-500 italic">未发现符合步骤或箭头模式的代码行</p>
            ) : (
              inventory.step_and_arrow_lines.map((item, idx) => (
                <div
                  key={idx}
                  className="p-2.5 bg-slate-900/80 border border-slate-800 rounded-lg text-xs font-mono space-y-1"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sky-400 font-semibold">
                      {item.file}:{item.line}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded uppercase ${
                        item.matchType === 'arrow'
                          ? 'bg-amber-950 text-amber-400 border border-amber-800'
                          : 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                      }`}
                    >
                      {item.matchType}
                    </span>
                  </div>
                  <div className="text-slate-300 bg-slate-950 p-2 rounded border border-slate-800 whitespace-pre-wrap">
                    {item.text}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 选项卡内容 5: 相对链接 */}
      {subTab === 'links' && (
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-200">
            相对文件与链接匹配 (Relative File Links)
          </h3>
          <div className="space-y-2">
            {inventory.relative_links.length === 0 ? (
              <p className="text-xs text-slate-500 italic">未检测到相对文件链接</p>
            ) : (
              inventory.relative_links.map((link, idx) => (
                <div
                  key={idx}
                  className="p-2.5 bg-slate-900/80 border border-slate-800 rounded-lg text-xs font-mono flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 text-[11px]">
                      {link.file}:{link.line}
                    </span>
                    <span className="text-slate-200 font-sans font-medium">[{link.linkText}]</span>
                  </div>
                  <div className="flex items-center gap-1 text-sky-400">
                    <span>{link.targetPath}</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 选项卡内容 6: 原始 JSON */}
      {subTab === 'raw' && (
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-200 font-mono">
              inventory.json (Deterministic Format Output)
            </h3>
            <button
              onClick={handleCopyRaw}
              className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs rounded-lg flex items-center gap-1.5 transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? '已复制' : '复制 JSON'}</span>
            </button>
          </div>
          <pre className="p-4 bg-slate-950 rounded-xl border border-slate-800 text-xs text-emerald-400 font-mono overflow-x-auto max-h-[600px] leading-relaxed">
            {JSON.stringify(inventory, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};
