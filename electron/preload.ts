import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  analyze: (url: string, options?: { activeScan?: boolean }) => ipcRenderer.invoke('analyze', url, options),
  analyzeRepo: (url: string, options?: { advanced?: boolean }) => ipcRenderer.invoke('analyze-repo', url, options),
  saveGithubToken: (token: string) => ipcRenderer.invoke('save-github-token', token),
  loadGithubToken: () => ipcRenderer.invoke('load-github-token'),
  getHistory: () => ipcRenderer.invoke('get-history'),
  deleteHistoryEntry: (id: string) => ipcRenderer.invoke('delete-history-entry', id),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  exportPdf: (html: string) => ipcRenderer.invoke('export-pdf', html),

  // API key management
  saveApiKey: (key: string) => ipcRenderer.invoke('save-api-key', key),
  loadApiKey: () => ipcRenderer.invoke('load-api-key'),
  validateApiKey: (key: string) => ipcRenderer.invoke('validate-api-key', key),

  // Groq streaming
  groqAnalyze: (scanData: unknown, apiKey: string) =>
    ipcRenderer.invoke('groq-analyze', scanData, apiKey),
  groqChat: (messages: unknown[], apiKey: string) =>
    ipcRenderer.invoke('groq-chat', messages, apiKey),

  // Streaming event listeners
  onGroqChunk: (cb: (chunk: { text: string; done: boolean }) => void) => {
    ipcRenderer.on('groq-chunk', (_e, chunk) => cb(chunk));
  },
  onGroqError: (cb: (msg: string) => void) => {
    ipcRenderer.on('groq-error', (_e, msg) => cb(msg));
  },
  removeGroqListeners: () => {
    ipcRenderer.removeAllListeners('groq-chunk');
    ipcRenderer.removeAllListeners('groq-error');
  },
});
