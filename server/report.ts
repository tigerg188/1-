import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { getInventory } from './inventory.js';
import { getBlueprint } from './understand.js';
import { getFeasibilityResult } from './feasibility.js';
import { getExecutionState } from './execute.js';
import { getVerificationReport } from './verify.ts';
import { readLedgerEntries } from './ledger.js';

const WORKSPACES_DIR = path.resolve(process.cwd(), 'data', 'workspaces');

/**
 * 汇总生成综合评估分析报告数据对象
 */
export function generateFullReportData(workspaceHash: string) {
  const inventory = getInventory(workspaceHash);
  const blueprint = getBlueprint(workspaceHash);
  const feasibility = getFeasibilityResult(workspaceHash);
  const execState = getExecutionState(workspaceHash);
  const verification = getVerificationReport(workspaceHash);
  const ledgerEntries = readLedgerEntries();

  return {
    meta: {
      workspaceHash,
      generatedAt: new Date().toISOString(),
      toolName: '通用 Agent/Skill 跨平台判定与运行引擎',
    },
    projectUnderstanding: {
      totalFiles: inventory.stats.totalFiles,
      totalSize: inventory.stats.totalSize,
      verificationRate: blueprint?.evidence_verification.verificationRate ?? 0,
      coveragePercentage: blueprint?.coverage_table.overallCoveragePercentage ?? 0,
      purpose: blueprint?.l0_intent.purpose || '未生成蓝图',
    },
    feasibility: {
      packageVerdict: feasibility?.packageVerdict || '未知',
      userLossList: feasibility?.userLossList || [],
    },
    executionTrace: {
      status: execState?.status || '未运行',
      tokensUsed: execState?.tokensUsed || 0,
      stepsCount: execState?.steps.length || 0,
      artifacts: execState?.artifacts || [],
    },
    verification: {
      overallPass: verification?.overallPass ?? false,
      codeChecks: verification?.codeChecks,
      judgements: verification?.judgements || [],
      summaryNote: verification?.summaryNote || '未执行验证',
    },
    knownGaps: [
      ...(!blueprint
        ? ['尚未生成项目蓝图']
        : blueprint.synthesisStatus && blueprint.synthesisStatus !== 'model'
        ? [`蓝图合成存在降级或失败 (${blueprint.synthesisNote || blueprint.synthesisStatus})`]
        : []),
      ...(!feasibility ? ['尚未运行平台可移植性评估'] : []),
      ...(!execState
        ? ['尚未运行任务执行']
        : ['当前执行引擎仅提供纯模型单轮文本生成，托管沙盒运行与产物收集仍未实现']),
      ...(verification?.hasUndecidedCriteria ? ['独立验证存在“无法判断”标准项'] : []),
    ],
    ledgerTotalCount: ledgerEntries.length,
  };
}

/**
 * 导出 Markdown 格式报告
 */
export function generateMarkdownReport(workspaceHash: string): string {
  const data = generateFullReportData(workspaceHash);

  return `# 通用 Agent/Skill 跨平台判定与运行评估报告

- **工作空间 Hash**: \`${data.meta.workspaceHash}\`
- **生成时间**: \`${data.meta.generatedAt}\`
- **报告生成工具**: ${data.meta.toolName}

---

## 1. 项目理解与概览 (Project Understanding)
- **文件总数**: ${data.projectUnderstanding.totalFiles} 个文件 (${(data.projectUnderstanding.totalSize / 1024).toFixed(1)} KB)
- **蓝图强证据校验率**: \`[已强校验 ${data.projectUnderstanding.verificationRate}%]\`
- **工程源码阅读覆盖率**: \`${data.projectUnderstanding.coveragePercentage}%\`
- **核心用途 (L0 Purpose)**: ${data.projectUnderstanding.purpose}

---

## 2. 平台可移植性判定 (Feasibility Verdict)
- **整包移植结论**: **${data.feasibility.packageVerdict}**
- **用户功能损失列表**:
${data.feasibility.userLossList.length === 0 ? '  - 无已知功能损失' : data.feasibility.userLossList.map((l) => `  - ${l}`).join('\n')}

---

## 3. 任务执行与交付物追溯 (Execution Trace & Artifacts)
- **运行状态**: ${data.executionTrace.status}
- **耗费 Token 数**: ${data.executionTrace.tokensUsed} tokens
- **执行步骤数**: ${data.executionTrace.stepsCount} 步
- **交付物列表 (Artifacts with SHA256)**:
${
  data.executionTrace.artifacts.length === 0
    ? '  - 尚无产出交付物'
    : data.executionTrace.artifacts
        .map((a) => `  - **${a.fileName}** (${a.size} B) — SHA256: \`${a.sha256}\``)
        .join('\n')
}

---

## 4. 独立双路验证结果 (Independent Verification)
- **整体验证判定**: **${data.verification.overallPass ? '满足全量验收标准 (PASS)' : '未完全通过 / 包含未知项'}**
- **验证结论说明**: ${data.verification.summaryNote}
- **逐条标准判决明细**:
${data.verification.judgements
  .map(
    (j) => `  - **[${j.verdict}]** ${j.description}\n    *依据*: ${j.reason}`
  )
  .join('\n')}

---

## 5. 缺口说明与审计汇总 (Gaps & Quota)
- **缺口日志**:
${data.knownGaps.map((g) => `  - ${g}`).join('\n')}
- **审计账本数据行数**: ${data.ledgerTotalCount} 行 (Append-only JSONL)
`;
}

/**
 * 导出 HTML 格式报告
 */
export function generateHtmlReport(workspaceHash: string): string {
  const md = generateMarkdownReport(workspaceHash);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>跨平台判定与运行评估报告 - ${workspaceHash.slice(0, 8)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; max-width: 900px; margin: 0 auto; line-height: 1.6; }
    h1, h2, h3 { color: #38bdf8; border-bottom: 1px solid #334155; padding-bottom: 0.5rem; }
    code { font-family: monospace; background: #1e293b; color: #34d399; padding: 0.2rem 0.4rem; rounded: 4px; }
    ul { background: #1e293b; padding: 1rem 2rem; border-radius: 8px; border: 1px solid #334155; }
    li { margin-bottom: 0.5rem; }
  </style>
</head>
<body>
  <div id="content">
    ${md.replace(/\n/g, '<br/>').replace(/# (.*)/g, '<h1>$1</h1>').replace(/## (.*)/g, '<h2>$1</h2>')}
  </div>
</body>
</html>`;
}

/**
 * 打包导出 ZIP 档案包 (包含 Markdown + HTML + JSON + ledger.jsonl)
 */
export function createReportZipBuffer(workspaceHash: string): Buffer {
  const zip = new AdmZip();

  const data = generateFullReportData(workspaceHash);
  const mdText = generateMarkdownReport(workspaceHash);
  const htmlText = generateHtmlReport(workspaceHash);

  zip.addFile('report.json', Buffer.from(JSON.stringify(data, null, 2), 'utf-8'));
  zip.addFile('report.md', Buffer.from(mdText, 'utf-8'));
  zip.addFile('report.html', Buffer.from(htmlText, 'utf-8'));

  // 附带审计账本数据
  const ledgerPath = path.resolve(process.cwd(), 'data', 'ledger.jsonl');
  if (fs.existsSync(ledgerPath)) {
    zip.addLocalFile(ledgerPath, '', 'ledger.jsonl');
  }

  return zip.toBuffer();
}
