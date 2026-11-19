import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  SYSTEM_MODELS,
  GEMINI_RATE_LIMIT_CONFIG,
  buildModelCallConfig,
  setActiveModelId,
} from '../config/models.js';
import {
  getSharedAIClient,
  hasValidGeminiApiKey,
  callGeminiWithRateLimit,
  resetGeminiCooldown,
} from './geminiClient.js';
import { InventoryData } from './inventory.js';
import { appendLedgerEntry } from './ledger.js';
import {
  BATCHED_UNIT_CARDS_PROMPT,
  SYNTHESIS_PROMPT,
  COUNTEREXAMPLE_PROMPT,
  BATCHED_INTENT_PROBES_PROMPT,
} from './prompts.js';

export type NodeRole =
  | 'entry_router'
  | 'specialist'
  | 'delivery'
  | 'resource'
  | 'script'
  | 'config'
  | 'doc'
  | 'unknown';

export type EdgeType =
  | 'routes_to'
  | 'may_invoke'
  | 'requires_input_from'
  | 'produces_for'
  | 'independent_entry'
  | 'shares_resource'
  | 'must_precede';

export interface EvidenceTag {
  type: 'evidence' | 'inference' | 'unknown';
  filePath?: string;
  lineStart?: number;
  lineEnd?: number;
  quote?: string;
  reason?: string;
}

export interface UnitCard {
  unitPath: string;
  instructionFile: string;
  role: NodeRole;
  roleSource?: string;
  purpose: string;
  activation_conditions: {
    when_to_use: string[];
    when_not_to_use: string[];
    evidence?: EvidenceTag;
  };
  declared_independence: '是' | '否' | '未知' | boolean;
  inputs: string[];
  outputs: string[];
  external_dependencies: string[];
  runtime_requirements: string[];
  non_goals: string[];
  l2_internal_workflow: Array<{
    stepIndex: number;
    description: string;
    evidence?: EvidenceTag;
  }>;
  evidenceTags: EvidenceTag[];
  analysisSource?: 'model' | 'code_rule' | 'failed';
  analysisNote?: string;
}

export interface L0Intent {
  purpose: string;
  intended_users: string[];
  stated_non_goals: string[];
  author_statements: Array<{
    statement: string;
    evidence: EvidenceTag;
  }>;
}

export interface TopologyNode {
  id: string;
  label: string;
  role: NodeRole;
  unitPath?: string;
}

export interface TopologyEdge {
  from: string;
  to: string;
  type: EdgeType;
  description?: string;
  evidence?: EvidenceTag;
}

