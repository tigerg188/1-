import express from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import { ingestGithubRepo, processZipBuffer } from './server/ingest.js';
import { getInventory } from './server/inventory.js';
import { readLedgerEntries, checkLedgerIntegrity, appendLedgerEntry } from './server/ledger.js';
import { runSelfTest } from './server/selftest.js';
import {
  runAcceptanceSuite,
  loadThresholds,
  loadManualReviews,
  saveManualReviews,
  recomputeReportWithManualReviews,
} from './acceptance/runner.js';
import { AVAILABLE_MODELS, getActiveModelId, setActiveModelId } from './config/models.js';
import {
  resetGeminiCooldown,
  getGeminiCooldownRemainingMs,
  hasValidGeminiApiKey,
} from './server/geminiClient.js';
import { getBlueprint, analyzeBlueprintPipeline } from './server/understand.js';
import {
  getCapabilityModel,
  runCapabilityProbe,
  runAllCapabilityProbes,
  evaluateFeasibilityPipeline,
  getFeasibilityResult,
} from './server/feasibility.js';
import { runDryRunValidator } from './server/adapters.js';
import {
  startOrResumeTaskExecution,
  getExecutionState,
  continueIncompleteTask,
  readExecutionArtifact,
} from './server/execute.js';
import {
  deriveVerificationCriteria,
  runIndependentVerificationEngine,
  getVerificationReport,
} from './server/verify.js';
import {
  generateFullReportData,
  generateMarkdownReport,
  generateHtmlReport,
  createReportZipBuffer,
} from './server/report.js';
import { initializeJobsOnStartup, createJob, loadJobState, controlJob } from './server/jobs.js';

