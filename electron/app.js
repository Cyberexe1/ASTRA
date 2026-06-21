
window.lastData = null;

// HTML-escape untrusted scan data before embedding it in the PDF template.
function escHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Store last-scanned URL so re-scan and history work
window.lastScanUrl = null;
window.lastScanOptions = null;

function reScan() {
  if (!window.lastScanUrl) return;
  document.getElementById('urlInput').value = window.lastScanUrl;
  if (window.lastScanOptions?.activeScan) {
    document.getElementById('activeScanToggle').checked = true;
  }
  analyze();
}

// ── Actionable error messages ──────────────────────────────────────────────────
function friendlyError(err) {
  const msg = (err && err.message) ? err.message : String(err);
  if (/net::ERR_|ENOTFOUND|getaddrinfo|ETIMEDOUT|ECONNREFUSED/i.test(msg)) {
    return '✗ Could not reach the URL — check the address and your internet connection.';
  }
  if (/TimeoutError|timeout/i.test(msg)) {
    return '✗ Page took too long to load. Try again or check if the site is accessible.';
  }
  if (/Invalid URL|Unsupported scheme/i.test(msg)) {
    return '✗ ' + msg + ' — enter a full URL starting with https://';
  }
  return '✗ ' + msg;
}

function friendlyRepoError(err) {
  const msg = (err && err.message) ? err.message : String(err);
  if (/not found|404/i.test(msg)) {
    return '✗ Repository not found. Check the URL — if it\'s a private repo, add a GitHub token in Settings.';
  }
  if (/rate limit|403/i.test(msg)) {
    return '✗ GitHub API rate limit hit. Add a GitHub token in Settings to get 5,000 requests/hour.';
  }
  if (/git.*not.*found|git.*installed|ENOENT.*git/i.test(msg)) {
    return '✗ Advanced mode requires git to be installed. Install git and try again, or switch to Basic mode.';
  }
  if (/timeout/i.test(msg)) {
    return '✗ Timed out fetching the repository. The repo may be very large — try Basic mode.';
  }
  return '✗ ' + msg;
}

// ── Scan history ───────────────────────────────────────────────────────────────
async function refreshHistoryPanel() {
  const list = document.getElementById('historyList');
  if (!list) return;
  let history = [];
  try { history = await window.electronAPI.getHistory(); } catch { return; }

  if (!history.length) {
    list.innerHTML = '<div style="color:var(--muted);font-size:0.8rem;text-align:center;padding:12px">No scans yet</div>';
    return;
  }

  list.innerHTML = history.slice(0, 20).map(h => `
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;display:flex;align-items:center;gap:8px">
      <span style="font-size:0.8rem">${h.type === 'repo' ? '📦' : '🌐'}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:0.78rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(h.url)}">${escHtml(h.url)}</div>
        <div style="font-size:0.7rem;color:var(--muted)">${new Date(h.timestamp).toLocaleString()}</div>
      </div>
      <button onclick="rescanFromHistory('${escHtml(h.type)}','${escHtml(h.url)}')"
              style="background:var(--accent);color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:0.72rem;cursor:pointer;white-space:nowrap">
        Re-scan
      </button>
      <button onclick="deleteHistoryEntry('${escHtml(h.id)}')"
              style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:1rem;padding:2px 4px">✕</button>
    </div>`).join('');
}

function rescanFromHistory(type, url) {
  toggleSettings();
  if (type === 'repo') {
    showRepoMode();
    document.getElementById('repoInput').value = url;
    setTimeout(() => analyzeRepo(), 100);
  } else {
    showWebsiteMode();
    document.getElementById('urlInput').value = url;
    setTimeout(() => analyze(), 100);
  }
}

async function deleteHistoryEntry(id) {
  try { await window.electronAPI.deleteHistoryEntry(id); } catch { /* ignore */ }
  await refreshHistoryPanel();
}

async function clearAllHistory() {
  try { await window.electronAPI.clearHistory(); } catch { /* ignore */ }
  await refreshHistoryPanel();
}

