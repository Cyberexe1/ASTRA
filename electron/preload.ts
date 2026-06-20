import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  analyze: (url: string, options?: { activeScan?: boolean }) => ipcRenderer.invoke('analyze', url, options),
  analyzeRepo: (url: string, options?: { advanced?: boolean }) => ipcRenderer.invoke('analyze-repo', url, options),
  saveGithubToken: (token: string) => ipcRenderer.invoke('save-github-token', token),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  exportPdf: (html: string) => ipcRenderer.invoke('export-pdf', html),

  // API key management
  saveApiKey: (key: string) => ipcRenderer.invoke('save-api-key', key),
  loadApiKey: () => ipcRenderer.invoke('load-api-key'),
  validateApiKey: (key: string) => ipcRenderer.invoke('validate-api-key', key),

  // Gemini streaming
  geminiAnalyze: (scanData: unknown, apiKey: string) =>
    ipcRenderer.invoke('gemini-analyze', scanData, apiKey),
  geminiChat: (messages: unknown[], apiKey: string) =>
    ipcRenderer.invoke('gemini-chat', messages, apiKey),

  // Streaming event listeners
  onGeminiChunk: (cb: (chunk: { text: string; done: boolean }) => void) => {
    ipcRenderer.on('gemini-chunk', (_e, chunk) => cb(chunk));
  },
  onGeminiError: (cb: (msg: string) => void) => {
    ipcRenderer.on('gemini-error', (_e, msg) => cb(msg));
  },
  removeGeminiListeners: () => {
    ipcRenderer.removeAllListeners('gemini-chunk');
    ipcRenderer.removeAllListeners('gemini-error');
  },
});
