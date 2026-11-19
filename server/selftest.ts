import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { generateDeterministicInventory, serializeDeterministicJson } from './inventory.js';
import { checkLedgerIntegrity, appendLedgerEntry, readLedgerEntries } from './ledger.js';

export interface SelfTestResult {
  timestamp: string;
  forbiddenScan: {
    passed: boolean;
    hitCount: number;
    hits: Array<{ file: string; line: number; keyword: string; text: string }>;
    scannedFilesCount: number;
  };
  inventoryDeterminism: {
    tested: boolean;
    passed: boolean;
    workspaceHash?: string;
    run1Hash?: string;
    run2Hash?: string;
    message: string;
  };
  ledgerIntegrity: {
    passed: boolean;
    totalEntries: number;
    message: string;
  };
}

const DEFAULT_FORBIDDEN_WORDS_PATH = path.resolve(process.cwd(), 'config', 'forbidden_words.json');

export function loadForbiddenWords(): string[] {
  if (fs.existsSync(DEFAULT_FORBIDDEN_WORDS_PATH)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(DEFAULT_FORBIDDEN_WORDS_PATH, 'utf-8'));
      if (Array.isArray(parsed.words)) {
        return parsed.words.map((w: unknown) => String(w).trim().toLowerCase()).filter(Boolean);
      }
    } catch {}
  }
  return [];
}

function scanFileForKeywords(
  filePath: string,
  baseDir: string,
  forbiddenWords: string[]
): Array<{ file: string; line: number; keyword: string; text: string }> {
  const relPath = path.relative(baseDir, filePath).replace(/\\/g, '/');
  // 跳过构建产物、开发工具配置及违禁词词表配置文件自身
  if (
    relPath.startsWith('dist/') ||
    relPath.startsWith('node_modules/') ||
    relPath.startsWith('.git/') ||
    relPath.startsWith('acceptance/raw/') ||
    relPath === 'config/forbidden_words.json'
  ) {
    return [];
  }

  const hits: Array<{ file: string; line: number; keyword: string; text: string }> = [];
  try {
    const text = fs.readFileSync(filePath, 'utf-8');
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      const lower = lineText.toLowerCase();

      for (const kw of forbiddenWords) {
        if (lower.includes(kw)) {
          hits.push({
            file: relPath,
            line: i + 1,
            keyword: kw,
            text: lineText.trim(),
          });
        }
      }
    }
  } catch {}

  return hits;
}

function walkScanDir(dir: string, baseDir: string): string[] {
  let files: string[] = [];
  if (!fs.existsSync(dir)) return files;
  const list = fs.readdirSync(dir);
  for (const item of list) {
    if (item === 'node_modules' || item === 'dist' || item === '.git' || item === 'data') continue;
    const full = path.join(dir, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      files = files.concat(walkScanDir(full, baseDir));
    } else {
      files.push(full);
    }
  }
  return files;
}

/**
 * 运行三大确定性自检
 */
export function runSelfTest(workspaceHash?: string): SelfTestResult {
  const timestamp = new Date().toISOString();
  const rootDir = process.cwd();
  const forbiddenWords = loadForbiddenWords();

  // (a) 扫描自身源码中的违禁词 (C1, C2)
  const scanTargetDirs = [
    path.join(rootDir, 'src'),
    path.join(rootDir, 'server'),
    path.join(rootDir, 'config'),
    path.join(rootDir, 'acceptance'),
  ];
  let scannedFiles: string[] = [
    path.join(rootDir, 'package.json'),
    path.join(rootDir, 'index.html'),
    path.join(rootDir, 'server.ts'),
  ];
  for (const d of scanTargetDirs) {
    scannedFiles = scannedFiles.concat(walkScanDir(d, rootDir));
  }

  let forbiddenHits: Array<{ file: string; line: number; keyword: string; text: string }> = [];
  for (const f of scannedFiles) {
    forbiddenHits = forbiddenHits.concat(scanFileForKeywords(f, rootDir, forbiddenWords));
  }

  const forbiddenScanResult = {
    passed: forbiddenHits.length === 0,
    hitCount: forbiddenHits.length,
    hits: forbiddenHits,
    scannedFilesCount: scannedFiles.length,
  };

  // (b) 清单提取确定性校验 (运行两次对比 SHA256；仅当存在解压源文件 .ingest_meta.json 时才运行以防止覆写纯 JSON 缓存)
  let inventoryDeterminismResult: SelfTestResult['inventoryDeterminism'] = {
    tested: false,
    passed: false,
    message: '尚未导入任何项目空间，跳过清单确定性对比',
  };

  if (workspaceHash) {
    const metaPath = path.resolve(rootDir, 'data', 'workspaces', workspaceHash, '.ingest_meta.json');
    if (!fs.existsSync(metaPath)) {
      inventoryDeterminismResult = {
        tested: false,
        passed: false,
        workspaceHash,
        message: '当前工作空间缺少 .ingest_meta.json 与解压源文件，跳过清单确定性对比以保护既有清单',
      };
    } else {
      try {
        const inv1 = generateDeterministicInventory(workspaceHash);
        const json1 = serializeDeterministicJson(inv1);
        const hash1 = crypto.createHash('sha256').update(json1).digest('hex');

        const inv2 = generateDeterministicInventory(workspaceHash);
        const json2 = serializeDeterministicJson(inv2);
        const hash2 = crypto.createHash('sha256').update(json2).digest('hex');

        const passed = hash1 === hash2 && json1 === json2;
        inventoryDeterminismResult = {
          tested: true,
          passed,
          workspaceHash,
          run1Hash: hash1,
          run2Hash: hash2,
          message: passed
            ? `确定性校验成功: 两次提取结果字节完全一致 (SHA256: ${hash1.slice(0, 16)}...)`
            : `确定性校验失败: 两次提取哈希不匹配 (${hash1.slice(0, 8)} vs ${hash2.slice(0, 8)})`,
        };
      } catch (err: any) {
        inventoryDeterminismResult = {
          tested: true,
          passed: false,
          workspaceHash,
          message: `确定性测试出错: ${err.message}`,
        };
      }
    }
  }

  // (c) 证据账本只增不减校验
  const beforeCount = readLedgerEntries().length;
  appendLedgerEntry({
    stage: 'STAGE1',
    action: 'SELF_TEST_RUN',
    inputs_hash: crypto.createHash('sha256').update(timestamp).digest('hex'),
    outputs_hash: forbiddenScanResult.passed ? 'PASS' : 'FAIL',
    ref: {
      details: `自检执行完成: 违禁词命中=${forbiddenHits.length}, 账本原条数=${beforeCount}`,
    },
  });

  const ledgerCheck = checkLedgerIntegrity();

  return {
    timestamp,
    forbiddenScan: forbiddenScanResult,
    inventoryDeterminism: inventoryDeterminismResult,
    ledgerIntegrity: {
      passed: ledgerCheck.valid,
      totalEntries: ledgerCheck.totalEntries,
      message: ledgerCheck.message,
    },
  };
}