export interface L1Topology {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

export interface L2Workflow {
  unitPath: string;
  steps: Array<{
    stepIndex: number;
    description: string;
    evidence?: EvidenceTag;
  }>;
}

export interface L3DeliveryRules {
  acceptance_rules: Array<{
    rule: string;
    evidence?: EvidenceTag;
  }>;
  delivery_formats: string[];
}

export interface ReconciliationReport {
  totalUnitCandidates: number;
  classifiedNodesCount: number;
  modelGeneratedCount: number;
  ruleFallbackCount: number;
  failedCount: number;
  unclassifiedFiles: string[];
  unconnectedUnits: string[];
  roleCounts: Record<NodeRole, number>;
  invalidEdgesCount: number;
  allEdgeEndpointsExist: boolean;
  modelUnderstoodCount?: number;
}

export interface EvidenceVerificationReport {
  totalTags: number;
  verifiedCount: number;
  unverifiedCount: number;
  verificationRate: number;
  tags: Array<{
    tag: EvidenceTag;
    verified: boolean;
    reason: string;
  }>;
}

export interface CounterexampleResult {
  targetType: 'must_precede' | 'independent_entry';
  targetId: string;
  claim: string;
  contradictionFound: boolean;
  contradictionEvidence?: EvidenceTag;
  explanation: string;
  status?: '已检索' | '未测试' | '模型调用失败' | '不适用';
}

export interface CoverageTable {
  overallCoveragePercentage: number;
  files: Array<{
    filePath: string;
    status: '已读全文' | '已读部分' | '未读';
    linesRead: number;
    totalLines: number;
  }>;
}

export interface IntentProbe {
  question: string;
  answerFromBlueprint: string;
  answerFromRawFiles: string;
  agrees: boolean | null;
  status?: '需人工比对' | '未测试' | '模型调用失败';
  notes?: string;
}

export interface BlueprintData {
  workspaceHash: string;
  updatedAt: string;
  l0_intent: L0Intent;
  l1_topology: L1Topology;
  l2_workflows: L2Workflow[];
  l3_delivery_rules: L3DeliveryRules;
  unit_cards: Record<string, UnitCard>;
  reconciliation_report: ReconciliationReport;
  evidence_verification: EvidenceVerificationReport;
  counterexamples: CounterexampleResult[];
  coverage_table: CoverageTable;
  intent_probes: IntentProbe[];
  modelCallsCount: number;
  synthesisStatus?: 'model' | 'code_rule' | 'failed';
  synthesisNote?: string;
}

const WORKSPACES_DIR = path.resolve(process.cwd(), 'data', 'workspaces');

function stripJsonFence(raw: string | undefined): string {
  return (raw || '{}')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
}

/**
 * 提取/读写蓝图缓存 JSON
 */
export function getBlueprint(workspaceHash: string): BlueprintData | null {
  const workspaceDir = path.join(WORKSPACES_DIR, workspaceHash);
  const bpFile = path.join(workspaceDir, 'blueprint.json');
  if (fs.existsSync(bpFile)) {
    try {
      return JSON.parse(fs.readFileSync(bpFile, 'utf-8'));
    } catch {}
  }
  return null;
}

export function saveBlueprint(workspaceHash: string, data: BlueprintData) {
  const workspaceDir = path.join(WORKSPACES_DIR, workspaceHash);
  const bpFile = path.join(workspaceDir, 'blueprint.json');
  fs.writeFileSync(bpFile, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * 规则 3: 代码对账分析 (纯代码计算，无模型)
 */
export function reconcileCode(
  inventory: InventoryData,
  nodes: TopologyNode[],
  edges: TopologyEdge[],
  unitCardsRecord?: Record<string, UnitCard>
): ReconciliationReport {
  const nodeIds = new Set(nodes.map((n) => n.id));

  // 计算每种 role 的数量
  const roleCounts: Record<NodeRole, number> = {
    entry_router: 0,
    specialist: 0,
    delivery: 0,
    resource: 0,
    script: 0,
    config: 0,
    doc: 0,
    unknown: 0,
  };

  for (const node of nodes) {
    if (roleCounts[node.role] !== undefined) {
      roleCounts[node.role]++;
    } else {
      roleCounts.unknown++;
    }
  }

  // 检查所有边端点是否存在
  let invalidEdgesCount = 0;
  for (const edge of edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      invalidEdgesCount++;
    }
  }

  // 查找未分类文件
  const unclassifiedFiles: string[] = [];
  for (const fileItem of inventory.files) {
    const rel = fileItem.relPath;
    let classified = false;
    for (const node of nodes) {
      if (node.id === rel || (node.unitPath && rel.startsWith(node.unitPath))) {
        classified = true;
        break;
      }
    }
    if (!classified) {
      unclassifiedFiles.push(rel);
    }
  }

  // 统计模型真正理解 vs 代码规则降级的单元数量，不把降级项计入已理解数
  let modelGeneratedCount = 0;
  let ruleFallbackCount = 0;
  let failedCount = 0;
  if (unitCardsRecord) {
    const cards = Object.values(unitCardsRecord);
    modelGeneratedCount = cards.filter((c) => c.analysisSource === 'model').length;
    ruleFallbackCount = cards.filter((c) => c.analysisSource === 'code_rule').length;
    failedCount = cards.filter((c) => c.analysisSource === 'failed').length;
  }

  // 查找未连接单元
  const connectedNodeIds = new Set<string>();
  for (const edge of edges) {
    connectedNodeIds.add(edge.from);
    connectedNodeIds.add(edge.to);
  }
  const unconnectedUnits = nodes
    .filter((n) => !connectedNodeIds.has(n.id) && !connectedNodeIds.has(n.unitPath || ''))
    .map((n) => n.id);

  return {
    totalUnitCandidates: inventory.unit_candidates.length,
    classifiedNodesCount: modelGeneratedCount,
    modelGeneratedCount,
    ruleFallbackCount,
    failedCount,
    unclassifiedFiles,
    unconnectedUnits,
    roleCounts,
    invalidEdgesCount,
    allEdgeEndpointsExist: invalidEdgesCount === 0,
    modelUnderstoodCount: modelGeneratedCount,
  };
}

/**
 * 规则 4: 证据校验器 Evidence Verifier (纯代码，校验 file:line "quote")
 */
export function verifyEvidence(
  workspaceDir: string,
  tags: EvidenceTag[]
): EvidenceVerificationReport {
  let verifiedCount = 0;
  let unverifiedCount = 0;
  const verifiedList: EvidenceVerificationReport['tags'] = [];

  for (const tag of tags) {
    if (tag.type !== 'evidence') {
      unverifiedCount++;
      verifiedList.push({ tag, verified: false, reason: '非强证据引用标签 (包含推断或未知)' });
      continue;
    }

    if (!tag.filePath || !tag.quote) {
      unverifiedCount++;
      verifiedList.push({ tag, verified: false, reason: '缺失引用文件路径或引用字符串' });
      continue;
    }

    const fullPath = path.join(workspaceDir, tag.filePath);
    if (!fs.existsSync(fullPath)) {
      unverifiedCount++;
      verifiedList.push({ tag, verified: false, reason: `引用文件不存在: ${tag.filePath}` });
      continue;
    }

    try {
      const fileContent = fs.readFileSync(fullPath, 'utf-8');
      const lines = fileContent.split('\n');

      // 行号有效性校验
      if (tag.lineStart && (tag.lineStart < 1 || tag.lineStart > lines.length)) {
        unverifiedCount++;
        verifiedList.push({
          tag,
          verified: false,
          reason: `起始行号超出文件实际行数: ${tag.lineStart} > ${lines.length}`,
        });
        continue;
      }

      // 消除空白的引文匹配校验
      const cleanQuote = tag.quote.replace(/\s+/g, ' ').trim().toLowerCase();
      const cleanFileContent = fileContent.replace(/\s+/g, ' ').trim().toLowerCase();

      if (cleanFileContent.includes(cleanQuote)) {
        verifiedCount++;
        verifiedList.push({ tag, verified: true, reason: '证据文件与引用文本匹配一致' });
      } else {
        unverifiedCount++;
        verifiedList.push({ tag, verified: false, reason: `在 ${tag.filePath} 中未找到对应原文` });
      }
    } catch (e: any) {
      unverifiedCount++;
      verifiedList.push({ tag, verified: false, reason: `读取文件出错: ${e.message}` });
    }
  }

  const total = tags.length;
  const rate = total > 0 ? Number(((verifiedCount / total) * 100).toFixed(1)) : 100;

  return {
    totalTags: total,
    verifiedCount,
    unverifiedCount,
    verificationRate: rate,
    tags: verifiedList,
  };
}

/**
 * 规则 6: 覆盖率计算器 Coverage Table (纯代码计算)
 */
export function computeCoverageTable(
  workspaceDir: string,
  inventory: InventoryData,
  readFilesMap: Map<string, number> // filePath -> readLines
): CoverageTable {
  let totalWorkspaceLines = 0;
  let totalReadLines = 0;
  const fileDetails: CoverageTable['files'] = [];

  for (const fileItem of inventory.files) {
    const rel = fileItem.relPath;
    const linesRead = readFilesMap.get(rel) || 0;

    // 真实统计文本文件总行数（非按字节估算）
    const ext = path.extname(rel).toLowerCase();
    const isText = ['.md', '.ts', '.tsx', '.js', '.jsx', '.py', '.json', '.yaml', '.yml', '.toml', '.txt'].includes(ext);
    let totalLines = 1;
    if (isText) {
      const fullPath = path.join(workspaceDir, rel);
      if (fs.existsSync(fullPath)) {
        try {
          totalLines = Math.max(1, fs.readFileSync(fullPath, 'utf-8').split('\n').length);
        } catch {
          totalLines = 1;
        }
      }
    }

    totalWorkspaceLines += totalLines;
    totalReadLines += Math.min(linesRead, totalLines);

    let status: CoverageTable['files'][0]['status'] = '未读';
    if (linesRead >= totalLines) {
      status = '已读全文';
    } else if (linesRead > 0) {
      status = '已读部分';
    }

    fileDetails.push({
      filePath: rel,
      status,
      linesRead,
      totalLines,
    });
  }

  const overallCoveragePercentage =
    totalWorkspaceLines > 0
      ? Number(((totalReadLines / totalWorkspaceLines) * 100).toFixed(1))
      : 100;

  return {
    overallCoveragePercentage,
    files: fileDetails,
  };
}

/**
 * 代码规则单元卡片回退提取器（显式标明来源于代码规则，禁止填造模板内容）
 */
function extractDeterministicUnitCard(
  uc: InventoryData['unit_candidates'][0],
  workspaceDir: string,
  readFilesMap: Map<string, number>,
  reasonNote: string
): UnitCard {
  const fullInstructionPath = path.join(workspaceDir, uc.instructionFile);
  let content = '';
  if (fs.existsSync(fullInstructionPath)) {
    content = fs.readFileSync(fullInstructionPath, 'utf-8');
    readFilesMap.set(uc.instructionFile, uc.lineCount);
  }
  const lines = content.split('\n');

  // 严格遵循 F3：禁止按目录名子串推断角色，无模型判断时一律为 unknown
  const role: NodeRole = 'unknown';
  const roleSource = '未知 (代码规则回退)';

  // 仅从原文提取首段非空文本，无则返回 [未知]
  let purpose = '[未知]';
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const trimmed = lines[i].trim();
    if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('---') && trimmed.length > 5) {
      purpose = trimmed;
      break;
    }
  }

