export const STATUS_META = {
  active: { label: '正在活动', tone: 'active' },
  tool_running: { label: '工具运行中', tone: 'active' },
  suspected_tool_stall: { label: '工具可能卡住', tone: 'danger' },
  connection_silent: { label: 'TCP 已连接，等待数据', tone: 'waiting' },
  waiting: { label: '等待模型 / 工具', tone: 'waiting' },
  suspected_stall: { label: '疑似卡住', tone: 'danger' },
  network_issue: { label: '可能有网络问题', tone: 'danger' },
  idle: { label: '空闲', tone: 'idle' },
  offline: { label: '未运行', tone: 'offline' },
  unavailable: { label: '数据不可见', tone: 'offline' }
};

export function deriveProviderState(input) {
  const now = input.now ?? Date.now();
  const processCount = input.processCount ?? 0;
  const lastActivityAt = input.lastActivityAt ?? 0;
  const ageMs = lastActivityAt ? Math.max(0, now - lastActivityAt) : Infinity;
  const cpuDelta = input.cpuDelta ?? 0;
  const busy = Boolean(input.busy);
  const stallMs = input.stallMs ?? 120_000;
  const tcp = input.tcp ?? { available: false, established: 0, connecting: 0 };
  const pendingToolCount = input.pendingToolCount ?? 0;
  const networkAge = input.networkIssueAt ? now - input.networkIssueAt : Infinity;

  if (input.probeError && !processCount) {
    return { status: 'unavailable', reason: `无法读取进程：${input.probeError}`, ageMs };
  }
  if (!processCount) return { status: 'offline', reason: '没有发现运行中的进程', ageMs };
  if (networkAge < 45_000) return { status: 'network_issue', reason: '近期会话事件出现超时、连接、重试或限流信号', ageMs };
  if (ageMs < 8_000 || cpuDelta > 0.03) {
    const signal = ageMs < 8_000 ? '会话日志刚刚更新' : '进程 CPU 正在变化';
    return { status: 'active', reason: signal, ageMs };
  }
  if (pendingToolCount > 0 && ageMs >= stallMs && cpuDelta <= 0.03) {
    return { status: 'suspected_tool_stall', reason: `${pendingToolCount} 个工具调用尚未返回，且 ${Math.round(ageMs / 1000)} 秒没有工具输出或 CPU 心跳；这不是模型网络告警`, ageMs };
  }
  if (pendingToolCount > 0) {
    return { status: 'tool_running', reason: `${pendingToolCount} 个工具调用尚未返回；本地工具执行与模型网络状态分开判断`, ageMs };
  }
  if (busy && ageMs >= stallMs && cpuDelta <= 0.03) {
    const connection = tcp.available && tcp.established > 0 ? '；TCP 仍连接但会话流持续静默' : '';
    return { status: 'suspected_stall', reason: `请求尚未完成，且 ${Math.round(ageMs / 1000)} 秒没有日志或 CPU 心跳${connection}`, ageMs };
  }
  if (busy && tcp.available && tcp.established > 0) {
    return { status: 'connection_silent', reason: `TCP 连接仍存在，但 ${Math.round(ageMs / 1000)} 秒没有新的会话数据；可能仍在云端计算`, ageMs };
  }
  if (busy) return { status: 'waiting', reason: '请求尚未完成，目前没有新的本地心跳', ageMs };
  return { status: 'idle', reason: '进程仍在，但最近会话已完成或没有待处理请求', ageMs };
}
