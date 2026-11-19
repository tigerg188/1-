import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { SYSTEM_MODELS, GEMINI_RATE_LIMIT_CONFIG, buildModelCallConfig } from '../config/models.js';
import {
  getSharedAIClient,
  hasValidGeminiApiKey,
  callGeminiWithRateLimit,
} from './geminiClient.js';
import { getInventory } from './inventory.js';
import { getFeasibilityResult } from './feasibility.js';
import { buildAdaptationPlan, AdaptationPlan } from './adapters.js';
import { appendLedgerEntry } from './ledger.js';
import { getBlueprint } from './understand.js';

export interface ExecutionStep {
  stepIndex: number;
  timestamp: string;
  stepType: 'user_input' | 'thought' | 'tool_call' | 'model_output' | 'artifact_generated' | 'error';
  toolCalls?: string[];
  truncatedInputOutput: string;
  fullContentHash: string;
  tokensUsed: number;
  error?: string;
}

export interface ArtifactMeta {
  fileName: string;
  relPath: string;
  size: number;
  sha256: string;
  createdAt: string;
}

export interface ExecutionState {
  workspaceHash: string;
  taskText: string;
  testMode: boolean;
  tokenBudget: number;
  tokensUsed: number;
  status: 'running' | 'paused_quota' | 'incomplete' | 'completed' | 'failed';
  statusMessage: string;
  interactionId?: string;
  environmentId?: string;
  steps: ExecutionStep[];
  artifacts: ArtifactMeta[];
  updatedAt: string;
}

const WORKSPACES_DIR = path.resolve(process.cwd(), 'data', 'workspaces');

/**
 * 内存级活跃执行任务注册表，防止并发重复提交及识别进程重启导致的陈旧 running 状态
 */
const activeExecutions = new Map<string, Promise<void>>();

/**
 * 获取现有任务执行状态（若检测到服务重启导致遗留的孤立 running 状态，诚实纠正为 incomplete）
 */
export function getExecutionState(workspaceHash: string): ExecutionState | null {
  const stateFile = path.join(WORKSPACES_DIR, workspaceHash, 'execution_state.json');
  if (fs.existsSync(stateFile)) {
    try {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as ExecutionState;
      if (state.status === 'running' && !activeExecutions.has(workspaceHash)) {
        state.status = 'incomplete';
        state.statusMessage = '上次执行因服务重启或进程中断未能完成，可点击“继续运行保存的进度”或重新启动任务';
        state.updatedAt = new Date().toISOString();
        saveExecutionState(workspaceHash, state);
      }
      return state;
    } catch {}
  }
  return null;
}

export function saveExecutionState(workspaceHash: string, state: ExecutionState) {
  const workspaceDir = path.join(WORKSPACES_DIR, workspaceHash);
  if (!fs.existsSync(workspaceDir)) {
    fs.mkdirSync(workspaceDir, { recursive: true });
  }
  const stateFile = path.join(workspaceDir, 'execution_state.json');
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8');
}

export function readExecutionArtifact(
  workspaceHash: string,
  fileName: string
): { fileName: string; content: string; size: number; sha256: string } {
  const safeName = path.basename(fileName);
  const artifactPath = path.join(WORKSPACES_DIR, workspaceHash, 'artifacts', safeName);
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`未找到交付物文件: ${safeName}`);
  }
  const buf = fs.readFileSync(artifactPath);
  return {
    fileName: safeName,
    content: buf.toString('utf-8'),
    size: buf.length,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
  };
}

/**
 * 后台异步执行纯模型任务，避免同步长连接请求触发网关 502/504 超时
 */
