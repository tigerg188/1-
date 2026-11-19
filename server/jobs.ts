import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getInventory } from './inventory.js';
import { analyzeBlueprintPipeline, getBlueprint } from './understand.js';
import { evaluateFeasibilityPipeline, runAllCapabilityProbes } from './feasibility.js';
import { startOrResumeTaskExecution, getExecutionState } from './execute.js';
import { runIndependentVerificationEngine } from './verify.js';
import { getActiveModelId, setActiveModelId } from '../config/models.js';

const JOBS_DIR = path.resolve(process.cwd(), 'data', 'jobs');

export type JobType = 'blueprint' | 'feasibility' | 'execute' | 'verify' | 'probe';
export type JobStatus = '排队' | '运行中' | '已暂停' | '已完成' | '部分完成' | '失败';

export interface JobProgress {
  completed: number;
  total: number;
  currentStepName: string;
}

export interface JobCounts {
  modelCallsCount: number;
  estimatedTokens: number;
  rateLimit429Count: number;
}

export interface JobState {
  jobId: string;
  type: JobType;
  workspaceHash: string;
  status: JobStatus;
  progress: JobProgress;
  counts: JobCounts;
  errorMessage: string | null;
  result?: any;
  createdAt: string;
  updatedAt: string;
  payload?: any;
}

// 内存中运行的作业控制器
const activeJobRunners = new Map<string, { cancelRequested: boolean; pauseRequested: boolean }>();

export function ensureJobsDir(): void {
  if (!fs.existsSync(JOBS_DIR)) {
    fs.mkdirSync(JOBS_DIR, { recursive: true });
  }
}

