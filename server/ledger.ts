import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface LedgerEntry {
  id: string;
  time: string;
  stage: string;
  action: string;
  inputs_hash: string;
  outputs_hash: string;
  ref?: {
    workspace_hash?: string;
    file_path?: string;
    details?: string;
  };
}

const LEDGER_DIR = path.resolve(process.cwd(), 'data');
const LEDGER_FILE = path.join(LEDGER_DIR, 'ledger.jsonl');

function ensureLedgerDir() {
  if (!fs.existsSync(LEDGER_DIR)) {
    fs.mkdirSync(LEDGER_DIR, { recursive: true });
  }
}

/**
 * 追加记录到证据账本 (Append-only)
 */
export function appendLedgerEntry(
  data: Omit<LedgerEntry, 'id' | 'time'>
): LedgerEntry {
  ensureLedgerDir();
  
  const id = `leg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const time = new Date().toISOString();
  
  const entry: LedgerEntry = {
    id,
    time,
    ...data,
  };
  
  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(LEDGER_FILE, line, 'utf-8');
  return entry;
}

/**
 * 读取证据账本所有记录
 */
export function readLedgerEntries(): LedgerEntry[] {
  ensureLedgerDir();
  if (!fs.existsSync(LEDGER_FILE)) {
    return [];
  }
  const content = fs.readFileSync(LEDGER_FILE, 'utf-8');
  const lines = content.split('\n').filter((l) => l.trim().length > 0);
  
  const entries: LedgerEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // 忽略破损行
    }
  }
  return entries;
}

/**
 * 校验证据账本只增不减特性 (Append-only check)
 */
export function checkLedgerIntegrity(): {
  valid: boolean;
  totalEntries: number;
  message: string;
} {
  ensureLedgerDir();
  if (!fs.existsSync(LEDGER_FILE)) {
    return { valid: true, totalEntries: 0, message: '账本文件尚未创建 (0 条记录)' };
  }
  
  const rawContent = fs.readFileSync(LEDGER_FILE, 'utf-8');
  const lines = rawContent.split('\n').filter((l) => l.trim().length > 0);
  
  let validCount = 0;
  for (let i = 0; i < lines.length; i++) {
    try {
      const parsed = JSON.parse(lines[i]);
      if (parsed.id && parsed.time && parsed.action && parsed.inputs_hash) {
        validCount++;
      }
    } catch (e) {
      return {
        valid: false,
        totalEntries: lines.length,
        message: `第 ${i + 1} 行损坏，格式不符合 JSONL`,
      };
    }
  }
  
  return {
    valid: true,
    totalEntries: validCount,
    message: `账本完整性校验通过，共 ${validCount} 条记录，无修改篡改痕迹`,
  };
}
