
window.lastData = null;

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
    securityView(data.requests, data.securityHeaders);

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

    const data =
      await window.electronAPI.analyze(url);

    status.textContent =

      `Captured ${data.aggregate.totalRequests} requests in ${data.totalDurationMs.toFixed(0)}ms`;

    render(data);

  } catch(err) {

    status.className = 'error';

    status.textContent =
      '✗ ' + (err.message || err);

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
  <div class="meta"><strong>URL:</strong> ${d.url} &nbsp;|&nbsp; <strong>Captured:</strong> ${d.captureTimestamp} &nbsp;|&nbsp; <strong>Generated:</strong> ${new Date().toISOString()}</div>
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
      <div class="card"><div class="label">Protocol</div><div class="value" style="font-size:14px">${d.tls.protocol}</div></div>
      <div class="card"><div class="label">Cert Expires</div><div class="value" style="font-size:12px;color:${d.tls.cert.daysUntilExpiry<30?'#f87171':'#34d399'}">${d.tls.cert.daysUntilExpiry}d</div></div>
    </div>
    ${d.tls.issues.length ? d.tls.issues.map(i=>`<div class="issue">⚠ ${i}</div>`).join('') : '<p style="color:#34d399">✓ No TLS issues</p>'}
  ` : `<p style="color:#f87171">${d.tls?.error||'Not available'}</p>`}
  <h2>CSP Analysis</h2>
  ${d.csp ? `<p><strong>Grade: ${d.csp.grade}</strong> — Score: ${d.csp.score}/100</p>
    ${d.csp.issues.map(i=>`<div class="issue"><strong>${i.severity.toUpperCase()}:</strong> ${i.issue} — ${i.recommendation}</div>`).join('')}
  ` : '<p>Not available</p>'}
  <h2>CORS Findings</h2>
  ${d.cors?.findings?.length ? `<table><thead><tr><th>Risk</th><th>URL</th><th>Issue</th><th>Header</th></tr></thead><tbody>
    ${d.cors.findings.map(f=>`<tr><td>${f.riskLevel.toUpperCase()}</td><td>${f.url.slice(0,60)}</td><td>${f.issue}</td><td style="font-family:monospace">${f.header}</td></tr>`).join('')}
  </tbody></table>` : '<p style="color:#34d399">✓ No CORS issues found</p>'}
  <h2>Technology Fingerprint</h2>
  ${d.fingerprint?.technologies?.length ? `<table><thead><tr><th>Technology</th><th>Category</th><th>Confidence</th><th>Evidence</th></tr></thead><tbody>
    ${d.fingerprint.technologies.map(t=>`<tr><td><strong>${t.name}</strong>${t.version?' v'+t.version:''}</td><td>${t.category}</td><td>${t.confidence}</td><td>${t.evidence.slice(0,80)}</td></tr>`).join('')}
  </tbody></table>` : '<p>No technologies detected</p>'}
  <h2>Vulnerability Scan</h2>
  ${d.vuln ? (() => { const all = Object.values(d.vuln.findings).flat();
    return all.length ? `<table><thead><tr><th>Severity</th><th>Type</th><th>URL</th><th>Description</th></tr></thead><tbody>
      ${all.map(f=>`<tr><td>${f.severity.toUpperCase()}</td><td style="color:#f87171;font-weight:700">${f.type}</td><td style="font-family:monospace">${f.url.slice(0,60)}</td><td>${f.description}</td></tr>`).join('')}
    </tbody></table>` : `<p style="color:#34d399">✓ No vulnerabilities detected (${d.vuln.scannedEndpoints} endpoints scanned)</p>`;
  })() : '<p>Not available</p>'}
  <h2>Full Request Log</h2>
  <table><thead><tr><th>URL</th><th>Method</th><th>Type</th><th>Status</th><th>Size</th><th>TTFB</th><th>Duration</th></tr></thead><tbody>
  ${(d.requests||[]).map(r=>`<tr>
    <td style="font-family:monospace">${r.url.slice(0,70)}</td>
    <td>${r.method}</td><td>${r.resourceType}</td>
    <td>${r.failed?'FAILED':r.statusCode||'—'}</td>
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

