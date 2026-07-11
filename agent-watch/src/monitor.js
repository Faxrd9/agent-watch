import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { discoverRecentFiles, JsonlTailer, readClaudeSessionStatuses } from './discovery.js';
import { parseRecord } from './parsers.js';
import { probeProcesses } from './process-probe.js';
import { deriveProviderState, STATUS_META } from './state.js';

const PROVIDERS = ['codex', 'claude'];

export class Monitor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.homeDir = options.homeDir ?? os.homedir();
    this.pollMs = options.pollMs ?? 2000;
    this.settings = {
      stallSeconds: options.stallSeconds ?? 120,
      showContent: options.showContent ?? false,
      maxEvents: options.maxEvents ?? 200,
      retentionMinutes: options.retentionMinutes ?? 60
    };
    this.roots = {
      codex: options.codexRoot ?? path.join(this.homeDir, '.codex', 'sessions'),
      claude: options.claudeRoot ?? path.join(this.homeDir, '.claude', 'projects'),
      claudeStatuses: options.claudeStatusesRoot ?? path.join(this.homeDir, '.claude', 'sessions')
    };
    this.tailer = new JsonlTailer();
    this.events = [];
    this.sequence = 0;
    this.running = false;
    this.timer = null;
    this.previousCpu = { codex: 0, claude: 0 };
    this.runtime = Object.fromEntries(PROVIDERS.map((provider) => [provider, {
      lastActivityAt: 0,
      lastSessionEventAt: 0,
      lastNetworkIssueAt: 0,
      latestSessionId: '',
      sessionBusy: new Map(),
      sessionPendingTools: new Map(),
      files: [],
      process: { processes: [], cpuTotal: 0, cpuDelta: 0, tcp: { available: false, total: 0, established: 0, connecting: 0, closing: 0 } },
      state: { status: 'offline', reason: '正在初始化', ageMs: Infinity }
    }]));
    this.snapshot = this.buildSnapshot();
  }

  start() {
    if (this.timer) return;
    this.poll();
    this.timer = setInterval(() => this.poll(), this.pollMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  updateSettings(next = {}) {
    const stall = Number(next.stallSeconds);
    if (Number.isFinite(stall)) this.settings.stallSeconds = Math.min(1800, Math.max(30, Math.round(stall)));
    if (typeof next.showContent === 'boolean') this.settings.showContent = next.showContent;
    const maxEvents = Number(next.maxEvents);
    if (Number.isFinite(maxEvents)) this.settings.maxEvents = Math.min(2000, Math.max(50, Math.round(maxEvents)));
    const retentionMinutes = Number(next.retentionMinutes);
    if (Number.isFinite(retentionMinutes)) this.settings.retentionMinutes = Math.min(1440, Math.max(5, Math.round(retentionMinutes)));
    this.pruneEvents();
    this.snapshot = this.buildSnapshot();
    this.emit('snapshot', this.snapshot);
    return this.settings;
  }

  clearEvents() {
    this.events = [];
    this.snapshot = this.buildSnapshot();
    this.emit('snapshot', this.snapshot);
  }

  pruneEvents(now = Date.now()) {
    const cutoff = now - this.settings.retentionMinutes * 60_000;
    this.events = this.events.filter((event) => (new Date(event.timestamp).getTime() || now) >= cutoff);
    if (this.events.length > this.settings.maxEvents) this.events.splice(0, this.events.length - this.settings.maxEvents);
  }

  async poll() {
    if (this.running) return;
    this.running = true;
    try {
      const [processes, codexFiles, claudeFiles, claudeStatuses] = await Promise.all([
        probeProcesses(),
        discoverRecentFiles(this.roots.codex),
        discoverRecentFiles(this.roots.claude),
        readClaudeSessionStatuses(this.roots.claudeStatuses)
      ]);
      const fileSets = { codex: codexFiles, claude: claudeFiles };
      for (const provider of PROVIDERS) {
        const runtime = this.runtime[provider];
        runtime.files = fileSets[provider];
        const current = processes[provider];
        current.cpuDelta = Math.max(0, current.cpuTotal - this.previousCpu[provider]);
        this.previousCpu[provider] = current.cpuTotal;
        runtime.process = current;
        for (const file of [...fileSets[provider]].reverse()) {
          const records = await this.tailer.read(file.path);
          for (const record of records) {
            const parsed = parseRecord(provider, record, { filePath: file.path, homeDir: this.homeDir });
            for (const event of parsed) this.addEvent(event);
          }
          runtime.lastActivityAt = Math.max(runtime.lastActivityAt, file.mtimeMs);
        }
      }

      const latestClaude = claudeStatuses[0];
      if (latestClaude?.status === 'busy') {
        const runtime = this.runtime.claude;
        const statusTime = new Date(latestClaude.updatedAt).getTime() || 0;
        if (statusTime >= runtime.lastSessionEventAt) runtime.latestSessionId = latestClaude.sessionId;
        runtime.sessionBusy.set(latestClaude.sessionId, true);
        runtime.lastActivityAt = Math.max(runtime.lastActivityAt, statusTime);
      }

      for (const provider of PROVIDERS) {
        const runtime = this.runtime[provider];
        const busy = runtime.latestSessionId ? runtime.sessionBusy.get(runtime.latestSessionId) === true : false;
        const pendingToolCount = runtime.latestSessionId ? (runtime.sessionPendingTools.get(runtime.latestSessionId)?.size ?? 0) : 0;
        runtime.state = deriveProviderState({
          processCount: runtime.process.processes.length,
          cpuDelta: runtime.process.cpuDelta,
          tcp: runtime.process.tcp,
          busy,
          pendingToolCount,
          lastActivityAt: runtime.lastActivityAt,
          networkIssueAt: runtime.lastNetworkIssueAt,
          stallMs: this.settings.stallSeconds * 1000,
          probeError: processes.error
        });
      }
      this.pruneEvents();
      this.snapshot = this.buildSnapshot();
      this.emit('snapshot', this.snapshot);
    } catch (error) {
      this.snapshot = { ...this.snapshot, updatedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) };
      this.emit('snapshot', this.snapshot);
    } finally {
      this.running = false;
    }
  }

  addEvent(event) {
    const runtime = this.runtime[event.provider];
    const timestampMs = new Date(event.timestamp).getTime() || Date.now();
    runtime.lastActivityAt = Math.max(runtime.lastActivityAt, timestampMs);
    if (timestampMs >= runtime.lastSessionEventAt) {
      runtime.lastSessionEventAt = timestampMs;
      runtime.latestSessionId = event.sessionId || runtime.latestSessionId;
    }
    if (event.busyHint !== null && event.sessionId) runtime.sessionBusy.set(event.sessionId, event.busyHint);
    if (event.sessionId && event.callId) {
      if (!runtime.sessionPendingTools.has(event.sessionId)) runtime.sessionPendingTools.set(event.sessionId, new Set());
      const pending = runtime.sessionPendingTools.get(event.sessionId);
      if (event.kind === 'tool_call') pending.add(event.callId);
      if (event.kind === 'tool_output') pending.delete(event.callId);
    }
    if (event.networkHint) runtime.lastNetworkIssueAt = timestampMs;
    this.events.push({ ...event, id: `${event.provider}-${timestampMs}-${++this.sequence}` });
    this.pruneEvents(timestampMs);
  }

  buildSnapshot() {
    const providers = {};
    for (const provider of PROVIDERS) {
      const runtime = this.runtime[provider];
      const meta = STATUS_META[runtime.state.status] ?? STATUS_META.unavailable;
      const pendingToolCount = runtime.latestSessionId ? (runtime.sessionPendingTools.get(runtime.latestSessionId)?.size ?? 0) : 0;
      providers[provider] = {
        name: provider === 'codex' ? 'Codex' : 'Claude Code',
        status: runtime.state.status,
        statusLabel: meta.label,
        tone: meta.tone,
        reason: runtime.state.reason,
        lastActivityAt: runtime.lastActivityAt ? new Date(runtime.lastActivityAt).toISOString() : null,
        processCount: runtime.process.processes.length,
        cpuDelta: runtime.process.cpuDelta,
        memoryBytes: runtime.process.processes.reduce((sum, item) => sum + item.memoryBytes, 0),
        pids: runtime.process.processes.map((item) => item.pid),
        tcp: runtime.process.tcp,
        busy: runtime.latestSessionId ? runtime.sessionBusy.get(runtime.latestSessionId) === true : false,
        pendingToolCount,
        observedFiles: runtime.files.map((file) => ({ path: file.path.replace(this.homeDir, '$HOME'), mtime: new Date(file.mtimeMs).toISOString(), size: file.size }))
      };
    }
    const events = [...this.events].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).map((event) => {
      const { busyHint, networkHint, ...safe } = event;
      if (!this.settings.showContent) safe.preview = '';
      return safe;
    });
    return {
      app: { name: 'Agent Watch', version: '0.1.0', localOnly: true },
      updatedAt: new Date().toISOString(),
      providers,
      events,
      settings: { ...this.settings },
      limitations: '本软件展示本机会话日志中可观察到的输入、文件访问、工具调用和输出；无法证明云端实际收到的完整 TLS 请求内容。'
    };
  }

  getSnapshot() {
    return this.snapshot;
  }
}
