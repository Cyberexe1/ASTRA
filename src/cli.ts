#!/usr/bin/env node
import { Command } from 'commander';
import { writeFile } from 'node:fs/promises';
import { normalizeAndValidate } from './url.js';
import { captureNetwork } from './capture.js';
import { processRequests } from './metrics.js';
import { renderReport } from './report.js';
import { generateHar } from './har.js';
import { writeOutput } from './output.js';

const program = new Command();

program
  .name('network-tab-analyzer')
  .description('Capture and analyze browser network activity for any URL')
  .argument('<url>', 'URL to analyze')
  .option('-o, --output <path>', 'Write Markdown report to file instead of stdout')
  .option('--har <path>', 'Export HAR 1.2 file to the specified path')
  .helpOption('-h, --help', 'Show usage information')
  .allowUnknownOption(false);

program.action(async (rawUrl: string, opts: { output?: string; har?: string }) => {
  const validation = normalizeAndValidate(rawUrl);
  if (!validation.ok) {
    process.stderr.write(`Error: ${validation.error}\n`);
    process.exit(1);
  }

  const url = validation.url;

  process.stderr.write('Loading page...\n');
  let captureResult;
  try {
    captureResult = await captureNetwork({ url, timeoutMs: 30000 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }

  process.stderr.write('Capturing network activity...\n');
  const data = processRequests(captureResult.requests);

  process.stderr.write('Generating report...\n');
  const report = renderReport({
    url,
    captureTimestamp: captureResult.captureTimestamp,
    totalDurationMs: captureResult.totalDurationMs,
    data,
  });

  try {
    await writeOutput(report, opts.output);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }

  if (opts.har) {
    const har = generateHar(captureResult.requests, captureResult.captureTimestamp);
    try {
      await writeFile(opts.har, JSON.stringify(har, null, 2), 'utf8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error writing HAR to "${opts.har}": ${msg}\n`);
      process.exit(1);
    }
  }
});

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
