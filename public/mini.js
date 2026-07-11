const root = document.querySelector('#miniRoot');
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);

function relativeTime(value) {
  if (!value) return '暂无';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 5) return '刚刚';
  if (seconds < 60) return `${seconds}秒前`;
  return `${Math.floor(seconds / 60)}分钟前`;
}

function render(snapshot) {
  root.innerHTML = `
    <header class="mini-header"><div><b>Agent Watch</b><span>普通独立小窗</span></div><time>${new Date(snapshot.updatedAt).toLocaleTimeString()}</time></header>
    <div class="mini-grid">${Object.entries(snapshot.providers).map(([key, provider]) => `
      <section class="mini-provider" data-tone="${escapeHtml(provider.tone)}">
        <div class="mini-row">
          <div class="mini-name"><span>${key === 'codex' ? 'CX' : 'CL'}</span><b>${escapeHtml(provider.name)}</b></div>
          <div class="mini-status"><i></i>${escapeHtml(provider.statusLabel)}</div>
        </div>
        <p>${escapeHtml(provider.reason)}</p>
        <div class="mini-metrics"><span>心跳 ${relativeTime(provider.lastActivityAt)}</span><span>TCP ${provider.tcp?.available ? provider.tcp.established : '—'}</span></div>
      </section>`).join('')}</div>`;
}

fetch('/api/snapshot').then((response) => response.json()).then(render).catch(() => {});
const stream = new EventSource('/api/events');
stream.onmessage = (message) => render(JSON.parse(message.data));
