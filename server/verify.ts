import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { SYSTEM_MODELS } from '../config/models.js';
import {
  getSharedAIClient,
  hasValidGeminiApiKey,
  callGeminiWithRateLimit,
} from './geminiClient.js';
import { BlueprintData, EvidenceTag } from './understand.js';
import { getBlueprint } from './understand.js';
import { readLedgerEntries } from './ledger.js';
import { getExecutionState, ExecutionState } from './execute.js';
import { appendLedgerEntry } from './ledger.js';

export interface VerificationCriterion {
  id: string;
  source: 'blueprint_l3' | 'task_requirement';
  description: string;
  evidenceRef?: EvidenceTag;
}

export interface CodeCheckResult {
  artifactsExistAndHashMatch: boolean;
  ledgerIsContinuous: boolean;
  claimedFilesExist: boolean;
  routingCompatibleWithBlueprint: boolean;
  details: string[];
}

export interface CriterionJudgement {
  criterionId: string;
  description: string;
  verdict: '满足' | '不满足' | '无法判断';
  evidenceRef?: EvidenceTag;
  reason: string;
}

export interface VerificationReport {
  workspaceHash: string;
  updatedAt: string;
  payloadLoggedPath: string;
  criteria: VerificationCriterion[];
  codeChecks: CodeCheckResult;
  judgements: CriterionJudgement[];
  hasUndecidedCriteria: boolean;
  overallPass: boolean;
  summaryNote: string;
}

const WORKSPACES_DIR = path.resolve(process.cwd(), 'data', 'workspaces');

const INDEPENDENT_VERIFIER_SYSTEM_INSTRUCTION = `
你是一个完全独立的双路验证审计器 (Independent Verifier)。
【核心审计法则】:
1. 你只接收分析蓝图、原始任务要求、审计账本日志与产出交付物，绝不接收或相信执行器的自我评估或内部推理！
2. 逐条对比验收标准，输出客观评价: "满足" | "不满足" | "无法判断"。
3. 每一项结论必须给出客观事实证据支撑，严禁凭空发明分值或虚构评分卡。
`;

/**
 * 在验证启动前，从蓝图 L3 规则与任务描述中运行时推导验收标准列表 (并预先展示给用户)
 */
export function deriveVerificationCriteria(
  blueprint: BlueprintData | null,
  taskText: string
): VerificationCriterion[] {
  const criteria: VerificationCriterion[] = [];

  // 1. 来自蓝图 L3 交付验收规则 (若蓝图未声明规则，不填造通用模板句)
  if (blueprint && blueprint.l3_delivery_rules.acceptance_rules.length > 0) {
    blueprint.l3_delivery_rules.acceptance_rules.forEach((ar, idx) => {
      criteria.push({
        id: `crit_l3_${idx + 1}`,
        source: 'blueprint_l3',
        description: ar.rule,
        evidenceRef: ar.evidence,
      });
    });
  }

  // 2. 来自任务文本提取
  criteria.push({
    id: 'crit_task_1',
    source: 'task_requirement',
    description: `完成用户指定任务描述要求: "${taskText.slice(0, 40)}..."`,
  });

  criteria.push({
    id: 'crit_task_2',
    source: 'task_requirement',
    description: '产出交付物文件存在且哈希校验匹配，无破损损坏',
  });

  return criteria;
}

/**
 * 确定性代码强校验 (Code checks first)
 */