async function executeModelInBackground(
  workspaceHash: string,
  initialState: ExecutionState,
  plan: AdaptationPlan,
  inputHash: string
): Promise<void> {
  const workspaceDir = path.join(WORKSPACES_DIR, workspaceHash);
  const stepsArtifactsDir = path.join(workspaceDir, 'step_artifacts');
  if (!fs.existsSync(stepsArtifactsDir)) {
    fs.mkdirSync(stepsArtifactsDir, { recursive: true });
  }

  // 每次持久化均使用当前状态拷贝
  const state: ExecutionState = {
    ...initialState,
    steps: [...initialState.steps],
    artifacts: [...initialState.artifacts],
  };

  try {
    if (!hasValidGeminiApiKey()) {
      const errMsg = '模型调用失败：未配置有效 GEMINI_API_KEY';
      const errHash = crypto.createHash('sha256').update(errMsg).digest('hex');
      state.steps.push({
        stepIndex: state.steps.length + 1,
        timestamp: new Date().toISOString(),
        stepType: 'error',
        truncatedInputOutput: errMsg,
        fullContentHash: errHash,
        tokensUsed: 0,
        error: errMsg,
      });
      state.status = 'failed';
      state.statusMessage = errMsg;
      state.updatedAt = new Date().toISOString();
      saveExecutionState(workspaceHash, state);
      appendLedgerEntry({
        stage: 'STAGE4',
        action: 'EXECUTE_FAILED',
        inputs_hash: inputHash,
        outputs_hash: errHash,
        ref: { workspace_hash: workspaceHash, details: errMsg },
      });
      return;
    }

    const ai = getSharedAIClient();
    const modelCfg = state.testMode
      ? SYSTEM_MODELS.DEFAULT_EXECUTION_TEST
      : SYSTEM_MODELS.DEFAULT_EXECUTION;

    const blueprint = getBlueprint(workspaceHash);
    const blueprintContextLines: string[] = [];
    if (blueprint && blueprint.synthesisStatus === 'model' && blueprint.l0_intent?.purpose) {
      blueprintContextLines.push(`- 项目蓝图核心意图: ${blueprint.l0_intent.purpose.slice(0, 240)}`);
    }
    if (plan.adapters.instructionFileAdapter.mountedFiles.length > 0) {
      const mountedPreview = plan.adapters.instructionFileAdapter.mountedFiles
        .slice(0, 8)
        .map((m) => m.source)
        .join(', ');
      blueprintContextLines.push(`- 已挂载指令文件列表: ${mountedPreview}`);
    }

    state.statusMessage = `正在排队调用 ${modelCfg.name} 生成结果（已配置 ${Math.round(
      GEMINI_RATE_LIMIT_CONFIG.executionTimeoutMs / 1000
    )} 秒超时保护）...`;
    state.updatedAt = new Date().toISOString();
    saveExecutionState(workspaceHash, state);

    const systemInstruction = state.testMode
      ? `你是纯文本任务推理模块（测试模式）。
请紧扣用户输入要求，输出结构清晰、精简浓缩的纯文本分析或结果（建议控制在 600~1200 字以内以节约配额）。
注意：当前未挂载真实项目文件沙盒，也未执行任何外部命令。`
      : `你是纯文本任务推理模块。
请仅根据用户输入要求输出完整、条理清晰的纯文本分析或结果说明。
注意：当前未挂载真实项目文件沙盒，也未执行任何外部命令。`;

    const modelInputText = `
【执行任务要求】:
${state.taskText}

【当前运行模式】:
- 实际运行方式: 纯模型单轮文本生成 (注: 托管沙盒尚未实现，适配器推荐为 ${plan.selectedBackend}，依赖命令 ${
      plan.adapters.codeRunAdapter.installCommands.join('; ') || '无'
    } 并未实际执行)
- 测试模式: ${state.testMode ? '开启 (限制输出篇幅与 Token 范围)' : '关闭'}
- Token 预算上限: ${state.tokenBudget}
${blueprintContextLines.length > 0 ? blueprintContextLines.join('\n') : ''}
`;

    const maxOutputTokens = state.testMode
      ? modelCfg.maxOutputTokens
      : Math.min(modelCfg.maxOutputTokens, Math.max(2048, state.tokenBudget));

    const callResult = await callGeminiWithRateLimit(
      async () => {
        return await ai.models.generateContent({
          model: modelCfg.id,
          contents: modelInputText,
          config: buildModelCallConfig(modelCfg, {
            systemInstruction,
            maxOutputTokens,
          }),
        });
      },
      {
        maxRetries: 2,
        timeoutMs: GEMINI_RATE_LIMIT_CONFIG.executionTimeoutMs,
        modelId: modelCfg.id,
        ignoreCooldown: false,
      }
    );

    if (callResult.quotaExceeded) {
      const msg = `额度已用完，进度已保存，可稍后继续（${callResult.error || '触发 429 限流'}）`;
      const errHash = crypto.createHash('sha256').update(msg).digest('hex');
      state.steps.push({
        stepIndex: state.steps.length + 1,
        timestamp: new Date().toISOString(),
        stepType: 'error',
        truncatedInputOutput: msg.slice(0, 150),
        fullContentHash: errHash,
        tokensUsed: 0,
        error: msg,
      });
      state.status = 'paused_quota';
      state.statusMessage = msg;
      state.updatedAt = new Date().toISOString();
      saveExecutionState(workspaceHash, state);
      appendLedgerEntry({
        stage: 'STAGE4',
        action: 'EXECUTE_PAUSED_QUOTA',
        inputs_hash: inputHash,
        outputs_hash: errHash,
        ref: { workspace_hash: workspaceHash, details: msg },
      });
      return;
    }

    if (callResult.error) {
      const msg = `执行遇到错误: ${callResult.error}`;
      const errHash = crypto.createHash('sha256').update(msg).digest('hex');
      state.steps.push({
        stepIndex: state.steps.length + 1,
        timestamp: new Date().toISOString(),
        stepType: 'error',
        truncatedInputOutput: msg.slice(0, 150),
        fullContentHash: errHash,
        tokensUsed: 0,
        error: msg,
      });
      state.status = 'failed';
      state.statusMessage = msg;
      state.updatedAt = new Date().toISOString();
      saveExecutionState(workspaceHash, state);
      appendLedgerEntry({
        stage: 'STAGE4',
        action: 'EXECUTE_FAILED',
        inputs_hash: inputHash,
        outputs_hash: errHash,
        ref: { workspace_hash: workspaceHash, details: msg },
      });
      return;
    }

    const responseText = callResult.result?.text;
    if (!responseText || !responseText.trim()) {
      const msg = '模型返回内容为空，未生成有效交付物';
      const errHash = crypto.createHash('sha256').update(msg).digest('hex');
      state.steps.push({
        stepIndex: state.steps.length + 1,
        timestamp: new Date().toISOString(),
        stepType: 'error',
        truncatedInputOutput: msg,
        fullContentHash: errHash,
        tokensUsed: 0,
        error: msg,
      });
      state.status = 'failed';
      state.statusMessage = msg;
      state.updatedAt = new Date().toISOString();
      saveExecutionState(workspaceHash, state);
      appendLedgerEntry({
        stage: 'STAGE4',
        action: 'EXECUTE_FAILED',
        inputs_hash: inputHash,
        outputs_hash: errHash,
        ref: { workspace_hash: workspaceHash, details: msg },
      });
      return;
    }

    const responseHash = crypto.createHash('sha256').update(responseText).digest('hex');
    const usageMeta = (callResult.result as any)?.usageMetadata;
    const realTokens =
      typeof usageMeta?.totalTokenCount === 'number' && usageMeta.totalTokenCount > 0
        ? usageMeta.totalTokenCount
        : Math.ceil(responseText.length / 4);

    // 记录模型输出步骤
    const modelStep: ExecutionStep = {
      stepIndex: state.steps.length + 1,
      timestamp: new Date().toISOString(),
      stepType: 'model_output',
      truncatedInputOutput: responseText.slice(0, 150),
      fullContentHash: responseHash,
      tokensUsed: realTokens,
    };
    state.steps.push(modelStep);
    state.tokensUsed += realTokens;

    fs.writeFileSync(path.join(stepsArtifactsDir, `step_${modelStep.stepIndex}.txt`), responseText, 'utf-8');

    // 生成并校验交付物产物
    const artifactsDir = path.join(workspaceDir, 'artifacts');
    if (!fs.existsSync(artifactsDir)) {
      fs.mkdirSync(artifactsDir, { recursive: true });
    }

    const outputArtifactName = `output_${Date.now()}.txt`;
    const outputArtifactPath = path.join(artifactsDir, outputArtifactName);
    fs.writeFileSync(outputArtifactPath, responseText, 'utf-8');

    const artifactStat = fs.statSync(outputArtifactPath);
    const artifactMeta: ArtifactMeta = {
      fileName: outputArtifactName,
      relPath: `artifacts/${outputArtifactName}`,
      size: artifactStat.size,
      sha256: responseHash,
      createdAt: new Date().toISOString(),
    };

    state.artifacts.push(artifactMeta);
    state.status = 'completed';
    state.statusMessage = '纯模型单轮文本生成完成，产出文本已记录 SHA256（未在沙盒中运行项目代码）';
    state.updatedAt = new Date().toISOString();

    saveExecutionState(workspaceHash, state);

    appendLedgerEntry({
      stage: 'STAGE4',
      action: 'EXECUTE_STEP_MODEL_OUTPUT',
      inputs_hash: inputHash,
      outputs_hash: responseHash,
      ref: {
        workspace_hash: workspaceHash,
        file_path: artifactMeta.relPath,
        details: `任务执行完成: Tokens=${state.tokensUsed}/${state.tokenBudget}, 交付物哈希=${responseHash.slice(0, 16)}...`,
      },
    });
  } catch (err: any) {
    const msg = `后台执行异常: ${err?.message || '未知内部错误'}`;
    const errHash = crypto.createHash('sha256').update(msg).digest('hex');
    state.steps.push({
      stepIndex: state.steps.length + 1,
      timestamp: new Date().toISOString(),
      stepType: 'error',
      truncatedInputOutput: msg.slice(0, 150),
      fullContentHash: errHash,
      tokensUsed: 0,
      error: msg,
    });
    state.status = 'failed';
    state.statusMessage = msg;
    state.updatedAt = new Date().toISOString();
    saveExecutionState(workspaceHash, state);
    appendLedgerEntry({
      stage: 'STAGE4',
      action: 'EXECUTE_FAILED',
      inputs_hash: inputHash,
      outputs_hash: errHash,
      ref: { workspace_hash: workspaceHash, details: msg },
    });
  }
}

