const providerCards = document.querySelector('#providerCards');
const eventList = document.querySelector('#eventList');
const observedFiles = document.querySelector('#observedFiles');
const connection = document.querySelector('#connection');
const limitationText = document.querySelector('#limitationText');
const settingsDialog = document.querySelector('#settingsDialog');
const stallSeconds = document.querySelector('#stallSeconds');
const showContent = document.querySelector('#showContent');
const maxEvents = document.querySelector('#maxEvents');
const retentionMinutes = document.querySelector('#retentionMinutes');
const eventDialog = document.querySelector('#eventDialog');
let snapshot = null;
let providerFilter = 'all';
let selectedEventId = null;
let miniWindow = null;

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);

function relativeTime(value) {
  if (!value) return '暂无';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 5) return '刚刚';
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  return `${Math.floor(minutes / 60)} 小时前`;
}

function formatBytes(value) {
  if (!value) return '0 MB';
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function providerLogo(provider) {
  return provider === 'codex' ? 'CX' : 'CL';
}

function renderProviders() {
  providerCards.innerHTML = Object.entries(snapshot.providers).map(([key, provider]) => `
    <article class="provider-card" data-tone="${escapeHtml(provider.tone)}">
      <div class="provider-top">
        <div class="provider-name">
          <div class="provider-logo">${providerLogo(key)}</div>
          <div><h2>${escapeHtml(provider.name)}</h2><p>${provider.pendingToolCount ? `${provider.pendingToolCount} 个工具尚未返回` : provider.busy ? '有未完成请求' : '没有未完成请求'}</p></div>
        </div>
        <div class="status-badge"><i></i>${escapeHtml(provider.statusLabel)}</div>
      </div>
      <p class="provider-reason">${escapeHtml(provider.reason)}</p>
      <div class="provider-metrics">
        <div class="metric"><span>最后活动</span><b>${relativeTime(provider.lastActivityAt)}</b></div>
        <div class="metric"><span>进程</span><b>${provider.processCount} 个</b></div>
        <div class="metric"><span>CPU 心跳</span><b>${provider.cpuDelta > .03 ? `+${provider.cpuDelta.toFixed(2)}s` : '静止'}</b></div>
        <div class="metric"><span>TCP</span><b>${provider.tcp?.available ? `${provider.tcp.established} 已连接` : '不可见'}</b></div>
        <div class="metric"><span>内存</span><b>${formatBytes(provider.memoryBytes)}</b></div>
      </div>
    </article>
  `).join('');
}

function eventGlyph(event) {
  const glyphs = { tool_call: 'TOOL', tool_output: 'OUT', user_input: 'IN', assistant_output: 'AI', thinking: '···', attachment: 'FILE', error: 'ERR', session: 'NEW', system: 'SYS' };
  return glyphs[event.kind] ?? 'EVT';
}

function renderEvents() {
  const events = snapshot.events.filter((event) => providerFilter === 'all' || event.provider === providerFilter);
  if (!events.length) {
    eventList.replaceChildren(document.querySelector('#emptyTemplate').content.cloneNode(true));
    return;
  }
  eventList.innerHTML = events.slice(0, 150).map((event) => `
    <article class="event" data-provider="${escapeHtml(event.provider)}" data-event-id="${escapeHtml(event.id)}" tabindex="0" role="button" aria-label="查看 ${escapeHtml(event.title)} 详情">
      <div class="event-icon">${eventGlyph(event)}</div>
      <div>
        <div class="event-title">${escapeHtml(event.title)}</div>
        <p class="event-summary">${escapeHtml(event.summary)}</p>
        ${event.paths?.length ? `<div class="path-chips">${event.paths.map((item) => `<span class="path-chip" title="${escapeHtml(item)}">${escapeHtml(item)}</span>`).join('')}</div>` : ''}
        ${event.preview ? `<pre class="event-preview">${escapeHtml(event.preview.slice(0, 520))}${event.preview.length > 520 ? '…' : ''}</pre>` : ''}
      </div>
      <time class="event-time" datetime="${escapeHtml(event.timestamp)}">${relativeTime(event.timestamp)}</time>
    </article>
  `).join('');
}

function openEventDetail(eventId) {
  const event = snapshot?.events.find((item) => item.id === eventId);
  if (!event) return;
  selectedEventId = eventId;
  document.querySelector('#detailProvider').textContent = `${event.provider === 'codex' ? 'CODEX' : 'CLAUDE CODE'} · ${event.kind}`;
  document.querySelector('#detailTitle').textContent = event.title;
  document.querySelector('#detailMeta').innerHTML = `
    <div><span>时间</span><b>${escapeHtml(new Date(event.timestamp).toLocaleString())}</b></div>
    <div><span>方向</span><b>${event.direction === 'input' ? '发送 / 输入' : event.direction === 'output' ? '返回 / 输出' : '内部事件'}</b></div>
    <div><span>工具</span><b>${escapeHtml(event.tool || '—')}</b></div>
    <div><span>会话</span><b>${escapeHtml(event.sessionId || '—')}</b></div>
    <div><span>来源文件</span><b>${escapeHtml(event.sourceFile || '—')}</b></div>
    <div><span>摘要</span><b>${escapeHtml(event.summary || '—')}</b></div>`;
  document.querySelector('#detailPaths').innerHTML = event.paths?.length
    ? `<h3>涉及的文件或路径</h3><div class="path-chips">${event.paths.map((item) => `<span class="path-chip" title="${escapeHtml(item)}">${escapeHtml(item)}</span>`).join('')}</div>`
    : '';
  const preview = document.querySelector('#detailPreview');
  const locked = document.querySelector('#previewLocked');
  preview.hidden = !snapshot.settings.showContent;
  locked.hidden = snapshot.settings.showContent;
  if (event.preview) {
    preview.textContent = event.preview;
  } else if (event.kind === 'thinking' && event.provider === 'codex') {
    preview.textContent = '该事件包含加密推理数据。内容本身已加密，本地没有解密密钥，因此无法读取完整思维链。若 Codex 另外提供可见推理摘要，摘要会单独显示。';
  } else if (event.kind === 'thinking') {
    preview.textContent = '检测到 thinking 活动。Agent Watch 不展示模型内部思维链，只显示思考活动、工具调用和可见摘要。';
  } else if (/last-prompt|最近一次提示/.test(`${event.title} ${event.summary}`)) {
    preview.textContent = '提示正文存在于本地记录中，但 Agent Watch 为保护隐私主动不读取和展示该字段。';
  } else {
    preview.textContent = '这个事件没有可显示的正文内容。';
  }
  if (!eventDialog.open) eventDialog.showModal();
}

function renderFiles() {
  const items = Object.entries(snapshot.providers).flatMap(([key, provider]) => provider.observedFiles.map((file) => ({ ...file, provider: key })));
  observedFiles.innerHTML = items.length ? items.slice(0, 8).map((file) => `
    <div class="file-item"><b title="${escapeHtml(file.path)}">${escapeHtml(file.path)}</b><span>${file.provider === 'codex' ? 'Codex' : 'Claude'} · ${relativeTime(file.mtime)} · ${formatBytes(file.size)}</span></div>
  `).join('') : '<p class="event-summary">尚未发现会话文件。</p>';
}

function render() {
  if (!snapshot) return;
  renderProviders();
  renderEvents();
  renderFiles();
  limitationText.textContent = snapshot.limitations;
  stallSeconds.value = String(snapshot.settings.stallSeconds);
  showContent.checked = snapshot.settings.showContent;
  maxEvents.value = String(snapshot.settings.maxEvents);
  retentionMinutes.value = String(snapshot.settings.retentionMinutes);
  renderMiniWindow();
}

function miniCard(provider, key) {
  return `
    <section class="mini-provider" data-tone="${escapeHtml(provider.tone)}">
      <div class="mini-row">
        <div class="mini-name"><span>${providerLogo(key)}</span><b>${escapeHtml(provider.name)}</b></div>
        <div class="mini-status"><i></i>${escapeHtml(provider.statusLabel)}</div>
      </div>
      <p>${escapeHtml(provider.reason)}</p>
      <div class="mini-metrics"><span>心跳 ${relativeTime(provider.lastActivityAt)}</span><span>TCP ${provider.tcp?.available ? provider.tcp.established : '—'}</span></div>
    </section>`;
}

function renderMiniWindow() {
  if (!miniWindow || miniWindow.closed || !snapshot) return;
  const root = miniWindow.document.querySelector('#miniRoot');
  if (!root) return;
  root.innerHTML = `
    <header class="mini-header"><div><b>Agent Watch</b><span>本地实时状态</span></div><time>${new Date(snapshot.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></header>
    <div class="mini-grid">${Object.entries(snapshot.providers).map(([key, provider]) => miniCard(provider, key)).join('')}</div>`;
}

async function openMiniWindow() {
  if (miniWindow && !miniWindow.closed) {
    miniWindow.focus();
    return;
  }
  if ('documentPictureInPicture' in window) {
    miniWindow = await window.documentPictureInPicture.requestWindow({ width: 390, height: 300 });
    miniWindow.document.title = 'Agent Watch 小窗';
    const meta = miniWindow.document.createElement('meta');
    meta.name = 'viewport';
    meta.content = 'width=device-width, initial-scale=1';
    const stylesheet = miniWindow.document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = '/mini.css';
    miniWindow.document.head.append(meta, stylesheet);
    miniWindow.document.body.innerHTML = '<main id="miniRoot" class="mini-shell"></main>';
    miniWindow.addEventListener('pagehide', () => { miniWindow = null; });
    renderMiniWindow();
    return;
  }
  miniWindow = window.open('/mini.html', 'agent-watch-mini', 'popup=yes,width=390,height=300,resizable=yes');
}

async function loadSnapshot() {
  const response = await fetch('/api/snapshot', { cache: 'no-store' });
  snapshot = await response.json();
  render();
}

function connect() {
  const stream = new EventSource('/api/events');
  stream.onopen = () => {
    connection.className = 'connection is-online';
    connection.querySelector('span').textContent = '本地实时连接';
  };
  stream.onmessage = (message) => {
    snapshot = JSON.parse(message.data);
    render();
  };
  stream.onerror = () => {
    connection.className = 'connection is-offline';
    connection.querySelector('span').textContent = '连接中断，正在重试';
  };
}

document.querySelectorAll('.filter').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.filter').forEach((item) => item.classList.toggle('is-active', item === button));
  providerFilter = button.dataset.provider;
  renderEvents();
}));

