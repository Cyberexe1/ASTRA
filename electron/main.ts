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
import { analyzeRepo } from '../src/repo/index.js';
import { streamGroqAnalysis, streamGroqChat, validateApiKey } from '../src/ai/groqClient.js';
import type { GroqChatMessage } from '../src/ai/groqClient.js';

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

// ─── IPC: API key management (encrypted via safeStorage) ─────────────────────
// IMPORTANT: constants must be declared BEFORE the handlers that reference them.
const KEY_FILE = join(app.getPath('userData'), 'groq-key.enc');
const GITHUB_TOKEN_FILE = join(app.getPath('userData'), 'github-token.enc');
const HISTORY_FILE = join(app.getPath('userData'), 'scan-history.json');

// ─── IPC: scan history persistence ────────────────────────────────────────────
interface HistoryEntry {
  id: string;
  type: 'website' | 'repo';
  url: string;
  timestamp: string;
  summary: Record<string, unknown>;
}

async function loadHistory(): Promise<HistoryEntry[]> {
  try {
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(HISTORY_FILE, 'utf8');
    return JSON.parse(raw) as HistoryEntry[];
  } catch { return []; }
}

async function saveHistory(entry: HistoryEntry): Promise<void> {
  const { writeFile } = await import('node:fs/promises');
  const history = await loadHistory();
  // Keep newest first, cap at 50 entries
  const updated = [entry, ...history.filter(h => h.id !== entry.id)].slice(0, 50);
  await writeFile(HISTORY_FILE, JSON.stringify(updated, null, 2), 'utf8');
}

ipcMain.handle('get-history', async () => loadHistory());

ipcMain.handle('delete-history-entry', async (_event, id: string) => {
  const { writeFile } = await import('node:fs/promises');
  const history = await loadHistory();
  await writeFile(HISTORY_FILE, JSON.stringify(history.filter(h => h.id !== id), null, 2), 'utf8');
});

ipcMain.handle('clear-history', async () => {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(HISTORY_FILE, '[]', 'utf8');
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

  const result = {
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
    securityHeaders,
    cookieIssues,
    mixedContent,
    vuln: vulnResult,
  };

  // Persist to history
  await saveHistory({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'website',
    url: validation.url,
    timestamp: capture.captureTimestamp,
    summary: {
      totalRequests: data.aggregate.totalRequests,
      totalBytes: data.aggregate.totalBytes,
      errors: data.errors.length,
      tlsGrade: result.tls && !('error' in result.tls) ? result.tls.grade : null,
      cspGrade: result.csp?.grade ?? null,
    },
  }).catch(() => {});

  return result;
});

// ─── IPC: open external link ──────────────────────────────────────────────────
ipcMain.handle('open-external', (_event, url: string) => {
  shell.openExternal(url);
});

// ─── IPC: analyze GitHub repository ───────────────────────────────────────────
ipcMain.handle('analyze-repo', async (_event, rawUrl: string, options: { advanced?: boolean } = {}) => {
  let token: string | undefined;
  try {
    const { readFile } = await import('node:fs/promises');
    const data = await readFile(GITHUB_TOKEN_FILE);
    token = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(data)
      : data.toString('utf8');
  } catch {
    token = process.env.GITHUB_TOKEN ?? undefined;
  }
  const result = await analyzeRepo(rawUrl, { advanced: options.advanced === true, token });

  // Persist to history
  await saveHistory({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'repo',
    url: rawUrl.trim(),
    timestamp: new Date().toISOString(),
    summary: {
      fileCount: result.fileCount,
      mode: result.mode,
      secrets: result.secrets.length,
      dependencies: result.dependencies.length,
      total: result.summary.total,
      critical: result.summary.critical,
      high: result.summary.high,
    },
  }).catch(() => {});

  return result;
});

ipcMain.handle('save-github-token', async (_event, value: string) => {
  const { writeFile } = await import('node:fs/promises');
  if (!safeStorage.isEncryptionAvailable()) {
    await writeFile(GITHUB_TOKEN_FILE, value, 'utf8');
  } else {
    await writeFile(GITHUB_TOKEN_FILE, safeStorage.encryptString(value));
  }
});

ipcMain.handle('load-github-token', async () => {
  try {
    const { readFile } = await import('node:fs/promises');
    const data = await readFile(GITHUB_TOKEN_FILE);
    const val = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(data)
      : data.toString('utf8');
    // Return only a masked preview, never the raw token to the renderer
    return val ? '•'.repeat(20) : null;
  } catch {
    return process.env.GITHUB_TOKEN ? '•'.repeat(20) : null;
  }
});

// ─── IPC: API key management ──────────────────────────────────────────────────
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
    return process.env.GROQ_API_KEY ?? null;
  }
});

ipcMain.handle('validate-api-key', async (_event, apiKey: string) => {
  return validateApiKey(apiKey);
});

// ─── IPC: Groq streaming analysis ────────────────────────────────────────────
ipcMain.handle('groq-analyze', async (event, scanData: unknown, apiKey: string) => {
  try {
    for await (const chunk of streamGroqAnalysis(apiKey, scanData)) {
      event.sender.send('groq-chunk', chunk);
    }
  } catch (err) {
    event.sender.send('groq-error', (err as Error).message);
  }
});

ipcMain.handle('groq-chat', async (event, messages: GroqChatMessage[], apiKey: string) => {
  try {
    for await (const chunk of streamGroqChat(apiKey, messages)) {
      event.sender.send('groq-chunk', chunk);
    }
  } catch (err) {
    event.sender.send('groq-error', (err as Error).message);
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
