import path from 'node:path';
import { extractPaths, maskPath, redactObject, redactText } from './redact.js';

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((block) => {
    if (typeof block === 'string') return block;
    if (!block || typeof block !== 'object') return '';
    return block.text ?? block.content ?? block.input_text ?? block.output_text ?? '';
  }).filter(Boolean).join('\n');
}

function descriptor(label, text) {
  const length = String(text ?? '').length;
  return length ? `${label}（${length} 字符）` : label;
}

function baseEvent(provider, filePath, timestamp, sessionId, homeDir) {
  return {
    provider,
    timestamp: timestamp || new Date().toISOString(),
    sessionId: sessionId || path.basename(filePath, '.jsonl'),
    sourceFile: maskPath(filePath, homeDir),
    kind: 'system',
    direction: 'internal',
    title: '会话事件',
    summary: '',
    preview: '',
    tool: '',
    callId: '',
    paths: [],
    busyHint: null,
    networkHint: false
  };
}

export function parseCodex(record, context) {
  const { filePath, homeDir } = context;
  const payload = record?.payload ?? {};
  const event = baseEvent('codex', filePath, record?.timestamp ?? payload?.timestamp, payload?.session_id ?? payload?.id, homeDir);

  if (record?.type === 'session_meta') {
    event.kind = 'session';
    event.title = 'Codex 会话已发现';
    event.summary = payload.cwd ? `工作目录 ${maskPath(payload.cwd, homeDir)}` : '会话元数据';
    event.paths = payload.cwd ? [maskPath(payload.cwd, homeDir)] : [];
    return [event];
  }

  if (record?.type === 'event_msg') {
    const subtype = payload.type ?? payload.kind ?? 'event';
    event.title = `Codex · ${subtype}`;
    event.summary = subtype === 'token_count' ? '令牌计数更新' : '内部状态更新';
    if (/task_started|turn_started|sub_agent_activity/i.test(subtype)) event.busyHint = true;
    if (/task_complete|turn_complete|completed|cancelled/i.test(subtype)) event.busyHint = false;
    if (/^(?:error|api_error|network_error|connection_error|transport_error|stream_error|request_failed|request_timeout|retry|response_retry|rate_limit_exceeded)$/i.test(subtype)) {
      event.kind = 'error';
      event.networkHint = true;
      event.summary = '检测到错误、重试或限流事件';
    }
    return subtype === 'token_count' ? [] : [event];
  }

  if (record?.type !== 'response_item') return [];
  const subtype = payload.type ?? '';
  if (subtype === 'message') {
    const role = payload.role ?? 'unknown';
    if (!['user', 'assistant'].includes(role)) return [];
    const text = contentText(payload.content);
    event.direction = role === 'user' ? 'input' : 'output';
    event.kind = role === 'user' ? 'user_input' : 'assistant_output';
    event.title = role === 'user' ? '你发给 Codex 的内容' : 'Codex 输出';
    event.summary = descriptor(role === 'user' ? '输入内容' : '输出内容', text);
    event.preview = redactText(text, { homeDir, maxLength: 4000 });
    event.paths = extractPaths(payload.content, homeDir);
    event.busyHint = role === 'user' ? true : false;
  } else if (subtype === 'agent_message') {
    const text = contentText(payload.content);
    event.kind = 'assistant_output';
    event.direction = 'output';
    event.title = 'Codex 回复';
    event.summary = descriptor('回复内容', text);
    event.preview = redactText(text, { homeDir, maxLength: 4000 });
    event.paths = extractPaths(payload.content, homeDir);
    event.busyHint = false;
  } else if (subtype === 'function_call' || subtype === 'custom_tool_call') {
    const input = parseMaybeJson(payload.arguments ?? payload.input ?? '');
    event.kind = 'tool_call';
    event.direction = 'input';
    event.tool = payload.name ?? 'tool';
    event.callId = payload.call_id ?? payload.id ?? '';
    event.title = `Codex 调用工具 · ${event.tool}`;
    event.summary = `正在使用 ${event.tool}`;
    event.preview = redactText(typeof input === 'string' ? input : JSON.stringify(redactObject(input, { homeDir })), { homeDir, maxLength: 4000 });
    event.paths = extractPaths(input, homeDir);
    event.busyHint = true;
  } else if (subtype === 'function_call_output' || subtype === 'custom_tool_call_output') {
    const output = payload.output ?? payload.content ?? '';
    event.kind = 'tool_output';
    event.callId = payload.call_id ?? '';
    event.direction = 'output';
    event.title = 'Codex 工具返回';
    event.summary = descriptor('工具输出', typeof output === 'string' ? output : JSON.stringify(output));
    event.preview = redactText(typeof output === 'string' ? output : JSON.stringify(redactObject(output, { homeDir })), { homeDir, maxLength: 4000 });
    event.paths = extractPaths(output, homeDir);
    event.busyHint = true;
  } else if (subtype === 'reasoning') {
    const visibleSummary = contentText(payload.summary);
    event.kind = 'thinking';
    event.title = 'Codex 正在推理';
    event.summary = visibleSummary ? descriptor('Codex 提供的可见推理摘要（不是完整思维链）', visibleSummary) : '检测到加密推理数据；内容已加密且本地没有解密密钥，无法读取完整思维链';
    event.preview = visibleSummary ? redactText(visibleSummary, { homeDir, maxLength: 4000 }) : '';
    event.busyHint = true;
  } else {
    return [];
  }
  return [event];
}

