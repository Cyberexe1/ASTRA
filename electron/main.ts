import { app, BrowserWindow, ipcMain, shell, safeStorage } from 'electron';
import { join } from 'node:path';
import { config as loadEnv } from 'dotenv';

// Load .env from project root
loadEnv({ path: join(__dirname, '../../.env') });
loadEnv({ path: join(process.cwd(), '.env'), override: false });

import { normalizeAndValidate } from '../src/url.js';
import { captureNetwork } from '../src/capture.js';
import { processRequests } from '../src/metrics.js';
import { generateHar } from '../src/har.js';
import { inspectTls } from '../src/security/tls.js';
import { analyzeCors } from '../src/security/cors.js';
import { extractApiEndpoints } from '../src/security/apiExtractor.js';
import { fingerprintTechnologies } from '../src/security/fingerprint.js';
import { runDnsRecon } from '../src/security/dns.js';
import { analyzeCsp, analyzeSecurityHeaders, analyzeCookies } from '../src/security/csp.js';
import { runVulnScan } from '../src/security/vulnScanner.js';
import { findMixedContent } from '../src/security/mixedContent.js';
import { correlateCves } from '../src/security/cve.js';
import { streamGeminiAnalysis, streamGeminiChat, validateApiKey } from '../src/ai/gemini.js';
import type { GeminiMessage } from '../src/ai/gemini.js';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  // __dirname is dist/electron/ — HTML lives at electron/index.html (project root)
  const htmlPath = join(__dirname, '../../electron/index.html');
  mainWindow.loadFile(htmlPath);

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Uncomment to open DevTools for debugging:
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ─── IPC: analyze URL ─────────────────────────────────────────────────────────
ipcMain.handle('analyze', async (_event, rawUrl: string, options: { activeScan?: boolean } = {}) => {
  const validation = normalizeAndValidate(rawUrl);
  if (!validation.ok) throw new Error(validation.error);

  const capture = await captureNetwork({ url: validation.url, timeoutMs: 60000 });
  const data = processRequests(capture.requests);
  const har = generateHar(capture.requests, capture.captureTimestamp);

  // Run security analysis in parallel
  const [tlsResult, corsReport, apiEndpoints, fingerprint, dnsReport, cspReport] = await Promise.allSettled([
    inspectTls(validation.url),
    Promise.resolve(analyzeCors(capture.requests)),
    Promise.resolve(extractApiEndpoints(capture.requests)),
    Promise.resolve(fingerprintTechnologies(capture.requests, validation.url)),
    runDnsRecon(capture.requests, validation.url),
    Promise.resolve(analyzeCsp(capture.requests)),
  ]);

  const api = apiEndpoints.status === 'fulfilled' ? apiEndpoints.value : [];

  // Security headers and cookie analysis (synchronous, uses captured requests)
  const securityHeaders = analyzeSecurityHeaders(capture.requests);
  const cookieIssues = analyzeCookies(capture.requests);

  // Mixed-content detection (HTTP sub-resources on an HTTPS page)
  const mixedContent = findMixedContent(capture.requests, validation.url);

  // CVE correlation for fingerprinted components with known versions
  let fingerprintValue = fingerprint.status === 'fulfilled' ? fingerprint.value : null;
  if (fingerprintValue) {
    try {
      const cves = await correlateCves(fingerprintValue.technologies);
      fingerprintValue = { ...fingerprintValue, cves };
    } catch { /* CVE lookup is best-effort */ }
  }

  // Active vulnerability scan is INTRUSIVE and OFF BY DEFAULT.
  // It only runs when the caller explicitly opts in (authorized-target consent).
  const emptyVuln = {
    findings: { sqli: [], xss: [], idor: [], pathTraversal: [], openRedirect: [], infoDisclosure: [] },
    scannedEndpoints: 0,
    duration: 0,
  };
  const vulnResult = options.activeScan === true
    ? await runVulnScan(api).catch(() => emptyVuln)
    : { ...emptyVuln, skipped: true };

  return {
    url: validation.url,
    captureTimestamp: capture.captureTimestamp,
    totalDurationMs: capture.totalDurationMs,
    aggregate: data.aggregate,
    byType: data.byType,
    slowest: data.slowest,
    errors: data.errors,
    requests: data.requests,
    har,
    tls: tlsResult.status === 'fulfilled' ? tlsResult.value : { error: (tlsResult.reason as Error).message },
    cors: corsReport.status === 'fulfilled' ? corsReport.value : { findings: [], summary: {} },
    api,
    fingerprint: fingerprintValue,
    dns: dnsReport.status === 'fulfilled' ? dnsReport.value : null,
    csp: cspReport.status === 'fulfilled' ? cspReport.value : null,
    securityHeaders,   // X-Content-Type-Options, Referrer-Policy, Permissions-Policy, etc.
    cookieIssues,      // HttpOnly, Secure, SameSite flag analysis
    mixedContent,      // HTTP resources loaded on an HTTPS page
    vuln: vulnResult,
  };
});

