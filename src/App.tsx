import React, { useState } from 'react';
import { IngestResult, InventoryData } from './types';
import { ImportPage } from './pages/ImportPage';
import { InventoryPage } from './pages/InventoryPage';
import { BlueprintPage } from './pages/BlueprintPage';
import { AdaptersPage } from './pages/AdaptersPage';
import { ExecutePage } from './pages/ExecutePage';
import { VerifyPage } from './pages/VerifyPage';
import { UnimplementedPage } from './pages/UnimplementedPage';
import { LedgerPage } from './pages/LedgerPage';
import { SelfTestPage } from './pages/SelfTestPage';
import { CharterModal } from './components/CharterModal';
import { BuildLogModal } from './components/BuildLogModal';
import { ModelSelector } from './components/ModelSelector';
import { ScrollText, FileText, Cpu } from 'lucide-react';

export type PageTab = 'import' | 'inventory' | 'blueprint' | 'adapters' | 'execute' | 'verify' | 'ledger' | 'selftest';

export default function App() {
  const [activeTab, setActiveTab] = useState<PageTab>('import');
  const [ingestResult, setIngestResult] = useState<IngestResult | null>(null);
  const [inventory, setInventory] = useState<InventoryData | null>(null);
  const [loadingInventory, setLoadingInventory] = useState(false);
  const [modelCallCount] = useState(0); // C6: 模型调用计数器，按需用户触发

  const [charterOpen, setCharterOpen] = useState(false);
  const [buildLogOpen, setBuildLogOpen] = useState(false);

  // 页面初次加载时检查服务端已激活的工作空间，支持状态恢复与刷新留存
  React.useEffect(() => {
    import('./utils/safeFetch').then(({ safeFetchJson }) => {
      safeFetchJson('/api/workspaces/current')
        .then((res) => {
          if (res.success && res.data && res.data.workspaceHash) {
            setIngestResult(res.data);
            fetchInventory(res.data.workspaceHash);
          }
        })
        .catch(() => {});
    });
  }, []);

  const blueprintCountLabel = ingestResult ? '已载入' : '';

  const handleIngestSuccess = (result: IngestResult) => {
    setIngestResult(result);
    setInventory(null);
    fetchInventory(result.workspaceHash);
  };

  const fetchInventory = async (hash: string) => {
    setLoadingInventory(true);
    try {
      const { safeFetchJson } = await import('./utils/safeFetch');
      const data = await safeFetchJson(`/api/inventory/${hash}`);
      if (data.success) {
        setInventory(data.data);
      }
    } catch (err) {
      console.error('获取清单失败', err);
    } finally {
      setLoadingInventory(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* 1-Row 3-Zone Top Bar Contract */}
      <header className="border-b border-slate-800/80 bg-slate-900/90 backdrop-blur-sm sticky top-0 z-40 px-6 py-3.5 flex items-center justify-between gap-8">
        {/* Zone 1: Single text element wordmark */}
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-base font-bold tracking-tight text-slate-100 whitespace-nowrap">
            通用 Agent/Skill 跨平台判定与运行引擎
          </span>
          <span className="text-[10px] font-mono px-2 py-0.5 bg-sky-950 text-sky-400 border border-sky-800 rounded hidden lg:inline">
            Stage 1
          </span>
        </div>

        {/* Zone 2: Nav Links / Segmented Tabs */}
        <nav className="flex items-center gap-1 overflow-x-auto no-scrollbar py-1">
          <button
            onClick={() => setActiveTab('import')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'import' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            导入
          </button>
          <button
            onClick={() => setActiveTab('inventory')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'inventory' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            清单 {inventory ? `(${inventory.files.length})` : ''}
          </button>
          <button
            onClick={() => setActiveTab('blueprint')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'blueprint' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            蓝图 {blueprintCountLabel ? `(${blueprintCountLabel})` : ''}
          </button>
          <button
            onClick={() => setActiveTab('adapters')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'adapters' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            适配
          </button>
          <button
            onClick={() => setActiveTab('execute')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'execute' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            执行
          </button>
          <button
            onClick={() => setActiveTab('verify')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'verify' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            验证
          </button>
          <button
            onClick={() => setActiveTab('ledger')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'ledger' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            证据账本
          </button>
          <button
            onClick={() => setActiveTab('selftest')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'selftest' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            自检
          </button>
        </nav>

        {/* Zone 3: Primary Action & Quota Info */}
        <div className="flex items-center gap-2.5 shrink-0">
          <ModelSelector compact />

          <button
            onClick={() => setCharterOpen(true)}
            className="p-1.5 text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
            title="查看宪章 CHARTER.md"
          >
            <ScrollText className="w-4 h-4 text-sky-400" />
            <span className="hidden sm:inline">宪章</span>
          </button>

          <button
            onClick={() => setBuildLogOpen(true)}
            className="p-1.5 text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
            title="查看构建日志 BUILD_LOG.md"
          >
            <FileText className="w-4 h-4 text-emerald-400" />
            <span className="hidden sm:inline">构建日志</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto">
        {activeTab === 'import' && (
          <ImportPage
            onIngestSuccess={handleIngestSuccess}
            activeResult={ingestResult}
            onGoToInventory={() => setActiveTab('inventory')}
          />
        )}

        {activeTab === 'inventory' && (
          <InventoryPage
            inventory={inventory}
            loading={loadingInventory}
            workspaceHash={ingestResult?.workspaceHash || null}
            onRefresh={() => {
              if (ingestResult) fetchInventory(ingestResult.workspaceHash);
            }}
          />
        )}

        {activeTab === 'blueprint' && (
          <BlueprintPage
            workspaceHash={ingestResult?.workspaceHash || null}
            onModelCallTriggered={() => {
              // Trigger refresh or update counters
            }}
          />
        )}

        {activeTab === 'adapters' && (
          <AdaptersPage
            workspaceHash={ingestResult?.workspaceHash || null}
            onModelCallTriggered={() => {
              // Model call counter update if needed
            }}
          />
        )}

        {activeTab === 'execute' && (
          <ExecutePage
            workspaceHash={ingestResult?.workspaceHash || null}
            onModelCallTriggered={() => {
              // Trigger refresh or counters
            }}
          />
        )}

        {activeTab === 'verify' && (
          <VerifyPage
            workspaceHash={ingestResult?.workspaceHash || null}
            onModelCallTriggered={() => {
              // Trigger refresh or counters
            }}
          />
        )}

        {activeTab === 'ledger' && <LedgerPage />}

        {activeTab === 'selftest' && (
          <SelfTestPage workspaceHash={ingestResult?.workspaceHash || null} />
        )}
      </main>

      {/* Modals */}
      <CharterModal isOpen={charterOpen} onClose={() => setCharterOpen(false)} />
      <BuildLogModal isOpen={buildLogOpen} onClose={() => setBuildLogOpen(false)} />
    </div>
  );
}
