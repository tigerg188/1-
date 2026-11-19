import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import AdmZip from 'adm-zip';
import { appendLedgerEntry } from './ledger.js';

export interface IngestResult {
  workspaceHash: string;
  fileCount: number;
  totalSize: number;
  sourceType: 'github' | 'zip';
  sourceUrl?: string;
  files: Array<{ relPath: string; size: number; sha256: string }>;
}

const WORKSPACES_DIR = path.resolve(process.cwd(), 'data', 'workspaces');
const GITHUB_FETCH_TIMEOUT_MS = 30000;

function ensureWorkspacesDir() {
  if (!fs.existsSync(WORKSPACES_DIR)) {
    fs.mkdirSync(WORKSPACES_DIR, { recursive: true });
  }
}

/**
 * 校验路径安全性，防止 Path Traversal 注入攻击
 */
export function sanitizePath(baseDir: string, relativePath: string): string {
  const normalized = path.normalize(relativePath).replace(/^(\.\.[\/\\])+/, '');
  const resolved = path.resolve(baseDir, normalized);
  if (resolved !== baseDir && !resolved.startsWith(baseDir + path.sep)) {
    throw new Error(`非法路径遍历风险: ${relativePath}`);
  }
  return resolved;
}

function isZipBuffer(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

/**
 * 将 Zip Buffer 解压并存储在隔离的项目空间目录中
 */
export function processZipBuffer(
  buffer: Buffer,
  sourceType: 'github' | 'zip',
  sourceUrl?: string
): IngestResult {
  ensureWorkspacesDir();

  if (buffer.length > 100 * 1024 * 1024) {
    throw new Error('压缩包文件过大，超出 100MB 限制');
  }

  if (!isZipBuffer(buffer)) {
    throw new Error('下载或上传的内容不是有效的 .zip 压缩归档格式');
  }

  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch (err: any) {
    throw new Error(`无法解析 .zip 压缩包: ${err?.message || '归档格式损坏'}`);
  }

  const zipEntries = zip.getEntries();
  const validEntries = zipEntries.filter((e) => !e.isDirectory);

  if (validEntries.length === 0) {
    throw new Error('压缩包中未包含任何有效文件');
  }

  if (validEntries.length > 5000) {
    throw new Error(`解压文件数 (${validEntries.length}) 超出 5000 个上限`);
  }

  // 计算整体 Buffer 的 SHA256 作为唯一 workspaceHash
  const workspaceHash = crypto.createHash('sha256').update(buffer).digest('hex');
  const workspaceDir = path.join(WORKSPACES_DIR, workspaceHash);

  // 若已存在，先清理旧文件重新解压
  if (fs.existsSync(workspaceDir)) {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
  fs.mkdirSync(workspaceDir, { recursive: true });

  // 检查是否包含单一顶级目录包装（例如 GitHub 自动打包的 repo-main/ 目录）
  const firstLevelDirs = new Set<string>();
  for (const entry of validEntries) {
    const cleanName = entry.entryName.replace(/^\/+/, '');
    const slashIdx = cleanName.indexOf('/');
    if (slashIdx > 0) {
      firstLevelDirs.add(cleanName.slice(0, slashIdx));
    } else {
      firstLevelDirs.add('__ROOT_FILE__');
    }
  }

  const singleDir = firstLevelDirs.size === 1 ? Array.from(firstLevelDirs)[0] : '';
  const hasSingleTopDir = Boolean(singleDir && singleDir !== '__ROOT_FILE__');
  const topDirPrefix = hasSingleTopDir ? singleDir + '/' : '';

  let fileCount = 0;
  let totalSize = 0;
  const filesMeta: Array<{ relPath: string; size: number; sha256: string }> = [];

  for (const entry of validEntries) {
    let relPath = entry.entryName.replace(/^\/+/, '');
    if (hasSingleTopDir && relPath.startsWith(topDirPrefix)) {
      relPath = relPath.slice(topDirPrefix.length);
    }

    if (!relPath || relPath === '.' || relPath === 'pax_global_header') {
      continue;
    }

    // 过滤不合法或隐藏系统垃圾文件（如 .git、__MACOSX、.DS_Store）
    if (
      relPath.startsWith('.git/') ||
      relPath.startsWith('__MACOSX/') ||
      relPath.endsWith('.DS_Store')
    ) {
      continue;
    }

    const targetPath = sanitizePath(workspaceDir, relPath);
    const targetFolder = path.dirname(targetPath);
    if (!fs.existsSync(targetFolder)) {
      fs.mkdirSync(targetFolder, { recursive: true });
    }

    const contentBuffer = entry.getData();
    fs.writeFileSync(targetPath, contentBuffer);

    const size = contentBuffer.length;
    const sha256 = crypto.createHash('sha256').update(contentBuffer).digest('hex');

    fileCount++;
    totalSize += size;
    filesMeta.push({ relPath, size, sha256 });
  }

  if (fileCount === 0) {
    throw new Error('过滤隐藏目录后未提取到任何有效工程文件');
  }

  // 写入原始元数据文件 .ingest_meta.json 到 workspace
  const metaObj = {
    workspaceHash,
    ingestTime: new Date().toISOString(),
    sourceType,
    sourceUrl: sourceUrl || '',
    fileCount,
    totalSize,
  };
  fs.writeFileSync(
    path.join(workspaceDir, '.ingest_meta.json'),
    JSON.stringify(metaObj, null, 2),
    'utf-8'
  );

  // 写入证据账本 (Append-only)
  appendLedgerEntry({
    stage: 'STAGE1',
    action: 'INGEST_PROJECT',
    inputs_hash: crypto.createHash('sha256').update(sourceUrl || buffer).digest('hex'),
    outputs_hash: workspaceHash,
    ref: {
      workspace_hash: workspaceHash,
      details: `导入项目成功: ${sourceType === 'github' ? sourceUrl : 'Zip 上传'} (${fileCount} 个文件, ${totalSize} 字节)`,
    },
  });

  return {
    workspaceHash,
    fileCount,
    totalSize,
    sourceType,
    sourceUrl,
    files: filesMeta,
  };
}

interface ParsedGithubTarget {
  owner: string;
  repo: string;
  ref?: string;
  fallbackRef?: string;
}

async function fetchWithTimeout(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers,
      redirect: 'follow',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 从 GitHub 公开仓库下载 zip 归档包并解压（支持 codeload 直连归档与 api.github.com 双路容错）
 */
export async function ingestGithubRepo(repoUrl: string): Promise<IngestResult> {
  const parsed = parseGithubUrl(repoUrl);
  if (!parsed) {
    throw new Error(
      '无法解析有效的 GitHub 仓库地址（支持 https://github.com/用户名/仓库名、github.com/用户名/仓库名、git@github.com:用户名/仓库名.git 或 用户名/仓库名）'
    );
  }

  const { owner, repo, ref, fallbackRef } = parsed;
  const canonicalSourceUrl = `https://github.com/${owner}/${repo}${ref ? `/tree/${ref}` : ''}`;

  const candidateUrls: Array<{ url: string; isApi: boolean }> = [];
  if (ref) {
    const encodedRef = ref
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/');
    candidateUrls.push(
      { url: `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${encodedRef}`, isApi: false },
      { url: `https://codeload.github.com/${owner}/${repo}/zip/refs/tags/${encodedRef}`, isApi: false },
      { url: `https://api.github.com/repos/${owner}/${repo}/zipball/${encodedRef}`, isApi: true }
    );
    if (fallbackRef && fallbackRef !== ref) {
      const encFallback = encodeURIComponent(fallbackRef);
      candidateUrls.push(
        { url: `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${encFallback}`, isApi: false },
        { url: `https://api.github.com/repos/${owner}/${repo}/zipball/${encFallback}`, isApi: true }
      );
    }
    candidateUrls.push({
      url: `https://github.com/${owner}/${repo}/archive/HEAD.zip`,
      isApi: false,
    });
  } else {
    candidateUrls.push(
      { url: `https://github.com/${owner}/${repo}/archive/HEAD.zip`, isApi: false },
      { url: `https://api.github.com/repos/${owner}/${repo}/zipball/`, isApi: true }
    );
  }

  let lastStatus = 0;
  let lastStatusText = '';
  let lastNetworkErr = '';

  for (const candidate of candidateUrls) {
    const headers: Record<string, string> = {
      'User-Agent': 'AI-Studio-Applet-IngestEngine',
      Accept: candidate.isApi ? 'application/vnd.github+json' : 'application/zip, */*',
    };
    if (process.env.GITHUB_TOKEN) {
      headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    try {
      const response = await fetchWithTimeout(candidate.url, headers, GITHUB_FETCH_TIMEOUT_MS);
      if (!response.ok) {
        lastStatus = response.status;
        lastStatusText = response.statusText;
        continue;
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      if (!isZipBuffer(buffer)) {
        lastNetworkErr = '服务端未返回有效 Zip 压缩包格式';
        continue;
      }

      return processZipBuffer(buffer, 'github', canonicalSourceUrl);
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        lastNetworkErr = `下载超时（超过 ${Math.round(GITHUB_FETCH_TIMEOUT_MS / 1000)} 秒）`;
      } else {
        lastNetworkErr = err?.message || '网络连接失败';
      }
    }
  }

  if (lastStatus === 404) {
    throw new Error(
      `GitHub 仓库 ${owner}/${repo}${ref ? ` (引用: ${ref})` : ''} 不存在、为私有仓库或不可访问 (404)`
    );
  }
  if (lastStatus === 403 || lastStatus === 429) {
    throw new Error(
      `GitHub 下载触发速率限制或访问受限 (${lastStatus})，请稍后重试或改用本地 .zip 压缩包上传`
    );
  }
  if (lastStatus > 0) {
    throw new Error(`下载 GitHub 仓库失败: HTTP ${lastStatus} ${lastStatusText}`);
  }
  throw new Error(`连接 GitHub 下载归档失败：${lastNetworkErr || '未知网络错误'}，可改用本地 .zip 压缩包上传`);
}

/**
 * 解析多种格式的 GitHub 仓库地址
 * 支持：
 * - https://github.com/owner/repo(.git)
 * - https://github.com/owner/repo/tree/branch(/subdir)
 * - https://github.com/owner/repo/blob/branch/...
 * - https://github.com/owner/repo/releases/tag/v1.0
 * - github.com/owner/repo
 * - git@github.com:owner/repo.git
 * - ssh://git@github.com/owner/repo.git
 * - git clone https://github.com/owner/repo.git
 * - owner/repo
 */
export function parseGithubUrl(urlStr: string): ParsedGithubTarget | null {
  try {
    let clean = String(urlStr || '').trim();
    if (!clean) return null;

    // 剥离常见外围引号或 git clone 前缀
    clean = clean.replace(/^git\s+clone\s+/i, '').trim();
    clean = clean.replace(/^[`"'“‘(<\[]+|[`"'”’)>\]。，,;；]+$/g, '').trim();
    if (!clean) return null;

    // 处理 SSH 格式: git@github.com:owner/repo.git 或 ssh://git@github.com/owner/repo.git
    const sshMatch = clean.match(/^(?:ssh:\/\/)?git@github\.com[:\/](.+)$/i);
    if (sshMatch) {
      clean = 'https://github.com/' + sshMatch[1];
    } else if (/^(?:www\.)?github\.com\//i.test(clean)) {
      clean = 'https://' + clean;
    } else if (!/^https?:\/\//i.test(clean)) {
      // owner/repo 短路径形式
      if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/.*)?$/.test(clean)) {
        clean = 'https://github.com/' + clean;
      } else {
        return null;
      }
    }

    const url = new URL(clean);
    const host = url.hostname.toLowerCase();
    if (host !== 'github.com' && host !== 'www.github.com') {
      return null;
    }

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;

    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/i, '');
    if (!owner || !repo || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
      return null;
    }

    let ref: string | undefined;
    let fallbackRef: string | undefined;

    if ((parts[2] === 'tree' || parts[2] === 'blob') && parts[3]) {
      ref = parts.slice(3).join('/');
      fallbackRef = parts[3];
    } else if (parts[2] === 'releases' && parts[3] === 'tag' && parts[4]) {
      ref = parts.slice(4).join('/');
      fallbackRef = parts[4];
    }

    return { owner, repo, ref, fallbackRef };
  } catch {
    return null;
  }
}
