import express from 'express';
import { normalizeAndValidate } from './url.js';
import { captureNetwork } from './capture.js';
import { processRequests } from './metrics.js';
import { generateHar } from './har.js';

const app = express();
app.use(express.json());

app.get('/', (_req, res) => {
  res.send(HTML);
});

app.post('/analyze', async (req, res) => {
  const { url: rawUrl } = req.body as { url: string };

  if (!rawUrl) {
    res.status(400).json({ error: 'URL is required' });
    return;
  }

  const validation = normalizeAndValidate(rawUrl);
  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return;
  }

  try {
    const capture = await captureNetwork({ url: validation.url, timeoutMs: 30000 });
    const data = processRequests(capture.requests);
    const har = generateHar(capture.requests, capture.captureTimestamp);

    res.json({
      url: validation.url,
      captureTimestamp: capture.captureTimestamp,
      totalDurationMs: capture.totalDurationMs,
      aggregate: data.aggregate,
      byType: data.byType,
      slowest: data.slowest,
      errors: data.errors,
      requests: data.requests,
      har,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`Network Tab Analyzer dashboard running at http://localhost:${PORT}`);
});

// ─── Inline HTML dashboard ────────────────────────────────────────────────────
const HTML = /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Network Tab Analyzer</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0f1117; --surface: #1a1d27; --surface2: #22263a;
    --border: #2e3250; --accent: #6c8ef5; --accent2: #a78bfa;
    --green: #34d399; --red: #f87171; --yellow: #fbbf24;
    --text: #e2e8f0; --muted: #8892b0; --font: 'Inter', system-ui, sans-serif;
  }
  body { background: var(--bg); color: var(--text); font-family: var(--font); min-height: 100vh; }

  header {
    padding: 20px 32px; border-bottom: 1px solid var(--border);
    display: flex; align-items: center; gap: 12px;
  }
  header svg { flex-shrink: 0; }
  header h1 { font-size: 1.25rem; font-weight: 700; letter-spacing: -0.02em; }
  header span { color: var(--muted); font-size: 0.85rem; margin-left: auto; }

  .hero {
    max-width: 720px; margin: 60px auto 0; padding: 0 24px; text-align: center;
  }
  .hero h2 { font-size: 2rem; font-weight: 800; letter-spacing: -0.03em; margin-bottom: 8px; }
  .hero p { color: var(--muted); margin-bottom: 32px; }

  .input-row {
    display: flex; gap: 10px; background: var(--surface);
    border: 1px solid var(--border); border-radius: 12px; padding: 6px 6px 6px 16px;
    transition: border-color .2s;
  }
  .input-row:focus-within { border-color: var(--accent); }
  .input-row input {
    flex: 1; background: none; border: none; outline: none;
    color: var(--text); font-size: 1rem; font-family: var(--font);
  }
  .input-row input::placeholder { color: var(--muted); }
  .input-row button {
    background: var(--accent); color: #fff; border: none; border-radius: 8px;
    padding: 10px 22px; font-size: 0.9rem; font-weight: 600; cursor: pointer;
    transition: opacity .15s;
  }
  .input-row button:hover { opacity: .85; }
  .input-row button:disabled { opacity: .5; cursor: not-allowed; }

  #status { margin-top: 16px; color: var(--muted); font-size: 0.9rem; min-height: 22px; }
  #status.error { color: var(--red); }

  #dashboard { max-width: 1200px; margin: 40px auto 60px; padding: 0 24px; display: none; }

  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 32px; }
  .card {
    background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
    padding: 20px; display: flex; flex-direction: column; gap: 6px;
  }
  .card .label { font-size: 0.75rem; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
  .card .value { font-size: 1.6rem; font-weight: 700; }
  .card .sub { font-size: 0.8rem; color: var(--muted); }

  .section { margin-bottom: 32px; }
  .section h3 {
    font-size: 0.85rem; text-transform: uppercase; letter-spacing: .08em;
    color: var(--muted); margin-bottom: 14px; display: flex; align-items: center; gap: 8px;
  }
  .section h3 .badge {
    background: var(--surface2); border-radius: 20px; padding: 2px 10px;
    font-size: 0.75rem; color: var(--text); text-transform: none; letter-spacing: 0;
  }

  /* Type breakdown bars */
  .type-grid { display: flex; flex-direction: column; gap: 10px; }
  .type-row { display: grid; grid-template-columns: 90px 1fr 80px 80px 80px; align-items: center; gap: 12px; }
  .type-row .name { font-size: 0.85rem; font-weight: 600; }
  .bar-wrap { background: var(--surface2); border-radius: 4px; height: 8px; overflow: hidden; }
  .bar { height: 100%; border-radius: 4px; background: var(--accent); transition: width .4s ease; }
  .type-row .num { font-size: 0.8rem; color: var(--muted); text-align: right; }

  /* Tables */
  .tbl-wrap { overflow-x: auto; border-radius: 10px; border: 1px solid var(--border); }
  table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
  thead th {
    background: var(--surface2); padding: 10px 14px; text-align: left;
    font-size: 0.72rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted);
    white-space: nowrap;
  }
  tbody tr { border-top: 1px solid var(--border); transition: background .1s; }
  tbody tr:hover { background: var(--surface2); }
  tbody td { padding: 9px 14px; vertical-align: middle; }
  .url-cell { max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: monospace; font-size: 0.78rem; }
  .pill {
    display: inline-block; padding: 2px 8px; border-radius: 20px;
    font-size: 0.72rem; font-weight: 600; white-space: nowrap;
  }
  .pill-2xx { background: #064e3b; color: var(--green); }
  .pill-3xx { background: #451a03; color: var(--yellow); }
  .pill-4xx, .pill-5xx, .pill-err { background: #450a0a; color: var(--red); }
  .pill-type { background: var(--surface2); color: var(--accent2); }

  .tabs { display: flex; gap: 4px; margin-bottom: 16px; }
  .tab {
    padding: 7px 16px; border-radius: 8px; font-size: 0.82rem; font-weight: 600;
    cursor: pointer; border: 1px solid transparent; color: var(--muted); background: none;
    transition: all .15s;
  }
  .tab.active { background: var(--surface); border-color: var(--border); color: var(--text); }
  .tab-panel { display: none; }
  .tab-panel.active { display: block; }

  .spinner {
    display: inline-block; width: 18px; height: 18px; border: 2px solid var(--border);
    border-top-color: var(--accent); border-radius: 50%; animation: spin .7s linear infinite;
    vertical-align: middle; margin-right: 8px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .waterfall-wrap { overflow-x: auto; }
  .waterfall-row { display: flex; align-items: center; gap: 10px; padding: 4px 0; border-top: 1px solid var(--border); font-size: 0.78rem; }
  .waterfall-row:first-child { border-top: none; }
  .wf-label { width: 260px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: monospace; color: var(--muted); }
  .wf-bar-wrap { flex: 1; position: relative; height: 16px; }
  .wf-bar { position: absolute; height: 10px; top: 3px; border-radius: 3px; min-width: 2px; }
  .wf-ttfb { background: var(--yellow); }
  .wf-recv { background: var(--accent); }
  .wf-dur { width: 60px; flex-shrink: 0; text-align: right; color: var(--muted); }

  .dl-btn {
    display: inline-flex; align-items: center; gap: 6px;
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
    padding: 7px 14px; font-size: 0.82rem; color: var(--text); cursor: pointer;
    text-decoration: none; transition: border-color .15s;
  }
  .dl-btn:hover { border-color: var(--accent); }
  .actions { display: flex; gap: 10px; margin-bottom: 24px; flex-wrap: wrap; }
</style>
</head>
<body>

<header>
  <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
    <rect width="28" height="28" rx="8" fill="#6c8ef5" fill-opacity=".15"/>
    <path d="M6 20 L10 13 L14 16 L18 9 L22 12" stroke="#6c8ef5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="22" cy="12" r="2" fill="#a78bfa"/>
  </svg>
  <h1>Network Tab Analyzer</h1>
  <span>DevTools Network tab — automated</span>
</header>

<div class="hero">
  <h2>Analyze any website's network</h2>
  <p>Enter a URL to capture all HTTP requests, timings, sizes, and errors — just like DevTools.</p>
  <div class="input-row">
    <input id="urlInput" type="text" placeholder="https://example.com" autocomplete="off" spellcheck="false"/>
    <button id="analyzeBtn" onclick="analyze()">Analyze</button>
  </div>
  <div id="status"></div>
</div>

<div id="dashboard">
  <div class="actions">
    <a id="dlHar" class="dl-btn" download="capture.har">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v8M4 6l3 3 3-3M2 11h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Download HAR
    </a>
    <a id="dlMd" class="dl-btn" download="report.md">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v8M4 6l3 3 3-3M2 11h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Download Markdown
    </a>
  </div>

  <div class="cards" id="cards"></div>

  <div class="section">
    <h3>Request Breakdown by Type <span class="badge" id="typeCount"></span></h3>
    <div class="type-grid" id="typeGrid"></div>
  </div>

  <div class="section">
    <div class="tabs">
      <button class="tab active" onclick="switchTab('all')">All Requests</button>
      <button class="tab" onclick="switchTab('slowest')">Slowest</button>
      <button class="tab" onclick="switchTab('errors')">Errors</button>
      <button class="tab" onclick="switchTab('waterfall')">Waterfall</button>
    </div>
    <div id="tab-all" class="tab-panel active"></div>
    <div id="tab-slowest" class="tab-panel"></div>
    <div id="tab-errors" class="tab-panel"></div>
    <div id="tab-waterfall" class="tab-panel"></div>
  </div>
</div>

<script>
let lastData = null;

function fmt(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes/1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes/1048576).toFixed(1) + ' MB';
  return (bytes/1073741824).toFixed(1) + ' GB';
}

function statusPill(req) {
  if (req.failed) return '<span class="pill pill-err">FAILED</span>';
  const s = req.statusCode;
  if (!s) return '<span class="pill pill-err">—</span>';
  const cls = s >= 500 ? 'pill-5xx' : s >= 400 ? 'pill-4xx' : s >= 300 ? 'pill-3xx' : 'pill-2xx';
  return \`<span class="pill \${cls}">\${s}</span>\`;
}

function typePill(t) {
  return \`<span class="pill pill-type">\${t}</span>\`;
}

function truncate(s, n=60) { return s.length > n ? s.slice(0,n)+'…' : s; }

function requestTable(rows) {
  if (!rows.length) return '<p style="color:var(--muted);padding:16px">None</p>';
  return \`<div class="tbl-wrap"><table>
    <thead><tr>
      <th>URL</th><th>Method</th><th>Type</th><th>Status</th>
      <th>Size</th><th>TTFB</th><th>Duration</th>
    </tr></thead>
    <tbody>\${rows.map(r => \`<tr>
      <td class="url-cell" title="\${r.url}">\${truncate(r.url)}</td>
      <td>\${r.method}</td>
      <td>\${typePill(r.resourceType)}</td>
      <td>\${statusPill(r)}</td>
      <td>\${fmt(r.sizeBytes)}</td>
      <td>\${r.ttfbMs.toFixed(0)}ms</td>
      <td>\${r.durationMs.toFixed(0)}ms</td>
    </tr>\`).join('')}
    </tbody></table></div>\`;
}

function waterfallView(requests) {
  if (!requests.length) return '<p style="color:var(--muted);padding:16px">None</p>';
  const maxDur = Math.max(...requests.map(r => r.durationMs), 1);
  const rows = requests.map(r => {
    const ttfbPct = (r.ttfbMs / maxDur * 100).toFixed(1);
    const recvPct = (Math.max(0, r.durationMs - r.ttfbMs) / maxDur * 100).toFixed(1);
    return \`<div class="waterfall-row">
      <div class="wf-label" title="\${r.url}">\${truncate(r.url, 38)}</div>
      <div class="wf-bar-wrap">
        <div class="wf-bar wf-ttfb" style="width:\${ttfbPct}%"></div>
        <div class="wf-bar wf-recv" style="left:\${ttfbPct}%;width:\${recvPct}%"></div>
      </div>
      <div class="wf-dur">\${r.durationMs.toFixed(0)}ms</div>
    </div>\`;
  });
  return \`<div style="margin-bottom:8px;font-size:0.75rem;color:var(--muted)">
    <span style="color:var(--yellow)">■</span> TTFB &nbsp;
    <span style="color:var(--accent)">■</span> Receive
  </div>
  <div class="waterfall-wrap">\${rows.join('')}</div>\`;
}

function render(data) {
  lastData = data;

  // Cards
  const cards = [
    { label: 'Total Requests', value: data.aggregate.totalRequests, sub: data.url },
    { label: 'Transferred', value: fmt(data.aggregate.totalBytes), sub: 'total size' },
    { label: 'Page Load', value: data.totalDurationMs.toFixed(0)+'ms', sub: 'network idle' },
    { label: 'Errors', value: data.errors.length, sub: data.errors.length ? '⚠ check errors tab' : '✓ clean' },
  ];
  document.getElementById('cards').innerHTML = cards.map(c => \`
    <div class="card">
      <div class="label">\${c.label}</div>
      <div class="value">\${c.value}</div>
      <div class="sub">\${c.sub}</div>
    </div>\`).join('');

  // Type breakdown
  const maxCount = Math.max(...data.byType.map(t => t.count), 1);
  document.getElementById('typeCount').textContent = data.byType.length + ' types';
  document.getElementById('typeGrid').innerHTML = \`
    <div class="type-row" style="font-size:0.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em">
      <div>Type</div><div>Requests</div><div>Count</div><div>Size</div><div>Avg</div>
    </div>
    \${data.byType.sort((a,b)=>b.count-a.count).map(t => \`
    <div class="type-row">
      <div class="name">\${t.resourceType}</div>
      <div class="bar-wrap"><div class="bar" style="width:\${(t.count/maxCount*100).toFixed(1)}%"></div></div>
      <div class="num">\${t.count}</div>
      <div class="num">\${fmt(t.totalBytes)}</div>
      <div class="num">\${t.avgDurationMs.toFixed(0)}ms</div>
    </div>\`).join('')}\`;

  // Tabs
  document.getElementById('tab-all').innerHTML = requestTable(data.requests);
  document.getElementById('tab-slowest').innerHTML = requestTable(data.slowest);
  document.getElementById('tab-errors').innerHTML = requestTable(data.errors);
  document.getElementById('tab-waterfall').innerHTML = waterfallView(
    [...data.requests].sort((a,b) => b.durationMs - a.durationMs).slice(0, 50)
  );

  // Downloads
  const harBlob = new Blob([JSON.stringify(data.har, null, 2)], {type:'application/json'});
  document.getElementById('dlHar').href = URL.createObjectURL(harBlob);

  const md = buildMarkdown(data);
  const mdBlob = new Blob([md], {type:'text/markdown'});
  document.getElementById('dlMd').href = URL.createObjectURL(mdBlob);

  document.getElementById('dashboard').style.display = 'block';
}

function buildMarkdown(data) {
  const lines = [
    '# Network Analysis Report',
    '',
    '## Summary',
    '',
    '| Field | Value |',
    '|---|---|',
    \`| URL | \${data.url} |\`,
    \`| Captured | \${data.captureTimestamp} |\`,
    \`| Total Requests | \${data.aggregate.totalRequests} |\`,
    \`| Total Transferred | \${fmt(data.aggregate.totalBytes)} |\`,
    \`| Page Load Duration | \${data.totalDurationMs.toFixed(0)}ms |\`,
    '',
    '## Request Breakdown by Type',
    '',
    '| Type | Count | Total Size | Avg Duration |',
    '|---|---|---|---|',
    ...data.byType.map(t => \`| \${t.resourceType} | \${t.count} | \${fmt(t.totalBytes)} | \${t.avgDurationMs.toFixed(0)}ms |\`),
    '',
    '## Slowest Requests',
    '',
    '| URL | Method | Type | Status | Size | TTFB | Duration |',
    '|---|---|---|---|---|---|---|',
    ...data.slowest.map(r => \`| \${r.url.slice(0,80)} | \${r.method} | \${r.resourceType} | \${r.failed?'FAILED':r.statusCode} | \${fmt(r.sizeBytes)} | \${r.ttfbMs.toFixed(0)}ms | \${r.durationMs.toFixed(0)}ms |\`),
    '',
    '## Errors and Failed Requests',
    '',
    data.errors.length ? [
      '| URL | Method | Type | Status | Size | TTFB | Duration |',
      '|---|---|---|---|---|---|---|',
      ...data.errors.map(r => \`| \${r.url.slice(0,80)} | \${r.method} | \${r.resourceType} | \${r.failed?'FAILED':r.statusCode} | \${fmt(r.sizeBytes)} | \${r.ttfbMs.toFixed(0)}ms | \${r.durationMs.toFixed(0)}ms |\`)
    ].join('\\n') : '_No errors._',
    '',
    '## Full Request Log',
    '',
    '| URL | Method | Type | Status | Size | TTFB | Duration |',
    '|---|---|---|---|---|---|---|',
    ...data.requests.map(r => \`| \${r.url.slice(0,80)} | \${r.method} | \${r.resourceType} | \${r.failed?'FAILED':r.statusCode} | \${fmt(r.sizeBytes)} | \${r.ttfbMs.toFixed(0)}ms | \${r.durationMs.toFixed(0)}ms |\`),
  ];
  return lines.join('\\n');
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t,i) => {
    const names = ['all','slowest','errors','waterfall'];
    t.classList.toggle('active', names[i] === name);
  });
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-'+name).classList.add('active');
}

async function analyze() {
  const url = document.getElementById('urlInput').value.trim();
  if (!url) return;

  const btn = document.getElementById('analyzeBtn');
  const status = document.getElementById('status');
  btn.disabled = true;
  status.className = '';
  status.innerHTML = '<span class="spinner"></span>Launching headless browser…';
  document.getElementById('dashboard').style.display = 'none';

  try {
    const res = await fetch('/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Analysis failed');
    status.textContent = \`Captured \${data.aggregate.totalRequests} requests in \${data.totalDurationMs.toFixed(0)}ms\`;
    render(data);
  } catch (err) {
    status.className = 'error';
    status.textContent = '✗ ' + err.message;
  } finally {
    btn.disabled = false;
  }
}

document.getElementById('urlInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') analyze();
});
</script>
</body>
</html>`;