async function saveGithubToken() {
  const input = document.getElementById('githubTokenInput');
  const status = document.getElementById('githubTokenStatus');
  const val = input.value.trim();
  if (!val || val.startsWith('•')) return;
  status.innerHTML = '<span style="color:var(--muted)">Saving…</span>';
  try {
    await window.electronAPI.saveGithubToken(val);
    input.value = '•'.repeat(20);
    status.innerHTML = '<span style="color:var(--green)">✓ GitHub token saved</span>';
  } catch (e) {
    status.innerHTML = '<span style="color:var(--red)">✗ Failed to save token</span>';
  }
}

function render(data) {

  window.lastData = data;

  document.getElementById('cards').innerHTML = [

    {
      label: 'Total Requests',
      value: data.aggregate.totalRequests,
      sub: data.url
    },

    {
      label: 'Transferred',
      value: fmt(data.aggregate.totalBytes),
      sub: 'total size'
    },

    {
      label: 'Page Load',
      value: data.totalDurationMs.toFixed(0) + 'ms',
      sub: 'to network idle'
    },

    {
      label: 'Errors',
      value: data.errors.length,
      sub: data.errors.length
        ? '⚠ see errors tab'
        : '✓ clean'
    },

  ].map(c => `
    <div class="card">

      <div class="label">
        ${c.label}
      </div>

      <div class="value">
        ${c.value}
      </div>

      <div class="sub">
        ${c.sub}
      </div>

    </div>
  `).join('');

  const maxCount = Math.max(
    ...data.byType.map(t => t.count),
    1
  );

  document.getElementById('typeCount').textContent =
    data.byType.length + ' types';

  document.getElementById('typeGrid').innerHTML =

    `<div class="type-row"
      style="
        font-size:0.7rem;
        color:var(--muted);
        text-transform:uppercase;
        letter-spacing:.06em
      ">

      <div>Type</div>
      <div>Requests</div>
      <div>Count</div>
      <div>Size</div>
      <div>Avg</div>

    </div>`

    +

    data.byType

      .sort((a,b)=>b.count-a.count)

      .map(t => `

        <div class="type-row">

          <div class="name">
            ${t.resourceType}
          </div>

          <div class="bar-wrap">

            <div
              class="bar"
              style="
                width:${(t.count/maxCount*100).toFixed(1)}%
              ">
            </div>

          </div>

          <div class="num">
            ${t.count}
          </div>

          <div class="num">
            ${fmt(t.totalBytes)}
          </div>

          <div class="num">
            ${t.avgDurationMs.toFixed(0)}ms
          </div>

        </div>

      `).join('');

  document.getElementById('tab-all').innerHTML =
    requestTable(data.requests);

  document.getElementById('tab-slowest').innerHTML =
    requestTable(data.slowest);

  document.getElementById('tab-errors').innerHTML =
    requestTable(data.errors);

  document.getElementById('tab-waterfall').innerHTML =

    waterfallView(
      [...data.requests]
        .sort((a,b)=>b.durationMs-a.durationMs)
        .slice(0,60)
    );

  document.getElementById('tab-security').innerHTML =
    securityView(data.requests, data.securityHeaders, data.mixedContent);

  document.getElementById('tab-cookies').innerHTML =
    cookiesView(data.requests, data.cookieIssues);

  document.getElementById('tab-tls').innerHTML =
    tlsView(data.tls);

  document.getElementById('tab-cors').innerHTML =
    corsView(data.cors);

  document.getElementById('tab-api').innerHTML =
    apiView(data.api);

  document.getElementById('tab-fingerprint').innerHTML =
    fingerprintView(data.fingerprint);

  document.getElementById('tab-dns').innerHTML =
    dnsView(data.dns);

  document.getElementById('tab-csp').innerHTML =
    cspView(data.csp);

  document.getElementById('tab-vuln').innerHTML =
    vulnView(data.vuln);

  document.getElementById('tab-ai').innerHTML = '';

  renderAiTab();

  document.getElementById('dashboard').style.display =
    'block';

  if (window.geminiApiKey) {

    setTimeout(() => {

      runAiAnalysis();

    }, 300);
  }
}