  // 提取 L2 内部编号步骤 (1. 2. 3.)
  const l2_internal_workflow: Array<{ stepIndex: number; description: string; evidence?: EvidenceTag }> = [];
  let stepIdx = 1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const match = line.match(/^(\d+)\.\s+(.+)$/);
    if (match && stepIdx <= 10) {
      l2_internal_workflow.push({
        stepIndex: stepIdx++,
        description: match[2].slice(0, 100),
        evidence: {
          type: 'evidence',
          filePath: uc.instructionFile,
          lineStart: i + 1,
          lineEnd: i + 1,
          quote: line.slice(0, 50),
        },
      });
    }
  }

  const primaryQuote = lines.find((l) => l.trim().length > 0)?.trim().slice(0, 40) || '';
  const rootEvidence: EvidenceTag = primaryQuote
    ? {
        type: 'evidence',
        filePath: uc.instructionFile,
        lineStart: 1,
        lineEnd: Math.min(5, lines.length),
        quote: primaryQuote,
      }
    : { type: 'unknown' };

  const analysisSource = reasonNote.includes('模型调用失败') ? 'failed' : 'code_rule';

  return {
    unitPath: uc.dirPath,
    instructionFile: uc.instructionFile,
    role,
    roleSource,
    purpose,
    activation_conditions: {
      when_to_use: ['[未知]'],
      when_not_to_use: ['[未知]'],
      evidence: rootEvidence,
    },
    declared_independence: '未知',
    inputs: ['[未知]'],
    outputs: ['[未知]'],
    external_dependencies: [],
    runtime_requirements: ['[未知]'],
    non_goals: ['[未知]'],
    l2_internal_workflow,
    evidenceTags: [rootEvidence],
    analysisSource,
    analysisNote: reasonNote,
  };
}

