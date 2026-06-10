# ASTRA — Pages & UI Structure

This document describes every screen, panel, and tab in the ASTRA desktop app for use in design tools like Google Stitch.

---

## 1. App Shell (Always Visible)

### Header Bar
- **Left:** ASTRA logo icon (network graph SVG) + "ASTRA" title + tagline "Automated Security Testing & Risk Analysis"
- **Right:** ⚙ Settings button
- Full-width drag region for moving the window (frameless window)
- Dark background `#0f1117`, border bottom

---

## 2. Home / Landing State

**Shown when no scan has been run yet.**

### Hero Section (centered)
- Large heading: "Analyze any website's security"
- Subtext: "ASTRA captures every network request, runs a full security audit, and delivers AI-powered analysis — automated."
- **URL Input Bar**
  - Text input: placeholder "https://example.com"
  - "Analyze" button (accent blue)
  - Rounded card style, glows on focus
- **Status line** below input — shows loading state or error message

---

## 3. Dashboard (After Scan Completes)

**Shown below the hero after a successful scan.**

### Action Bar
- Download HAR button
- Download Markdown button
- Download PDF button

### Summary Cards Row
4 metric cards in a grid:
| Card | Content |
|---|---|
| Total Requests | Number + analyzed URL |
| Transferred | Human-readable bytes (e.g. 1.2 MB) |
| Page Load | Duration in ms |
| Errors | Count + status indicator |

### Request Breakdown by Type
- Section heading with badge showing type count
- Bar chart rows: Type name | Animated bar | Count | Size | Avg duration
- Types: document, script, stylesheet, image, xhr, fetch, font, media, other

---

## 4. Tab Navigation

14 tabs below the breakdown section. Each tab is a panel that replaces the content area.

---

### Tab 1 — All Requests
**Full request log table**
Columns: URL (truncated, monospace) | Method | Type (pill) | Status (colored pill) | Size | TTFB | Duration

---

### Tab 2 — Slowest
**Top 5 slowest requests**
Same table as All Requests, filtered to 5 slowest by duration.

---

### Tab 3 — Errors
**All failed or 4xx/5xx requests**
Same table format. Empty state: "None" message.

---

### Tab 4 — Waterfall
**Visual timeline of requests**
- Legend: yellow = TTFB, blue = Receive
- Each row: URL label (left, truncated) | Proportional bar (TTFB + receive segments) | Duration (right)
- Sorted by duration descending, max 60 requests shown

---

### Tab 5 — Security Headers
**Two sections:**

1. **Security header cards grid** (2-4 per row)
   - Each card: header name + colored dot (green=good, yellow=present but weak, red=missing) + current value
   - Headers checked: HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, X-XSS-Protection, Cache-Control

2. **All Response Headers table**
   - Full list of headers from the main document request
   - Columns: Header name (monospace, purple) | Value (monospace)

---

### Tab 6 — Cookies
**Set-Cookie header analysis table**
Columns: Name | Value (truncated) | Secure (✓/✗ pill) | HttpOnly (✓/✗ pill) | SameSite | Path | Source URL

Empty state if no cookies found.

---

### Tab 7 — TLS
**Two-column layout:**

Left card — TLS Grade
- Large letter grade (A+/A/B/C/F) in color (green/yellow/red)
- List of issues found (red warnings) or "✓ No issues found"

Right card — Connection Details
- Protocol (TLS 1.2 / TLS 1.3)
- Cipher suite name
- Key bits
- HSTS present/missing
- HSTS max-age
- includeSubDomains ✓/✗
- Preload ✓/✗

Full-width card — Certificate
- Subject, Issuer, Valid From, Valid To (with days remaining, red if < 30)
- Self-signed indicator
- SHA-256 fingerprint
- Subject Alternative Names (SANs)

---

### Tab 8 — CORS
**Summary cards row:** Critical | High | Medium | Low counts

**Findings table** (if issues found):
Columns: Risk (colored pill) | URL | Method | Issue description | Header | Value

Empty state: "✓ No CORS issues found"

---

### Tab 9 — API / JWT
**Summary cards:** Endpoints | JWTs Found | Sensitive Leaks

**Endpoints table:**
Columns: Path (monospace) | Method | Auth type (pill) | Findings (JWT/Leak badges) | Content-Type | Duration