export function parseClaude(record, context) {
  const { filePath, homeDir } = context;
  const message = record?.message ?? {};
  const eventBase = baseEvent('claude', filePath, record?.timestamp, record?.sessionId, homeDir);

  if (record?.type === 'attachment') {
    const event = { ...eventBase };
    event.kind = 'attachment';
    event.direction = 'input';
    event.title = 'Claude Code 观察到附件';
    event.summary = '本地会话记录包含附件事件';
    event.paths = extractPaths(record.attachment, homeDir);
    event.preview = redactText(JSON.stringify(redactObject(record.attachment, { homeDir })), { homeDir, maxLength: 4000 });
    event.busyHint = true;
    return [event];
  }
  if (record?.type === 'system') {
    const event = { ...eventBase };
    const subtype = record.subtype ?? 'system';
    event.kind = subtype === 'api_error' ? 'error' : 'system';
    event.title = `Claude Code 系统事件 · ${subtype}`;
    if (subtype === 'api_error') {
      const attempt = Number(record.retryAttempt ?? 0);
      const maximum = Number(record.maxRetries ?? 0);
      const waitMs = Number(record.retryInMs ?? 0);
      event.summary = `API 错误；重试 ${attempt}${maximum ? `/${maximum}` : ''}${waitMs ? `，预计 ${Math.round(waitMs / 1000)} 秒后重试` : ''}`;
      event.networkHint = true;
      event.busyHint = true;
    } else if (subtype === 'turn_duration') {
      const duration = Number(record.durationMs ?? 0);
      event.summary = `本轮已结束${duration ? `，耗时 ${(duration / 1000).toFixed(1)} 秒` : ''}${record.messageCount ? `，${record.messageCount} 条消息` : ''}`;
      event.busyHint = false;
    } else if (subtype === 'informational') {
      event.summary = `系统通知${record.level ? `（${record.level}）` : ''}；正文为保护隐私未读取`;
    } else if (subtype === 'local_command') {
      event.summary = '执行了 Claude Code 本地命令；命令正文为保护隐私未读取';
    } else if (subtype === 'away_summary') {
      event.summary = '生成了离开期间摘要；摘要正文为保护隐私未读取';
    } else {
      event.summary = `检测到 ${subtype} 状态；仅显示结构化元数据`;
    }
    event.paths = record.cwd ? [maskPath(record.cwd, homeDir)] : [];
    return [event];
  }
  if (['mode', 'permission-mode', 'queue-operation', 'last-prompt'].includes(record?.type)) {
    const event = { ...eventBase };
    event.kind = 'system';
    event.title = `Claude Code 状态 · ${record.type}`;
    if (record.type === 'permission-mode' || record.type === 'mode') {
      event.summary = `模式切换为 ${redactText(record.mode ?? record.permissionMode ?? 'unknown', { homeDir, maxLength: 80 })}`;
    } else if (record.type === 'queue-operation') {
      event.summary = `队列操作 ${redactText(record.operation ?? record.action ?? 'updated', { homeDir, maxLength: 80 })}`;
    } else {
      event.summary = '记录了最近一次提示；为保护隐私不读取提示正文';
    }
    return [event];
  }
  if (!['user', 'assistant'].includes(record?.type)) return [];

  const blocks = Array.isArray(message.content) ? message.content : [{ type: 'text', text: message.content ?? '' }];
  const events = [];
  for (const block of blocks) {
    const event = { ...eventBase, paths: [] };
    if (block?.type === 'tool_use') {
      event.kind = 'tool_call';
      event.direction = 'input';
      event.tool = block.name ?? 'tool';
      event.callId = block.id ?? '';
      event.title = `Claude Code 调用工具 · ${event.tool}`;
      event.summary = `正在使用 ${event.tool}`;
      event.preview = redactText(JSON.stringify(redactObject(block.input, { homeDir })), { homeDir, maxLength: 4000 });
      event.paths = extractPaths(block.input, homeDir);
      event.busyHint = true;
    } else if (block?.type === 'tool_result') {
      const text = contentText(block.content) || (typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? ''));
      event.kind = 'tool_output';
      event.callId = block.tool_use_id ?? '';
      event.direction = 'output';
      event.title = 'Claude Code 工具返回';
      event.summary = descriptor(block.is_error ? '工具错误' : '工具输出', text);
      event.preview = redactText(text, { homeDir, maxLength: 4000 });
      event.paths = extractPaths(block.content, homeDir);
      event.busyHint = true;
    } else if (block?.type === 'thinking') {
      event.kind = 'thinking';
      event.title = 'Claude Code 正在思考';
      event.summary = '检测到 Claude Code thinking 活动；Agent Watch 不展示内部思维链，只显示活动状态';
      event.busyHint = true;
    } else if (block?.type === 'text' || typeof block === 'string') {
      const text = typeof block === 'string' ? block : block.text ?? '';
      const isUser = record.type === 'user';
      event.kind = isUser ? 'user_input' : 'assistant_output';
      event.direction = isUser ? 'input' : 'output';
      event.title = isUser ? '你发给 Claude Code 的内容' : 'Claude Code 输出';
      event.summary = descriptor(isUser ? '输入内容' : '输出内容', text);
      event.preview = redactText(text, { homeDir, maxLength: 4000 });
      event.paths = extractPaths(text, homeDir);
      event.busyHint = isUser ? true : message.stop_reason === 'tool_use' ? true : false;
    } else {
      continue;
    }
    events.push(event);
  }
  return events;
}

export function parseRecord(provider, record, context) {
  try {
    return provider === 'codex' ? parseCodex(record, context) : parseClaude(record, context);
  } catch {
    return [];
  }
}
