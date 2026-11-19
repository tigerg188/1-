import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { SYSTEM_MODELS, buildModelCallConfig } from '../config/models.js';
import {
  getSharedAIClient,
  hasValidGeminiApiKey,
  callGeminiWithRateLimit,
} from './geminiClient.js';
import { InventoryData } from './inventory.js';
import { getBlueprint, EvidenceTag } from './understand.js';
import { appendLedgerEntry } from './ledger.js';

export interface CapabilityEntry {
  key: string;
  name: string;
  category: string;
  status: 'supported' | 'unsupported' | 'unknown';
  source: 'doc' | 'probe' | 'declared';
  doc_ref?: string;
  probe_result?: string;
  timestamp: string;
}

export type UnitVerdictType = '可直接移植' | '需改写' | '不可移植' | '未知';

export interface UnitFeasibilityVerdict {
  unitPath: string;
  verdict: UnitVerdictType;
  requiredCapabilities: string[];
  blockingCapability?: string;
  reason: string;
  evidenceTags: EvidenceTag[];
  rewritePlan?: string[];
}

export interface FeasibilityEvaluationResult {
  workspaceHash: string;
  updatedAt: string;
  packageVerdict: UnitVerdictType;
  unitVerdicts: UnitFeasibilityVerdict[];
  userLossList: string[];
  capabilityModelSnapshot: Record<string, CapabilityEntry>;
  summary: {
    totalUnits: number;
    directPortableCount: number;
    needRewriteCount: number;
    nonPortableCount: number;
    unknownCount: number;
  };
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const CAPABILITY_MODEL_FILE = path.join(DATA_DIR, 'capability_model.json');
const WORKSPACES_DIR = path.join(DATA_DIR, 'workspaces');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * 默认声明式平台能力拓扑字典 (平台无关，通用定义)
 */
export const DEFAULT_CAPABILITY_MODEL: Record<string, CapabilityEntry> = {
  web_search: {
    key: 'web_search',
    name: 'Web 实时搜索检索',
    category: '外部交互与 Grounding',
    status: 'unknown',
    source: 'declared',
    timestamp: new Date().toISOString(),
  },
  url_fetch: {
    key: 'url_fetch',
    name: 'URL 网页内容抓取解析',
    category: '外部交互与 Grounding',
    status: 'unknown',
    source: 'declared',
    timestamp: new Date().toISOString(),
  },
  code_execution: {
    key: 'code_execution',
    name: '代码运行与隔离沙盒',
    category: '计算与运行时',
    status: 'unknown',
    source: 'declared',
    timestamp: new Date().toISOString(),
  },
  filesystem_persist: {
    key: 'filesystem_persist',
    name: '文件系统持久化存储',
    category: '存储与 I/O',
    status: 'unknown',
    source: 'declared',
    timestamp: new Date().toISOString(),
  },
  long_output: {
    key: 'long_output',
    name: '长上下文输出生成',
    category: '模型与推断',
    status: 'unknown',
    source: 'declared',
    timestamp: new Date().toISOString(),
  },
  structured_output: {
    key: 'structured_output',
    name: '结构化 JSON Schema 约束输出',
    category: '模型与推断',
    status: 'unknown',
    source: 'declared',
    timestamp: new Date().toISOString(),
  },
  binary_file_read: {
    key: 'binary_file_read',
    name: '多模态/二进制文件解析',
    category: '存储与 I/O',
    status: 'unknown',
    source: 'declared',
    timestamp: new Date().toISOString(),
  },
  gpu: {
    key: 'gpu',
    name: '本地硬件 GPU 加速指令',
    category: '计算与运行时',
    status: 'unknown',
    source: 'declared',
    timestamp: new Date().toISOString(),
  },
  container_runtime: {
    key: 'container_runtime',
    name: 'Root 特权 Docker 容器',
    category: '计算与运行时',
    status: 'unknown',
    source: 'declared',
    timestamp: new Date().toISOString(),
  },
  background_jobs: {
    key: 'background_jobs',
    name: '守护进程与常驻后台任务',
    category: '计算与运行时',
    status: 'unknown',
    source: 'declared',
    timestamp: new Date().toISOString(),
  },
  scheduler: {
    key: 'scheduler',
    name: '独立 Cron 定时任务服务',
    category: '计算与运行时',
    status: 'unknown',
    source: 'declared',
    timestamp: new Date().toISOString(),
  },
  remote_mcp: {
    key: 'remote_mcp',
    name: '远程 MCP (Model Context Protocol)',
    category: '外部交互与 Grounding',
    status: 'unknown',
    source: 'declared',
    timestamp: new Date().toISOString(),
  },
  ui_hosting: {
    key: 'ui_hosting',
    name: '客户端 Web 交互与界面宿主',
    category: '前端与交付',
    status: 'unknown',
    source: 'declared',
    timestamp: new Date().toISOString(),
  },
};

/**
 * 读取平台能力配置字典
 */
export function getCapabilityModel(): Record<string, CapabilityEntry> {
  ensureDataDir();
  if (fs.existsSync(CAPABILITY_MODEL_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CAPABILITY_MODEL_FILE, 'utf-8'));
    } catch {}
  }
  // 初次使用写入默认模型
  fs.writeFileSync(CAPABILITY_MODEL_FILE, JSON.stringify(DEFAULT_CAPABILITY_MODEL, null, 2), 'utf-8');
  return DEFAULT_CAPABILITY_MODEL;
}

