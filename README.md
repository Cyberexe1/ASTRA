# ASTRA — Automated Security Testing & Risk Analysis

## The Divine Weapon for Modern Web Security

In ancient Indian mythology, an Astra was a powerful celestial weapon capable of revealing weaknesses, overcoming formidable defenses, and changing the course of battle. Inspired by that idea, ASTRA brings the same philosophy to cybersecurity—helping security professionals identify vulnerabilities, uncover hidden attack surfaces, and gain the intelligence needed to defend modern applications.

ASTRA is a desktop security analysis tool that automates what you'd normally do by hand in browser DevTools — and goes considerably deeper. You give it a URL; it drives a real headless browser to that page, records every network request the page makes, runs a battery of passive and active security checks against what it captured, and then hands the whole picture to an LLM that writes up a prioritized risk report.

It's built with Electron + TypeScript + Playwright and runs entirely on your machine. Nothing is captured or analyzed on a remote server — the only outbound call to a third party is the optional AI step, and that's something you opt into with your own API key.

---

## Table of contents

- [What this project is](#what-this-project-is)
- [How it works (end to end)](#how-it-works-end-to-end)
- [What it does — module by module](#what-it-does--module-by-module)
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

ASTRA collapses that workflow into a single action. It is three things at once:

1. **A network capture engine** — a headless Chromium instance, controlled by Playwright, that loads any URL and records the full request/response timeline exactly as a browser sees it.
2. **A security analysis suite** — ten focused modules that each examine the captured traffic (and in a few cases make their own follow-up probes) for a specific class of problem: TLS, headers, cookies, CORS, CSP, technology fingerprinting, CMS attack surface, API/secret exposure, DNS, and active vulnerabilities.
3. **An AI reporting layer** — the consolidated scan output is streamed to a large language model (Groq's `llama-3.3-70b-versatile`) which produces an executive summary, ranked findings, and a remediation plan, and then answers follow-up questions in a chat.

The same core analysis runs in three delivery modes: a full Electron desktop app, a command-line tool, and a lightweight Express web dashboard.

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
If an API key is configured, the consolidated result is summarized into a compact prompt (`src/ai/gemini.ts`) and streamed to the model. Tokens arrive incrementally and render live in the UI. A follow-up chat keeps the scan context so you can interrogate the findings.

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
| **CMS Attack Surface** | `security/fingerprint.ts` | When a CMS is detected, passively flags known exposure in the captured traffic. For WordPress: `xmlrpc.php` (brute-force amplification via `system.multicall`), REST API user enumeration (`/wp-json/wp/v2/users`), `readme.html`/`license.txt` version disclosure, exposed `wp-login.php`, and component versions leaked via `?ver=`. |
| **API Endpoint Extractor** | `security/apiExtractor.ts` | Catalogs every XHR/fetch and mutating request. Detects auth type (Bearer, Basic, API key headers), decodes JWT headers and payloads, and scans for leaked secrets. It is **location-aware**: a Bearer token in a request `Authorization` header is *expected* and not flagged, whereas the same token in a URL or response body is reported as a leak — with a reason attached. |
| **DNS Reconnaissance** | `security/dns.ts` | For every unique domain the page contacted, resolves A, AAAA, MX, TXT, NS, and CNAME records, and identifies subdomains of the target. Lookups are capped to avoid hanging on pages that touch dozens of domains. |
| **Vulnerability Scanner** | `security/vulnScanner.ts` | The only actively intrusive module. Against detected endpoints it tests for SQL injection (error-based **and** time-based blind, using a baseline request for comparison so it isn't fooled by a naturally slow endpoint), reflected XSS (context-aware — a payload reflected inside an HTML comment or HTML-encoded is *not* flagged), path traversal (only on file-path-looking params), open redirects, IDOR (probing adjacent numeric IDs), and information disclosure (stack traces, PHP/DB errors, secrets in bodies — skipping JS/CSS responses to avoid false positives on minified code). |

### AI Security Analysis
The consolidated scan is summarized and streamed to **Groq (`llama-3.3-70b-versatile`)** over an OpenAI-compatible streaming endpoint. It produces an executive summary with an overall risk level, critical findings with concrete remediation steps, a third-party risk assessment, and a prioritized remediation plan tailored to the detected stack. A follow-up chat retains the scan context.

> The integration file is named `src/ai/gemini.ts` for legacy reasons — it targets the Groq API, not Google Gemini.

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
                    │ ai/gemini.ts    │   │ exports: PDF / HAR /  │
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
    gemini.ts         — Groq (llama-3.3-70b-versatile) streaming client
  security/
    tls.ts            — TLS/SSL inspection + HSTS + HTTP→HTTPS redirect check
    cors.ts           — CORS misconfiguration detection (low false-positive)
    csp.ts            — CSP analysis + security headers + cookie flag checks
    fingerprint.ts    — Technology detection + version extraction + CMS attack surface
    apiExtractor.ts   — API endpoint, JWT decode, location-aware secret leaks
    dns.ts            — DNS reconnaissance
    vulnScanner.ts    — Active scanning with baseline comparison
  __tests__/          — Vitest + fast-check property tests
electron/
  main.ts             — Main process: IPC handlers, pipeline orchestration, PDF, key mgmt
  preload.ts          — contextBridge security boundary (window.electronAPI)
  index.html          — Dashboard shell
  app.js              — Renderer: analysis flow, tab switching, exports
  views.js            — Renderer: per-tab render functions
  ai.js               — Renderer: streaming AI analysis + chat
  styles.css          — Dashboard styling
```

---

## Tech stack

- **Electron** — desktop shell with full Node.js system access in the main process
- **Playwright** — headless Chromium for real-browser network capture
- **TypeScript** — strict mode throughout
- **Groq (`llama-3.3-70b-versatile`)** — AI analysis via OpenAI-compatible streaming API
- **Vitest + fast-check** — property-based testing for the pure core
- **Express** — optional web dashboard
- **Commander** — CLI argument parsing

---

## Testing

```bash
npm test
```

32 tests across 4 suites cover URL normalization/validation, metrics computation, Markdown report rendering, and HAR round-trip — using property-based testing with fast-check, which generates large numbers of random inputs to surface edge cases a handful of hand-written cases would miss.

---

## Security and privacy notes

- **The vulnerability scanner sends real, intrusive HTTP requests** (injection payloads, traversal strings, adjacent-ID probes) to the target. Only run it against systems you own or are explicitly authorized to test.
- **The AI feature transmits scan data** (headers, URLs, findings) to Groq's API. Don't run it on scans that contain credentials or sensitive internal URLs.
- **API keys are encrypted at rest** using your OS keychain via Electron's `safeStorage`, and `.env` is gitignored. Secrets are never written into reports or committed.
- **The renderer is sandboxed** — `contextIsolation` on, `nodeIntegration` off, with all privileged operations mediated through the preload bridge.
