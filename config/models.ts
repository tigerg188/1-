import { ThinkingLevel } from '@google/genai';

/**
 * 统一模型与 Agent 配置文件
 * 严格遵从 C6 (Quota-Friendly) 与 Gemini API 调用规范：
 * 1. 所有模型与 Agent ID 仅在本文件中集中配置，禁止分散在业务逻辑代码中；
 * 2. 支持灵活切换官方模型（如 Gemini 4 Hydrogen、Gemini 3.1 Flash Lite、Gemini Flash Latest、Gemini 4 Argon）；
 * 3. 严格遵循各模型参数规范：Gemini 4 系列使用 thinkingConfig.thinkingLevel，Gemini 3.1 Flash Lite 使用 MINIMAL，禁止传入已弃用参数。
 */

export interface ModelOption {
  id: string;
  name: string;
  description: string;
  provider: string;
  supportsThinking: boolean;
  defaultThinkingLevel?: ThinkingLevel;
  maxOutputTokens: number;
}

export const AVAILABLE_MODELS: Record<string, ModelOption> = {
  'gemini-4-hydrogen': {
    id: 'gemini-4-hydrogen',
    name: 'Gemini 4 Hydrogen',
    description: '官方推荐：多步逻辑理解与生成速度兼备',
    provider: 'google',
    supportsThinking: true,
    defaultThinkingLevel: ThinkingLevel.LOW,
    maxOutputTokens: 8192,
  },
  'gemini-3.1-flash-lite': {
    id: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite',
    description: '极速高配额：配额充裕、超低延迟，高频调用与限流恢复首选',
    provider: 'google',
    supportsThinking: false,
    maxOutputTokens: 8192,
  },
  'gemini-flash-latest': {
    id: 'gemini-flash-latest',
    name: 'Gemini Flash Latest',
    description: '自动指向官方最新稳定 Flash 系列版本',
    provider: 'google',
    supportsThinking: false,
    maxOutputTokens: 8192,
  },
  'gemini-4-argon': {
    id: 'gemini-4-argon',
    name: 'Gemini 4 Argon',
    description: '复杂深度推理与代码架构分析（适合高阶任务）',
    provider: 'google',
    supportsThinking: true,
    defaultThinkingLevel: ThinkingLevel.LOW,
    maxOutputTokens: 8192,
  },
};

export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  thinkingLevel?: ThinkingLevel;
  maxOutputTokens: number;
}

let activeModelId: string = 'gemini-4-hydrogen';

export function getActiveModelId(): string {
  return activeModelId;
}