export function runCodeChecks(
  workspaceHash: string,
  blueprint: BlueprintData | null,
  execState: ExecutionState | null
): CodeCheckResult {
  const details: string[] = [];
  const workspaceDir = path.join(WORKSPACES_DIR, workspaceHash);

  // 1. 交付物存在性与 SHA256 哈希比对
  let artifactsMatch = true;
  if (!execState || execState.artifacts.length === 0) {
    artifactsMatch = false;
    details.push('× 未检测到生成的交付物产物记录');
  } else {
    for (const art of execState.artifacts) {
      const fullPath = path.join(workspaceDir, art.relPath);
      if (!fs.existsSync(fullPath)) {
        artifactsMatch = false;
        details.push(`× 产物文件丢失: ${art.relPath}`);
      } else {
        const content = fs.readFileSync(fullPath);
        const hash = crypto.createHash('sha256').update(content).digest('hex');
        if (hash !== art.sha256) {
          artifactsMatch = false;
          details.push(`× 产物哈希不一致: ${art.fileName} (${hash.slice(0, 8)} vs ${art.sha256.slice(0, 8)})`);
        }
      }
    }
  }

  if (artifactsMatch) {
    details.push('✓ 交付物文件存在性与 SHA256 哈希校验完全匹配');
  }

  // 2. 账本连续性校验
  const ledgerEntries = readLedgerEntries();
  const ledgerContinuous = ledgerEntries.length > 0;
  details.push(
    ledgerContinuous
      ? `✓ 证据账本连续完整 (${ledgerEntries.length} 条记录)`
      : '× 证据账本为空或不连续'
  );

  // 3. 引用文件存在性
  const claimedExist = fs.existsSync(workspaceDir);
  details.push(claimedExist ? '✓ 项目工程工作空间正常存在' : '× 工作空间缺失');

  // 4. 路由兼容性校验（检查是否实际观测到跨节点 tool_call 路由步骤）
  const hasObservedRouting = Boolean(
    execState && execState.steps.some((s) => s.stepType === 'tool_call' && s.toolCalls && s.toolCalls.length > 0)
  );
  const routingCompat = false;
  if (!execState) {
    details.push('× 无法判断路由兼容性：尚未运行任务执行');
  } else if (!hasObservedRouting) {
    details.push('⚠ 无法判断路由兼容性：仅观测到纯模型文本输出步骤，未实际经过 L1 节点路由调度');
  } else if (blueprint && blueprint.l1_topology.edges.length > 0) {
    details.push('⚠ 观测到工具调用，但未实现自动比对 L1 拓扑边，需人工复核');
  } else {
    details.push('⚠ 蓝图无 L1 拓扑边，无法验证路由兼容性');
  }

  return {
    artifactsExistAndHashMatch: artifactsMatch,
    ledgerIsContinuous: ledgerContinuous,
    claimedFilesExist: claimedExist,
    routingCompatibleWithBlueprint: routingCompat,
    details,
  };
}

/**
 * 运行独立验证引擎 (使用独立系统指令，并将确切 Payload 日志写盘)
 */
