import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import yaml from 'yaml';
import { appendLedgerEntry } from './ledger.js';

export interface FileItem {
  relPath: string;
  size: number;
  sha256: string;
}

export interface InventoryData {
  files: FileItem[];
  stats: {
    byExtension: Record<string, { count: number; totalSize: number }>;
    totalFiles: number;
    totalSize: number;
  };
  parsed_frontmatter_and_keys: Array<{
    file: string;
    format: 'markdown' | 'yaml' | 'json' | 'toml' | 'unknown';
    topLevelKeys: string[];
    frontmatter?: Record<string, unknown>;
  }>;
  headings: Array<{
    file: string;
    line: number;
    level: number;
    text: string;
  }>;
  step_and_arrow_lines: Array<{
    file: string;
    line: number;
    text: string;
    matchType: 'arrow' | 'step';
  }>;
  relative_links: Array<{
    file: string;
    line: number;
    linkText: string;
    targetPath: string;
  }>;
  standard_format_flags: Record<string, boolean>;
  candidate_entry_points: Array<{
    file: string;
    reason: string;
  }>;
  unit_candidates: Array<{
    dirPath: string;
    instructionFile: string;
    lineCount: number;
    title?: string;
  }>;
}

const WORKSPACES_DIR = path.resolve(process.cwd(), 'data', 'workspaces');

// 格式与特征匹配定义（均为格式级、通用抽象知识，无任何案例名称）
const STANDARD_FORMAT_FILES = [
  'SKILL.md',
  'AGENTS.md',
  'README.md',
  'PROMPT.md',
  'INSTRUCTIONS.md',
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'Dockerfile',
  'docker-compose.yml',
  'metadata.json',
  'tsconfig.json',
  'Makefile',
  'manifest.json',
  'drizzle.config.ts',
];

const ENTRY_POINT_HEURISTIC_NAMES = [
  'skill.md',
  'agents.md',
  'readme.md',
  'main.py',
  'index.ts',
  'index.js',
  'app.py',
  'app.ts',
  'server.ts',
  'server.js',
  'cli.py',
  'run.py',
  'main.go',
  'main.rs',
];

/**
 * 递归遍历项目目录获取所有文件相对路径
 */
function walkDirectory(dir: string, baseDir: string): string[] {
  let results: string[] = [];
  const list = fs.readdirSync(dir);
  
  for (const file of list) {
    if (file === '.ingest_meta.json' || file === 'inventory.json') continue;
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      results = results.concat(walkDirectory(fullPath, baseDir));
    } else {
      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
      results.push(relPath);
    }
  }
  return results;
}

/**
 * 确定性提取引擎 (Pure TS/Node Code, NO model)
 */
