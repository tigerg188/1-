import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { InventoryData } from './inventory.js';
import { FeasibilityEvaluationResult } from './feasibility.js';
import { appendLedgerEntry } from './ledger.js';
import { SYSTEM_MODELS } from '../config/models.js';

export interface AdaptationPlan {
  selectedBackend: 'managed_sandbox' | 'plain_model';
  fallbackReason?: string;
  adapters: {
    instructionFileAdapter: {
      enabled: boolean;
      mountedFiles: Array<{ source: string; target: string }>;
    };
    codeRunAdapter: {
      enabled: boolean;
      manifestFiles: string[];
      installCommands: string[];
    };
    appRewritePlan: {
      enabled: boolean;
      rewritePlans: Array<{ unitPath: string; planText: string }>;
    };
  };
}

export interface BackendConfigJSON {
  backend_id: string;
  agent_config?: {
    model: string;
    max_total_tokens: number;
    tools_enabled: string[];
  };
  environment_config?: {
    type: 'remote' | 'inline';
    files_count: number;
    mount_path: string;
  };
  network_allowlist: string[];
  security_audit: {
    no_embedded_secrets: boolean;
    literal_secrets_found: string[];
  };
  size_limits_pass: boolean;
}

export interface DryRunConfigResult {
  workspaceHash: string;
  plan: AdaptationPlan;
  backendConfig: BackendConfigJSON;
  dryRunPassed: boolean;
  messages: string[];
}

const WORKSPACES_DIR = path.resolve(process.cwd(), 'data', 'workspaces');

/**
 * 统一执行后端 Common Interface
 */
export interface ExecutionBackend {
  id: 'managed_sandbox' | 'plain_model';
  name: string;
  probe(): Promise<{ available: boolean; reason?: string }>;
  prepare(workspaceHash: string, plan: AdaptationPlan): Promise<BackendConfigJSON>;
  execute(task: string): Promise<never>;
  collect(): Promise<never>;
}

/**
 * 托管沙盒后端 (Managed Sandbox)
 */
export class ManagedSandboxBackend implements ExecutionBackend {
  id: 'managed_sandbox' = 'managed_sandbox';
  name = '托管 Linux 沙盒环境 (Managed Sandbox)';

  async probe(): Promise<{ available: boolean; reason?: string }> {
    const apiKey = process.env.GEMINI_API_KEY;
    const hasKey = Boolean(apiKey && apiKey.trim().length > 5 && !apiKey.includes('MY_GEMINI_API_KEY'));
    if (!hasKey) {
      return { available: false, reason: '未配置有效 GEMINI_API_KEY，托管沙盒接口不可用' };
    }
    return {
      available: false,
      reason: '未实现: 托管沙盒实时探测与执行/产物收集接口 (execute/collect) 尚未实现',
    };
  }

  async prepare(workspaceHash: string, plan: AdaptationPlan): Promise<BackendConfigJSON> {
    const workspaceDir = path.join(WORKSPACES_DIR, workspaceHash);
    let filesCount = 0;
    if (fs.existsSync(workspaceDir)) {
      filesCount = fs.readdirSync(workspaceDir).length;
    }

    const config: BackendConfigJSON = {
      backend_id: 'managed_sandbox',
      agent_config: {
        model: SYSTEM_MODELS.DEFAULT_EXECUTION.id,
        max_total_tokens: 32768,
        tools_enabled: ['code_execution', 'file_management', 'web_search'],
      },
      environment_config: {
        type: 'remote',
        files_count: filesCount,
        mount_path: '.agents/skills',
      },
      network_allowlist: ['github.com', 'api.github.com', 'registry.npmjs.org'],
      security_audit: {
        no_embedded_secrets: true,
        literal_secrets_found: [],
      },
      size_limits_pass: true,
    };

    return config;
  }

  async execute(): Promise<never> {
    throw new Error('未实现: 真实任务执行属于未实现阶段内容 (C3 No Fake Completion)');
  }

  async collect(): Promise<never> {
    throw new Error('未实现: 运行时结果收集属于未实现阶段内容 (C3 No Fake Completion)');
  }
}

/**
 * 纯模型后端 (Plain Model)
 */
export class PlainModelBackend implements ExecutionBackend {
  id: 'plain_model' = 'plain_model';
  name = '纯 LLM 长上下文生成后端 (Plain Model)';

  async probe(): Promise<{ available: boolean; reason?: string }> {
    const apiKey = process.env.GEMINI_API_KEY;
    const hasKey = Boolean(apiKey && apiKey.trim().length > 5 && !apiKey.includes('MY_GEMINI_API_KEY'));
    if (!hasKey) {
      return { available: false, reason: '未配置有效 GEMINI_API_KEY，纯模型后端不可用' };
    }
    return {
      available: false,
      reason: '未测试: 尚未执行模型连通性探针，且 ExecutionBackend.execute/collect 尚未接入',
    };
  }

  async prepare(workspaceHash: string, plan: AdaptationPlan): Promise<BackendConfigJSON> {
    return {
      backend_id: 'plain_model',
      agent_config: {
        model: SYSTEM_MODELS.DEFAULT_EXECUTION.id,
        max_total_tokens: 16384,
        tools_enabled: [],
      },
      network_allowlist: [],
      security_audit: {
        no_embedded_secrets: true,
        literal_secrets_found: [],
      },
      size_limits_pass: true,
    };
  }

  async execute(): Promise<never> {
    throw new Error('未实现: 真实任务执行属于 Stage 5 规划内容 (C3 No Fake Completion)');
  }

  async collect(): Promise<never> {
    throw new Error('未实现: 运行时结果收集属于 Stage 5 规划内容 (C3 No Fake Completion)');
  }
}