/**
 * 启动或恢复任务执行引擎（立即返回 running 状态并后台异步执行，前端通过状态接口轮询进度）
 */
export async function startOrResumeTaskExecution(
  workspaceHash: string,
  taskText: string,
  options: { testMode?: boolean; tokenBudget?: number; resume?: boolean }
): Promise<ExecutionState> {
  const workspaceDir = path.join(WORKSPACES_DIR, workspaceHash);
  if (!fs.existsSync(workspaceDir)) {
    throw new Error(`工作空间不存在: ${workspaceHash}`);
  }

  // 若同一工作空间已有活跃后台任务在运行，直接返回当前状态避免重复并发调用
  if (activeExecutions.has(workspaceHash)) {
    const current = getExecutionState(workspaceHash);
    if (current) return current;
  }

  const inventory = getInventory(workspaceHash);
  const feasibility = getFeasibilityResult(workspaceHash);
  if (!feasibility) {
    throw new Error('需先在“适配”页面生成可移植性评估结果');
  }

  const plan = await buildAdaptationPlan(inventory, feasibility);
  let state = getExecutionState(workspaceHash);

  const testMode = options.testMode ?? true;
  const tokenBudget = options.tokenBudget || (testMode ? 10000 : 30000);
  const inputHash = crypto.createHash('sha256').update(taskText).digest('hex');

  const stepsArtifactsDir = path.join(workspaceDir, 'step_artifacts');
  if (!fs.existsSync(stepsArtifactsDir)) {
    fs.mkdirSync(stepsArtifactsDir, { recursive: true });
  }

  if (!state || !options.resume) {
    const userTokens = Math.ceil(taskText.length / 4);
    const userStep: ExecutionStep = {
      stepIndex: 1,
      timestamp: new Date().toISOString(),
      stepType: 'user_input',
      truncatedInputOutput: taskText.slice(0, 100),
      fullContentHash: inputHash,
      tokensUsed: userTokens,
    };
    state = {
      workspaceHash,
      taskText,
      testMode,
      tokenBudget,
      tokensUsed: userTokens,
      status: 'running',
      statusMessage: '任务已启动，正在初始化纯模型执行...',
      steps: [userStep],
      artifacts: [],
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(stepsArtifactsDir, `step_${userStep.stepIndex}.txt`), taskText, 'utf-8');
    saveExecutionState(workspaceHash, state);

    appendLedgerEntry({
      stage: 'STAGE4',
      action: 'EXECUTE_STEP_USER_INPUT',
      inputs_hash: inputHash,
      outputs_hash: inputHash,
      ref: {
        workspace_hash: workspaceHash,
        details: `任务执行开始: 测试模式=${testMode}, Token 预算=${tokenBudget}, 描述="${taskText.slice(0, 30)}..."`,
      },
    });
  } else {
    const resumeMsg = '从断点状态恢复任务继续执行';
    const resumeHash = crypto.createHash('sha256').update(resumeMsg).digest('hex');
    state.status = 'running';
    state.statusMessage = '正在从上次保存的进度恢复执行...';
    state.updatedAt = new Date().toISOString();
    state.steps.push({
      stepIndex: state.steps.length + 1,
      timestamp: new Date().toISOString(),
      stepType: 'thought',
      truncatedInputOutput: resumeMsg,
      fullContentHash: resumeHash,
      tokensUsed: 0,
    });
    saveExecutionState(workspaceHash, state);

    appendLedgerEntry({
      stage: 'STAGE4',
      action: 'EXECUTE_RESUMED',
      inputs_hash: inputHash,
      outputs_hash: resumeHash,
      ref: {
        workspace_hash: workspaceHash,
        details: `任务断点恢复执行: 测试模式=${state.testMode}, Token 预算=${state.tokenBudget}`,
      },
    });
  }

  const jobPromise = executeModelInBackground(workspaceHash, state, plan, inputHash).finally(() => {
    activeExecutions.delete(workspaceHash);
  });
  activeExecutions.set(workspaceHash, jobPromise);

  return state;
}

/**
 * 继续运行 incomplete 或 paused_quota 状态的任务
 */
export async function continueIncompleteTask(workspaceHash: string): Promise<ExecutionState> {
  const state = getExecutionState(workspaceHash);
  if (!state) {
    throw new Error('未找到任务执行状态');
  }
  return startOrResumeTaskExecution(workspaceHash, state.taskText, {
    testMode: state.testMode,
    tokenBudget: state.tokenBudget,
    resume: true,
  });
}