export function generateDeterministicInventory(workspaceHash: string): InventoryData {
  const workspaceDir = path.join(WORKSPACES_DIR, workspaceHash);
  if (!fs.existsSync(workspaceDir)) {
    throw new Error(`工作空间不存在: ${workspaceHash}`);
  }

  // 1. 搜集并按路径升序排序所有文件 (确保确定性)
  const relFilePaths = walkDirectory(workspaceDir, workspaceDir).sort();

  const files: FileItem[] = [];
  const extStats: Record<string, { count: number; totalSize: number }> = {};
  let totalSize = 0;

  for (const relPath of relFilePaths) {
    const fullPath = path.join(workspaceDir, relPath);
    const content = fs.readFileSync(fullPath);
    const size = content.length;
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');

    files.push({ relPath, size, sha256 });
    totalSize += size;

    const ext = path.extname(relPath).toLowerCase() || '[no_ext]';
    if (!extStats[ext]) {
      extStats[ext] = { count: 0, totalSize: 0 };
    }
    extStats[ext].count++;
    extStats[ext].totalSize += size;
  }

  const parsedFrontmatterAndKeys: InventoryData['parsed_frontmatter_and_keys'] = [];
  const headings: InventoryData['headings'] = [];
  const stepAndArrowLines: InventoryData['step_and_arrow_lines'] = [];
  const relativeLinks: InventoryData['relative_links'] = [];
  const standardFlags: Record<string, boolean> = {};
  const candidateEntryPoints: InventoryData['candidate_entry_points'] = [];
  const unitCandidatesMap = new Map<string, InventoryData['unit_candidates'][0]>();

  // 初始化标准格式标志
  for (const stdFile of STANDARD_FORMAT_FILES) {
    standardFlags[stdFile] = false;
  }

  // 2. 逐文件进行词法与确定性语法规则分析
  for (const fileItem of files) {
    const { relPath } = fileItem;
    const fileName = path.basename(relPath);
    const fullPath = path.join(workspaceDir, relPath);

    // 标准格式存在性检测
    for (const stdFile of STANDARD_FORMAT_FILES) {
      if (fileName.toLowerCase() === stdFile.toLowerCase() || relPath.toLowerCase() === stdFile.toLowerCase()) {
        standardFlags[stdFile] = true;
      }
    }

    // 候选入口点识别 (通用启发式)
    if (ENTRY_POINT_HEURISTIC_NAMES.includes(fileName.toLowerCase())) {
      candidateEntryPoints.push({
        file: relPath,
        reason: `符合通用标准入口文件名启发式规则 (${fileName})`,
      });
    }

    // 单元候选 (包含标准指令文件的目录)
    const upperName = fileName.toUpperCase();
    if (
      upperName === 'SKILL.MD' ||
      upperName === 'AGENTS.MD' ||
      upperName === 'README.MD' ||
      upperName === 'PROMPT.MD' ||
      upperName === 'INSTRUCTIONS.MD'
    ) {
      const dirPath = path.dirname(relPath);
      const textContent = fs.readFileSync(fullPath, 'utf-8');
      const lines = textContent.split('\n');
      
      // 提取标题 (第一个 # 标题)
      let title: string | undefined = undefined;
      for (const line of lines) {
        const titleMatch = line.match(/^#\s+(.+)$/);
        if (titleMatch) {
          title = titleMatch[1].trim();
          break;
        }
      }

      if (!unitCandidatesMap.has(dirPath)) {
        unitCandidatesMap.set(dirPath, {
          dirPath: dirPath === '.' ? '/' : dirPath,
          instructionFile: relPath,
          lineCount: lines.length,
          title,
        });
      }
    }

    // 针对 Markdown / YAML / JSON / TOML 文件的通用解析
    const ext = path.extname(relPath).toLowerCase();
    const isTextFile = ['.md', '.yaml', '.yml', '.json', '.toml', '.txt', '.py', '.ts', '.js'].includes(ext);

    if (isTextFile) {
      const text = fs.readFileSync(fullPath, 'utf-8');
      const lines = text.split('\n');

      // (A) 前置元数据 (Frontmatter) & 顶层键解析
      if (ext === '.md') {
        const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        let topKeys: string[] = [];
        let fmObj: Record<string, unknown> | undefined = undefined;

        if (fmMatch) {
          try {
            const parsedFm = yaml.parse(fmMatch[1]);
            if (parsedFm && typeof parsedFm === 'object') {
              fmObj = parsedFm as Record<string, unknown>;
              topKeys = Object.keys(fmObj).sort();
            }
          } catch {
            // 解析失败忽略
          }
        }
        if (topKeys.length > 0 || fmObj) {
          parsedFrontmatterAndKeys.push({
            file: relPath,
            format: 'markdown',
            topLevelKeys: topKeys,
            frontmatter: fmObj,
          });
        }
      } else if (ext === '.yaml' || ext === '.yml') {
        try {
          const parsed = yaml.parse(text);
          if (parsed && typeof parsed === 'object') {
            const topKeys = Object.keys(parsed).sort();
            parsedFrontmatterAndKeys.push({
              file: relPath,
              format: 'yaml',
              topLevelKeys: topKeys,
            });
          }
        } catch {}
      } else if (ext === '.json') {
        try {
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const topKeys = Object.keys(parsed).sort();
            parsedFrontmatterAndKeys.push({
              file: relPath,
              format: 'json',
              topLevelKeys: topKeys,
            });
          }
        } catch {}
      } else if (ext === '.toml') {
        // 简易正则提取 TOML 顶层键/区段
        const topKeys: string[] = [];
        for (const l of lines) {
          const sectionMatch = l.match(/^\[([^\]]+)\]/);
          const keyMatch = l.match(/^([a-zA-Z0-9_-]+)\s*=/);
          if (sectionMatch) {
            topKeys.push(sectionMatch[1].trim());
          } else if (keyMatch) {
            topKeys.push(keyMatch[1].trim());
          }
        }
        if (topKeys.length > 0) {
          parsedFrontmatterAndKeys.push({
            file: relPath,
            format: 'toml',
            topLevelKeys: Array.from(new Set(topKeys)).sort(),
          });
        }
      }

      // (B) 遍历每行进行 Markdown 标题、步骤/箭头行、相对链接提取
      for (let i = 0; i < lines.length; i++) {
        const lineText = lines[i];
        const lineNumber = i + 1;

        // Markdown 标题提取 (# Heading)
        if (ext === '.md') {
          const headingMatch = lineText.match(/^(#{1,6})\s+(.+)$/);
          if (headingMatch) {
            headings.push({
              file: relPath,
              line: lineNumber,
              level: headingMatch[1].length,
              text: headingMatch[2].trim(),
            });
          }
        }

        // 箭头或步骤行提取
        // 箭头: ->, -->, =>, ==>, ➔, →
        // 步骤: 1., Step 1:, 步骤1, [1], 1)
        const hasArrow = /(?:->|-->|=>|==>|➔|→)/.test(lineText);
        const hasStep = /^\s*(?:\d+\.|\d+\)|\[\d+\]|[Ss]tep\s*\d+|步骤\s*\d+)/.test(lineText);

        if (hasArrow) {
          stepAndArrowLines.push({
            file: relPath,
            line: lineNumber,
            text: lineText.trim(),
            matchType: 'arrow',
          });
        } else if (hasStep) {
          stepAndArrowLines.push({
            file: relPath,
            line: lineNumber,
            text: lineText.trim(),
            matchType: 'step',
          });
        }

        // 相对链接提取 (Markdown 或 HTML href)
        // [text](path) 或 href="path"
        const mdLinkMatches = lineText.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g);
        for (const m of mdLinkMatches) {
          const linkText = m[1].trim();
          const targetPath = m[2].trim();
          if (!targetPath.startsWith('http://') && !targetPath.startsWith('https://') && !targetPath.startsWith('#')) {
            relativeLinks.push({
              file: relPath,
              line: lineNumber,
              linkText,
              targetPath,
            });
          }
        }

        const hrefMatches = lineText.matchAll(/href=["']([^"']+)["']/g);
        for (const m of hrefMatches) {
          const targetPath = m[1].trim();
          if (!targetPath.startsWith('http://') && !targetPath.startsWith('https://') && !targetPath.startsWith('#')) {
            relativeLinks.push({
              file: relPath,
              line: lineNumber,
              linkText: targetPath,
              targetPath,
            });
          }
        }
      }
    }
  }

  // 排序保证确定性
  parsedFrontmatterAndKeys.sort((a, b) => a.file.localeCompare(b.file));
  headings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  stepAndArrowLines.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  relativeLinks.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  candidateEntryPoints.sort((a, b) => a.file.localeCompare(b.file));
  
  const unitCandidates = Array.from(unitCandidatesMap.values()).sort((a, b) => a.dirPath.localeCompare(b.dirPath));

  const inventory: InventoryData = {
    files,
    stats: {
      byExtension: extStats,
      totalFiles: files.length,
      totalSize,
    },
    parsed_frontmatter_and_keys: parsedFrontmatterAndKeys,
    headings,
    step_and_arrow_lines: stepAndArrowLines,
    relative_links: relativeLinks,
    standard_format_flags: standardFlags,
    candidate_entry_points: candidateEntryPoints,
    unit_candidates: unitCandidates,
  };

  // 格式化为 JSON 并存入工作空间 inventory.json (确定性键排序)
  const jsonContent = serializeDeterministicJson(inventory);
  fs.writeFileSync(path.join(workspaceDir, 'inventory.json'), jsonContent, 'utf-8');

  // 追加证据账本记录
  const inventoryHash = crypto.createHash('sha256').update(jsonContent).digest('hex');
  appendLedgerEntry({
    stage: 'STAGE1',
    action: 'GENERATE_INVENTORY',
    inputs_hash: workspaceHash,
    outputs_hash: inventoryHash,
    ref: {
      workspace_hash: workspaceHash,
      file_path: 'inventory.json',
      details: `确定性清单提取完成: ${files.length} 个文件, 提取 ${headings.length} 标题, ${stepAndArrowLines.length} 步骤/箭头行, ${unitCandidates.length} 单元候选`,
    },
  });

  return inventory;
}

/**
 * 递归深度确定性 JSON 序列化
 */
export function serializeDeterministicJson(obj: unknown): string {
  return JSON.stringify(sortKeysObject(obj), null, 2);
}

function sortKeysObject(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(sortKeysObject);
  } else if (obj !== null && typeof obj === 'object') {
    const sortedObj: Record<string, unknown> = {};
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    for (const key of keys) {
      sortedObj[key] = sortKeysObject((obj as Record<string, unknown>)[key]);
    }
    return sortedObj;
  }
  return obj;
}

/**
 * 获取现有工作空间的确定性清单
 */
export function getInventory(workspaceHash: string): InventoryData {
  const workspaceDir = path.join(WORKSPACES_DIR, workspaceHash);
  const inventoryFile = path.join(workspaceDir, 'inventory.json');
  if (fs.existsSync(inventoryFile)) {
    const content = fs.readFileSync(inventoryFile, 'utf-8');
    return JSON.parse(content);
  }
  return generateDeterministicInventory(workspaceHash);
}
