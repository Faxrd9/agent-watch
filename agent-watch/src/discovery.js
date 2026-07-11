import fs from 'node:fs/promises';
import path from 'node:path';

async function walk(root, output, options, depth = 0) {
  if (depth > options.maxDepth) return;
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) return walk(fullPath, output, options, depth + 1);
    if (!entry.isFile() || !entry.name.endsWith(options.extension)) return;
    try {
      const stat = await fs.stat(fullPath);
      if (Date.now() - stat.mtimeMs <= options.maxAgeMs) output.push({ path: fullPath, size: stat.size, mtimeMs: stat.mtimeMs });
    } catch {}
  }));
}

export async function discoverRecentFiles(root, options = {}) {
  const config = {
    extension: options.extension ?? '.jsonl',
    maxDepth: options.maxDepth ?? 8,
    maxAgeMs: options.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000,
    limit: options.limit ?? 4
  };
  const files = [];
  await walk(root, files, config);
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, config.limit);
}

export class JsonlTailer {
  constructor(options = {}) {
    this.initialBytes = options.initialBytes ?? 256 * 1024;
    this.maxReadBytes = options.maxReadBytes ?? 1024 * 1024;
    this.states = new Map();
  }

  async read(filePath) {
    let stat;
    try { stat = await fs.stat(filePath); } catch { return []; }
    let state = this.states.get(filePath);
    if (!state) {
      const offset = Math.max(0, stat.size - this.initialBytes);
      state = { offset, carry: '', discardFirst: offset > 0 };
      this.states.set(filePath, state);
    }
    if (stat.size < state.offset) {
      state.offset = 0;
      state.carry = '';
      state.discardFirst = false;
    }
    if (stat.size === state.offset) return [];

    let start = state.offset;
    let length = stat.size - start;
    if (length > this.maxReadBytes) {
      start = stat.size - this.maxReadBytes;
      length = this.maxReadBytes;
      state.carry = '';
      state.discardFirst = start > 0;
    }
    const handle = await fs.open(filePath, 'r');
    let bytesRead = 0;
    let buffer;
    try {
      buffer = Buffer.alloc(length);
      ({ bytesRead } = await handle.read(buffer, 0, length, start));
    } finally {
      await handle.close();
    }
    state.offset = start + bytesRead;
    const combined = state.carry + buffer.subarray(0, bytesRead).toString('utf8');
    const lines = combined.split(/\r?\n/);
    state.carry = lines.pop() ?? '';
    if (state.discardFirst) {
      lines.shift();
      state.discardFirst = false;
    }
    const records = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try { records.push(JSON.parse(line)); } catch {}
    }
    return records;
  }
}

export async function readClaudeSessionStatuses(root) {
  let entries;
  try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { return []; }
  const results = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const filePath = path.join(root, entry.name);
    try {
      const stat = await fs.stat(filePath);
      if (Date.now() - stat.mtimeMs > 24 * 60 * 60 * 1000) continue;
      const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
      results.push({
        sessionId: data.sessionId ?? entry.name.replace(/\.json$/, ''),
        status: data.status ?? 'unknown',
        pid: data.pid ?? null,
        updatedAt: data.updatedAt ?? stat.mtime.toISOString()
      });
    } catch {}
  }
  return results.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 10);
}
