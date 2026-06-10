import type { ReportInput, NetworkRequest } from './types.js';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function truncateUrl(url: string, maxLen: number = 80): string {
  if (url.length <= maxLen) return url;
  return url.slice(0, maxLen - 1) + '…';
}

function statusCell(req: NetworkRequest): string {
  if (req.failed) return 'FAILED';
  return req.statusCode !== null ? String(req.statusCode) : '-';
}

function requestTable(requests: NetworkRequest[]): string {
  const header = '| URL | Method | Type | Status | Size | TTFB | Duration |\n|---|---|---|---|---|---|---|';
  const rows = requests.map((r) =>
    `| ${truncateUrl(r.url)} | ${r.method} | ${r.resourceType} | ${statusCell(r)} | ${formatBytes(r.sizeBytes)} | ${r.ttfbMs.toFixed(0)}ms | ${r.durationMs.toFixed(0)}ms |`
  );
  return [header, ...rows].join('\n');
}

export function renderReport(input: ReportInput): string {
  const { url, captureTimestamp, totalDurationMs, data } = input;
  const { aggregate, byType, slowest, errors, requests } = data;

  const sections: string[] = [];

  // Summary
  sections.push(`## Summary

| Field | Value |
|---|---|
| URL | ${url} |
| Captured | ${captureTimestamp} |
| Total Requests | ${aggregate.totalRequests} |
| Total Transferred | ${formatBytes(aggregate.totalBytes)} |
| Page Load Duration | ${totalDurationMs.toFixed(0)}ms |`);

  // Request Breakdown by Type
  const typeRows = byType
    .map((t) => `| ${t.resourceType} | ${t.count} | ${formatBytes(t.totalBytes)} | ${t.avgDurationMs.toFixed(0)}ms |`)
    .join('\n');
  sections.push(`## Request Breakdown by Type

| Type | Count | Total Size | Avg Duration |
|---|---|---|---|
${typeRows}`);

  // Slowest Requests
  sections.push(`## Slowest Requests

${requestTable(slowest)}`);

  // Errors and Failed Requests
  const errorContent = errors.length > 0
    ? requestTable(errors)
    : '_No errors or failed requests._';
  sections.push(`## Errors and Failed Requests

${errorContent}`);

  // Full Request Log
  sections.push(`## Full Request Log

${requestTable(requests)}`);

  return `# Network Analysis Report\n\n${sections.join('\n\n')}`;
}
