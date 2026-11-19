import { GoogleGenAI } from '@google/genai';
import { GEMINI_RATE_LIMIT_CONFIG, getActiveModelId } from '../config/models.js';

let cachedClient: GoogleGenAI | null = null;
let cachedApiKey: string | undefined;

/**
 * 模块级串行节流队列与基于模型的 429 冷却时间戳，避免并发突发请求瞬间打满 RPM 配额
 */
let requestQueue: Promise<unknown> = Promise.resolve();
let lastRequestFinishedAt = 0;
let globalCooldownUntil = 0;
const modelCooldownMap = new Map<string, number>();

export function hasValidGeminiApiKey(): boolean {
  const apiKey = process.env.GEMINI_API_KEY;
  return Boolean(apiKey && apiKey.trim().length > 5 && !apiKey.includes('MY_GEMINI_API_KEY'));
}

export function getSharedAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!cachedClient || cachedApiKey !== apiKey) {
    cachedApiKey = apiKey;
    cachedClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return cachedClient;
}

export function getGeminiCooldownRemainingMs(modelId?: string): number {
  const now = Date.now();
  const globalRem = Math.max(0, globalCooldownUntil - now);
  const targetId = modelId || getActiveModelId();
  const modelUntil = modelCooldownMap.get(targetId) || 0;
  const modelRem = Math.max(0, modelUntil - now);
  return Math.max(globalRem, modelRem);
}

/**
 * 手动重置冷却状态（切换模型、用户点击强制重试或更新密钥时调用）
 */
export function resetGeminiCooldown(modelId?: string): void {
  if (modelId) {
    modelCooldownMap.delete(modelId);
  } else {
    modelCooldownMap.clear();
    globalCooldownUntil = 0;
  }
}