export function setActiveModelId(modelId: string): ModelOption {
  const clean = String(modelId || '').replace(/^models\//, '').trim();
  if (AVAILABLE_MODELS[clean]) {
    activeModelId = clean;
  } else if (clean) {
    AVAILABLE_MODELS[clean] = {
      id: clean,
      name: clean,
      description: '动态指定模型',
      provider: 'google',
      supportsThinking: clean.startsWith('gemini-4'),
      defaultThinkingLevel: clean.startsWith('gemini-4') ? ThinkingLevel.LOW : undefined,
      maxOutputTokens: 8192,
    };
    activeModelId = clean;
  }
  syncSystemModels();
  return AVAILABLE_MODELS[activeModelId];
}

export const SYSTEM_MODELS: Record<string, ModelConfig> = {
  DEFAULT_UNDERSTANDING: {
    id: 'gemini-4-hydrogen',
    name: 'Gemini 4 Hydrogen',
    provider: 'google',
    thinkingLevel: ThinkingLevel.LOW,
    maxOutputTokens: 8192,
  },
  DEFAULT_FEASIBILITY: {
    id: 'gemini-4-hydrogen',
    name: 'Gemini 4 Hydrogen',
    provider: 'google',
    thinkingLevel: ThinkingLevel.LOW,
    maxOutputTokens: 8192,
  },
  DEFAULT_EXECUTION: {
    id: 'gemini-4-hydrogen',
    name: 'Gemini 4 Hydrogen',
    provider: 'google',
    thinkingLevel: ThinkingLevel.MEDIUM,
    maxOutputTokens: 8192,
  },
  DEFAULT_EXECUTION_TEST: {
    id: 'gemini-4-hydrogen',
    name: 'Gemini 4 Hydrogen (测试模式)',
    provider: 'google',
    thinkingLevel: ThinkingLevel.LOW,
    maxOutputTokens: 2048,
  },
};

function syncSystemModels() {
  const active = AVAILABLE_MODELS[activeModelId] || AVAILABLE_MODELS['gemini-4-hydrogen'];
  SYSTEM_MODELS.DEFAULT_UNDERSTANDING = {
    id: active.id,
    name: active.name,
    provider: active.provider,
    thinkingLevel: active.supportsThinking ? (active.defaultThinkingLevel ?? ThinkingLevel.LOW) : undefined,
    maxOutputTokens: active.maxOutputTokens,
  };
  SYSTEM_MODELS.DEFAULT_FEASIBILITY = {
    id: active.id,
    name: active.name,
    provider: active.provider,
    thinkingLevel: active.supportsThinking ? (active.defaultThinkingLevel ?? ThinkingLevel.LOW) : undefined,
    maxOutputTokens: active.maxOutputTokens,
  };
  SYSTEM_MODELS.DEFAULT_EXECUTION = {
    id: active.id,
    name: active.name,
    provider: active.provider,
    thinkingLevel: active.supportsThinking ? ThinkingLevel.MEDIUM : undefined,
    maxOutputTokens: active.maxOutputTokens,
  };
  SYSTEM_MODELS.DEFAULT_EXECUTION_TEST = {
    id: active.id,
    name: `${active.name} (测试模式)`,
    provider: active.provider,
    thinkingLevel: active.supportsThinking ? ThinkingLevel.LOW : undefined,
    maxOutputTokens: 2048,
  };
}

export function buildModelCallConfig(
  modelCfg: ModelConfig,
  overrides?: {
    responseMimeType?: string;
    maxOutputTokens?: number;
    systemInstruction?: string;
    thinkingLevel?: ThinkingLevel;
  }
): Record<string, any> {
  const config: Record<string, any> = {};
  if (overrides?.responseMimeType) {
    config.responseMimeType = overrides.responseMimeType;
  }
  if (overrides?.systemInstruction) {
    config.systemInstruction = overrides.systemInstruction;
  }
  if (typeof overrides?.maxOutputTokens === 'number') {
    config.maxOutputTokens = overrides.maxOutputTokens;
  } else if (modelCfg.maxOutputTokens) {
    config.maxOutputTokens = modelCfg.maxOutputTokens;
  }

  const targetLevel = overrides?.thinkingLevel ?? modelCfg.thinkingLevel;
  if (targetLevel && modelCfg.id.startsWith('gemini-4')) {
    config.thinkingConfig = { thinkingLevel: targetLevel };
  } else if (modelCfg.id.startsWith('gemini-3.1-flash-lite')) {
    config.thinkingConfig = { thinkingLevel: ThinkingLevel.MINIMAL };
  }
  return config;
}

export const GEMINI_RATE_LIMIT_CONFIG = {
  /** 串行请求最小间隔（毫秒），避免并发突发触发 RPM 限流 */
  minIntervalMs: 1800,
  /** 单次请求默认超时时间（毫秒） */
  perAttemptTimeoutMs: 60000,
  /** 长文本执行阶段单次请求超时时间（毫秒，防止深度推理生成被 45 秒误杀） */
  executionTimeoutMs: 180000,
  /** 遭遇 429 RetryInfo 时允许自动等待退避的单次最大等待时长（毫秒） */
  maxAutoRetryDelayMs: 50000,
  /** 蓝图单元批处理每批最多单元数与字符预算，用于大幅减少总请求次数 */
  unitBatchMaxCount: 6,
  unitBatchMaxChars: 14000,
};

export const AGENT_REGISTRY = {
  UNDERSTAND_AGENT: {
    get modelId() {
      return SYSTEM_MODELS.DEFAULT_UNDERSTANDING.id;
    },
    role: 'Blueprint Analysis Agent',
  },
  FEASIBILITY_AGENT: {
    get modelId() {
      return SYSTEM_MODELS.DEFAULT_FEASIBILITY.id;
    },
    role: 'Portability Evaluation Agent',
  },
  EXECUTION_AGENT: {
    get modelId() {
      return SYSTEM_MODELS.DEFAULT_EXECUTION.id;
    },
    role: 'Adapter Execution Agent',
  },
  VERIFY_AGENT: {
    get modelId() {
      return SYSTEM_MODELS.DEFAULT_EXECUTION.id;
    },
    role: 'Verification Agent',
  },
};
