# ASTRA — Automated Security Testing & Risk Analysis

A desktop security analysis tool that automates what you'd normally do manually in browser DevTools — but goes far deeper. Give it a URL, and it captures every network request the page makes, runs a full security audit, and delivers an AI-powered analysis using Gemini 2.5 Flash.

Built with Electron + TypeScript + Playwright. Runs entirely on your machine.

---

## What it does

### Network Capture
Launches a headless Chromium browser, loads the target URL, and intercepts every HTTP request made during page load — including XHR, fetch calls, dynamically loaded scripts, fonts, images, and media. This is the same data you see in the browser's Network tab, but automated and exportable.

### Security Analysis
After capture, seven security modules run in parallel:

| Module | What it checks |
|---|---|
| **TLS Inspector** | Certificate validity, expiry, self-signed detection, protocol version (TLS 1.2/1.3), cipher suite, HSTS presence and configuration. Grades A+ to F. |
| **CORS Analyzer** | Wildcard origins on API endpoints, credentials + wildcard combinations, dangerous HTTP methods allowed cross-origin, Authorization header exposure |
| **CSP Analyzer** | Deep parses Content-Security-Policy, flags `unsafe-inline`, `unsafe-eval`, wildcards, missing `frame-ancestors`, report-only mode. Grades A to F. |
| **Technology Fingerprinter** | Detects frameworks (React, Angular, Vue, Next.js), CMS (WordPress, Drupal, Shopify), servers (nginx, Apache, IIS), CDNs (Cloudflare, Vercel, CloudFront), analytics, payment providers, auth services |
| **API Endpoint Extractor** | Identifies all XHR/fetch endpoints, detects auth type (Bearer, Basic, API Key), decodes JWTs, scans for sensitive data leaks (AWS keys, GitHub tokens, passwords in URLs) |
| **DNS Reconnaissance** | Resolves A, AAAA, MX, TXT, NS, CNAME records for every domain contacted by the page |
| **Vulnerability Scanner** | Actively probes detected API endpoints for SQL injection, reflected XSS, path traversal, open redirects, and information disclosure |

### AI Security Analysis
Integrates Gemini 2.5 Flash to analyze the full scan output and produce:
- Executive summary with overall risk level
- Critical findings with specific remediation steps
- Third-party risk assessment
- Prioritized remediation plan tailored to the detected tech stack
- Follow-up chat — ask questions about the scan results

### Export
- **PDF report** — full security report with all findings, tables, and analysis
- **HAR file** — raw network capture importable into Chrome DevTools or webpagetest.org
- **Markdown report** — shareable text report

---

## Who it's for

**Security engineers and penetration testers** — passive recon on any target URL without touching the server. Captures what the site exposes to browsers, not what you send to it.

**Developers** — audit your own application before shipping. Find missing security headers, exposed API keys, insecure cookies, and CORS misconfigurations without reading through DevTools manually.

**Bug bounty hunters** — fast initial recon. Technology fingerprinting, JWT extraction, API endpoint discovery, and sensitive data leak detection in one pass.

**Security teams** — run against any URL in your portfolio and get a structured report you can share or commit to a repo.

---

## What you can find with it

- Missing or misconfigured security headers (HSTS, CSP, X-Frame-Options, etc.)
- TLS/SSL issues — weak protocols, expiring certificates, missing HSTS preload
- CORS misconfigurations that could allow cross-origin data theft
- JWT tokens in request/response headers — decoded and displayed
- API keys, Bearer tokens, AWS credentials, GitHub tokens leaked in URLs or headers
- WordPress, Drupal, Shopify, and other CMS installations
- Third-party trackers, analytics, and ad networks the site contacts
- SQL injection and XSS vulnerabilities in API endpoints with query parameters
- Open redirects in redirect/return/next URL parameters
- Stack traces, PHP errors, and database errors in API responses
- DNS records for every domain the page contacts

---

## Installation

**Prerequisites:** Node.js 20+, Electron (installed via npm)

```bash
git clone <repo>
cd astra
npm install
npx playwright install chromium
npm run electron
```

For the AI analysis feature, get a free Gemini API key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and add it in Settings.

---

## CLI usage

The tool also works as a CLI without the Electron UI:

```bash
npm run build

# Basic analysis — prints Markdown report to stdout
node dist/cli.js https://example.com

# Save report to file
node dist/cli.js https://example.com --output report.md

# Also export HAR file
node dist/cli.js https://example.com --output report.md --har capture.har
```

---

## Web dashboard

A lightweight Express-based web dashboard is also included:

```bash
npm run serve
# Open http://localhost:3000
```

---

## Project structure

```
src/
  cli.ts              — CLI entry point
  server.ts           — Express web dashboard
  capture.ts          — Playwright headless browser capture
  metrics.ts          — Request grouping, aggregates, slowest/error filtering
  report.ts           — Markdown report renderer
  har.ts              — HAR 1.2 export and round-trip parsing
  output.ts           — File/stdout writer
  url.ts              — URL normalization and validation
  types.ts            — Shared TypeScript interfaces
  ai/
    gemini.ts         — Gemini 2.5 Flash streaming integration
  security/
    tls.ts            — TLS/SSL certificate inspection
    cors.ts           — CORS misconfiguration detection
    csp.ts            — Content Security Policy analysis
    fingerprint.ts    — Technology and third-party detection
    apiExtractor.ts   — API endpoint, JWT, and sensitive data extraction
    dns.ts            — DNS reconnaissance
    vulnScanner.ts    — Active vulnerability scanning
electron/
  main.ts             — Electron main process + IPC handlers
  preload.ts          — Context bridge (secure renderer ↔ main communication)
  index.html          — Dashboard UI (all tabs, AI chat, settings)
```

---

## Tech stack

- **Electron** — desktop app shell with full Node.js system access
- **Playwright** — headless Chromium for real browser network capture
- **TypeScript** — strict mode throughout
- **Gemini 2.5 Flash** — AI security analysis with 1M token context and thinking mode
- **Vitest + fast-check** — property-based testing for all pure functions
- **Express** — optional web dashboard

---

## Testing

```bash
npm test
```

32 tests covering URL validation, metrics computation, report rendering, and HAR round-trip — all using property-based testing with fast-check.

---

## Notes

- The vulnerability scanner sends real HTTP requests to the target. Only use it on systems you own or have explicit permission to test.
- The AI analysis feature sends scan data (headers, URLs, findings) to Google's Gemini API. Do not use it on scans containing credentials or sensitive internal URLs.
- API keys are encrypted using your OS keychain via Electron's `safeStorage`.
