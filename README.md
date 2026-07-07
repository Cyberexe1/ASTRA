# ASTRA — Automated Security Testing & Risk Analysis

## The Divine Weapon for Modern Web Security

In ancient Indian mythology, an Astra was a powerful celestial weapon capable of revealing weaknesses, overcoming formidable defenses, and changing the course of battle. Inspired by that idea, ASTRA brings the same philosophy to cybersecurity—helping security professionals identify vulnerabilities, uncover hidden attack surfaces, and gain the intelligence needed to defend modern applications.

ASTRA is a desktop security analysis tool that automates what you'd normally do by hand in browser DevTools — and goes considerably deeper. It works in two modes:

- **Website scan** — give it a URL; it drives a real headless browser to that page, records every network request, runs a battery of passive and active security checks, and hands the whole picture to an LLM that writes up a prioritized risk report.
- **Repo scan** — give it a GitHub repository URL; it pulls the source (via the GitHub API or a full `git clone`) and scans for leaked secrets, vulnerable dependencies, CI/CD workflow risks, repo-hygiene problems, and insecure code patterns.

It's built with Electron + TypeScript + Playwright and runs entirely on your machine. Nothing is captured or analyzed on a remote server — the only outbound calls to third parties are the optional AI step, OSV.dev dependency lookups, and the GitHub API, all of which you control.

---

## Table of contents

