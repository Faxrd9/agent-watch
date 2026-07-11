# Privacy

Agent Watch is designed as a local observability tool.

## Data processing

- The HTTP server binds only to `127.0.0.1`.
- No telemetry, analytics, crash reporting, or update checking is included.
- Session JSONL files are read incrementally and are not copied into a database.
- Raw event records are not retained by Agent Watch.
- UI events contain normalized metadata and redacted, length-limited previews only.
- Content previews are disabled by default.
- Diagnostic exports omit content previews.

## Sensitive data filtering

The redactor masks the local home directory and common forms of API keys, bearer tokens, GitHub tokens, AWS access keys, passwords, secrets, and private keys. No redactor can guarantee detection of every secret format. Keep content preview disabled when working with highly sensitive repositories.

## Network visibility

Agent Watch does not intercept TLS traffic. “Observed input” means information present in local session records; it is not a byte-for-byte representation of a cloud request.

## Reporting privacy issues

Do not attach raw Codex or Claude Code session files to a public issue. Provide a synthetic fixture or the built-in redacted diagnostic export.
