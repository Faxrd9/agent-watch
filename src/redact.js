import os from 'node:os';

const SECRET_PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi, '[REDACTED PRIVATE KEY]'],
  [/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED TOKEN]'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, '$1 [REDACTED]'],
  [/\b(?:api[_-]?key|token|secret|password|passwd|authorization)\b\s*[:=]\s*["']?[^\s,"'}]{6,}/gi, '$1=[REDACTED]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[REDACTED GITHUB TOKEN]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED AWS KEY]']
];

export function redactText(value, options = {}) {
  const maxLength = options.maxLength ?? 360;
  const home = options.homeDir ?? os.homedir();
  let text = String(value ?? '').replaceAll('\0', '');
  if (home) {
    const normalized = home.replaceAll('\\', '/');
    text = text.replaceAll(home, '$HOME').replaceAll(normalized, '$HOME');
  }
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  text = text.replace(/\r/g, '').replace(/[\t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length > maxLength) return `${text.slice(0, maxLength)}…`;
  return text;
}

export function maskPath(value, homeDir = os.homedir()) {
  if (!value) return '';
  let result = String(value).replaceAll('\\', '/');
  const normalizedHome = String(homeDir ?? '').replaceAll('\\', '/');
  if (normalizedHome && result.toLowerCase().startsWith(normalizedHome.toLowerCase())) {
    result = `$HOME${result.slice(normalizedHome.length)}`;
  }
  return redactText(result, { homeDir, maxLength: 220 });
}

export function redactObject(value, options = {}, depth = 0) {
  if (depth > 5) return '[nested data]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactText(value, options);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactObject(item, options, depth + 1));
  if (typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value).slice(0, 40)) {
      if (/^(?:raw|encrypted_content|signature)$/i.test(key)) continue;
      if (/(?:token|secret|password|authorization|api.?key)/i.test(key)) {
        output[key] = '[REDACTED]';
      } else {
        output[key] = redactObject(item, options, depth + 1);
      }
    }
    return output;
  }
  return String(value);
}

export function extractPaths(value, homeDir = os.homedir()) {
  const found = new Set();
  const visit = (item, key = '', depth = 0) => {
    if (depth > 5 || item === null || item === undefined) return;
    if (typeof item === 'string') {
      if (/(?:path|file|cwd|workdir|directory|folder)/i.test(key)) found.add(maskPath(item, homeDir));
      const matches = item.match(/(?:[A-Za-z]:[\\/][^\s"'<>|]+|\/(?:home|Users|tmp|var|opt|workspace)\/[^\s"'<>|]+)/g) ?? [];
      for (const match of matches.slice(0, 8)) found.add(maskPath(match, homeDir));
      return;
    }
    if (Array.isArray(item)) return item.slice(0, 30).forEach((child) => visit(child, key, depth + 1));
    if (typeof item === 'object') {
      for (const [childKey, child] of Object.entries(item).slice(0, 50)) visit(child, childKey, depth + 1);
    }
  };
  visit(value);
  return [...found].filter(Boolean).slice(0, 12);
}
