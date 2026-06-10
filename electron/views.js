
function fmt(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(1) + ' GB';
}

function statusPill(req) {
  if (req.failed) {
    return '<span class="pill pill-err">FAILED</span>';
  }

  const s = req.statusCode;

  if (!s) {
    return '<span class="pill pill-err">—</span>';
  }

  const cls =
    s >= 500
      ? 'pill-5xx'
      : s >= 400
      ? 'pill-4xx'
      : s >= 300
      ? 'pill-3xx'
      : 'pill-2xx';

  return `<span class="pill ${cls}">${s}</span>`;
}

function typePill(t) {
  return `<span class="pill pill-type">${t}</span>`;
}

function trunc(s, n = 60) {
  return s.length > n
    ? s.slice(0, n) + '…'
    : s;
}

function requestTable(rows) {
  if (!rows.length) {
    return `
      <p style="color:var(--muted);padding:16px 0">
        None
      </p>
    `;
  }

  return `
    <div class="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th>URL</th>
            <th>Method</th>
            <th>Type</th>
            <th>Status</th>
            <th>Size</th>
            <th>TTFB</th>
            <th>Duration</th>
          </tr>
        </thead>

        <tbody>
          ${rows.map(r => `
            <tr>
              <td class="url-cell" title="${r.url}">
                ${trunc(r.url)}
              </td>

              <td>${r.method}</td>

              <td>
                ${typePill(r.resourceType)}
              </td>

              <td>
                ${statusPill(r)}
              </td>

              <td>
                ${fmt(r.sizeBytes)}
              </td>

              <td>
                ${r.ttfbMs.toFixed(0)}ms
              </td>

              <td>
                ${r.durationMs.toFixed(0)}ms
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function waterfallView(requests) {
  if (!requests.length) {
    return `
      <p style="color:var(--muted);padding:16px 0">
        None
      </p>
    `;
  }

  const maxDur = Math.max(
    ...requests.map(r => r.durationMs),
    1
  );

  return `
    <div style="margin-bottom:8px;font-size:0.73rem;color:var(--muted)">
      <span style="color:var(--yellow)">■</span>
      TTFB

      &nbsp;

      <span style="color:var(--accent)">■</span>
      Receive
    </div>

    <div class="waterfall-wrap">
      ${requests.map(r => {

        const tp =
          (r.ttfbMs / maxDur * 100).toFixed(1);

        const rp =
          (
            Math.max(0, r.durationMs - r.ttfbMs)
            / maxDur
            * 100
          ).toFixed(1);

        return `
          <div class="waterfall-row">

            <div class="wf-label" title="${r.url}">
              ${trunc(r.url, 36)}
            </div>

            <div class="wf-bar-wrap">

              <div
                class="wf-bar wf-ttfb"
                style="width:${tp}%">
              </div>

              <div
                class="wf-bar wf-recv"
                style="left:${tp}%;width:${rp}%">
              </div>

            </div>

            <div class="wf-dur">
              ${r.durationMs.toFixed(0)}ms
            </div>

          </div>
        `;
      }).join('')}
    </div>
  `;
}

function securityView(requests, securityHeaders) {

  const doc =
    requests.find(
      r => r.resourceType === 'document'
    ) || requests[0];

  if (!doc) {
    return `<p style="color:var(--muted);padding:16px 0">No data</p>`;
  }

  const h = doc.responseHeaders || {};
  const lh = Object.fromEntries(
    Object.entries(h).map(([k,v]) => [k.toLowerCase(), v])
  );

  // Core header checks — shown as a visual grid
  const checks = [
    { name: 'Strict-Transport-Security', key: 'strict-transport-security', good: v => !!v },
    { name: 'Content-Security-Policy',   key: 'content-security-policy',   good: v => !!v },
    { name: 'X-Frame-Options',           key: 'x-frame-options',           good: v => !!v },
    { name: 'X-Content-Type-Options',    key: 'x-content-type-options',    good: v => v === 'nosniff' },
    { name: 'Referrer-Policy',           key: 'referrer-policy',           good: v => !!v },
    { name: 'Permissions-Policy',        key: 'permissions-policy',        good: v => !!v },
    { name: 'Cross-Origin-Opener-Policy',key: 'cross-origin-opener-policy',good: v => !!v },
    { name: 'Cache-Control',             key: 'cache-control',             good: v => !!v },
  ];

  const cards = checks.map(c => {
    const val = lh[c.key];
    const present = !!val;
    const ok = present && c.good(val);
    const dot = ok ? 'dot-green' : present ? 'dot-yellow' : 'dot-red';
    return `<div class="sec-card">
      <div class="sec-title"><div class="dot ${dot}"></div>${c.name}</div>
      <div class="sec-row">
        <span>${present ? 'Present' : 'Missing'}</span>
        <span class="sec-val" title="${val || ''}">${val || '—'}</span>
      </div>
    </div>`;
  });

  // Backend-analyzed security header findings (from analyzeSecurityHeaders)
  const sevColor = {critical:'var(--red)', high:'var(--red)', medium:'var(--yellow)', low:'var(--muted)'};
  const backendFindings = securityHeaders && securityHeaders.length
    ? `<div style="margin-bottom:20px">
        <div style="font-size:0.78rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">
          Security Header Issues (${securityHeaders.length})
        </div>
        <div class="tbl-wrap"><table>
          <thead><tr><th>Severity</th><th>Header</th><th>Issue</th><th>Fix</th></tr></thead>
          <tbody>${securityHeaders.map(f => `<tr>
            <td><span class="pill" style="background:${sevColor[f.severity]}22;color:${sevColor[f.severity]}">${f.severity.toUpperCase()}</span></td>
            <td style="font-family:monospace;font-size:0.75rem;color:var(--accent2)">${f.header}</td>
            <td style="font-size:0.8rem;font-weight:600">${f.issue}</td>
            <td style="font-size:0.76rem;color:var(--muted)">${f.recommendation}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>`
    : '<p style="color:var(--green);margin-bottom:16px">✓ All checked security headers are present</p>';

  const allHeaders = Object.entries(lh)
    .map(([k,v]) => `<tr>
      <td style="font-family:monospace;font-size:0.75rem;color:var(--accent2)">${k}</td>
      <td style="font-family:monospace;font-size:0.73rem;word-break:break-all">${v}</td>
    </tr>`).join('');

  return `
    <div class="security-grid">${cards.join('')}</div>
    <div style="margin-top:20px">${backendFindings}</div>
    <div style="margin-top:20px">
      <div style="font-size:0.78rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">All Response Headers</div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Header</th><th>Value</th></tr></thead>
        <tbody>${allHeaders}</tbody>
      </table></div>
    </div>`;
}


function cookiesView(requests, cookieIssues) {
  const cookieRows = [];
  for (const r of requests) {
    const setCookie = r.responseHeaders?.['set-cookie'] || r.responseHeaders?.['Set-Cookie'];
    if (setCookie) {
      const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
      for (const c of cookies) {
        const parts = c.split(';').map(p => p.trim());
        const [nameVal, ...attrs] = parts;
        const [name, ...valParts] = nameVal.split('=');
        const attrMap = Object.fromEntries(attrs.map(a => {
          const [k, ...v] = a.split('=');
          return [k.toLowerCase(), v.join('=') || true];
        }));
        cookieRows.push({
          url: r.url, name: name?.trim(),
          value: valParts.join('=').slice(0,40),
          secure: !!attrMap['secure'],
          httpOnly: !!attrMap['httponly'],
          sameSite: attrMap['samesite'] || '—',
          path: attrMap['path'] || '/',
        });
      }
    }
  }

  const sevColor = {critical:'var(--red)', high:'var(--red)', medium:'var(--yellow)', low:'var(--muted)'};
  const issuesSection = cookieIssues && cookieIssues.length
    ? `<div style="margin-bottom:20px">
        <div style="font-size:0.78rem;color:var(--red);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">
          ⚠ Cookie Security Issues (${cookieIssues.length})
        </div>
        <div class="tbl-wrap"><table>
          <thead><tr><th>Severity</th><th>Cookie Name</th><th>Issue</th></tr></thead>
          <tbody>${cookieIssues.map(i => `<tr>
            <td><span class="pill" style="background:${sevColor[i.severity]}22;color:${sevColor[i.severity]}">${i.severity.toUpperCase()}</span></td>
            <td style="font-family:monospace;font-weight:700">${i.name}</td>
            <td style="font-size:0.8rem">${i.issue}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>`
    : cookieRows.length ? '<p style="color:var(--green);margin-bottom:16px">✓ All cookies have correct security flags</p>' : '';

  if (!cookieRows.length) return `${issuesSection}<p style="color:var(--muted);padding:16px 0">No Set-Cookie headers found.</p>`;

  return `${issuesSection}<div class="tbl-wrap"><table>
    <thead><tr><th>Name</th><th>Value</th><th>Secure</th><th>HttpOnly</th><th>SameSite</th><th>Path</th><th>Source URL</th></tr></thead>
    <tbody>${cookieRows.map(c => `<tr>
      <td style="font-weight:600">${c.name}</td>
      <td style="font-family:monospace;font-size:0.74rem">${c.value}</td>
      <td>${c.secure ? '<span class="pill pill-2xx">✓</span>' : '<span class="pill pill-err">✗</span>'}</td>
      <td>${c.httpOnly ? '<span class="pill pill-2xx">✓</span>' : '<span class="pill pill-err">✗</span>'}</td>
      <td>${c.sameSite}</td><td>${c.path}</td>
      <td class="url-cell" title="${c.url}">${trunc(c.url, 40)}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function tlsView(tls) {
  if (!tls) return '<p style="color:var(--muted);padding:16px 0">No TLS data.</p>';
  if (tls.error) return `<p style="color:var(--red);padding:16px 0">✗ ${tls.error}</p>`;
  const gradeColor = {'A+':'var(--green)','A':'var(--green)','B':'var(--yellow)','C':'var(--yellow)','F':'var(--red)'}[tls.grade] || 'var(--muted)';
  const sevColor = {critical:'var(--red)', high:'var(--red)', medium:'var(--yellow)', low:'var(--muted)'};
  // tls.issues is now [{severity, issue}] — handle both old string format and new object format
  const issuesHtml = tls.issues && tls.issues.length
    ? tls.issues.map(i => {
        const text = typeof i === 'string' ? i : i.issue;
        const sev  = typeof i === 'string' ? 'high' : i.severity;
        const color = sevColor[sev] || 'var(--muted)';
        return `<div style="color:${color};font-size:0.8rem;padding:3px 0">⚠ ${text}</div>`;
      }).join('')
    : '<div style="color:var(--green);font-size:0.8rem">✓ No issues found</div>';
  const httpRedirectRow = tls.httpRedirectsToHttps !== undefined
    ? `<div class="sec-row"><span>HTTP→HTTPS Redirect</span><span class="sec-val" style="color:${tls.httpRedirectsToHttps?'var(--green)':'var(--red)'}">${tls.httpRedirectsToHttps ? '✓ Yes' : '✗ No'}</span></div>`
    : '';
  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
    <div class="sec-card">
      <div class="sec-title">TLS Grade</div>
      <div style="font-size:3rem;font-weight:900;color:${gradeColor};line-height:1">${tls.grade}</div>
      <div style="margin-top:12px">${issuesHtml}</div>
    </div>
    <div class="sec-card">
      <div class="sec-title">Connection</div>
      <div class="sec-row"><span>Protocol</span><span class="sec-val">${tls.protocol}</span></div>
      <div class="sec-row"><span>Cipher</span><span class="sec-val">${tls.cipher}</span></div>
      <div class="sec-row"><span>Key Bits</span><span class="sec-val">${tls.cipherBits}</span></div>
      <div class="sec-row"><span>HSTS</span><span class="sec-val" style="color:${tls.hstsPresent?'var(--green)':'var(--red)'}">${tls.hstsPresent ? '✓ Present' : '✗ Missing'}</span></div>
      <div class="sec-row"><span>HSTS Max-Age</span><span class="sec-val">${tls.hstsMaxAge ? tls.hstsMaxAge+'s' : '—'}</span></div>
      <div class="sec-row"><span>includeSubDomains</span><span class="sec-val">${tls.hstsIncludeSubdomains ? '✓' : '✗'}</span></div>
      <div class="sec-row"><span>Preload</span><span class="sec-val">${tls.hstsPreload ? '✓' : '✗'}</span></div>
      ${httpRedirectRow}
    </div>
    <div class="sec-card" style="grid-column:1/-1">
      <div class="sec-title">Certificate</div>
      <div class="sec-row"><span>Subject</span><span class="sec-val">${tls.cert.subject}</span></div>
      <div class="sec-row"><span>Issuer</span><span class="sec-val">${tls.cert.issuer}</span></div>
      <div class="sec-row"><span>Valid From</span><span class="sec-val">${new Date(tls.cert.validFrom).toLocaleDateString()}</span></div>
      <div class="sec-row"><span>Valid To</span><span class="sec-val" style="color:${tls.cert.daysUntilExpiry < 30 ? 'var(--red)' : 'inherit'}">${new Date(tls.cert.validTo).toLocaleDateString()} (${tls.cert.daysUntilExpiry}d)</span></div>
      <div class="sec-row"><span>Self-Signed</span><span class="sec-val">${tls.cert.selfSigned ? '⚠ Yes' : '✓ No'}</span></div>
      <div class="sec-row"><span>Fingerprint</span><span class="sec-val" style="font-size:0.68rem">${tls.cert.fingerprint}</span></div>
      <div class="sec-row"><span>SANs</span><span class="sec-val">${tls.cert.subjectAltNames.slice(0,5).join(', ')}${tls.cert.subjectAltNames.length > 5 ? ` +${tls.cert.subjectAltNames.length-5} more` : ''}</span></div>
    </div>
  </div>`;
}

function corsView(cors) {
  if (!cors || !cors.findings) return '<p style="color:var(--muted);padding:16px 0">No CORS data.</p>';
  const { findings, summary } = cors;
  const summaryHtml = `<div style="display:flex;gap:12px;margin-bottom:16px">
    ${[['critical','var(--red)'],['high','var(--red)'],['medium','var(--yellow)'],['low','var(--muted)']].map(([level, color]) =>
      `<div class="card" style="min-width:100px"><div class="label">${level}</div><div class="value" style="color:${color}">${summary[level]||0}</div></div>`).join('')}
  </div>`;
  if (!findings.length) return summaryHtml + '<p style="color:var(--green);padding:8px 0">✓ No CORS issues found.</p>';
  const riskColor = {'critical':'var(--red)','high':'var(--red)','medium':'var(--yellow)','low':'var(--muted)','info':'var(--muted)'};
  const rows = findings.map(f => `<tr>
    <td><span class="pill" style="background:${riskColor[f.riskLevel]}22;color:${riskColor[f.riskLevel]}">${f.riskLevel.toUpperCase()}</span></td>
    <td class="url-cell" title="${f.url}">${trunc(f.url)}</td>
    <td>${f.method}</td>
    <td style="font-weight:600;font-size:0.8rem">${f.issue}</td>
    <td style="font-family:monospace;font-size:0.72rem;color:var(--accent2)">${f.header}</td>
    <td style="font-family:monospace;font-size:0.72rem;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${f.value}">${f.value}</td>
  </tr>`).join('');
  return summaryHtml + `<div class="tbl-wrap"><table>
    <thead><tr><th>Risk</th><th>URL</th><th>Method</th><th>Issue</th><th>Header</th><th>Value</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function apiView(endpoints) {
  if (!endpoints || !endpoints.length) return '<p style="color:var(--muted);padding:16px 0">No API endpoints detected.</p>';
  const jwtCount = endpoints.reduce((n, e) => n + e.jwts.length, 0);
  const leakCount = endpoints.reduce((n, e) => n + e.sensitiveLeaks.length, 0);
  const summaryHtml = `<div style="display:flex;gap:12px;margin-bottom:16px">
    <div class="card" style="min-width:120px"><div class="label">Endpoints</div><div class="value">${endpoints.length}</div></div>
    <div class="card" style="min-width:120px"><div class="label">JWTs Found</div><div class="value" style="color:${jwtCount?'var(--yellow)':'var(--green)'}">${jwtCount}</div></div>
    <div class="card" style="min-width:120px"><div class="label">Sensitive Leaks</div><div class="value" style="color:${leakCount?'var(--red)':'var(--green)'}">${leakCount}</div></div>
  </div>`;
  const rows = endpoints.map(e => {
    const jwtBadge = e.jwts.length ? `<span class="pill pill-3xx">JWT ×${e.jwts.length}</span> ` : '';
    const leakBadge = e.sensitiveLeaks.length ? `<span class="pill pill-err">⚠ Leak ×${e.sensitiveLeaks.length}</span> ` : '';
    const authBadge = e.hasAuth ? `<span class="pill pill-2xx">${e.authType||'Auth'}</span>` : '<span class="pill" style="background:var(--surface2);color:var(--muted)">No Auth</span>';
    return `<tr>
      <td class="url-cell" title="${e.url}">${trunc(e.path, 40)}</td>
      <td>${e.method}</td><td>${authBadge}</td><td>${jwtBadge}${leakBadge}</td>
      <td style="font-size:0.75rem;color:var(--muted)">${e.responseContentType?.split(';')[0]||'—'}</td>
      <td>${e.durationMs.toFixed(0)}ms</td>
    </tr>`;
  }).join('');
  const jwtDetails = endpoints.flatMap(e => e.jwts.map(j => ({ url: e.url, jwt: j }))).slice(0, 10);
  const jwtSection = jwtDetails.length ? `<div style="margin-top:20px">
    <div style="font-size:0.78rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Decoded JWTs</div>
    ${jwtDetails.map(({ url, jwt }) => `<div class="sec-card" style="margin-bottom:10px">
      <div class="sec-title" style="font-family:monospace;font-size:0.72rem;color:var(--muted)">${trunc(url, 60)}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
        <div><div style="font-size:0.7rem;color:var(--muted);margin-bottom:4px">HEADER</div>
          <pre style="font-size:0.72rem;color:var(--accent2);white-space:pre-wrap;word-break:break-all">${JSON.stringify(jwt.header,null,2)}</pre></div>
        <div><div style="font-size:0.7rem;color:var(--muted);margin-bottom:4px">PAYLOAD</div>
          <pre style="font-size:0.72rem;color:var(--text);white-space:pre-wrap;word-break:break-all">${JSON.stringify(jwt.payload,null,2)}</pre></div>
      </div></div>`).join('')}
  </div>` : '';
  const allLeaks = endpoints.flatMap(e => e.sensitiveLeaks.map(l => ({ url: e.url, ...l })));
  const leakSection = allLeaks.length ? `<div style="margin-top:20px">
    <div style="font-size:0.78rem;color:var(--red);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">⚠ Sensitive Data Leaks</div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Type</th><th>Location</th><th>Value</th><th>URL</th></tr></thead>
      <tbody>${allLeaks.map(l => `<tr>
        <td style="font-weight:600;color:var(--red)">${l.type}</td>
        <td><span class="pill pill-type">${l.location}</span></td>
        <td style="font-family:monospace;font-size:0.72rem;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.value}</td>
        <td class="url-cell" title="${l.url}">${trunc(l.url)}</td>
      </tr>`).join('')}</tbody>
    </table></div>
  </div>` : '';
  return summaryHtml + `<div class="tbl-wrap"><table>
    <thead><tr><th>Path</th><th>Method</th><th>Auth</th><th>Findings</th><th>Content-Type</th><th>Duration</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>${jwtSection}${leakSection}`;
}

function fingerprintView(fp) {
  if (!fp) return '<p style="color:var(--muted);padding:16px 0">No fingerprint data.</p>';
  const catColors = {framework:'var(--accent)',cms:'var(--accent2)',server:'var(--yellow)',cdn:'var(--green)',analytics:'var(--muted)',payment:'var(--red)',auth:'var(--yellow)',language:'var(--accent)',library:'var(--accent2)'};
  const techCards = fp.technologies.map(t => `
    <div class="sec-card" style="display:flex;align-items:center;gap:10px">
      <div style="flex:1">
        <div style="font-weight:700;font-size:0.85rem">${t.name}${t.version ? ' <span style="color:var(--muted);font-weight:400">v'+t.version+'</span>' : ''}</div>
        <div style="font-size:0.72rem;color:var(--muted);margin-top:2px">${t.evidence}</div>
      </div>
      <span class="pill" style="background:${catColors[t.category]||'var(--muted)'}22;color:${catColors[t.category]||'var(--muted)'}">${t.category}</span>
      <span class="pill" style="background:var(--surface2);color:var(--muted)">${t.confidence}</span>
    </div>`).join('');
  const thirdPartyRows = fp.thirdPartyDomains.map(d => `<tr>
    <td style="font-family:monospace;font-size:0.78rem">${d.domain}</td>
    <td><span class="pill pill-type">${d.category}</span></td>
    <td>${d.requestCount}</td><td>${fmt(d.totalBytes)}</td>
  </tr>`).join('');

  // CMS attack surface section — new
  const sevColor = {high:'var(--red)', medium:'var(--yellow)', low:'var(--muted)'};
  const cmsSection = fp.cmsExposure && fp.cmsExposure.length
    ? `<div style="margin-bottom:24px">
        <div style="font-size:0.78rem;color:var(--red);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">
          ⚠ CMS Attack Surface (${fp.cmsExposure.length} findings)
        </div>
        ${fp.cmsExposure.map(f => `<div class="sec-card" style="margin-bottom:8px;border-left:3px solid ${sevColor[f.severity]||'var(--muted)'}">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span class="pill" style="background:${sevColor[f.severity]}22;color:${sevColor[f.severity]}">${f.severity.toUpperCase()}</span>
            <span style="font-weight:700;font-size:0.82rem">${f.finding}</span>
            <span style="font-size:0.72rem;color:var(--muted);margin-left:auto">${f.cms}</span>
          </div>
          <div style="font-size:0.76rem;color:var(--muted);margin-bottom:4px">${f.detail}</div>
          ${f.url ? `<div style="font-family:monospace;font-size:0.7rem;color:var(--accent2)">${trunc(f.url, 80)}</div>` : ''}
        </div>`).join('')}
      </div>`
    : '';

  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">
    <div class="sec-card"><div class="sec-title">Server</div><div style="font-family:monospace;font-size:0.82rem;color:var(--text)">${fp.serverSoftware||'—'}</div></div>
    <div class="sec-card"><div class="sec-title">Powered By</div><div style="font-family:monospace;font-size:0.82rem;color:var(--text)">${fp.poweredBy||'—'}</div></div>
  </div>
  ${cmsSection}
  <div style="font-size:0.78rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Detected Technologies (${fp.technologies.length})</div>
  <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:24px">${techCards||'<p style="color:var(--muted)">None detected</p>'}</div>
  <div style="font-size:0.78rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Third-Party Domains (${fp.thirdPartyDomains.length})</div>
  ${fp.thirdPartyDomains.length ? `<div class="tbl-wrap"><table>
    <thead><tr><th>Domain</th><th>Category</th><th>Requests</th><th>Size</th></tr></thead>
    <tbody>${thirdPartyRows}</tbody>
  </table></div>` : '<p style="color:var(--muted)">None detected</p>'}`;
}

function dnsView(dns) {
  if (!dns) return '<p style="color:var(--muted);padding:16px 0">No DNS data.</p>';
  const subHtml = dns.subdomains.length
    ? dns.subdomains.map(s => `<span class="pill pill-type" style="margin:2px">${s}</span>`).join('')
    : '<span style="color:var(--muted)">None found</span>';
  const domainCards = dns.domains.map(d => {
    const rows = d.records.map(r => `<div class="sec-row">
      <span class="pill pill-type" style="min-width:50px;text-align:center">${r.type}</span>
      <span class="sec-val" style="max-width:none;flex:1;font-family:monospace;font-size:0.72rem">${r.value}</span>
    </div>`).join('');
    return `<div class="sec-card"><div class="sec-title">${d.domain}</div>${rows || '<div style="color:var(--muted);font-size:0.78rem">No records found</div>'}</div>`;
  }).join('');
  return `<div style="margin-bottom:16px">
    <div style="font-size:0.78rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Subdomains Found</div>
    <div>${subHtml}</div>
  </div>
  <div style="font-size:0.78rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">DNS Records (${dns.domains.length} domains)</div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px">${domainCards}</div>`;
}

function cspView(csp) {
  if (!csp) return '<p style="color:var(--muted);padding:16px 0">No CSP data.</p>';
  const gradeColor = {A:'var(--green)',B:'var(--green)',C:'var(--yellow)',D:'var(--yellow)',F:'var(--red)'}[csp.grade]||'var(--muted)';
  const sevColor = {critical:'var(--red)',high:'var(--red)',medium:'var(--yellow)',low:'var(--muted)',info:'var(--muted)'};
  const issueRows = csp.issues.map(i => `<tr>
    <td><span class="pill" style="background:${sevColor[i.severity]}22;color:${sevColor[i.severity]}">${i.severity.toUpperCase()}</span></td>
    <td style="font-family:monospace;font-size:0.75rem;color:var(--accent2)">${i.directive}</td>
    <td style="font-weight:600;font-size:0.8rem">${i.issue}</td>
    <td style="font-size:0.76rem;color:var(--muted)">${i.recommendation}</td>
  </tr>`).join('');
  const dirRows = Object.entries(csp.directives||{}).map(([k,v]) => `<tr>
    <td style="font-family:monospace;font-size:0.75rem;color:var(--accent2)">${k}</td>
    <td style="font-family:monospace;font-size:0.72rem;word-break:break-all">${v.join(' ')}</td>
  </tr>`).join('');
  return `<div style="display:grid;grid-template-columns:auto 1fr;gap:16px;align-items:start;margin-bottom:20px">
    <div class="sec-card" style="text-align:center;min-width:120px">
      <div class="sec-title">CSP Grade</div>
      <div style="font-size:3rem;font-weight:900;color:${gradeColor};line-height:1">${csp.grade}</div>
      <div style="font-size:0.8rem;color:var(--muted);margin-top:4px">Score: ${csp.score}/100</div>
    </div>
    <div class="sec-card">
      <div class="sec-title">Raw Policy</div>
      <pre style="font-size:0.7rem;white-space:pre-wrap;word-break:break-all;color:var(--muted);max-height:80px;overflow:auto">${csp.raw||'Not present'}</pre>
    </div>
  </div>
  ${csp.issues.length ? `<div style="margin-bottom:20px">
    <div style="font-size:0.78rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Issues (${csp.issues.length})</div>
    <div class="tbl-wrap"><table><thead><tr><th>Severity</th><th>Directive</th><th>Issue</th><th>Recommendation</th></tr></thead>
    <tbody>${issueRows}</tbody></table></div></div>` : '<p style="color:var(--green);margin-bottom:16px">✓ No CSP issues found</p>'}
  ${dirRows ? `<div style="font-size:0.78rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Parsed Directives</div>
  <div class="tbl-wrap"><table><thead><tr><th>Directive</th><th>Values</th></tr></thead>
  <tbody>${dirRows}</tbody></table></div>` : ''}`;
}

function vulnView(vuln) {
  if (!vuln) return '<p style="color:var(--muted);padding:16px 0">No scan data.</p>';
  const all = [...vuln.findings.sqli, ...vuln.findings.xss, ...vuln.findings.pathTraversal, ...vuln.findings.openRedirect, ...vuln.findings.infoDisclosure];
  const sevColor = {critical:'var(--red)',high:'var(--red)',medium:'var(--yellow)',low:'var(--muted)',info:'var(--muted)'};
  const summary = `<div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">
    <div class="card" style="min-width:110px"><div class="label">Scanned</div><div class="value">${vuln.scannedEndpoints}</div><div class="sub">endpoints</div></div>
    <div class="card" style="min-width:110px"><div class="label">Findings</div><div class="value" style="color:${all.length?'var(--red)':'var(--green)'}">${all.length}</div><div class="sub">${vuln.duration}ms</div></div>
    ${[['SQLi',vuln.findings.sqli],['XSS',vuln.findings.xss],['Path Traversal',vuln.findings.pathTraversal],['Open Redirect',vuln.findings.openRedirect],['Info Disclosure',vuln.findings.infoDisclosure]].map(([label,arr])=>
      `<div class="card" style="min-width:110px"><div class="label">${label}</div><div class="value" style="color:${arr.length?'var(--red)':'var(--green)'}">${arr.length}</div></div>`
    ).join('')}
  </div>`;
  if (!all.length) return summary + '<p style="color:var(--green)">✓ No vulnerabilities detected.</p><p style="color:var(--muted);font-size:0.8rem;margin-top:8px">Note: Basic automated scan. Manual testing recommended.</p>';
  const rows = all.map(f => `<tr>
    <td><span class="pill" style="background:${sevColor[f.severity]}22;color:${sevColor[f.severity]}">${f.severity.toUpperCase()}</span></td>
    <td style="font-weight:700;font-size:0.8rem;color:var(--red)">${f.type}</td>
    <td class="url-cell" title="${f.url}">${trunc(f.url)}</td>
    <td>${f.method}</td>
    <td style="font-size:0.76rem">${f.description}</td>
    <td style="font-family:monospace;font-size:0.7rem;color:var(--muted);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${f.evidence}">${f.evidence.slice(0,80)}</td>
  </tr>`).join('');
  return summary + `<div class="tbl-wrap"><table>
    <thead><tr><th>Severity</th><th>Type</th><th>URL</th><th>Method</th><th>Description</th><th>Evidence</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
  <p style="color:var(--muted);font-size:0.78rem;margin-top:12px">⚠ Automated scan only. Verify findings manually before reporting.</p>`;
}