document.querySelector('#settingsButton').addEventListener('click', () => settingsDialog.showModal());
document.querySelector('#miniWindowButton').addEventListener('click', () => {
  openMiniWindow().catch(() => {
    miniWindow = window.open('/mini.html', 'agent-watch-mini', 'popup=yes,width=390,height=300,resizable=yes');
  });
});
eventList.addEventListener('click', (event) => {
  const card = event.target.closest('[data-event-id]');
  if (card) openEventDetail(card.dataset.eventId);
});
eventList.addEventListener('keydown', (event) => {
  if (!['Enter', ' '].includes(event.key)) return;
  const card = event.target.closest('[data-event-id]');
  if (card) { event.preventDefault(); openEventDetail(card.dataset.eventId); }
});
document.querySelector('#closeEventDialog').addEventListener('click', () => eventDialog.close());
document.querySelector('#enablePreview').addEventListener('click', async () => {
  await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ showContent: true })
  });
  showContent.checked = true;
  setTimeout(() => selectedEventId && openEventDetail(selectedEventId), 100);
});
document.querySelector('#saveSettings').addEventListener('click', async () => {
  await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stallSeconds: Number(stallSeconds.value),
      showContent: showContent.checked,
      maxEvents: Number(maxEvents.value),
      retentionMinutes: Number(retentionMinutes.value)
    })
  });
  settingsDialog.close();
});

document.querySelector('#clearButton').addEventListener('click', async () => {
  if (!window.confirm('只清空 Agent Watch 当前内存中的界面记录？Codex 和 Claude Code 的原始会话文件不会被修改。')) return;
  await fetch('/api/clear', { method: 'POST' });
  if (eventDialog.open) eventDialog.close();
});

document.querySelector('#exportButton').addEventListener('click', () => {
  if (!snapshot) return;
  const diagnostic = {
    exportedAt: new Date().toISOString(),
    app: snapshot.app,
    providers: snapshot.providers,
    events: snapshot.events.map(({ preview, ...event }) => event),
    settings: snapshot.settings,
    limitations: snapshot.limitations
  };
  const blob = new Blob([JSON.stringify(diagnostic, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `agent-watch-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
});

setInterval(() => snapshot && render(), 10_000);
loadSnapshot().catch(() => {});
connect();