/**
 * 保存能力模型更新
 */
export function saveCapabilityModel(model: Record<string, CapabilityEntry>) {
  ensureDataDir();
  fs.writeFileSync(CAPABILITY_MODEL_FILE, JSON.stringify(model, null, 2), 'utf-8');
}

/**
 * 执行平台能力“探针” (Minimal-token probes)
 */
export async function runCapabilityProbe(key: string): Promise<CapabilityEntry> {
  const currentModel = getCapabilityModel();
  const entry = currentModel[key] || {
    key,
    name: key,
    category: '未知类别',
    status: 'unknown',
    source: 'probe',
    timestamp: new Date().toISOString(),
  };

  const nowStr = new Date().toISOString();

  try {
    if (key === 'structured_output') {
      if (!hasValidGeminiApiKey()) {
        entry.status = 'unknown';
        entry.source = 'probe';
        entry.probe_result = '未探测：未配置有效 GEMINI_API_KEY，无法运行模型探针';
      } else {
        const ai = getSharedAIClient();
        const feasModel = SYSTEM_MODELS.DEFAULT_FEASIBILITY;
        const probeGenConfig = buildModelCallConfig(feasModel, {
          responseMimeType: 'application/json',
        });
        const callRes = await callGeminiWithRateLimit(
          async () =>
            ai.models.generateContent({
              model: feasModel.id,
              contents: '{"ok": true}',
              config: probeGenConfig,
            }),
          { maxRetries: 1, modelId: feasModel.id, ignoreCooldown: true }
        );

        if (callRes.error || !callRes.result) {
          entry.status = 'unknown';
          entry.source = 'probe';
          entry.probe_result = `模型调用失败：${callRes.error || '未获得模型响应'}（状态保持未知）`;
        } else {
          const raw = (callRes.result.text || '').trim();
          if (raw) {
            JSON.parse(raw);
            entry.status = 'supported';
            entry.source = 'probe';
            entry.probe_result = `探针成功: 结构化 JSON 输出校验通过 (${raw.slice(0, 30)})`;
          } else {
            entry.status = 'unknown';
            entry.source = 'probe';
            entry.probe_result = '探针返回为空，无法判断';
          }
        }
      }
    } else {
      entry.status = 'unknown';
      entry.source = 'probe';
      entry.probe_result = `未实现：尚未实现 ${entry.name} (${key}) 的真实探针检测，状态保持未知`;
    }
  } catch (err: any) {
    entry.status = 'unknown';
    entry.source = 'probe';
    entry.probe_result = `模型调用失败：${err.message}（状态保持未知）`;
  }

  entry.timestamp = nowStr;
  currentModel[key] = entry;
  saveCapabilityModel(currentModel);

  // 记录证据账本
  appendLedgerEntry({
    stage: 'STAGE3',
    action: 'PROBE_CAPABILITY',
    inputs_hash: crypto.createHash('sha256').update(key).digest('hex'),
    outputs_hash: crypto.createHash('sha256').update(JSON.stringify(entry)).digest('hex'),
    ref: {
      details: `运行平台能力探针 [${key}]: 状态=${entry.status}, 来源=${entry.source}, 结果=${entry.probe_result}`,
    },
  });

  return entry;
}