const upload = multer({
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  initializeJobsOnStartup();

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // API Routes
  
  // 1. 获取宪章与构建日志
  app.get('/api/charter', (req, res) => {
    const charterPath = path.resolve(process.cwd(), 'CHARTER.md');
    if (fs.existsSync(charterPath)) {
      res.type('text/plain').send(fs.readFileSync(charterPath, 'utf-8'));
    } else {
      res.status(404).json({ error: 'CHARTER.md 未找到' });
    }
  });

  app.get('/api/build-log', (req, res) => {
    const logPath = path.resolve(process.cwd(), 'BUILD_LOG.md');
    if (fs.existsSync(logPath)) {
      res.type('text/plain').send(fs.readFileSync(logPath, 'utf-8'));
    } else {
      res.status(404).json({ error: 'BUILD_LOG.md 未找到' });
    }
  });

  // 2. 运行时导入接口 (GitHub / Zip)
  app.post('/api/ingest/github', async (req, res) => {
    try {
      const { repoUrl } = req.body;
      if (!repoUrl || !String(repoUrl).trim()) {
        return res.status(400).json({ success: false, error: '请输入有效的 GitHub 仓库地址' });
      }
      const result = await ingestGithubRepo(String(repoUrl));
      res.json({ success: true, data: result });
    } catch (err: any) {
      const msg = err?.message || 'GitHub 导入失败';
      const isBadInput = msg.includes('无法解析有效的 GitHub 仓库地址');
      res.status(isBadInput ? 400 : 500).json({ success: false, error: msg });
    }
  });

  app.post('/api/ingest/zip', upload.single('file'), (req, res) => {
    try {
      if (!req.file || !req.file.buffer) {
        return res.status(400).json({ success: false, error: '请上传有效的 .zip 压缩文件' });
      }
      const result = processZipBuffer(req.file.buffer, 'zip');
      res.json({ success: true, data: result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'Zip 解压导入失败' });
    }
  });

  // 2.5 获取当前/最近激活的工作空间
  app.get('/api/workspaces/current', (req, res) => {
    try {
      const workspacesDir = path.resolve(process.cwd(), 'data', 'workspaces');
      if (!fs.existsSync(workspacesDir)) {
        return res.json({ success: true, data: null });
      }
      const dirs = fs.readdirSync(workspacesDir).filter((d) => !d.startsWith('.'));
      if (dirs.length === 0) {
        return res.json({ success: true, data: null });
      }
      dirs.sort((a, b) => {
        const statA = fs.statSync(path.join(workspacesDir, a));
        const statB = fs.statSync(path.join(workspacesDir, b));
        return statB.mtimeMs - statA.mtimeMs;
      });
      const latestHash = dirs[0];
      const metaPath = path.join(workspacesDir, latestHash, '.ingest_meta.json');
      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        return res.json({ success: true, data: meta });
      }
      res.json({ success: true, data: { workspaceHash: latestHash } });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 3. 确定性清单接口
  app.get('/api/inventory/:hash', (req, res) => {
    try {
      const { hash } = req.params;
      const data = getInventory(hash);
      res.json({ success: true, data });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || '获取清单失败' });
    }
  });

  // 4. 证据账本接口
  app.get('/api/ledger', (req, res) => {
    try {
      const entries = readLedgerEntries();
      const integrity = checkLedgerIntegrity();
      res.json({ success: true, entries, integrity });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || '读取证据账本失败' });
    }
  });

  app.get('/api/ledger/export', (req, res) => {
    try {
      const ledgerPath = path.resolve(process.cwd(), 'data', 'ledger.jsonl');
      if (fs.existsSync(ledgerPath)) {
        res.setHeader('Content-Type', 'application/x-jsonlines');
        res.setHeader('Content-Disposition', 'attachment; filename="ledger.jsonl"');
        res.sendFile(ledgerPath);
      } else {
        res.status(404).send('账本尚无记录');
      }
    } catch (err: any) {
      res.status(500).send('导出失败: ' + err.message);
    }
  });

  // 5. 确定性自检接口
  app.post('/api/selftest', (req, res) => {
    try {
      const { workspaceHash } = req.body || {};
      const result = runSelfTest(workspaceHash);
      res.json({ success: true, data: result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || '执行自检失败' });
    }
  });

  // 5.5 验收自动化测试与规则自评接口 (F1)
  app.get('/api/acceptance/report', (req, res) => {
    try {
      const reportPath = path.resolve(process.cwd(), 'ACCEPTANCE_REPORT.json');
      const thresholdsCfg = loadThresholds();
      const manualReviews = loadManualReviews();
      if (fs.existsSync(reportPath)) {
        const parsed = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
        return res.json({
          success: true,
          data: parsed,
          thresholds: thresholdsCfg.thresholds,
          manualReviews,
        });
      }
      res.json({
        success: true,
        data: null,
        thresholds: thresholdsCfg.thresholds,
        manualReviews,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || '读取验收报告失败' });
    }
  });

  app.post('/api/acceptance/run', async (req, res) => {
    try {
      const { workspaceHash } = req.body || {};
      const report = await runAcceptanceSuite(workspaceHash || null);
      res.json({ success: true, data: report });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || '运行验收测试失败' });
    }
  });

  app.post('/api/acceptance/manual-review', (req, res) => {
    try {
      const { confirmed, dimensionKey, note } = req.body || {};
      const current = loadManualReviews();
      const now = new Date().toISOString();
      if (dimensionKey) {
        current.confirmedDimensions = {
          ...(current.confirmedDimensions || {}),
          [dimensionKey]: Boolean(confirmed),
        };
        current.confirmed = Object.values(current.confirmedDimensions).some(Boolean);
      } else {
        current.confirmed = Boolean(confirmed);
        if (!confirmed) {
          current.confirmedDimensions = {};
        }
      }
      current.confirmedAt = now;
      if (typeof note === 'string') {
        current.note = note;
      }
      saveManualReviews(current);

      appendLedgerEntry({
        stage: 'ACCEPTANCE',
        action: 'ACCEPTANCE_MANUAL_REVIEW',
        inputs_hash: String(dimensionKey || 'all'),
        outputs_hash: String(Boolean(confirmed)),
        ref: {
          details: `人工复核状态更新: 确认=${Boolean(confirmed)}, 维度=${dimensionKey || '全量'}, 时间=${now}`,
        },
      });

      const updatedReport = recomputeReportWithManualReviews();
      res.json({ success: true, data: updatedReport, manualReviews: current });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || '保存人工复核确认失败' });
    }
  });

  app.get('/api/acceptance/raw/:fileName', (req, res) => {
    try {
      const safeName = path.basename(req.params.fileName || '');
      if (!safeName.endsWith('.json')) {
        return res.status(400).json({ success: false, error: '仅支持读取 .json 原始输出文件' });
      }
      const rawPath = path.resolve(process.cwd(), 'acceptance', 'raw', safeName);
      if (!fs.existsSync(rawPath)) {
        return res.status(404).json({ success: false, error: '原始输出文件不存在' });
      }
      res.json({ success: true, data: JSON.parse(fs.readFileSync(rawPath, 'utf-8')) });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || '读取原始输出失败' });
    }
  });

  // 3.4 模型配置与限流管理接口
  app.get('/api/models', (req, res) => {
    try {
      const activeModelId = getActiveModelId();
      const availableModels = Object.values(AVAILABLE_MODELS);
      const cooldownRemainingMs = getGeminiCooldownRemainingMs();
      const hasApiKey = hasValidGeminiApiKey();
      res.json({
        success: true,
        data: {
          activeModelId,
          availableModels,
          cooldownRemainingMs,
          hasApiKey,
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || '获取模型配置失败' });
    }
  });

  app.post('/api/models/active', (req, res) => {
    try {
      const { modelId } = req.body || {};
      if (!modelId || !String(modelId).trim()) {
        return res.status(400).json({ success: false, error: '缺少 modelId 参数' });
      }
      const updated = setActiveModelId(String(modelId).trim());
      // 切换模型时自动清除该模型及全局冷却，让后续调用立即生效
      resetGeminiCooldown();
      res.json({
        success: true,
        data: {
          activeModelId: getActiveModelId(),
          model: updated,
          cooldownRemainingMs: getGeminiCooldownRemainingMs(),
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || '切换模型失败' });
    }
  });

  app.post('/api/models/reset-cooldown', (req, res) => {
    try {
      resetGeminiCooldown();
      res.json({
        success: true,
        data: {
          activeModelId: getActiveModelId(),
          cooldownRemainingMs: 0,
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || '重置冷却时间失败' });
    }
  });

  // 3.5 蓝图理解引擎接口 (Stage 2)
  app.get('/api/blueprint/:hash', (req, res) => {
    try {
      const { hash } = req.params;
      const bp = getBlueprint(hash);
      if (bp) {
        res.json({ success: true, data: bp });
      } else {
        res.json({ success: false, data: null, message: '尚未生成蓝图，请发起分析' });
      }
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || '获取蓝图失败' });
    }
  });

  app.post('/api/blueprint/analyze', async (req, res) => {
    try {
      const { workspaceHash, forceRetry, modelId } = req.body || {};
      if (!workspaceHash) {
        return res.status(400).json({ error: '缺失工作空间 Hash' });
      }
      if (modelId) {
        setActiveModelId(modelId);
      }
      if (forceRetry) {
        resetGeminiCooldown();
      }
      const inventory = getInventory(workspaceHash);
      const blueprint = await analyzeBlueprintPipeline(workspaceHash, inventory, {
        forceRetry: Boolean(forceRetry),
        modelId: modelId || getActiveModelId(),
      });
      res.json({ success: true, data: blueprint });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || '生成蓝图过程出错' });
    }
  });

  // 3.8 平台能力字典与探针接口 (Stage 3)
  app.get('/api/feasibility/capability-model', (req, res) => {
    try {
      const model = getCapabilityModel();
      res.json({ success: true, data: model });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/feasibility/probe', async (req, res) => {
    try {
      const { key } = req.body;
      if (key) {
        const updated = await runCapabilityProbe(key);
        res.json({ success: true, data: updated, model: getCapabilityModel() });
      } else {
        const model = await runAllCapabilityProbes();
        res.json({ success: true, data: model, model });
      }
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || '运行探针遇到错误' });
    }
  });

  app.post('/api/feasibility/evaluate', async (req, res) => {
    try {
      const { workspaceHash } = req.body;
      if (!workspaceHash) {
        return res.status(400).json({ error: '缺失工作空间 Hash' });
      }
      const inventory = getInventory(workspaceHash);
      const result = await evaluateFeasibilityPipeline(workspaceHash, inventory);
      res.json({ success: true, data: result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || '可移植性评估失败' });
    }
  });

  app.get('/api/feasibility/result/:hash', (req, res) => {
    try {
      const { hash } = req.params;
      const resData = getFeasibilityResult(hash);
      if (resData) {
        res.json({ success: true, data: resData });
      } else {
        res.json({ success: false, data: null, message: '尚未运行评估' });
      }
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/adapters/dry-run', async (req, res) => {
    try {
      const { workspaceHash } = req.body;
      if (!workspaceHash) {
        return res.status(400).json({ error: '缺失工作空间 Hash' });
      }
      const inventory = getInventory(workspaceHash);
      let feasibility = getFeasibilityResult(workspaceHash);
      if (!feasibility) {
        feasibility = await evaluateFeasibilityPipeline(workspaceHash, inventory);
      }
      const dryRunRes = await runDryRunValidator(workspaceHash, inventory, feasibility);
      res.json({ success: true, data: dryRunRes });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || 'DRY-RUN 校验失败' });
    }
  });

  // 4.0 任务执行引擎接口 (Stage 4)
  app.post('/api/execute/start', async (req, res) => {
    try {
      const { workspaceHash, taskText, testMode, tokenBudget } = req.body;
      if (!workspaceHash || !String(taskText || '').trim()) {
        return res.status(400).json({ success: false, error: '缺失工作空间标识或任务描述' });
      }
      const state = await startOrResumeTaskExecution(workspaceHash, String(taskText).trim(), {
        testMode,
        tokenBudget,
        resume: false,
      });
      res.json({ success: true, data: state });
    } catch (err: any) {
      const msg = err?.message || '启动任务执行失败';
      const isPrecondition = msg.includes('工作空间不存在') || msg.includes('需先在');
      res.status(isPrecondition ? 400 : 500).json({ success: false, error: msg });
    }
  });

  app.get('/api/execute/status/:hash', (req, res) => {
    try {
      const { hash } = req.params;
      const state = getExecutionState(hash);
      res.json({ success: true, data: state });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/execute/continue', async (req, res) => {
    try {
      const { workspaceHash } = req.body;
      if (!workspaceHash) {
        return res.status(400).json({ success: false, error: '缺失工作空间标识' });
      }
      const state = await continueIncompleteTask(workspaceHash);
      res.json({ success: true, data: state });
    } catch (err: any) {
      const msg = err?.message || '继续运行任务失败';
      const isPrecondition = msg.includes('未找到') || msg.includes('工作空间不存在') || msg.includes('需先在');
      res.status(isPrecondition ? 400 : 500).json({ success: false, error: msg });
    }
  });

  app.get('/api/execute/artifact/:hash/:fileName', (req, res) => {
    try {
      const { hash, fileName } = req.params;
      const artifact = readExecutionArtifact(hash, fileName);
      if (req.query.download === '1') {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(artifact.fileName)}"`);
        return res.send(artifact.content);
      }
      res.json({ success: true, data: artifact });
    } catch (err: any) {
      res.status(404).json({ success: false, error: err?.message || '未找到交付物文件' });
    }
  });

  // 4.5 独立双路验证与比对接口 (Stage 4)
  app.post('/api/verify/criteria', (req, res) => {
    try {
      const { workspaceHash, taskText } = req.body;
      const blueprint = getBlueprint(workspaceHash);
      const criteria = deriveVerificationCriteria(blueprint, taskText || '未指定任务文本');
      res.json({ success: true, data: criteria });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/verify/run', async (req, res) => {
    try {
      const { workspaceHash, taskText } = req.body;
      if (!workspaceHash) {
        return res.status(400).json({ error: '缺失工作空间 Hash' });
      }
      const report = await runIndependentVerificationEngine(workspaceHash, taskText || '标准验收任务');
      res.json({ success: true, data: report });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || '独立验证过程出错' });
    }
  });

  app.get('/api/verify/result/:hash', (req, res) => {
    try {
      const { hash } = req.params;
      const report = getVerificationReport(hash);
      res.json({ success: true, data: report });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 4.8 综合评估报告导出接口 (Stage 4)
  app.get('/api/report/export/:hash/:format', (req, res) => {
    try {
      const { hash, format } = req.params;
      if (format === 'json') {
        const data = generateFullReportData(hash);
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="report_${hash.slice(0, 8)}.json"`);
        res.send(JSON.stringify(data, null, 2));
      } else if (format === 'md') {
        const mdText = generateMarkdownReport(hash);
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="report_${hash.slice(0, 8)}.md"`);
        res.send(mdText);
      } else if (format === 'html') {
        const htmlText = generateHtmlReport(hash);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="report_${hash.slice(0, 8)}.html"`);
        res.send(htmlText);
      } else if (format === 'zip') {
        const zipBuf = createReportZipBuffer(hash);
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="audit_bundle_${hash.slice(0, 8)}.zip"`);
        res.send(zipBuf);
      } else {
        res.status(400).send('不支持的导出格式');
      }
    } catch (err: any) {
      res.status(500).json({ success: false, error: '导出失败: ' + err.message });
    }
  });

  // 6. 后台作业调度与管理接口 (F2)
  app.post('/api/jobs/start', (req, res) => {
    try {
      const { type, workspaceHash, payload } = req.body || {};
      if (!type || !workspaceHash) {
        return res.status(400).json({ success: false, error: '缺失 type 或 workspaceHash 参数' });
      }
      const job = createJob(type, workspaceHash, payload);
      res.json({ success: true, jobId: job.jobId, data: job });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || '创建后台作业失败' });
    }
  });

  app.get('/api/jobs/:jobId', (req, res) => {
    try {
      const { jobId } = req.params;
      const job = loadJobState(jobId);
      if (!job) {
        return res.status(404).json({ success: false, error: '作业不存在' });
      }
      res.json({ success: true, data: job });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || '获取作业状态失败' });
    }
  });

  app.post('/api/jobs/:jobId/control', (req, res) => {
    try {
      const { jobId } = req.params;
      const { action } = req.body || {};
      if (!['pause', 'resume', 'cancel'].includes(action)) {
        return res.status(400).json({ success: false, error: '无效的控制动作 (action 必须为 pause, resume 或 cancel)' });
      }
      const updated = controlJob(jobId, action);
      res.json({ success: true, data: updated });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || '控制作业失败' });
    }
  });

  app.get('/api/jobs/workspace/:hash', (req, res) => {
    try {
      const { hash } = req.params;
      const jobsDir = path.resolve(process.cwd(), 'data', 'jobs');
      if (!fs.existsSync(jobsDir)) {
        return res.json({ success: true, data: [] });
      }
      const files = fs.readdirSync(jobsDir).filter((f) => f.endsWith('.json'));
      const list = [];
      for (const f of files) {
        try {
          const st = JSON.parse(fs.readFileSync(path.join(jobsDir, f), 'utf-8'));
          if (st.workspaceHash === hash) {
            list.push(st);
          }
        } catch {}
      }
      list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      res.json({ success: true, data: list });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || '获取工作空间作业列表失败' });
    }
  });

  // 全局 API 错误处理中间件（强制返回 JSON 格式，绝不返回 HTML）
  app.use('/api/*', (err: any, req: any, res: any, next: any) => {
    console.error('[API Error Intercepted]', err);
    res.status(500).json({
      success: false,
      errorCode: 'INTERNAL_ERROR',
      message: err?.message || '服务端内部异常',
    });
  });

  // API 404 Fallback - Prevent returning HTML for unhandled API endpoints
  app.all('/api/*', (req, res) => {
    res.status(404).json({
      success: false,
      errorCode: 'NOT_FOUND',
      message: `API 接口未找到 (404): ${req.method} ${req.path}`,
    });
  });

  // Vite middle-wares in dev mode
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });
    app.use(vite.middlewares);
    app.use('*', async (req, res, next) => {
      const url = req.originalUrl;
      try {
        let template = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e: any) {
        vite.ssrFixStacktrace(e);
        next(e);
      }
    });
  } else {
    // Static production serve
    app.use(express.static(path.resolve(process.cwd(), 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(process.cwd(), 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Express 引擎启动于端口 http://0.0.0.0:${PORT}`);
  });
}

startServer();