export function parseRetryDelayMs(err: unknown): number | null {
  const rawText = serializeErrorText(err);
  // 匹配 RetryInfo 中的 "retryDelay":"42s" / retryDelay: '42s' 等格式
  const jsonDelayMatch = rawText.match(/["']?retryDelay["']?\s*:\s*["'](\d+(?:\.\d+)?)s["']/i);
  if (jsonDelayMatch) {
    return Math.ceil(Number(jsonDelayMatch[1]) * 1000);
  }
  // 匹配文案 "Please retry in 42.733554945s"
  const textDelayMatch = rawText.match(/retry\s+in\s+(\d+(?:\.\d+)?)s/i);
  if (textDelayMatch) {
    return Math.ceil(Number(textDelayMatch[1]) * 1000);
  }
  return null;
}

function serializeErrorText(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) {
    const extra = (err as any).details || (err as any).error || (err as any).cause;
    return [err.message, extra ? JSON.stringify(extra) : ''].filter(Boolean).join(' ');
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export interface ClassifiedGeminiError {
  code: number | null;
  isQuotaExceeded: boolean;
  isDailyLimit: boolean;
  retryable: boolean;
  retryDelayMs: number | null;
  rawSummary: string;
  userMessage: string;
}

export function classifyGeminiError(err: unknown): ClassifiedGeminiError {
  const rawText = serializeErrorText(err);
  const lower = rawText.toLowerCase();

  const retryDelayMs = parseRetryDelayMs(err);
  const is429 =
    lower.includes('429') ||
    lower.includes('resource_exhausted') ||
    lower.includes('quota exceeded') ||
    lower.includes('rate limit');

  if (is429) {
    const isDailyLimit =
      lower.includes('perday') ||
      lower.includes('requestsperday') ||
      lower.includes('daily') ||
      Boolean(retryDelayMs && retryDelayMs > 120000); // 超过 2 分钟的等待通常为日配额或长周期窗口

    const delaySec = retryDelayMs ? Math.ceil(retryDelayMs / 1000) : null;
    const retryHint = delaySec ? `，服务端建议 ${delaySec} 秒后重试` : '';

    const userMessage = isDailyLimit
      ? `触发 Gemini API 配额上限 (429 RESOURCE_EXHAUSTED${retryHint})；您可以切换到其他轻量模型（如 Gemini 3.1 Flash Lite），或在 Settings > Secrets 面板切换绑定计费账号的 API Key 提升配额`
      : `触发 Gemini API 速率限流 (429 RESOURCE_EXHAUSTED${retryHint})；可切换其他模型，或在 Settings > Secrets 面板切换计费密钥提升配额，或稍后重试`;

    return {
      code: 429,
      isQuotaExceeded: true,
      isDailyLimit,
      retryable: !isDailyLimit,
      retryDelayMs,
      rawSummary: rawText.slice(0, 320),
      userMessage,
    };
  }

  const isAuthErr =
    lower.includes('permission_denied') ||
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    /\b403\b/.test(lower);

  if (isAuthErr) {
    return {
      code: lower.includes('403') || lower.includes('permission_denied') ? 403 : 400,
      isQuotaExceeded: false,
      isDailyLimit: false,
      retryable: false,
      retryDelayMs: null,
      rawSummary: rawText.slice(0, 320),
      userMessage:
        'Gemini API Key 无效或无权限 (400/403)，请在 Settings > Secrets 面板检查或重新选择有效的密钥',
    };
  }

  const isNotFound = lower.includes('not_found') || /\b404\b/.test(lower);
  if (isNotFound) {
    return {
      code: 404,
      isQuotaExceeded: false,
      isDailyLimit: false,
      retryable: false,
      retryDelayMs: null,
      rawSummary: rawText.slice(0, 320),
      userMessage:
        '请求的 Gemini 模型不存在或不受支持 (404 NOT_FOUND)，可在上方切换其他可用官方模型',
    };
  }

  const isTransientServer =
    lower.includes('timeout') ||
    rawText.includes('超时') ||
    /\b50[0234]\b/.test(lower) ||
    lower.includes('unavailable') ||
    lower.includes('econnreset') ||
    lower.includes('fetch failed');

  return {
    code: null,
    isQuotaExceeded: false,
    isDailyLimit: false,
    retryable: isTransientServer,
    retryDelayMs: null,
    rawSummary: rawText.slice(0, 320),
    userMessage: rawText.slice(0, 320) || '模型调用未知异常',
  };
}

export interface RateLimitCallOptions {
  maxRetries?: number;
  minIntervalMs?: number;
  timeoutMs?: number;
  maxAutoRetryDelayMs?: number;
  modelId?: string;
  ignoreCooldown?: boolean;
}

export interface RateLimitCallResult<T> {
  result?: T;
  quotaExceeded?: boolean;
  error?: string;
  classified?: ClassifiedGeminiError;
  attempts: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`请求超时（超过 ${Math.round(timeoutMs / 1000)} 秒）`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 通过全局串行队列、最小请求间隔、RetryInfo 解析与指数退避执行 Gemini 调用
 */
export async function callGeminiWithRateLimit<T>(
  fn: () => Promise<T>,
  options: RateLimitCallOptions = {}
): Promise<RateLimitCallResult<T>> {
  const maxRetries = options.maxRetries ?? 2;
  const minIntervalMs = options.minIntervalMs ?? GEMINI_RATE_LIMIT_CONFIG.minIntervalMs;
  const timeoutMs = options.timeoutMs ?? GEMINI_RATE_LIMIT_CONFIG.perAttemptTimeoutMs;
  const maxAutoRetryDelayMs =
    options.maxAutoRetryDelayMs ?? GEMINI_RATE_LIMIT_CONFIG.maxAutoRetryDelayMs;
  const targetModelId = options.modelId || getActiveModelId();
  const ignoreCooldown = Boolean(options.ignoreCooldown);

  const task = async (): Promise<RateLimitCallResult<T>> => {
    let attempts = 0;
    let fallbackBackoffMs = 2000;

    while (attempts <= maxRetries) {
      // 1. 若非强制重试，遵守当前模型的 429 冷却窗口
      if (!ignoreCooldown) {
        const now = Date.now();
        const modelCooldownUntil = modelCooldownMap.get(targetModelId) || 0;
        const cooldownRem = Math.max(0, Math.max(globalCooldownUntil, modelCooldownUntil) - now);

        if (cooldownRem > 0) {
          if (cooldownRem > maxAutoRetryDelayMs) {
            const sec = Math.ceil(cooldownRem / 1000);
            return {
              quotaExceeded: true,
              attempts,
              error: `当前模型 (${targetModelId}) 处于限流冷却中（建议等待 ${sec} 秒）；您可直接切换其他模型（如 Gemini 3.1 Flash Lite）或在 Settings > Secrets 切换计费密钥`,
            };
          }
          await sleep(cooldownRem + 200);
        }
      }

      // 2. 遵守最小请求间距
      const sinceLast = Date.now() - lastRequestFinishedAt;
      if (lastRequestFinishedAt > 0 && sinceLast < minIntervalMs) {
        await sleep(minIntervalMs - sinceLast);
      }

      attempts++;
      try {
        const res = await withTimeout(fn, timeoutMs);
        lastRequestFinishedAt = Date.now();
        // 成功调用后清除当前模型的限流标记
        modelCooldownMap.delete(targetModelId);
        return { result: res, attempts };
      } catch (err: any) {
        lastRequestFinishedAt = Date.now();
        const classified = classifyGeminiError(err);

        if (classified.isQuotaExceeded) {
          const waitMs = classified.retryDelayMs
            ? classified.retryDelayMs + 1000
            : fallbackBackoffMs;

          // 核心修复：长周期配额超限（如 2498 秒）绝不可在内存中持久锁死所有后续请求！
          // 仅对短时间可退避重试的限流记录冷却，长周期超限仅记录 3 秒防突发抖动
          const effectiveCooldown = waitMs <= maxAutoRetryDelayMs ? waitMs : 3000;
          modelCooldownMap.set(targetModelId, Date.now() + effectiveCooldown);

          const canRetry =
            classified.retryable &&
            attempts <= maxRetries &&
            waitMs <= maxAutoRetryDelayMs;

          if (!canRetry) {
            return {
              quotaExceeded: true,
              attempts,
              error: classified.userMessage,
              classified,
            };
          }

          await sleep(waitMs);
          fallbackBackoffMs = Math.min(fallbackBackoffMs * 2, 16000);
          continue;
        }

        if (classified.retryable && attempts <= maxRetries) {
          await sleep(fallbackBackoffMs);
          fallbackBackoffMs = Math.min(fallbackBackoffMs * 2, 16000);
          continue;
        }

        return {
          quotaExceeded: false,
          attempts,
          error: classified.userMessage,
          classified,
        };
      }
    }

    return {
      quotaExceeded: true,
      attempts,
      error: `触发 ${targetModelId} 速率限流，重试次数已耗尽；可切换其他可用模型或稍后重试`,
    };
  };

  // 将本次调用串行排入队列，保证同一进程内所有模块不会并发打爆 RPM
  const runPromise = requestQueue.then(task, task);
  requestQueue = runPromise.catch(() => undefined);
  return runPromise;
}