/**
 * 运行所有探针
 */
export async function runAllCapabilityProbes(): Promise<Record<string, CapabilityEntry>> {
  const model = getCapabilityModel();
  for (const key of Object.keys(model)) {
    await runCapabilityProbe(key);
  }
  return getCapabilityModel();
}

/**
 * 规则 2: 从蓝图/清单提取单元能力依赖，并进行确定性比对得出移植判定
 */
export async function evaluateFeasibilityPipeline(
  workspaceHash: string,
  inventory: InventoryData
): Promise<FeasibilityEvaluationResult> {
  const capabilityModel = getCapabilityModel();
  const blueprint = getBlueprint(workspaceHash);
  const workspaceDir = path.join(WORKSPACES_DIR, workspaceHash);

  const unitVerdicts: UnitFeasibilityVerdict[] = [];
  const userLossSet = new Set<string>();

  // 逐单元使用代码关键词规则提取能力依赖并计算判定（未调用模型）
  for (const uc of inventory.unit_candidates) {
    const card = blueprint?.unit_cards?.[uc.dirPath];
    let requiredCapabilities: string[] = [];

    // 分析单元文件与指令关键词确定可能涉及的能力（代码规则，非模型理解）
    if (uc.instructionFile) {
      const fullPath = path.join(workspaceDir, uc.instructionFile);
      if (fs.existsSync(fullPath)) {
        const text = fs.readFileSync(fullPath, 'utf-8').toLowerCase();
        if (text.includes('search') || text.includes('google') || text.includes('web')) {
          requiredCapabilities.push('web_search');
        }
        if (text.includes('http') || text.includes('fetch') || text.includes('url')) {
          requiredCapabilities.push('url_fetch');
        }
        if (text.includes('python') || text.includes('node') || text.includes('script') || text.includes('code')) {
          requiredCapabilities.push('code_execution');
        }
        if (text.includes('docker') || text.includes('container') || text.includes('root')) {
          requiredCapabilities.push('container_runtime');
        }
        if (text.includes('gpu') || text.includes('cuda')) {
          requiredCapabilities.push('gpu');
        }
        if (text.includes('cron') || text.includes('schedule')) {
          requiredCapabilities.push('scheduler');
        }
      }
    }

    requiredCapabilities = Array.from(new Set(requiredCapabilities));

    // 纯代码确定性匹配 Capability Model 计算 verdict
    let unitVerdict: UnitVerdictType = '未知';
    let blockingCap: string | undefined = undefined;
    let reason = '';
    const rewritePlan: string[] = [];

    if (requiredCapabilities.length === 0) {
      unitVerdict = '未知';
      reason = '来源：代码规则（非模型理解）。未在指令文本中匹配到已知能力关键词，且未调用模型提取需求，判定为未知';
    } else {
      let allSupported = true;
      for (const capKey of requiredCapabilities) {
        const cap = capabilityModel[capKey];
        if (!cap || cap.status === 'unknown') {
          allSupported = false;
          unitVerdict = '未知';
          blockingCap = capKey;
          reason = `来源：代码规则（非模型理解）。所需能力 ${capKey} 状态未知，无法判定可移植性`;
          break;
        } else if (cap.status === 'unsupported') {
          allSupported = false;
          if (capKey === 'gpu' || capKey === 'container_runtime') {
            unitVerdict = '不可移植';
            blockingCap = capKey;
            reason = `来源：代码规则（非模型理解）。受限于平台能力 ${cap.name} (unsupported)`;
            userLossSet.add(`损失 ${uc.dirPath} 单元的能力 (${cap.name})`);
            break;
          } else {
            unitVerdict = '需改写';
            blockingCap = capKey;
            reason = `来源：代码规则（非模型理解）。缺少能力 ${cap.name}，需改写替代`;
            rewritePlan.push(`改写方案: 需对 ${cap.name} 提供替代交互方案`);
            userLossSet.add(`单元 ${uc.dirPath} 需改写: 缺少 ${cap.name}`);
          }
        }
      }
      if (allSupported) {
        unitVerdict = '可直接移植';
        reason = '来源：代码规则（非模型理解）。关键词匹配到的能力均已在 Capability Model 中验证为 supported';
      }
    }

    unitVerdicts.push({
      unitPath: uc.dirPath,
      verdict: unitVerdict,
      requiredCapabilities,
      blockingCapability: blockingCap,
      reason,
      evidenceTags: card?.evidenceTags || [
        { type: 'inference', reason: '来源：代码规则（关键词规则匹配，非模型理解）' },
      ],
      rewritePlan: rewritePlan.length > 0 ? rewritePlan : undefined,
    });
  }

  // 纯代码确定性计算整包 Verdict (Package Verdict)
  let packageVerdict: UnitVerdictType = '可直接移植';
  let directCount = 0;
  let needRewriteCount = 0;
  let nonPortableCount = 0;
  let unknownCount = 0;

  for (const uv of unitVerdicts) {
    if (uv.verdict === '可直接移植') directCount++;
    else if (uv.verdict === '需改写') needRewriteCount++;
    else if (uv.verdict === '不可移植') nonPortableCount++;
    else if (uv.verdict === '未知') unknownCount++;
  }

  if (nonPortableCount > 0) {
    packageVerdict = '不可移植';
  } else if (needRewriteCount > 0) {
    packageVerdict = '需改写';
  } else if (unknownCount > 0) {
    packageVerdict = '未知';
  } else {
    packageVerdict = '可直接移植';
  }

  const result: FeasibilityEvaluationResult = {
    workspaceHash,
    updatedAt: new Date().toISOString(),
    packageVerdict,
    unitVerdicts,
    userLossList: Array.from(userLossSet),
    capabilityModelSnapshot: capabilityModel,
    summary: {
      totalUnits: unitVerdicts.length,
      directPortableCount: directCount,
      needRewriteCount,
      nonPortableCount,
      unknownCount,
    },
  };

  // 持久化评估结果到工作空间
  const resultFile = path.join(WORKSPACES_DIR, workspaceHash, 'feasibility.json');
  fs.writeFileSync(resultFile, JSON.stringify(result, null, 2), 'utf-8');

  // 追加证据账本 (Append-only)
  appendLedgerEntry({
    stage: 'STAGE3',
    action: 'EVALUATE_FEASIBILITY',
    inputs_hash: workspaceHash,
    outputs_hash: crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex'),
    ref: {
      workspace_hash: workspaceHash,
      file_path: 'feasibility.json',
      details: `可移植性评估完成: 整包结论=${packageVerdict}, 可直接移植=${directCount}, 需改写=${needRewriteCount}, 不可移植=${nonPortableCount}`,
    },
  });

  return result;
}

export function getFeasibilityResult(workspaceHash: string): FeasibilityEvaluationResult | null {
  const resultFile = path.join(WORKSPACES_DIR, workspaceHash, 'feasibility.json');
  if (fs.existsSync(resultFile)) {
    try {
      return JSON.parse(fs.readFileSync(resultFile, 'utf-8'));
    } catch {}
  }
  return null;
}
