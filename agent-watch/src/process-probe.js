import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function emptyResult(error = '') {
  return {
    codex: { processes: [], cpuTotal: 0, tcp: { available: false, total: 0, established: 0, connecting: 0, closing: 0 } },
    claude: { processes: [], cpuTotal: 0, tcp: { available: false, total: 0, established: 0, connecting: 0, closing: 0 } },
    error
  };
}

async function probeWindows() {
  const script = `
    $items = Get-Process -ErrorAction SilentlyContinue |
      Where-Object { $_.ProcessName -match '^(codex|codex-code-mode-host|claude)$' } |
      Select-Object Id, ProcessName, CPU, WorkingSet64, StartTime
    $tcpAvailable = $false
    $connections = @()
    try {
      $connections = @(Get-NetTCPConnection -ErrorAction Stop |
        Where-Object { @($items.Id) -contains $_.OwningProcess } |
        Select-Object OwningProcess, State)
      $tcpAvailable = $true
    } catch {}
    [pscustomobject]@{
      processes = @($items)
      connections = @($connections)
      tcpAvailable = $tcpAvailable
    } | ConvertTo-Json -Compress -Depth 4
  `;
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    timeout: 5000,
    maxBuffer: 1024 * 1024
  });
  const parsed = stdout.trim() ? JSON.parse(stdout) : { processes: [], connections: [], tcpAvailable: false };
  const rows = Array.isArray(parsed.processes) ? parsed.processes : parsed.processes ? [parsed.processes] : [];
  const result = emptyResult();
  const providerByPid = new Map();
  for (const row of rows) {
    const provider = /^claude$/i.test(row.ProcessName) ? 'claude' : 'codex';
    const process = {
      pid: Number(row.Id),
      name: row.ProcessName,
      cpu: Number(row.CPU ?? 0),
      memoryBytes: Number(row.WorkingSet64 ?? 0),
      startedAt: row.StartTime ?? null
    };
    result[provider].processes.push(process);
    result[provider].cpuTotal += process.cpu;
    result[provider].tcp.available = Boolean(parsed.tcpAvailable);
    providerByPid.set(process.pid, provider);
  }
  const connections = Array.isArray(parsed.connections) ? parsed.connections : parsed.connections ? [parsed.connections] : [];
  for (const connection of connections) {
    const provider = providerByPid.get(Number(connection.OwningProcess));
    if (!provider) continue;
    const tcp = result[provider].tcp;
    const state = String(connection.State ?? '').toLowerCase();
    tcp.total += 1;
    if (state === 'established') tcp.established += 1;
    else if (['synsent', 'synreceived'].includes(state.replace(/[^a-z]/g, ''))) tcp.connecting += 1;
    else if (['closewait', 'finwait1', 'finwait2', 'closing', 'lastack', 'timewait'].includes(state.replace(/[^a-z0-9]/g, ''))) tcp.closing += 1;
  }
  return result;
}

async function probePosix() {
  const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,comm=,time=,rss=,args='], { timeout: 5000, maxBuffer: 1024 * 1024 });
  const result = emptyResult();
  for (const line of stdout.split('\n')) {
    if (!/(?:^|\s)(?:codex|claude)(?:\s|$)/i.test(line)) continue;
    const match = line.trim().match(/^(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(.*)$/);
    if (!match) continue;
    const [, pid, name, cpuTime, rss] = match;
    const provider = /claude/i.test(name) ? 'claude' : 'codex';
    const parts = cpuTime.split(':').map(Number);
    const cpu = parts.reduce((sum, part) => sum * 60 + part, 0);
    result[provider].processes.push({ pid: Number(pid), name, cpu, memoryBytes: Number(rss) * 1024, startedAt: null });
    result[provider].cpuTotal += cpu;
  }
  return result;
}

export async function probeProcesses() {
  try {
    return process.platform === 'win32' ? await probeWindows() : await probePosix();
  } catch (error) {
    return emptyResult(error instanceof Error ? error.message : String(error));
  }
}