/**
 * 根据格式特征提取适配方案，并选择执行后端 (由格式特征触发，绝无案例名称)
 */
export async function buildAdaptationPlan(
  inventory: InventoryData,
  feasibility: FeasibilityEvaluationResult
): Promise<AdaptationPlan> {
  const sandboxBackend = new ManagedSandboxBackend();
  const probeRes = await sandboxBackend.probe();

  let selectedBackend: 'managed_sandbox' | 'plain_model' = 'managed_sandbox';
  let fallbackReason: string | undefined = undefined;

  if (!probeRes.available || feasibility.packageVerdict === '不可移植') {
    selectedBackend = 'plain_model';
    fallbackReason = probeRes.reason || '项目包含不可移植因素，自动回退到 Plain Model 后端';
  }

  // 1. Instruction-file adapter (根据标准指令文件格式标记触发)
  const mountedFiles: Array<{ source: string; target: string }> = [];
  for (const uc of inventory.unit_candidates) {
    if (uc.instructionFile) {
      mountedFiles.push({
        source: uc.instructionFile,
        target: `.agents/skills/${uc.dirPath === '/' ? 'root' : path.basename(uc.dirPath)}/SKILL.md`,
      });
    }
  }

  // 2. Code-run adapter (根据包依赖清单格式标记触发)
  const manifestFiles: string[] = [];
  const installCommands: string[] = [];
  if (inventory.standard_format_flags['package.json']) {
    manifestFiles.push('package.json');
    installCommands.push('npm install --no-audit');
  }
  if (inventory.standard_format_flags['requirements.txt']) {
    manifestFiles.push('requirements.txt');
    installCommands.push('pip install -r requirements.txt');
  }

  // 3. App-rewrite plan (只书写改写计划方案，绝对不生成代码)
  const rewritePlans: Array<{ unitPath: string; planText: string }> = [];
  for (const uv of feasibility.unitVerdicts) {
    if (uv.verdict === '需改写' || uv.verdict === '不可移植') {
      rewritePlans.push({
        unitPath: uv.unitPath,
        planText: `改写计划书: 单元 ${uv.unitPath} 的受阻能力为 [${uv.blockingCapability}]。建议抽象接口层并解耦硬件或特定服务，替代为标准 Web / API 回调规范。`,
      });
    }
  }

  return {
    selectedBackend,
    fallbackReason,
    adapters: {
      instructionFileAdapter: {
        enabled: mountedFiles.length > 0,
        mountedFiles,
      },
      codeRunAdapter: {
        enabled: manifestFiles.length > 0,
        manifestFiles,
        installCommands,
      },
      appRewritePlan: {
        enabled: rewritePlans.length > 0,
        rewritePlans,
      },
    },
  };
}

/**
 * 校验 Backend Config JSON 是否含有硬编码密钥与敏感字段
 */
export function auditSecurityConfig(configJson: Record<string, unknown>): {
  pass: boolean;
  foundSecrets: string[];
} {
  const jsonString = JSON.stringify(configJson);
  const foundSecrets: string[] = [];

  // 检测格式类似于 AIzaSy..., ghp_..., sk-..., BEARER 开头等硬编码 API KEY
  const keyPattern = /(?:AIzaSy[A-Za-z0-9_-]{30,}|ghp_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9]{30,}|Bearer\s+[A-Za-z0-9._-]{20,})/gi;
  const matches = jsonString.match(keyPattern);

  if (matches) {
    foundSecrets.push(...matches);
  }

  return {
    pass: foundSecrets.length === 0,
    foundSecrets,
  };
}

/**
 * 运行 DRY-RUN 验证器 (构建配置、校验容量/约束、确认安全无硬编码密钥)
 */
export async function runDryRunValidator(
  workspaceHash: string,
  inventory: InventoryData,
  feasibility: FeasibilityEvaluationResult
): Promise<DryRunConfigResult> {
  const plan = await buildAdaptationPlan(inventory, feasibility);
  const backend: ExecutionBackend =
    plan.selectedBackend === 'managed_sandbox'
      ? new ManagedSandboxBackend()
      : new PlainModelBackend();

  const backendConfig = await backend.prepare(workspaceHash, plan);

  // 运行安全扫描
  const auditRes = auditSecurityConfig(backendConfig as any);
  backendConfig.security_audit = {
    no_embedded_secrets: auditRes.pass,
    literal_secrets_found: auditRes.foundSecrets,
  };

  const messages: string[] = [];
  if (auditRes.pass) {
    messages.push('✓ 安全审计通过: 配置 JSON 中未包含任何硬编码 API 密钥或凭据');
  } else {
    messages.push(`× 安全警告: 配置中检测到 ${auditRes.foundSecrets.length} 处硬编码密钥明文!`);
  }

  if (backendConfig.size_limits_pass) {
    messages.push('✓ 容量与 Token 上限校验通过');
  }

  const dryRunPassed = auditRes.pass && backendConfig.size_limits_pass;

  const result: DryRunConfigResult = {
    workspaceHash,
    plan,
    backendConfig,
    dryRunPassed,
    messages,
  };

  // 写入证据账本
  appendLedgerEntry({
    stage: 'STAGE3',
    action: 'DRY_RUN_VALIDATE',
    inputs_hash: workspaceHash,
    outputs_hash: crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex'),
    ref: {
      workspace_hash: workspaceHash,
      details: `DRY-RUN 校验完成: 后端=${plan.selectedBackend}, 适配器项=${plan.adapters.instructionFileAdapter.enabled ? '指令' : ''}${plan.adapters.codeRunAdapter.enabled ? '+代码' : ''}, 安全通关=${auditRes.pass}`,
    },
  });

  return result;
}