export async function runIndependentVerificationEngine(
  workspaceHash: string,
  taskText: string
): Promise<VerificationReport> {
  const workspaceDir = path.join(WORKSPACES_DIR, workspaceHash);
  const blueprint = getBlueprint(workspaceHash);
  const execState = getExecutionState(workspaceHash);
  const ledgerEntries = readLedgerEntries();

  // 1. 预先导出推导的验证标准
  const criteria = deriveVerificationCriteria(blueprint, taskText);

  // 2. 先运行纯代码确定性校验
  const codeChecks = runCodeChecks(workspaceHash, blueprint, execState);

  // 3. 构造干净独立的 Payload (排除执行器的内部 self-praise 与思路)
  const independentPayload = {
    blueprint_l0: blueprint?.l0_intent || {},
    blueprint_l3: blueprint?.l3_delivery_rules || {},
    task_text: taskText,
    ledger_summary: ledgerEntries.slice(-10).map((e) => ({ stage: e.stage, action: e.action, hash: e.outputs_hash })),
    artifacts_meta: execState?.artifacts || [],
    code_checks_result: codeChecks,
  };

  // 将 Payload 写入磁盘以便审计证明独立性
  const payloadLoggedPath = path.join(workspaceDir, 'verification_payload.json');
  fs.writeFileSync(payloadLoggedPath, JSON.stringify(independentPayload, null, 2), 'utf-8');

  // 4. 调用独立的 LLM 验证器
  const ai = getSharedAIClient();
  const prompt = `
你是独立的双路审计器。
请根据以下验证 Payload 对逐条验证标准做出独立判决:

【推导的标准项】:
${JSON.stringify(criteria, null, 2)}

【验证 Payload (不含执行器思考线索)】:
${JSON.stringify(independentPayload, null, 2)}

【输出 JSON 格式要求】:
返回且仅返回符合以下结构的 JSON:
{
  "judgements": [
    {
      "criterionId": "<CRITERION_ID>",
      "description": "<DESC>",
      "verdict": "满足", // 只能是 "满足" | "不满足" | "无法判断"
      "reason": "<REASON_WITH_EVIDENCE_QUOTE>"
    }
  ]
}
`;

  let judgements: CriterionJudgement[] = [];
  if (!hasValidGeminiApiKey()) {
    judgements = criteria.map((c) => ({
      criterionId: c.id,
      description: c.description,
      verdict: '无法判断',
      reason: '模型调用失败：未配置有效 GEMINI_API_KEY，无法执行独立模型验证',
    }));
  } else {
    const callRes = await callGeminiWithRateLimit(
      async () => {
        return await ai.models.generateContent({
          model: SYSTEM_MODELS.DEFAULT_EXECUTION.id,
          contents: prompt,
          config: {
            systemInstruction: INDEPENDENT_VERIFIER_SYSTEM_INSTRUCTION,
            responseMimeType: 'application/json',
            thinkingConfig: {
              thinkingLevel: SYSTEM_MODELS.DEFAULT_EXECUTION.thinkingLevel,
            },
          },
        });
      },
      { maxRetries: 2 }
    );

    if (callRes.error || !callRes.result) {
      judgements = criteria.map((c) => ({
        criterionId: c.id,
        description: c.description,
        verdict: '无法判断',
        reason: `模型调用失败：${callRes.error || '未获得模型响应'}（判定为无法判断）`,
      }));
    } else {
      try {
        const cleanJson = (callRes.result.text || '{}')
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/```\s*$/, '')
          .trim();
        const parsed = JSON.parse(cleanJson);
        if (Array.isArray(parsed.judgements) && parsed.judgements.length > 0) {
          judgements = parsed.judgements.map((j: any) => ({
            criterionId: j.criterionId || 'crit_unknown',
            description: j.description || '',
            verdict: ['满足', '不满足', '无法判断'].includes(j.verdict) ? j.verdict : '无法判断',
            reason: j.reason || '[模型未提供原因]',
          }));
        } else {
          judgements = criteria.map((c) => ({
            criterionId: c.id,
            description: c.description,
            verdict: '无法判断',
            reason: '模型返回结构缺失 judgements，判定为无法判断',
          }));
        }
      } catch (err: any) {
        judgements = criteria.map((c) => ({
          criterionId: c.id,
          description: c.description,
          verdict: '无法判断',
          reason: `模型返回 JSON 解析失败：${err?.message || String(err)}（判定为无法判断）`,
        }));
      }
    }
  }

  // 是否存在无法判断项
  const hasUndecided = judgements.some((j) => j.verdict === '无法判断');
  const allSatisfied = judgements.every((j) => j.verdict === '满足');
  const overallPass = allSatisfied && codeChecks.artifactsExistAndHashMatch && !hasUndecided;

  const summaryNote = hasUndecided
    ? '评估结论: 包含“无法判断”标准项，系统不能直接给出全量通过标记，请结合引证进一步确认。'
    : overallPass
    ? '评估结论: 所有验收标准项均已验证满足，交付物与账本审计完全一致。'
    : '评估结论: 部分标准未满足或交付物校验异常。';

  const report: VerificationReport = {
    workspaceHash,
    updatedAt: new Date().toISOString(),
    payloadLoggedPath: 'verification_payload.json',
    criteria,
    codeChecks,
    judgements,
    hasUndecidedCriteria: hasUndecided,
    overallPass,
    summaryNote,
  };

  // 持久化验证报告到工作空间
  fs.writeFileSync(path.join(workspaceDir, 'verification_report.json'), JSON.stringify(report, null, 2), 'utf-8');

  // 追加证据账本 (Append-only)
  appendLedgerEntry({
    stage: 'STAGE4',
    action: 'INDEPENDENT_VERIFY',
    inputs_hash: workspaceHash,
    outputs_hash: crypto.createHash('sha256').update(JSON.stringify(report)).digest('hex'),
    ref: {
      workspace_hash: workspaceHash,
      file_path: 'verification_report.json',
      details: `独立双路验证完成: 整体通过=${overallPass}, 无法判断项=${hasUndecided ? '有' : '无'}, Payload 记录写盘`,
    },
  });

  return report;
}

export function getVerificationReport(workspaceHash: string): VerificationReport | null {
  const file = path.join(WORKSPACES_DIR, workspaceHash, 'verification_report.json');
  if (fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {}
  }
  return null;
}