**Decoded JWTs section** (if JWTs found):
- Card per JWT: source URL + two-column header/payload JSON display

**Sensitive Data Leaks section** (if leaks found):
- Table: Type (red) | Location | Value | Source URL

---

### Tab 10 — Tech Stack
**Two info cards:** Server software | Powered-by header value

**Detected Technologies list:**
- Card per technology: Name + version | Evidence text | Category pill | Confidence pill
- Categories color-coded: framework (blue), cms (purple), server (yellow), cdn (green), analytics (gray), payment (red), auth (yellow), library (purple)

**Third-Party Domains table:**
Columns: Domain (monospace) | Category pill | Request count | Total size

---

### Tab 11 — DNS Recon
**Subdomains section:**
- Pill badges for each subdomain found

**DNS Records section:**
- Card per domain (up to 20)
- Each card: domain name heading + rows of Type pill | Value (monospace)
- Record types: A, AAAA, MX, TXT, NS, CNAME

---

### Tab 12 — CSP
**Grade card + raw policy card (side by side):**
- Grade: large letter (A/B/C/D/F) + score out of 100
- Raw: scrollable pre-formatted policy text

**Issues table** (if issues found):
Columns: Severity (colored pill) | Directive (monospace, purple) | Issue | Recommendation

**Parsed Directives table:**
Columns: Directive (monospace) | Values

---

### Tab 13 — Vuln Scan
**Summary cards:** Scanned endpoints | Total findings | SQLi | XSS | Path Traversal | Open Redirect | Info Disclosure

**Findings table** (if vulnerabilities found):
Columns: Severity (colored pill) | Type (red, bold) | URL | Method | Description | Evidence (truncated)

Empty state: "✓ No vulnerabilities detected"
Disclaimer: "Automated scan only. Verify findings manually before reporting."

---

### Tab 14 — 🤖 AI Analysis

**No API key state:**
- Centered card with message + "Open Settings" button

**With API key — Chat interface:**
- Message thread (scrollable)
  - AI messages: left-aligned, dark surface background, robot emoji avatar
  - User messages: right-aligned, accent blue background, person emoji avatar
  - Markdown rendered: headings, bold, code, lists
  - Streaming cursor animation while generating
- **Input bar** at bottom:
  - Text input: "Ask about the scan…"
  - Send button
- Footer: "Powered by Gemini 2.5 Flash · Your scan data is sent to Google's API"

Auto-runs full security analysis when scan completes (if API key set).

---

## 5. Settings Panel (Slide-in from right)

**Triggered by ⚙ Settings button in header.**

- Overlay panel, 380px wide, full height
- Close button (✕) top right
- **Gemini API Key section:**
  - Label + description + link to aistudio.google.com
  - Password input field + Save button
  - Validation status (validating… / ✓ Saved / ✗ Invalid)
- **Info section:**
  - Model name: gemini-2.5-flash-preview-04-17
  - Note about local encrypted storage

---

## Color Palette

| Token | Value | Usage |
|---|---|---|
| `--bg` | `#0f1117` | App background |
| `--surface` | `#1a1d27` | Cards, panels |
| `--surface2` | `#22263a` | Table headers, hover states |
| `--border` | `#2e3250` | All borders |
| `--accent` | `#6c8ef5` | Primary blue — buttons, bars, links |
| `--accent2` | `#a78bfa` | Purple — type pills, header names |
| `--green` | `#34d399` | Success, good grades |
| `--red` | `#f87171` | Errors, critical findings |
| `--yellow` | `#fbbf24` | Warnings, TTFB bars |
| `--text` | `#e2e8f0` | Primary text |
| `--muted` | `#8892b0` | Secondary text, labels |

---

## Typography

- Font: Inter (system-ui fallback)
- Base size: 0.8–0.85rem for table content
- Labels: 0.7–0.72rem, uppercase, letter-spacing 0.06em
- Values/headings: 0.9–1.1rem, font-weight 700
- Monospace: system monospace for URLs, headers, code values

---

## Layout Notes

- Max content width: 1100px, centered
- Tabs wrap on smaller windows (flex-wrap)
- All tables have horizontal scroll on overflow
- Cards use CSS Grid with `auto-fit, minmax()` for responsive columns
- Waterfall bars use absolute positioning within a flex container