/**
 * 运行 Step 1 ~ Step 7 完整蓝图理解引擎 Pipeline
 */
export async function analyzeBlueprintPipeline(
  workspaceHash: string,
  inventory: InventoryData,
  options?: { forceRetry?: boolean; modelId?: string }
): Promise<BlueprintData> {
  const workspaceDir = path.join(WORKSPACES_DIR, workspaceHash);
  if (!fs.existsSync(workspaceDir)) {
    throw new Error(`工作空间不存在: ${workspaceHash}`);
  }

  if (options?.modelId) {
    setActiveModelId(options.modelId);
  }
  if (options?.forceRetry) {
    resetGeminiCooldown();
  }
  const force = Boolean(options?.forceRetry);

  const hasValidApiKey = hasValidGeminiApiKey();
  const ai = hasValidApiKey ? getSharedAIClient() : null;
  let modelCallCount = 0;
  let quotaAbortedReason: string | null = null;
  const readFilesMap = new Map<string, number>();

  // 1. Step 1: Unit cards (按单元批量调用以大幅节省 RPM 与 Token，或无密钥时确定性纯代码提取)
  const unitCardsRecord: Record<string, UnitCard> = {};
  const l2Workflows: L2Workflow[] = [];
  const allCollectedTags: EvidenceTag[] = [];

  if (!hasValidApiKey || !ai) {
    for (const uc of inventory.unit_candidates) {
      const card = extractDeterministicUnitCard(
        uc,
        workspaceDir,
        readFilesMap,
        '来源：代码规则（非模型理解；未配置有效 GEMINI_API_KEY）'
      );
      unitCardsRecord[uc.dirPath] = card;
      if (card.l2_internal_workflow.length > 0) {
        l2Workflows.push({ unitPath: uc.dirPath, steps: card.l2_internal_workflow });
      }
      if (card.evidenceTags) {
        allCollectedTags.push(...card.evidenceTags);
      }
    }
  } else {
    // 将候选单元按数量上限与字符预算分组，避免高并发突发打满 RPM
    const maxBatchCount = GEMINI_RATE_LIMIT_CONFIG.unitBatchMaxCount;
    const maxBatchChars = GEMINI_RATE_LIMIT_CONFIG.unitBatchMaxChars;
    type BatchEntry = {
      uc: InventoryData['unit_candidates'][0];
      content: string;
    };
    const batches: BatchEntry[][] = [];
    let currentBatch: BatchEntry[] = [];
    let currentChars = 0;

    for (const uc of inventory.unit_candidates) {
      const fullInstructionPath = path.join(workspaceDir, uc.instructionFile);
      let instructionContent = '';
      if (fs.existsSync(fullInstructionPath)) {
        instructionContent = fs.readFileSync(fullInstructionPath, 'utf-8');
        readFilesMap.set(uc.instructionFile, uc.lineCount);
      }
      const clipped = instructionContent.slice(0, 3200);
      if (
        currentBatch.length > 0 &&
        (currentBatch.length >= maxBatchCount || currentChars + clipped.length > maxBatchChars)
      ) {
        batches.push(currentBatch);
        currentBatch = [];
        currentChars = 0;
      }
      currentBatch.push({ uc, content: clipped });
      currentChars += clipped.length;
    }
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    const pushCardResult = (card: UnitCard) => {
      unitCardsRecord[card.unitPath] = card;
      if (card.l2_internal_workflow.length > 0) {
        l2Workflows.push({ unitPath: card.unitPath, steps: card.l2_internal_workflow });
      }
      if (card.evidenceTags) {
        allCollectedTags.push(...card.evidenceTags);
      }
    };

    for (const batch of batches) {
      if (quotaAbortedReason) {
        for (const item of batch) {
          pushCardResult(
            extractDeterministicUnitCard(
              item.uc,
              workspaceDir,
              readFilesMap,
              `来源：代码规则（非模型理解）；${quotaAbortedReason}`
            )
          );
        }
        continue;
      }

      const batchPayload = batch.map((b) => ({
        unitPath: b.uc.dirPath,
        instructionFile: b.uc.instructionFile,
        instructionContent: b.content,
      }));
      const promptText = BATCHED_UNIT_CARDS_PROMPT.replace(
        '<UNITS_BATCH_JSON>',
        JSON.stringify(batchPayload)
      );

      modelCallCount++;
      const understandModel = SYSTEM_MODELS.DEFAULT_UNDERSTANDING;
      const understandGenConfig = buildModelCallConfig(understandModel, {
        responseMimeType: 'application/json',
      });
      const callRes = await callGeminiWithRateLimit(
        async () =>
          ai.models.generateContent({
            model: understandModel.id,
            contents: promptText,
            config: understandGenConfig,
          }),
        { maxRetries: 2, modelId: understandModel.id, ignoreCooldown: force }
      );

      if (callRes.error || !callRes.result) {
        if (callRes.quotaExceeded) {
          quotaAbortedReason = callRes.error || '触发 Gemini API 配额限流 (429)';
        }
        const failReason = callRes.error || '未获得模型响应';
        for (const item of batch) {
          pushCardResult(
            extractDeterministicUnitCard(
              item.uc,
              workspaceDir,
              readFilesMap,
              `来源：代码规则（非模型理解）；模型调用失败：${failReason}`
            )
          );
        }
        continue;
      }

      try {
        const parsed = JSON.parse(stripJsonFence(callRes.result.text));
        const returnedCards: any[] = Array.isArray(parsed?.cards)
          ? parsed.cards
          : Array.isArray(parsed)
          ? parsed
          : [];
        const cardByPath = new Map<string, any>();
        for (const c of returnedCards) {
          if (c?.unitPath) cardByPath.set(String(c.unitPath), c);
        }

        for (const item of batch) {
          const parsedCard = cardByPath.get(item.uc.dirPath);
          if (!parsedCard) {
            pushCardResult(
              extractDeterministicUnitCard(
                item.uc,
                workspaceDir,
                readFilesMap,
                '来源：代码规则（非模型理解）；模型批量响应中缺失该单元输出'
              )
            );
            continue;
          }

          const rawInd = parsedCard.declared_independence;
          const declared_independence =
            rawInd === true || rawInd === '是' || rawInd === 'true'
              ? '是'
              : rawInd === false || rawInd === '否' || rawInd === 'false'
              ? '否'
              : '未知';

          const card: UnitCard = {
            unitPath: item.uc.dirPath,
            instructionFile: item.uc.instructionFile,
            role: parsedCard.role || 'unknown',
            roleSource: '模型判断 (带证据引文)',
            purpose: parsedCard.purpose || '[未知]',
            activation_conditions: parsedCard.activation_conditions || {
              when_to_use: ['[未知]'],
              when_not_to_use: ['[未知]'],
            },
            declared_independence,
            inputs: Array.isArray(parsedCard.inputs) && parsedCard.inputs.length > 0 ? parsedCard.inputs : ['[未知]'],
            outputs: Array.isArray(parsedCard.outputs) && parsedCard.outputs.length > 0 ? parsedCard.outputs : ['[未知]'],
            external_dependencies: Array.isArray(parsedCard.external_dependencies)
              ? parsedCard.external_dependencies
              : [],
            runtime_requirements:
              Array.isArray(parsedCard.runtime_requirements) && parsedCard.runtime_requirements.length > 0
                ? parsedCard.runtime_requirements
                : ['[未知]'],
            non_goals:
              Array.isArray(parsedCard.non_goals) && parsedCard.non_goals.length > 0
                ? parsedCard.non_goals
                : ['[未知]'],
            l2_internal_workflow: Array.isArray(parsedCard.l2_internal_workflow)
              ? parsedCard.l2_internal_workflow
              : [],
            evidenceTags: Array.isArray(parsedCard.evidenceTags) ? parsedCard.evidenceTags : [],
            analysisSource: 'model',
            analysisNote: '来源：模型批量理解',
          };
          pushCardResult(card);
        }
      } catch (parseErr: any) {
        for (const item of batch) {
          pushCardResult(
            extractDeterministicUnitCard(
              item.uc,
              workspaceDir,
              readFilesMap,
              `来源：代码规则（非模型理解）；模型响应 JSON 解析失败：${parseErr?.message || String(parseErr)}`
            )
          );
        }
      }
    }
  }

  // 2. Step 2: Synthesis (合成 L0, L1, L3)
  const authorStatements: Array<{ statement: string; evidence: EvidenceTag }> = [];
  const readmeItem = inventory.files.find((f) => f.relPath.toUpperCase() === 'README.MD');
  if (readmeItem) {
    const readmeText = fs.readFileSync(path.join(workspaceDir, readmeItem.relPath), 'utf-8');
    const readmeLines = readmeText.split('\n');
    readFilesMap.set(readmeItem.relPath, readmeLines.length);
    const firstNonEmptyIdx = readmeLines.findIndex((l) => l.trim().length > 0);
    if (firstNonEmptyIdx >= 0) {
      const firstLine = readmeLines[firstNonEmptyIdx].trim();
      authorStatements.push({
        statement: firstLine,
        evidence: {
          type: 'evidence',
          filePath: readmeItem.relPath,
          lineStart: firstNonEmptyIdx + 1,
          lineEnd: firstNonEmptyIdx + 1,
          quote: firstLine.slice(0, 60),
        },
      });
    }
  }

  // 精简单元卡片汇总体积，减少合成阶段 Token 消耗
  const compactUnitCards: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(unitCardsRecord)) {
    compactUnitCards[k] = {
      unitPath: v.unitPath,
      instructionFile: v.instructionFile,
      role: v.role,
      purpose: v.purpose,
      declared_independence: v.declared_independence,
      inputs: v.inputs,
      outputs: v.outputs,
      external_dependencies: v.external_dependencies,
      evidenceTags: (v.evidenceTags || []).slice(0, 3),
    };
  }

  const synthesisPrompt = SYNTHESIS_PROMPT
    .replace('<INVENTORY_SUMMARY>', JSON.stringify({ totalFiles: inventory.stats.totalFiles, formatFlags: inventory.standard_format_flags }))
    .replace('<AUTHOR_STATEMENTS>', JSON.stringify(authorStatements))
    .replace('<UNIT_CARDS_DATA>', JSON.stringify(compactUnitCards));

  let l0Intent: L0Intent = {
    purpose: '[未知]',
    intended_users: ['[未知]'],
    stated_non_goals: [],
    author_statements: authorStatements,
  };
  let l1Topology: L1Topology = { nodes: [], edges: [] };
  let l3Delivery: L3DeliveryRules = { acceptance_rules: [], delivery_formats: [] };
  let synthesisStatus: 'model' | 'code_rule' | 'failed' = 'code_rule';
  let synthesisNote = '来源：代码规则（非模型理解；未配置有效 GEMINI_API_KEY）';

  if (ai) {
    if (quotaAbortedReason) {
      synthesisStatus = 'failed';
      synthesisNote = `模型调用失败：${quotaAbortedReason}（未生成模型 L0/L1/L3 蓝图拓扑，禁止代码假造边关系）`;
    } else {
      modelCallCount++;
      const synthModel = SYSTEM_MODELS.DEFAULT_UNDERSTANDING;
      const synthGenConfig = buildModelCallConfig(synthModel, {
        responseMimeType: 'application/json',
      });
      const synthCall = await callGeminiWithRateLimit(
        async () =>
          ai.models.generateContent({
            model: synthModel.id,
            contents: synthesisPrompt,
            config: synthGenConfig,
          }),
        { maxRetries: 2, modelId: synthModel.id, ignoreCooldown: force }
      );

      if (synthCall.error || !synthCall.result) {
        if (synthCall.quotaExceeded) {
          quotaAbortedReason = synthCall.error || '触发 Gemini API 配额限流 (429)';
        }
        synthesisStatus = 'failed';
        synthesisNote = `模型调用失败：${synthCall.error || '未获得模型响应'}（未生成模型 L0/L1/L3 蓝图拓扑，禁止代码假造边关系）`;
      } else {
        try {
          const parsedSynth = JSON.parse(stripJsonFence(synthCall.result.text));
          if (parsedSynth.l0_intent) l0Intent = { ...l0Intent, ...parsedSynth.l0_intent };
          if (parsedSynth.l1_topology) l1Topology = parsedSynth.l1_topology;
          if (parsedSynth.l3_delivery_rules) l3Delivery = parsedSynth.l3_delivery_rules;
          synthesisStatus = 'model';
          synthesisNote = '来源：模型合成';
        } catch (parseErr: any) {
          synthesisStatus = 'failed';
          synthesisNote = `模型调用失败：蓝图合成响应 JSON 解析失败 (${parseErr?.message || String(parseErr)})（未生成模型 L0/L1/L3 蓝图拓扑，禁止代码假造边关系）`;
        }
      }
    }
  }

  // 约束 1: 若模型返回了 L1 节点，仅保留 inventory 实际存在的单元节点
  if (l1Topology.nodes && l1Topology.nodes.length > 0) {
    const validNodeIds = new Set([
      ...inventory.unit_candidates.map((u) => u.dirPath),
      ...inventory.files.map((f) => f.relPath),
    ]);
    l1Topology.nodes = l1Topology.nodes.filter((n) => validNodeIds.has(n.id) || validNodeIds.has(n.unitPath || ''));
  } else {
    l1Topology.nodes = [];
  }

  // 约束 2: 过滤没有真实证据的 must_precede 边
  l1Topology.edges = (l1Topology.edges || []).map((e) => {
    if (e.type === 'must_precede' && (!e.evidence || e.evidence.type !== 'evidence')) {
      return { ...e, type: 'may_invoke' }; // 强制降级为 may_invoke
    }
    return e;
  });

  // 3. Step 3: Code Reconciliation (排除仅代码规则降级的卡片以免虚高)
  const reconciliationReport = reconcileCode(inventory, l1Topology.nodes, l1Topology.edges, unitCardsRecord);

  // 4. Step 4: Evidence Verifier
  if (l0Intent.author_statements) {
    l0Intent.author_statements.forEach((st) => st.evidence && allCollectedTags.push(st.evidence));
  }
  l1Topology.edges.forEach((e) => e.evidence && allCollectedTags.push(e.evidence));
  l3Delivery.acceptance_rules.forEach((r) => r.evidence && allCollectedTags.push(r.evidence));

  const evidenceReport = verifyEvidence(workspaceDir, allCollectedTags);

  // 5. Step 5: Counterexample Pass (反例检索)
  const counterexamples: CounterexampleResult[] = [];
  const mustPrecedeEdges = l1Topology.edges.filter((e) => e.type === 'must_precede');
  for (const edge of mustPrecedeEdges) {
    if (!ai) {
      counterexamples.push({
        targetType: 'must_precede',
        targetId: `${edge.from}->${edge.to}`,
        claim: `硬性依赖: ${edge.from} -> ${edge.to}`,
        contradictionFound: false,
        explanation: '未测试：未配置有效 GEMINI_API_KEY，无法执行反例检索',
        status: '未测试',
      });
      continue;
    }

    if (quotaAbortedReason) {
      counterexamples.push({
        targetType: 'must_precede',
        targetId: `${edge.from}->${edge.to}`,
        claim: `硬性依赖: ${edge.from} -> ${edge.to}`,
        contradictionFound: false,
        explanation: `模型调用失败：${quotaAbortedReason}（无法判断是否存在反例）`,
        status: '模型调用失败',
      });
      continue;
    }

    modelCallCount++;
    const card = unitCardsRecord[edge.from];
    let fileContextSnippet = '[未能读取源文件内容]';
    if (card?.instructionFile) {
      const fp = path.join(workspaceDir, card.instructionFile);
      if (fs.existsSync(fp)) {
        fileContextSnippet = fs.readFileSync(fp, 'utf-8').slice(0, 4000);
      }
    }
    const prompt = COUNTEREXAMPLE_PROMPT
      .replace('<ASSERTION_TYPE>', 'must_precede')
      .replace('<CLAIM_TEXT>', `${edge.from} 必须先于 ${edge.to} 执行`)
      .replace('<TARGET_PATH>', edge.from)
      .replace('<FILE_CONTEXT>', fileContextSnippet);

    const cxModel = SYSTEM_MODELS.DEFAULT_UNDERSTANDING;
    const cxGenConfig = buildModelCallConfig(cxModel, {
      responseMimeType: 'application/json',
    });
    const cxCall = await callGeminiWithRateLimit(
      async () =>
        ai.models.generateContent({
          model: cxModel.id,
          contents: prompt,
          config: cxGenConfig,
        }),
      { maxRetries: 1, modelId: cxModel.id, ignoreCooldown: force }
    );

    if (cxCall.error || !cxCall.result) {
      if (cxCall.quotaExceeded) {
        quotaAbortedReason = cxCall.error || quotaAbortedReason;
      }
      counterexamples.push({
        targetType: 'must_precede',
        targetId: `${edge.from}->${edge.to}`,
        claim: `硬性依赖: ${edge.from} -> ${edge.to}`,
        contradictionFound: false,
        explanation: `模型调用失败：${cxCall.error || '未获得模型响应'}（无法判断是否存在反例）`,
        status: '模型调用失败',
      });
    } else {
      try {
        const parsed = JSON.parse(stripJsonFence(cxCall.result.text));
        counterexamples.push({
          targetType: 'must_precede',
          targetId: `${edge.from}->${edge.to}`,
          claim: `硬性依赖: ${edge.from} -> ${edge.to}`,
          contradictionFound: Boolean(parsed.contradictionFound),
          contradictionEvidence: parsed.contradictionEvidence,
          explanation: parsed.explanation || '模型未返回详细说明',
          status: '已检索',
        });
      } catch (err: any) {
        counterexamples.push({
          targetType: 'must_precede',
          targetId: `${edge.from}->${edge.to}`,
          claim: `硬性依赖: ${edge.from} -> ${edge.to}`,
          contradictionFound: false,
          explanation: `模型响应 JSON 解析失败：${err?.message || String(err)}（无法判断是否存在反例）`,
          status: '模型调用失败',
        });
      }
    }
  }

  if (counterexamples.length === 0) {
    counterexamples.push({
      targetType: 'must_precede',
      targetId: 'none',
      claim: '无硬性先后依赖断言',
      contradictionFound: false,
      explanation: '不适用（没有可检索的 must_precede 或 independent_entry 断言）',
      status: '不适用',
    });
  }

  // 6. Step 6: Coverage Table
  const coverageTable = computeCoverageTable(workspaceDir, inventory, readFilesMap);

  // 7. Step 7: Intent Probes (双路独立批量探针，共 2 次调用替代原 6 次 — 严禁写死 agrees: true)
  const intentProbes: IntentProbe[] = [];
  const probeQuestions = [
    '该项目主要面向哪类使用者？',
    '系统是否声明了明确的非目标 (Non-goals)？',
    '项目的核心交付物与预期产出格式是什么？',
  ];

  if (!ai) {
    for (const q of probeQuestions) {
      intentProbes.push({
        question: q,
        answerFromBlueprint: '[未测试]',
        answerFromRawFiles: '[未测试]',
        agrees: null,
        status: '未测试',
        notes: '未测试：未配置有效 GEMINI_API_KEY，未执行意图双路探针',
      });
    }
  } else if (quotaAbortedReason) {
    for (const q of probeQuestions) {
      intentProbes.push({
        question: q,
        answerFromBlueprint: '[模型调用失败]',
        answerFromRawFiles: '[模型调用失败]',
        agrees: null,
        status: '模型调用失败',
        notes: `模型调用失败：${quotaAbortedReason}`,
      });
    }
  } else {
    const questionsJson = JSON.stringify(probeQuestions);
    const probePromptBp = BATCHED_INTENT_PROBES_PROMPT
      .replace('<QUESTIONS_JSON>', questionsJson)
      .replace('<CONTEXT_DATA>', JSON.stringify(l0Intent));
    const probePromptRaw = BATCHED_INTENT_PROBES_PROMPT
      .replace('<QUESTIONS_JSON>', questionsJson)
      .replace(
        '<CONTEXT_DATA>',
        JSON.stringify(
          inventory.unit_candidates.map((u) => ({
            dirPath: u.dirPath,
            instructionFile: u.instructionFile,
            title: u.title,
            lineCount: u.lineCount,
          }))
        )
      );

    modelCallCount++;
    const probeModel = SYSTEM_MODELS.DEFAULT_UNDERSTANDING;
    const probeGenConfig = buildModelCallConfig(probeModel, {
      responseMimeType: 'application/json',
    });
    const bpCall = await callGeminiWithRateLimit(
      async () =>
        ai.models.generateContent({
          model: probeModel.id,
          contents: probePromptBp,
          config: probeGenConfig,
        }),
      { maxRetries: 1, modelId: probeModel.id, ignoreCooldown: force }
    );

    let rawCall: Awaited<ReturnType<typeof callGeminiWithRateLimit<any>>> | null = null;
    if (!bpCall.quotaExceeded) {
      modelCallCount++;
      rawCall = await callGeminiWithRateLimit(
        async () =>
          ai.models.generateContent({
            model: probeModel.id,
            contents: probePromptRaw,
            config: probeGenConfig,
          }),
        { maxRetries: 1, modelId: probeModel.id, ignoreCooldown: force }
      );
    }

    if (bpCall.error || !bpCall.result || !rawCall || rawCall.error || !rawCall.result) {
      const errMsg = bpCall.error || rawCall?.error || '模型调用失败';
      for (const q of probeQuestions) {
        intentProbes.push({
          question: q,
          answerFromBlueprint: '[模型调用失败]',
          answerFromRawFiles: '[模型调用失败]',
          agrees: null,
          status: '模型调用失败',
          notes: `模型调用失败：${errMsg}`,
        });
      }
    } else {
      try {
        const bpParsed = JSON.parse(stripJsonFence(bpCall.result.text));
        const rawParsed = JSON.parse(stripJsonFence(rawCall.result.text));
        const bpAnswers: Array<{ question?: string; answer?: string }> = Array.isArray(bpParsed?.answers)
          ? bpParsed.answers
          : [];
        const rawAnswers: Array<{ question?: string; answer?: string }> = Array.isArray(rawParsed?.answers)
          ? rawParsed.answers
          : [];

        probeQuestions.forEach((q, idx) => {
          const ans1 =
            bpAnswers.find((a) => a.question === q)?.answer || bpAnswers[idx]?.answer || '无法确定';
          const ans2 =
            rawAnswers.find((a) => a.question === q)?.answer || rawAnswers[idx]?.answer || '无法确定';
          intentProbes.push({
            question: q,
            answerFromBlueprint: ans1,
            answerFromRawFiles: ans2,
            agrees: null,
            status: '需人工比对',
            notes: '双路回答已生成，系统未执行自动语义一致性裁决（无法判断）',
          });
        });
      } catch (parseErr: any) {
        for (const q of probeQuestions) {
          intentProbes.push({
            question: q,
            answerFromBlueprint: '[模型调用失败]',
            answerFromRawFiles: '[模型调用失败]',
            agrees: null,
            status: '模型调用失败',
            notes: `模型响应 JSON 解析失败：${parseErr?.message || String(parseErr)}`,
          });
        }
      }
    }
  }

  const blueprintResult: BlueprintData = {
    workspaceHash,
    updatedAt: new Date().toISOString(),
    l0_intent: l0Intent,
    l1_topology: l1Topology,
    l2_workflows: l2Workflows,
    l3_delivery_rules: l3Delivery,
    unit_cards: unitCardsRecord,
    reconciliation_report: reconciliationReport,
    evidence_verification: evidenceReport,
    counterexamples,
    coverage_table: coverageTable,
    intent_probes: intentProbes,
    modelCallsCount: modelCallCount,
    synthesisStatus,
    synthesisNote,
  };

  // 持久化 blueprint.json 到工作空间
  saveBlueprint(workspaceHash, blueprintResult);

  // 写入证据账本 (Append-only)
  appendLedgerEntry({
    stage: 'STAGE2',
    action: 'SYNTHESIZE_BLUEPRINT',
    inputs_hash: workspaceHash,
    outputs_hash: crypto.createHash('sha256').update(JSON.stringify(blueprintResult)).digest('hex'),
    ref: {
      workspace_hash: workspaceHash,
      file_path: 'blueprint.json',
      details: `蓝图生成成功: L1 节点=${l1Topology.nodes.length}, 边=${l1Topology.edges.length}, 证据校验率=${evidenceReport.verificationRate}%, 模型调用=${modelCallCount}次`,
    },
  });

  return blueprintResult;
}