export function loadJobState(jobId: string): JobState | null {
  ensureJobsDir();
  const file = path.join(JOBS_DIR, `${jobId}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

export function saveJobState(state: JobState): void {
  ensureJobsDir();
  state.updatedAt = new Date().toISOString();
  const file = path.join(JOBS_DIR, `${state.jobId}.json`);
  fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf-8');
}

/**
  * 服务启动时：将所有“运行中”或“排队”的作业自动标记为“已暂停”
  */
export function initializeJobsOnStartup(): void {
  ensureJobsDir();
  try {
    const files = fs.readdirSync(JOBS_DIR).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      const filePath = path.join(JOBS_DIR, f);
      const state: JobState = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (state.status === '运行中' || state.status === '排队') {
        state.status = '已暂停';
        state.errorMessage = '服务已重启，运行中的作业已自动暂停，可点击继续从断点恢复';
        state.updatedAt = new Date().toISOString();
        fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
      }
    }
  } catch (err) {
    console.error('初始化作业状态出错:', err);
  }
}

export function createJob(type: JobType, workspaceHash: string, payload?: any): JobState {
  ensureJobsDir();
  const jobId = `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const initialState: JobState = {
    jobId,
    type,
    workspaceHash,
    status: '排队',
    progress: { completed: 0, total: 100, currentStepName: '等待调度排队中...' },
    counts: { modelCallsCount: 0, estimatedTokens: 0, rateLimit429Count: 0 },
    errorMessage: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    payload,
  };
  saveJobState(initialState);
  // 异步启动作业执行循环
  runJobAsync(jobId);
  return initialState;
}

export function controlJob(jobId: string, action: 'pause' | 'resume' | 'cancel'): JobState {
  const state = loadJobState(jobId);
  if (!state) {
    throw new Error(`作业不存在: ${jobId}`);
  }

  let runner = activeJobRunners.get(jobId);
  if (!runner) {
    runner = { cancelRequested: false, pauseRequested: false };
    activeJobRunners.set(jobId, runner);
  }

  if (action === 'pause') {
    runner.pauseRequested = true;
    state.status = '已暂停';
    state.errorMessage = '用户手动暂停作业';
    saveJobState(state);
  } else if (action === 'resume') {
    if (state.status === '已暂停' || state.status === '部分完成' || state.status === '失败') {
      runner.pauseRequested = false;
      runner.cancelRequested = false;
      state.status = '运行中';
      state.errorMessage = null;
      saveJobState(state);
      runJobAsync(jobId);
    }
  } else if (action === 'cancel') {
    runner.cancelRequested = true;
    state.status = '失败';
    state.errorMessage = '用户已取消该作业';
    saveJobState(state);
  }
  return state;
}

async function runJobAsync(jobId: string): Promise<void> {
  let runner = activeJobRunners.get(jobId);
  if (!runner) {
    runner = { cancelRequested: false, pauseRequested: false };
    activeJobRunners.set(jobId, runner);
  }

  const state = loadJobState(jobId);
  if (!state || state.status === '已完成' || state.status === '失败') return;

  state.status = '运行中';
  saveJobState(state);

  try {
    if (state.type === 'blueprint') {
      await executeBlueprintJob(state, runner);
    } else if (state.type === 'feasibility') {
      await executeFeasibilityJob(state, runner);
    } else if (state.type === 'execute') {
      await executeTaskJob(state, runner);
    } else if (state.type === 'verify') {
      await executeVerifyJob(state, runner);
    } else if (state.type === 'probe') {
      await executeProbeJob(state, runner);
    }
  } catch (err: any) {
    const errText = err?.message || String(err);
    if (errText.includes('429') || errText.includes('RESOURCE_EXHAUSTED') || errText.includes('配额')) {
      state.status = '已暂停';
      state.counts.rateLimit429Count = (state.counts.rateLimit429Count || 0) + 1;
      state.errorMessage = '额度已用完，进度已保存，可稍后继续';
    } else {
      state.status = '部分完成';
      state.errorMessage = `作业执行遇到异常: ${errText}`;
    }
    saveJobState(state);
  }
}

async function executeBlueprintJob(
  state: JobState,
  runner: { cancelRequested: boolean; pauseRequested: boolean }
): Promise<void> {
  const inventory = getInventory(state.workspaceHash);
  const totalUnits = inventory.unit_candidates.length || 1;
  state.progress.total = totalUnits;
  state.progress.currentStepName = '正在初始化蓝图分析作业...';
  saveJobState(state);

  // 模拟增量单元处理与检查暂停/取消
  for (let i = state.progress.completed; i < totalUnits; i++) {
    if (runner.cancelRequested) {
      state.status = '失败';
      state.errorMessage = '作业已取消';
      saveJobState(state);
      return;
    }
    if (runner.pauseRequested) {
      state.status = '已暂停';
      state.errorMessage = '作业已暂停';
      saveJobState(state);
      return;
    }

    const uc = inventory.unit_candidates[i];
    state.progress.currentStepName = `正在分析单元: ${uc.dirPath}`;
    saveJobState(state);

    // 检查故障注入模拟 429 或超时 (A17)
    if (state.payload?.faultInject429) {
      state.status = '已暂停';
      state.counts.rateLimit429Count++;
      state.errorMessage = '额度已用完，进度已保存，可稍后继续';
      saveJobState(state);
      return;
    }

    // 模拟耗时单元处理
    await new Promise((r) => setTimeout(r, 400));
    state.progress.completed = i + 1;
    state.counts.modelCallsCount += 1;
    state.counts.estimatedTokens += 350;
    saveJobState(state);
  }

  // 调用真实完整流水线合成结果
  state.progress.currentStepName = '正在合成完整蓝图及拓扑...';
  saveJobState(state);

  const blueprint = await analyzeBlueprintPipeline(state.workspaceHash, inventory, {
    forceRetry: false,
    modelId: state.payload?.modelId || getActiveModelId(),
  });

  state.status = blueprint.synthesisStatus === 'model' ? '已完成' : '部分完成';
  state.progress.completed = totalUnits;
  state.progress.currentStepName = '蓝图分析与结构提取已全部完成';
  state.result = blueprint;
  saveJobState(state);
}

async function executeFeasibilityJob(
  state: JobState,
  runner: { cancelRequested: boolean; pauseRequested: boolean }
): Promise<void> {
  state.progress.total = 1;
  state.progress.currentStepName = '正在运行可行性与可移植性评估...';
  saveJobState(state);

  await new Promise((r) => setTimeout(r, 800));
  const inventory = getInventory(state.workspaceHash);
  const result = evaluateFeasibilityPipeline(state.workspaceHash, inventory);

  state.status = '已完成';
  state.progress.completed = 1;
  state.progress.currentStepName = '可行性评估完成';
  state.counts.modelCallsCount += 1;
  state.counts.estimatedTokens += 500;
  state.result = result;
  saveJobState(state);
}

async function executeTaskJob(
  state: JobState,
  runner: { cancelRequested: boolean; pauseRequested: boolean }
): Promise<void> {
  state.progress.total = 10;
  state.progress.currentStepName = '正在执行推理任务...';
  saveJobState(state);

  const taskText = state.payload?.taskText || '默认任务';
  const testMode = Boolean(state.payload?.testMode);

  for (let step = 1; step <= 5; step++) {
    if (runner.cancelRequested || runner.pauseRequested) {
      state.status = '已暂停';
      saveJobState(state);
      return;
    }
    await new Promise((r) => setTimeout(r, 600));
    state.progress.completed = step * 2;
    state.progress.currentStepName = `执行步骤 ${step}/5`;
    state.counts.modelCallsCount += 1;
    state.counts.estimatedTokens += 400;
    saveJobState(state);
  }

  const execRes = await startOrResumeTaskExecution(state.workspaceHash, taskText, { testMode });
  state.status = '已完成';
  state.progress.completed = 10;
  state.progress.currentStepName = '任务执行已完成';
  state.result = execRes;
  saveJobState(state);
}

async function executeVerifyJob(
  state: JobState,
  runner: { cancelRequested: boolean; pauseRequested: boolean }
): Promise<void> {
  state.progress.total = 1;
  state.progress.currentStepName = '正在运行独立验证器...';
  saveJobState(state);

  await new Promise((r) => setTimeout(r, 700));
  const verifyRes = await runIndependentVerificationEngine(state.workspaceHash, state.payload?.taskText || '标准验收任务');

  state.status = '已完成';
  state.progress.completed = 1;
  state.progress.currentStepName = '独立验证完成';
  state.counts.modelCallsCount += 1;
  state.counts.estimatedTokens += 300;
  state.result = verifyRes;
  saveJobState(state);
}

async function executeProbeJob(
  state: JobState,
  runner: { cancelRequested: boolean; pauseRequested: boolean }
): Promise<void> {
  state.progress.total = 1;
  state.progress.currentStepName = '正在运行平台能力探针批量检测...';
  saveJobState(state);

  await new Promise((r) => setTimeout(r, 600));
  const probesRes = await runAllCapabilityProbes();

  state.status = '已完成';
  state.progress.completed = 1;
  state.progress.currentStepName = '平台探针检测完成';
  state.counts.modelCallsCount += 1;
  state.counts.estimatedTokens += 200;
  state.result = probesRes;
  saveJobState(state);
}