- [What this project is](#what-this-project-is)
- [How it works (end to end)](#how-it-works-end-to-end)
- [What it does — module by module](#what-it-does--module-by-module)
- [Repo Analyzer (GitHub repository scanning)](#repo-analyzer-github-repository-scanning)
- [What you can find with it](#what-you-can-find-with-it)
- [Architecture](#architecture)
- [Data model](#data-model)
- [Installation](#installation)
- [Usage — desktop, CLI, and web](#usage)
- [Project structure](#project-structure)
- [Tech stack](#tech-stack)
- [Testing](#testing)
- [Security and privacy notes](#security-and-privacy-notes)

---

## What this project is

Most web reconnaissance starts the same way: open DevTools, watch the Network tab, click around, then manually pick apart headers, certificates, cookies, and third-party calls. It's slow, it's easy to miss things, and the findings live in your head instead of in a report.

ASTRA collapses that workflow into a single action, and extends it to source code. It is several things at once:

1. **A network capture engine** — a headless Chromium instance, controlled by Playwright, that loads any URL and records the full request/response timeline exactly as a browser sees it.
2. **A security analysis suite** — focused modules that each examine the captured traffic (and in a few cases make their own follow-up probes) for a specific class of problem: TLS, security headers, cookies, CORS, CSP, technology fingerprinting + CVE correlation, CMS attack surface, API/secret exposure, DNS, mixed content, and active vulnerabilities.
3. **A GitHub repo scanner** — a second input mode that pulls a repository's source (GitHub API or full `git clone`) and scans for leaked secrets, vulnerable dependencies, CI/CD workflow risks, repo hygiene, and insecure code patterns.
4. **An AI reporting layer** — the consolidated scan output is streamed to a large language model (Groq's `llama-3.3-70b-versatile`) which produces an executive summary, ranked findings, and a remediation plan, and then answers follow-up questions in a chat.

The website analysis core runs in three delivery modes: a full Electron desktop app, a command-line tool, and a lightweight Express web dashboard. The repo scanner runs in the desktop app.

---

## How it works (end to end)

A single scan moves through a fixed pipeline. Here's the whole journey of one URL:

### 1. URL normalization and validation
The raw input is normalized (a bare `example.com` becomes `https://example.com`) and validated. Anything that isn't structurally a valid `http:` or `https:` URL is rejected before a browser is ever launched. This is handled by `src/url.ts` and is the same gate for every entry point.

### 2. Headless capture
`src/capture.ts` launches headless Chromium via Playwright, opens a fresh browser context (so no cookies or cache bleed in from a previous run), and attaches listeners to four page events:

- `request` — records a start timestamp the moment a request fires
- `response` — attaches the response object to its originating request
- `requestfinished` — computes duration and TTFB, reads the response body to measure real transfer size, and produces a normalized `NetworkRequest`
- `requestfailed` — captures failed requests with their error text so failures show up in the report too

Page-load completion is detected with a **two-stage wait strategy**. It first waits for `networkidle`. Heavy single-page apps that poll forever never go idle, so on a timeout it falls back to `domcontentloaded` plus a short fixed wait — enough to catch the initial burst of XHR/fetch calls without hanging indefinitely. Whatever was captured by then is returned.

### 3. Metrics processing
`src/metrics.ts` takes the flat list of requests and derives the performance view: totals (request count, bytes, duration), a per-resource-type breakdown (script vs image vs xhr…), the five slowest requests, and the set of errored/failed requests.

### 4. Security analysis (parallel)
The captured requests are fanned out to the security modules. Most are pure functions over the captured data and run synchronously; the ones that reach back out to the network (TLS handshake, DNS lookups, the active vulnerability scanner) run as promises. In the Electron path they're orchestrated with `Promise.allSettled` so one slow or failing module never sinks the whole scan — a failed TLS probe just returns an error placeholder while everything else proceeds.

### 5. AI analysis (optional, streamed)
If an API key is configured, the consolidated result is summarized into a compact prompt (`src/ai/groqClient.ts`) and streamed to the model. Tokens arrive incrementally and render live in the UI. A follow-up chat keeps the scan context so you can interrogate the findings.

### 6. Export
The finished scan can be exported three ways: a **PDF** (rendered by a hidden Electron window printing to PDF), a **HAR 1.2** file (importable into Chrome DevTools or webpagetest.org), and a **Markdown** report.

---

## What it does — module by module

After capture, the analysis modules run in parallel. Each owns one problem domain.

| Module | File | What it checks |
|---|---|---|
| **TLS Inspector** | `security/tls.ts` | Opens its own TLS connection to read the certificate: validity window, expiry countdown, self-signed detection, protocol version (flags broken TLS 1.0/1.1 and SSLv3), weak cipher suites, and key length. Fetches the HSTS header and checks `max-age`, `includeSubDomains`, and `preload`. Also verifies that **plain HTTP redirects to HTTPS**. The grade is driven by the worst issue *type*, so a single critical issue (expired cert, broken protocol) floors the grade rather than being averaged away. |
| **Security Headers** | `security/csp.ts` | Checks the document response for `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and `Cross-Origin-Opener-Policy`. Flags both missing headers and invalid values (e.g. deprecated `X-Frame-Options: ALLOW-FROM`, or an `X-Content-Type-Options` that isn't `nosniff`). |
| **Cookie Analyzer** | `security/csp.ts` | Parses every `Set-Cookie` for missing `HttpOnly`, `Secure`, and `SameSite` flags. Session/auth-looking cookies (names matching `sess`, `token`, `auth`, `jwt`, `csrf`…) are rated higher severity than ordinary cookies. |
| **CORS Analyzer** | `security/cors.ts` | Flags wildcard origins on API endpoints, the impossible-but-telling wildcard + credentials combination, and credentialed access granted to **untrusted third-party** origins (subdomains of the target are treated as trusted). It deliberately does **not** flag standard REST patterns — `Authorization` headers or `PUT`/`DELETE` methods cross-origin — because those are normal and flagging them just buries real findings in noise. |
| **CSP Analyzer** | `security/csp.ts` | Deep-parses Content-Security-Policy into directives and flags `unsafe-inline`, `unsafe-eval`, wildcard sources, `http:` schemes, `data:` in `script-src`, missing `frame-ancestors`, missing `upgrade-insecure-requests`, and report-only mode. Produces a 0–100 score and an A–F grade. |
| **Technology Fingerprinter** | `security/fingerprint.ts` | Identifies frameworks (React, Angular, Vue, Next.js), CMS (WordPress, Drupal, Shopify, Umbraco), servers (nginx, Apache, IIS), CDNs (Cloudflare, Vercel, CloudFront, Fastly, Akamai), analytics, payment, and auth providers — from response headers and URL patterns. Extracts **version numbers** from `?ver=` params and asset URLs. Also tallies every third-party domain the page contacted, categorized. |
| **CVE Correlation** | `security/cve.ts` | Takes fingerprinted components that have a detected version (jQuery, Bootstrap, React, Vue, Angular, Next.js, Express) and queries the free **OSV.dev** database for known vulnerabilities, surfacing matching CVE/GHSA advisories with severity. |
| **CMS Attack Surface** | `security/fingerprint.ts` | When a CMS is detected, passively flags known exposure in the captured traffic. For WordPress: `xmlrpc.php` (brute-force amplification via `system.multicall`), REST API user enumeration (`/wp-json/wp/v2/users`), `readme.html`/`license.txt` version disclosure, exposed `wp-login.php`, and component versions leaked via `?ver=`. |
| **API Endpoint Extractor** | `security/apiExtractor.ts` | Catalogs every XHR/fetch and mutating request. Detects auth type (Bearer, Basic, API key headers), decodes JWT headers and payloads, and scans for leaked secrets. It is **location-aware**: a Bearer token in a request `Authorization` header is *expected* and not flagged, whereas the same token in a URL or response body is reported as a leak — with a reason attached. |
| **DNS Reconnaissance** | `security/dns.ts` | For every unique domain the page contacted, resolves A, AAAA, MX, TXT, NS, and CNAME records, and identifies subdomains of the target. Lookups are capped to avoid hanging on pages that touch dozens of domains. |
| **Mixed Content** | `security/mixedContent.ts` | On an HTTPS page, flags any sub-resource loaded over plain HTTP — `active` content (script/stylesheet/xhr) as high severity, `passive` content (image/media/font) as medium. |
| **Vulnerability Scanner** | `security/vulnScanner.ts` | The only actively intrusive module — **disabled by default**, run only when the user explicitly opts in via a consent toggle. Against detected endpoints it tests for SQL injection (error-based **and** time-based blind, using a baseline request for comparison so it isn't fooled by a naturally slow endpoint), reflected XSS (context-aware — a payload reflected inside an HTML comment or HTML-encoded is *not* flagged), path traversal (only on file-path-looking params), open redirects, IDOR (probing adjacent numeric IDs), and information disclosure (stack traces, PHP/DB errors, secrets in bodies — skipping JS/CSS responses to avoid false positives on minified code). |

### AI Security Analysis
The consolidated scan is summarized and streamed to **Groq (`llama-3.3-70b-versatile`)** over an OpenAI-compatible streaming endpoint. It produces an executive summary with an overall risk level, critical findings with concrete remediation steps, a third-party risk assessment, and a prioritized remediation plan tailored to the detected stack. A follow-up chat retains the scan context.

> The integration lives in `src/ai/groqClient.ts` and targets the Groq API (OpenAI-compatible endpoint).

---

## Repo Analyzer (GitHub repository scanning)

Alongside website scanning, ASTRA can analyze a GitHub repository's **source code**. Click **Repo Analyzer** in the header, paste a repository URL, pick a mode with the Basic/Advanced toggle, and scan.

### Two modes

- **⚡ Basic (default)** — fetches the repository through the **GitHub REST API** plus the raw-content CDN. It sees the current snapshot of files on the default (or specified) branch. No `git` install required, fast, and works on any public repo.
- **🔬 Advanced** — performs a full **`git clone`** into a temp directory and additionally scans the **entire git history** (`git log -p`) for secrets. This catches credentials that were committed and later "removed" but still live in history. Requires `git` on the PATH; slower on large repos.

### What it scans

| Scanner | File | What it finds |
|---|---|---|
| **Secret Scanner** | `repo/secretScanner.ts` | Hardcoded secrets across source files (and git history in Advanced mode): AWS keys, GitHub/Slack/Stripe/Twilio/SendGrid tokens, Google API keys, private keys, JWTs, connection strings with embedded passwords, and generic API-key assignments. Filters out placeholders (`your_api_key_here`, `process.env.X`) and redacts the matched value in the report. |
| **Dependency Scanner** | `repo/depScanner.ts` | Parses `package-lock.json`, `package.json`, `requirements.txt`, `go.mod`, and `Gemfile.lock`, resolves versions, and queries **OSV.dev** for known-vulnerable dependencies. Prefers lock files for exact versions. |
| **Workflow Scanner** | `repo/workflowScanner.ts` | GitHub Actions risks: `pull_request_target` misuse, script injection via untrusted `${{ github.event.* }}`, unpinned third-party actions (not pinned to a commit SHA), `permissions: write-all`, and self-hosted runners on public repos. |
| **Hygiene Checks** | `repo/hygiene.ts` | Committed `.env` files, a `.gitignore` that doesn't ignore `.env` (or none at all), committed key/credential files (`.pem`, `.key`, keystores), missing `SECURITY.md`, and no Dependabot/Renovate config. |
| **Code Pattern Scanner** | `repo/hygiene.ts` | Insecure code patterns: `eval()`, shell exec with string interpolation, `os.system`/`subprocess(shell=True)`, SQL string concatenation, weak hashes (MD5/SHA1), `Math.random()` for tokens, and disabled TLS verification. |

### Scope and access

- **Public repos** — anyone's, no authentication needed.
- **Private repos** — only with a GitHub token that has access. Add one in Settings (stored encrypted via the OS keychain, same as the AI key) or via the `GITHUB_TOKEN` environment variable. A token also raises the API rate limit from 60 to 5,000 requests/hour.
- All fetch/clone operations are bounded (file count, per-file size, total bytes, history patch size, clone timeout) so a huge or malicious repo can't exhaust resources. Cloned temp directories are always cleaned up.

Unlike the website vulnerability scanner, repo scanning is **read-only** — it never attacks a running server, so no consent gate is required for public repos.

---

## What you can find with it

- **Missing/misconfigured security headers** — HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, COOP
- **TLS/SSL weaknesses** — broken protocols (TLS 1.0/1.1), expiring or expired certificates, self-signed certs, weak ciphers, missing HSTS preload, and sites that serve plain HTTP without redirecting to HTTPS
- **Insecure cookies** — session tokens missing HttpOnly / Secure / SameSite
- **CORS misconfigurations** — wildcard-on-API and untrusted credentialed origins that could enable cross-origin data theft
- **Exposed secrets** — JWTs (decoded), AWS keys, GitHub/Slack tokens, generic API keys, and passwords leaked in URLs or response bodies
- **CMS attack surface** — WordPress/Drupal/Shopify installs plus xmlrpc, user enumeration, and version disclosure
- **Third-party exposure** — every tracker, analytics, ad network, and CDN the page talks to, with request counts and bytes
- **Active vulnerabilities** — SQL injection (error-based and time-based blind), reflected XSS, path traversal, open redirects, IDOR, and information disclosure
- **DNS footprint** — full records for every domain the page contacts, plus discovered subdomains
- **Performance data** — total weight, per-type breakdown, slowest requests, and a request waterfall

---

## Architecture

ASTRA is built around a **shared analysis core** with three independent front-ends layered on top. The core has no knowledge of how it's being invoked, which is why the exact same capture-and-analyze logic backs the desktop app, the CLI, and the web server.

### High-level flow

```
                          ┌──────────────────────────────┐
        URL input ───────▶│  url.ts  — normalize+validate │
                          └───────────────┬───────────────┘
                                          │ valid https?
                                          ▼
                          ┌──────────────────────────────┐
                          │  capture.ts — Playwright /    │
                          │  headless Chromium            │
                          │  events: request, response,   │
                          │  requestfinished, failed      │
                          └───────────────┬───────────────┘
                                          │ NetworkRequest[]
                          ┌───────────────┴───────────────┐
                          ▼                                ▼
              ┌────────────────────┐          ┌──────────────────────────┐
              │  metrics.ts        │          │  security/*  (parallel)   │
              │  totals, by-type,  │          │  tls · csp(+headers       │
              │  slowest, errors   │          │  +cookies) · cors ·       │
              └─────────┬──────────┘          │  fingerprint(+cms) ·      │
                        │                      │  apiExtractor · dns ·     │
                        │                      │  vulnScanner              │
                        │                      └────────────┬─────────────┘
                        └───────────────┬───────────────────┘
                                        ▼
                          ┌──────────────────────────────┐
                          │  consolidated scan result      │
                          └───────┬───────────────┬────────┘
                                  ▼               ▼
                    ┌─────────────────┐   ┌──────────────────────┐
                    │ ai/groqClient.ts│   │ exports: PDF / HAR /  │
                    │ (Groq, streamed)│   │ Markdown              │
                    └─────────────────┘   └──────────────────────┘
```

### The three front-ends

**Desktop (Electron)** — the primary experience.
- **Main process** (`electron/main.ts`) runs in Node and owns all privileged work: it registers IPC handlers, runs the capture + analysis pipeline, manages the encrypted API key, streams AI tokens back to the renderer, and renders PDFs.
- **Preload** (`electron/preload.ts`) is the security boundary. With `contextIsolation` on and `nodeIntegration` off, the renderer has no direct Node access — it can only call the specific functions exposed on `window.electronAPI` (`analyze`, `exportPdf`, `saveApiKey`, the streaming listeners, etc.). This is the recommended Electron hardening posture.
- **Renderer** (`electron/index.html` + `app.js` + `views.js` + `ai.js` + `styles.css`) is plain HTML/CSS/JS — no framework. `app.js` drives the analysis flow and tab switching, `views.js` holds the render function for each tab, and `ai.js` manages the streaming AI panel and chat.

The renderer→main contract is a single `analyze(url)` call that returns the entire consolidated result object; AI runs over a separate streaming channel using `ipcRenderer` events so tokens can paint as they arrive.

**CLI** (`src/cli.ts`) — built on Commander. Same `url.ts → capture.ts → metrics.ts → report.ts` spine, writing a Markdown report to stdout or a file, with optional HAR export. Progress is written to stderr so the report on stdout stays clean and pipeable.

**Web dashboard** (`src/server.ts`) — an Express server exposing a `POST /analyze` endpoint and a self-contained HTML dashboard, for when you want the visual output without installing the desktop app.

### Design principles in the code

- **Pure functions where possible.** `metrics.ts`, `report.ts`, `csp.ts`, `cors.ts`, `fingerprint.ts`, and `apiExtractor.ts` are pure transformations over captured data. That's what makes them straightforward to property-test and means re-running analysis never re-hits the network.
- **Network-touching modules are isolated and failure-tolerant.** TLS, DNS, and the vuln scanner are the only modules that make their own outbound connections, and they're wrapped in `Promise.allSettled` so any one of them failing degrades gracefully instead of failing the scan.
- **Low false-positive bias.** Several modules were specifically tuned to *not* flag normal behavior (auth headers in CORS, Bearer tokens in their correct location, minified JS that looks like a stack trace). A scanner that cries wolf gets ignored.
- **One capture, many views.** The browser is driven exactly once per scan; performance metrics, security findings, the HAR, and the AI prompt are all derived from that single `NetworkRequest[]` snapshot.

---

## Data model

Everything downstream of capture operates on one normalized shape (`src/types.ts`):

```ts
interface NetworkRequest {
  url: string;
  method: string;
  resourceType: 'document' | 'script' | 'stylesheet' | 'image'
              | 'xhr' | 'fetch' | 'font' | 'media' | 'other';
  statusCode: number | null;     // null when the request failed
  sizeBytes: number;             // real transferred body size
  ttfbMs: number;                // time to first byte
  durationMs: number;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  failed: boolean;
  errorText?: string;
}
```

Playwright's many resource types are collapsed into this fixed set so the rest of the system never has to special-case browser internals. The HAR exporter (`src/har.ts`) maps this shape to and from HAR 1.2, so a capture can round-trip through a `.har` file and back.

---

## Installation

**Prerequisites:** Node.js 20+

```bash
git clone <repo>
cd astra
npm install
npx playwright install chromium
npm run electron
```

For the AI analysis feature, get a free Groq API key at [console.groq.com/keys](https://console.groq.com/keys) and either add it in **Settings** inside the app, or set it in a `.env` file at the project root:

```
GROQ_API_KEY=your_key_here
```

The `.env` file is gitignored and must never be committed. When entered in Settings, the key is encrypted at rest using your OS keychain via Electron's `safeStorage`. The lookup order is: encrypted keychain file → `process.env.GROQ_API_KEY` → none.

---

## Usage

### Desktop app
```bash
npm run electron
```
Enter a URL, hit Analyze, and explore the tabbed results. Export to PDF/HAR/Markdown from the toolbar.

To scan a repository instead, click **Repo Analyzer** in the header, paste a GitHub URL, choose **Basic** or **Advanced** with the toggle, and hit Scan.

### CLI
```bash
npm run build

# Print a Markdown report to stdout
node dist/cli.js https://example.com

# Save the report to a file
node dist/cli.js https://example.com --output report.md

# Also export a HAR file
node dist/cli.js https://example.com --output report.md --har capture.har
```

### Web dashboard
```bash
npm run serve
# open http://localhost:3000
```

---

## Project structure

```
src/
  cli.ts              — CLI entry point (Commander)
  server.ts           — Express web dashboard + POST /analyze
  capture.ts          — Playwright headless capture + two-stage wait strategy
  metrics.ts          — Request grouping, aggregates, slowest/error filtering
  report.ts           — Markdown report renderer
  har.ts              — HAR 1.2 export and round-trip parsing
  output.ts           — File/stdout writer
  url.ts              — URL normalization and validation
  types.ts            — Shared TypeScript interfaces (NetworkRequest, etc.)
  ai/
    groqClient.ts     — Groq (llama-3.3-70b-versatile) streaming client
  security/
    tls.ts            — TLS/SSL inspection + HSTS + HTTP→HTTPS redirect check
    cors.ts           — CORS misconfiguration detection (low false-positive)
    csp.ts            — CSP analysis + security headers + cookie flag checks
    fingerprint.ts    — Technology detection + version extraction + CMS attack surface
    cve.ts            — OSV.dev CVE correlation for fingerprinted components
    apiExtractor.ts   — API endpoint, JWT decode, location-aware secret leaks
    dns.ts            — DNS reconnaissance
    mixedContent.ts   — HTTP-on-HTTPS mixed content detection
    vulnScanner.ts    — Active scanning with baseline comparison (opt-in)
  repo/               — GitHub repository scanner
    githubUrl.ts      — GitHub URL/shorthand parsing and validation
    fetchRepo.ts      — GitHub API fetch (basic) + git clone with history (advanced)
    secretScanner.ts  — Hardcoded secret detection (files + git history)
    depScanner.ts     — Manifest parsing + OSV.dev dependency CVE lookups
    workflowScanner.ts — GitHub Actions workflow risk analysis
    hygiene.ts        — Repo hygiene + insecure code pattern checks
    index.ts          — Repo analysis orchestrator
  __tests__/          — Vitest + fast-check property tests
electron/
  main.ts             — Main process: IPC handlers, pipeline orchestration, PDF, key/token mgmt
  preload.ts          — contextBridge security boundary (window.electronAPI)
  index.html          — Dashboard shell + website/repo hero + Basic/Advanced toggle
  app.js              — Renderer: analysis flow, repo scan, mode switching, exports
  views.js            — Renderer: per-tab render functions + repo view (HTML-escaped)
  ai.js               — Renderer: streaming AI analysis + chat
  styles.css          — Dashboard styling
```

---

## Tech stack

- **Electron** — desktop shell with full Node.js system access in the main process
- **Playwright** — headless Chromium for real-browser network capture
- **TypeScript** — strict mode throughout
- **Groq (`llama-3.3-70b-versatile`)** — AI analysis via OpenAI-compatible streaming API
- **OSV.dev** — free open-source vulnerability database for dependency/component CVE lookups
- **GitHub REST API + git** — repository fetching for the repo scanner
- **Vitest + fast-check** — property-based testing for the pure core
- **Express** — optional web dashboard
- **Commander** — CLI argument parsing

---

## Testing

```bash
npm test
```

86 tests across 6 suites cover URL normalization/validation, metrics computation, Markdown report rendering, HAR round-trip, the security analysis modules (CSP, headers, cookies, CORS false-positive guards, API leak detection, fingerprinting, mixed content), and the repo scanner (GitHub URL parsing, secret detection + redaction, workflow analysis, hygiene, code patterns) — using a mix of example-based and property-based testing with fast-check.

---

## Security and privacy notes

- **The vulnerability scanner sends real, intrusive HTTP requests** (injection payloads, traversal strings, adjacent-ID probes) to the target. It is **off by default** and only runs when you tick the consent toggle. Only run it against systems you own or are explicitly authorized to test.
- **Repo scanning is read-only** — it fetches/clones source and analyzes it locally; it never attacks a server. Treat any secrets it finds in someone else's repo responsibly (report, don't abuse).
- **The AI feature transmits scan data** (headers, URLs, findings) to Groq's API, with detected secret values redacted to `[REDACTED]` before sending. Still, don't run it on scans containing sensitive internal URLs you don't want leaving your machine.
- **Dependency/CVE lookups query OSV.dev** with package names and versions only — no source code is sent.
- **API keys and GitHub tokens are encrypted at rest** using your OS keychain via Electron's `safeStorage`, and `.env` is gitignored. Secrets are never written into reports or committed.
- **The renderer is sandboxed** — `contextIsolation` on, `nodeIntegration` off, with all privileged operations mediated through the preload bridge. All scan data (including hostile site headers and repo contents) is HTML-escaped before rendering, and the PDF export escapes the same way.