function switchTab(name) {

  const names = [
    'all',
    'slowest',
    'errors',
    'waterfall',
    'security',
    'cookies',
    'tls',
    'cors',
    'api',
    'fingerprint',
    'dns',
    'csp',
    'vuln',
    'ai'
  ];

  document.querySelectorAll('.tab')

    .forEach((t,i) => {

      t.classList.toggle(
        'active',
        names[i] === name
      );

    });

  document.querySelectorAll('.tab-panel')

    .forEach(p => {

      p.classList.remove('active');

    });

  document.getElementById('tab-' + name)
    .classList.add('active');
}

async function analyze() {

  const url =
    document.getElementById('urlInput')
      .value
      .trim();

  if (!url) {
    return;
  }

  const btn =
    document.getElementById('analyzeBtn');

  const status =
    document.getElementById('status');

  btn.disabled = true;

  status.className = '';

  status.innerHTML =
    '<span class="spinner"></span>Launching headless browser…';

  document.getElementById('dashboard').style.display =
    'none';

  try {

    const activeScan =
      document.getElementById('activeScanToggle')?.checked === true;

    const data =
      await window.electronAPI.analyze(url, { activeScan });

    // Persist URL for re-scan and history
    window.lastScanUrl = url;
    window.lastScanOptions = { activeScan };

    status.textContent =

      `Captured ${data.aggregate.totalRequests} requests in ${data.totalDurationMs.toFixed(0)}ms`;

    render(data);

    // Refresh history panel if settings are open
    refreshHistoryPanel().catch(() => {});

  } catch(err) {

    status.className = 'error';

    status.textContent = friendlyError(err);

  } finally {

    btn.disabled = false;
  }
}

function downloadHar() {

  if (!window.lastData) {
    return;
  }

  const blob = new Blob(

    [
      JSON.stringify(
        window.lastData.har,
        null,
        2
      )
    ],

    {
      type:'application/json'
    }
  );

  const a =
    document.createElement('a');

  a.href =
    URL.createObjectURL(blob);

  a.download = 'capture.har';

  a.click();
}

function downloadMarkdown() {

  if (!window.lastData) {
    return;
  }

  const d = window.lastData;

  const lines = [

    '# Network Analysis Report',
    '',

    '## Summary',
    '',

    '| Field | Value |',
    '|---|---|',

    `| URL | ${d.url} |`,
    `| Captured | ${d.captureTimestamp} |`,
    `| Total Requests | ${d.aggregate.totalRequests} |`,
    `| Total Transferred | ${fmt(d.aggregate.totalBytes)} |`,
    `| Page Load Duration | ${d.totalDurationMs.toFixed(0)}ms |`,

    '',

    '## Request Breakdown by Type',
    '',

    '| Type | Count | Total Size | Avg Duration |',
    '|---|---|---|---|',

    ...d.byType.map(t => `
| ${t.resourceType}
| ${t.count}
| ${fmt(t.totalBytes)}
| ${t.avgDurationMs.toFixed(0)}ms |
`),

    '',

    '## Full Request Log',
    '',

    '| URL | Method | Type | Status | Size | TTFB | Duration |',
    '|---|---|---|---|---|---|---|',

    ...d.requests.map(r => `
| ${r.url.slice(0,80)}
| ${r.method}
| ${r.resourceType}
| ${r.failed ? 'FAILED' : r.statusCode}
| ${fmt(r.sizeBytes)}
| ${r.ttfbMs.toFixed(0)}ms
| ${r.durationMs.toFixed(0)}ms |
`)
  ];

  const blob = new Blob(

    [lines.join('\n')],

    {
      type:'text/markdown'
    }
  );

  const a =
    document.createElement('a');

  a.href =
    URL.createObjectURL(blob);

  a.download = 'report.md';

  a.click();
}

