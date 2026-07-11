# Security Policy

## Supported versions

Security fixes are applied to the latest version on the default branch.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub Security Advisories when the repository is published. Do not include real API keys, authentication files, raw prompts, or unredacted session logs.

## Security design

- Localhost-only HTTP server
- Strict Content Security Policy
- Static-file path containment checks
- 64 KiB API request limit
- No third-party runtime packages
- No shell execution based on browser input
- Read-only access to agent session files
- No TLS interception, certificate installation, or credential access

The process probe invokes a fixed PowerShell or `ps` command. User-controlled strings are not interpolated into those commands.