// ─── IPC: open external link ──────────────────────────────────────────────────
ipcMain.handle('open-external', (_event, url: string) => {
  shell.openExternal(url);
});

// ─── IPC: API key management (encrypted via safeStorage) ─────────────────────
const KEY_FILE = join(app.getPath('userData'), 'gemini-key.enc');

ipcMain.handle('save-api-key', async (_event, apiKey: string) => {
  const { writeFile } = await import('node:fs/promises');
  if (!safeStorage.isEncryptionAvailable()) {
    await writeFile(KEY_FILE, apiKey, 'utf8');
  } else {
    const encrypted = safeStorage.encryptString(apiKey);
    await writeFile(KEY_FILE, encrypted);
  }
});

ipcMain.handle('load-api-key', async () => {
  const { readFile } = await import('node:fs/promises');
  try {
    const data = await readFile(KEY_FILE);
    if (!safeStorage.isEncryptionAvailable()) return data.toString('utf8');
    return safeStorage.decryptString(data);
  } catch {
    // Fall back to .env GROQ_API_KEY if no saved key
    return process.env.GROQ_API_KEY ?? null;
  }
});

ipcMain.handle('validate-api-key', async (_event, apiKey: string) => {
  return validateApiKey(apiKey);
});

// ─── IPC: Gemini streaming analysis ──────────────────────────────────────────
ipcMain.handle('gemini-analyze', async (event, scanData: unknown, apiKey: string) => {
  try {
    for await (const chunk of streamGeminiAnalysis(apiKey, scanData)) {
      event.sender.send('gemini-chunk', chunk);
    }
  } catch (err) {
    event.sender.send('gemini-error', (err as Error).message);
  }
});

ipcMain.handle('gemini-chat', async (event, messages: GeminiMessage[], apiKey: string) => {
  try {
    for await (const chunk of streamGeminiChat(apiKey, messages)) {
      event.sender.send('gemini-chunk', chunk);
    }
  } catch (err) {
    event.sender.send('gemini-error', (err as Error).message);
  }
});

// ─── IPC: export PDF ──────────────────────────────────────────────────────────
ipcMain.handle('export-pdf', async (_event, htmlContent: string) => {
  const { dialog } = await import('electron');
  const { writeFile } = await import('node:fs/promises');

  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow!, {
    title: 'Save PDF Report',
    defaultPath: `network-report-${Date.now()}.pdf`,
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
  });

  if (canceled || !filePath) return { canceled: true };

  // Create a hidden BrowserWindow to render the HTML and print to PDF
  const pdfWin = new BrowserWindow({ show: false, webPreferences: { javascript: true } });
  await pdfWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

  const pdfBuffer = await pdfWin.webContents.printToPDF({
    printBackground: true,
    pageSize: 'A4',
    margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
  });

  pdfWin.destroy();
  await writeFile(filePath, pdfBuffer);
  return { filePath };
});