async function downloadPdf() {
  if (!window.lastData) return;
  const btn = document.getElementById('pdfBtn');
  btn.textContent = 'Generating…';
  btn.disabled = true;
  const d = window.lastData;
  const sevColor = {critical:'#f87171',high:'#f87171',medium:'#fbbf24',low:'#8892b0'};
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
  <style>
    body{font-family:system-ui,sans-serif;font-size:11px;color:#1a1a2e;margin:0;padding:24px}
    h1{font-size:20px;margin-bottom:4px}h2{font-size:14px;margin:20px 0 8px;border-bottom:2px solid #6c8ef5;padding-bottom:4px}
    h3{font-size:12px;margin:14px 0 6px}
    table{width:100%;border-collapse:collapse;margin-bottom:12px;font-size:10px}
    th{background:#22263a;color:#e2e8f0;padding:5px 8px;text-align:left;font-size:9px;text-transform:uppercase}
    td{padding:4px 8px;border-bottom:1px solid #e2e8f0;vertical-align:top;word-break:break-all}
    tr:nth-child(even) td{background:#f8f9ff}
    .pill{display:inline-block;padding:1px 6px;border-radius:10px;font-size:9px;font-weight:700}
    .card-row{display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap}
    .card{background:#f0f2ff;border:1px solid #c7d0f8;border-radius:8px;padding:10px 14px;min-width:120px}
    .card .label{font-size:8px;text-transform:uppercase;color:#8892b0}
    .card .value{font-size:18px;font-weight:800}
    .meta{color:#8892b0;font-size:10px;margin-bottom:20px}
    .issue{padding:6px 8px;border-left:3px solid #f87171;background:#fff5f5;margin-bottom:6px;border-radius:0 4px 4px 0}
    pre{background:#f0f2ff;padding:8px;border-radius:4px;font-size:9px;white-space:pre-wrap;word-break:break-all}
    @media print{body{padding:0}}
  </style></head><body>
  <h1>ASTRA — Security Analysis Report</h1>
  <div class="meta"><strong>URL:</strong> ${escHtml(d.url)} &nbsp;|&nbsp; <strong>Captured:</strong> ${escHtml(d.captureTimestamp)} &nbsp;|&nbsp; <strong>Generated:</strong> ${escHtml(new Date().toISOString())}</div>
  <h2>Summary</h2>
  <div class="card-row">
    <div class="card"><div class="label">Total Requests</div><div class="value">${d.aggregate.totalRequests}</div></div>
    <div class="card"><div class="label">Transferred</div><div class="value">${fmt(d.aggregate.totalBytes)}</div></div>
    <div class="card"><div class="label">Page Load</div><div class="value">${d.totalDurationMs.toFixed(0)}ms</div></div>
    <div class="card"><div class="label">Errors</div><div class="value" style="color:${d.errors.length?'#f87171':'#34d399'}">${d.errors.length}</div></div>
    ${d.vuln ? `<div class="card"><div class="label">Vuln Findings</div><div class="value" style="color:${Object.values(d.vuln.findings).flat().length?'#f87171':'#34d399'}">${Object.values(d.vuln.findings).flat().length}</div></div>` : ''}
  </div>
  <h2>TLS / SSL</h2>
  ${d.tls && !d.tls.error ? `
    <div class="card-row">
      <div class="card"><div class="label">Grade</div><div class="value" style="color:${{'A+':'#34d399','A':'#34d399','B':'#fbbf24','C':'#fbbf24','F':'#f87171'}[d.tls.grade]||'#8892b0'}">${d.tls.grade}</div></div>
      <div class="card"><div class="label">Protocol</div><div class="value" style="font-size:14px">${escHtml(d.tls.protocol)}</div></div>
      <div class="card"><div class="label">Cert Expires</div><div class="value" style="font-size:12px;color:${d.tls.cert.daysUntilExpiry<30?'#f87171':'#34d399'}">${escHtml(d.tls.cert.daysUntilExpiry)}d</div></div>
    </div>
    ${d.tls.issues.length ? d.tls.issues.map(i=>`<div class="issue">⚠ ${escHtml(typeof i === 'string' ? i : i.issue)}</div>`).join('') : '<p style="color:#34d399">✓ No TLS issues</p>'}
  ` : `<p style="color:#f87171">${escHtml(d.tls?.error||'Not available')}</p>`}
  <h2>CSP Analysis</h2>
  ${d.csp ? `<p><strong>Grade: ${escHtml(d.csp.grade)}</strong> — Score: ${escHtml(d.csp.score)}/100</p>
    ${d.csp.issues.map(i=>`<div class="issue"><strong>${escHtml((i.severity||'').toUpperCase())}:</strong> ${escHtml(i.issue)} — ${escHtml(i.recommendation)}</div>`).join('')}
  ` : '<p>Not available</p>'}
  <h2>CORS Findings</h2>
  ${d.cors?.findings?.length ? `<table><thead><tr><th>Risk</th><th>URL</th><th>Issue</th><th>Header</th></tr></thead><tbody>
    ${d.cors.findings.map(f=>`<tr><td>${escHtml((f.riskLevel||'').toUpperCase())}</td><td>${escHtml(f.url.slice(0,60))}</td><td>${escHtml(f.issue)}</td><td style="font-family:monospace">${escHtml(f.header)}</td></tr>`).join('')}
  </tbody></table>` : '<p style="color:#34d399">✓ No CORS issues found</p>'}
  <h2>Technology Fingerprint</h2>
  ${d.fingerprint?.technologies?.length ? `<table><thead><tr><th>Technology</th><th>Category</th><th>Confidence</th><th>Evidence</th></tr></thead><tbody>
    ${d.fingerprint.technologies.map(t=>`<tr><td><strong>${escHtml(t.name)}</strong>${t.version?' v'+escHtml(t.version):''}</td><td>${escHtml(t.category)}</td><td>${escHtml(t.confidence)}</td><td>${escHtml(t.evidence.slice(0,80))}</td></tr>`).join('')}
  </tbody></table>` : '<p>No technologies detected</p>'}
  <h2>Vulnerability Scan</h2>
  ${d.vuln ? (d.vuln.skipped ? '<p style="color:#8892b0">Active scan not run (disabled by default — enable in Settings for authorized targets).</p>' : (() => { const all = Object.values(d.vuln.findings).flat();
    return all.length ? `<table><thead><tr><th>Severity</th><th>Type</th><th>URL</th><th>Description</th></tr></thead><tbody>
      ${all.map(f=>`<tr><td>${escHtml((f.severity||'').toUpperCase())}</td><td style="color:#f87171;font-weight:700">${escHtml(f.type)}</td><td style="font-family:monospace">${escHtml(f.url.slice(0,60))}</td><td>${escHtml(f.description)}</td></tr>`).join('')}
    </tbody></table>` : `<p style="color:#34d399">✓ No vulnerabilities detected (${escHtml(d.vuln.scannedEndpoints)} endpoints scanned)</p>`;
  })()) : '<p>Not available</p>'}
  <h2>Full Request Log</h2>
  <table><thead><tr><th>URL</th><th>Method</th><th>Type</th><th>Status</th><th>Size</th><th>TTFB</th><th>Duration</th></tr></thead><tbody>
  ${(d.requests||[]).map(r=>`<tr>
    <td style="font-family:monospace">${escHtml(r.url.slice(0,70))}</td>
    <td>${escHtml(r.method)}</td><td>${escHtml(r.resourceType)}</td>
    <td>${escHtml(r.failed?'FAILED':r.statusCode||'—')}</td>
    <td>${fmt(r.sizeBytes)}</td><td>${r.ttfbMs.toFixed(0)}ms</td><td>${r.durationMs.toFixed(0)}ms</td>
  </tr>`).join('')}
  </tbody></table>
  </body></html>`;
  try {
    const result = await window.electronAPI.exportPdf(html);
    if (!result.canceled) {
      const s = document.getElementById('status');
      s.className = '';
      s.textContent = `PDF saved to ${result.filePath}`;
    }
  } catch(err) {
    alert('PDF export failed: ' + err.message);
  } finally {
    btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><rect x="2" y="1" width="10" height="12" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M4 4h6M4 7h6M4 10h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg> Download PDF';
    btn.disabled = false;
  }
}

document.getElementById('urlInput')

  .addEventListener('keydown', e => {

    if (e.key === 'Enter') {

      analyze();
    }
  });



// ─── Repo Analyzer ────────────────────────────────────────────────────────────

function showRepoMode() {
  document.getElementById('websiteHero').style.display = 'none';
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('repoHero').style.display = 'flex';
  const existing = document.getElementById('repoResults');
  if (existing && existing.innerHTML.trim()) existing.style.display = 'block';
  if (window.repoAdvanced === undefined) setRepoMode(false);
  document.getElementById('repoInput')?.focus();
}

function showWebsiteMode() {
  document.getElementById('repoHero').style.display = 'none';
  document.getElementById('repoResults').style.display = 'none';
  document.getElementById('websiteHero').style.display = 'flex';
  document.getElementById('urlInput')?.focus();
}

function setRepoMode(advanced) {
  window.repoAdvanced = advanced === true;

  const basic = document.getElementById('modeBasic');
  const adv = document.getElementById('modeAdvanced');
  const text = document.getElementById('advancedModeText');
  const btn = document.getElementById('repoAnalyzeBtn');

  // Active pill styling
  if (basic && adv) {
    if (window.repoAdvanced) {
      adv.style.background = 'var(--accent)';
      adv.style.color = '#fff';
      adv.setAttribute('aria-selected', 'true');
      basic.style.background = 'transparent';
      basic.style.color = 'var(--muted2)';
      basic.setAttribute('aria-selected', 'false');
    } else {
      basic.style.background = 'var(--accent)';
      basic.style.color = '#fff';
      basic.setAttribute('aria-selected', 'true');
      adv.style.background = 'transparent';
      adv.style.color = 'var(--muted2)';
      adv.setAttribute('aria-selected', 'false');
    }
  }

  if (text) {
    text.innerHTML = window.repoAdvanced
      ? '<strong style="color:var(--accent2)">Advanced mode</strong> — full <code>git clone</code> including ' +
        '<strong>git history</strong> secret scanning (requires git installed; slower on large repos).'
      : '<strong style="color:var(--text)">Basic mode</strong> — fast GitHub API snapshot scan of current files (no git required).';
  }

  if (btn) btn.textContent = window.repoAdvanced ? 'Deep Scan' : 'Scan Repo';
}

async function analyzeRepo() {
  const url = document.getElementById('repoInput').value.trim();
  if (!url) return;

  const advanced = window.repoAdvanced === true;
  const btn = document.getElementById('repoAnalyzeBtn');
  const status = document.getElementById('repoStatus');
  const results = document.getElementById('repoResults');

  btn.disabled = true;
  status.innerHTML = '<span class="spinner"></span>' +
    (advanced ? 'Cloning repository and scanning git history…' : 'Fetching repository from GitHub…');
  results.style.display = 'none';

  try {
    const data = await window.electronAPI.analyzeRepo(url, { advanced });
    window.lastRepoData = data;
    status.innerHTML = '<span style="color:var(--green)">✓</span> <span>Scanned ' +
      data.fileCount + ' files' + (data.historyCommits ? ' across ' + data.historyCommits + ' commits' : '') +
      ' — ' + data.summary.total + ' findings</span>';
    results.innerHTML = repoView(data);
    results.style.display = 'block';
    refreshHistoryPanel().catch(() => {});
  } catch (err) {
    status.innerHTML = '<span style="color:var(--red)">' + escHtml(friendlyRepoError(err)) + '</span>';
  } finally {
    btn.disabled = false;
  }
}

document.getElementById('repoInput')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') analyzeRepo();
});
