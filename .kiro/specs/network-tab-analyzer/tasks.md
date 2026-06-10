# Implementation Plan: Network Tab Analyzer

## Overview

Implement a Node.js/TypeScript CLI tool that captures browser network activity via Playwright and emits a structured Markdown report. The pipeline is: CLI args → URL validation → browser capture → metrics processing → report/HAR rendering → output. Pure stages are implemented and tested first; the browser capture stage last.

## Tasks

- [x] 1. Initialize project structure and shared types
  - Create `package.json` with dependencies: `playwright`, `commander`; devDependencies: `typescript`, `vitest`, `fast-check`, `@types/node`
  - Create `tsconfig.json` targeting Node 20, `strict: true`, `outDir: dist`
  - Create `src/types.ts` defining `ResourceType`, `NetworkRequest`, `CaptureResult`, `CaptureOptions`, `ProcessedData`, `AggregateMetrics`, `TypeMetrics`, `ReportInput`, `HarFile`, `HarEntry`
  - Create `src/__tests__/arbitraries.ts` with a shared `networkRequestArbitrary()` fast-check arbitrary covering all `NetworkRequest` fields with realistic distributions
  - _Requirements: 2.2_

- [x] 2. Implement URL validation (`src/url.ts`)
  - [x] 2.1 Implement `normalizeUrl` and `validateUrl` and `normalizeAndValidate`
    - `normalizeUrl`: prepend `https://` if input lacks `http://` or `https://` prefix
    - `validateUrl`: use `new URL()` to detect structural invalidity; reject non-http/https schemes
    - `normalizeAndValidate`: compose both, return `{ ok: true; url }` or `{ ok: false; error }`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ]* 2.2 Write property test for URL scheme normalization (Property 1)
    - **Property 1: URL scheme normalization**
    - **Validates: Requirements 1.2**
    - Use `fc.string()` filtered to exclude `http://` and `https://` prefixes; assert result starts with `https://` + original input

  - [ ]* 2.3 Write property test for URL validation rejection (Property 2)
    - **Property 2: URL validation rejects all invalid inputs**
    - **Validates: Requirements 1.3, 1.4**
    - Generate structurally invalid strings and strings with non-http/https schemes; assert `{ ok: false }` returned

  - [ ]* 2.4 Write unit tests for URL validation
    - Bare domain (e.g. `example.com`) → prepends `https://`
    - Already-prefixed `http://` and `https://` → unchanged
    - Structurally invalid string → `{ ok: false }` with descriptive error
    - `ftp://`, `file://`, `ws://` schemes → `{ ok: false }` with scheme error
    - _Requirements: 1.2, 1.3, 1.4_

- [x] 3. Implement metrics processor (`src/metrics.ts`)
  - [x] 3.1 Implement `groupByType`, `computeAggregate`, `computeTypeMetrics`, `getSlowest`, `getErrors`, and `processRequests`
    - `groupByType`: group `NetworkRequest[]` by `resourceType` into a `Map`
    - `computeAggregate`: sum `sizeBytes`, `durationMs`; count requests
    - `computeTypeMetrics`: per-type count, total bytes, average duration
    - `getSlowest(requests, n)`: return top-n by `durationMs` descending
    - `getErrors`: filter where `statusCode >= 400` or `failed === true`
    - `processRequests`: compose all of the above into `ProcessedData`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ]* 3.2 Write property test for failed requests always recorded (Property 4)
    - **Property 4: Failed requests are always recorded**
    - **Validates: Requirements 2.5**
    - Generate arrays with mixed `failed: true` entries; assert all appear in `processRequests` result

  - [ ]* 3.3 Write property test for grouping correctness (Property 5)
    - **Property 5: Grouping correctness**
    - **Validates: Requirements 3.1**
    - Assert every request in each group matches the group key; assert union of all groups equals original list

  - [ ]* 3.4 Write property test for metrics computation correctness (Property 6)
    - **Property 6: Metrics computation correctness**
    - **Validates: Requirements 3.2, 3.3**
    - Assert `totalBytes` equals exact sum of `sizeBytes`; assert per-type averages are consistent with group members

  - [ ]* 3.5 Write property test for slowest requests selection (Property 7)
    - **Property 7: Slowest requests selection**
    - **Validates: Requirements 3.4**
    - Generate arrays with ≥5 entries; assert result length is 5 and all results have `durationMs ≥` every non-result request

  - [ ]* 3.6 Write property test for error filter (Property 8)
    - **Property 8: Error requests filter**
    - **Validates: Requirements 3.5**
    - Assert `getErrors` returns exactly requests where `statusCode >= 400` or `failed === true`, no more, no fewer

- [x] 4. Checkpoint — Ensure all tests pass
  - Run `vitest --run` and confirm all URL and metrics tests pass. Ask the user if questions arise.

- [x] 5. Implement report renderer (`src/report.ts`)
  - [x] 5.1 Implement `formatBytes`, `truncateUrl`, and `renderReport`
    - `formatBytes`: convert bytes to human-readable string (B, KB, MB, GB)
    - `truncateUrl`: truncate to 80 characters, appending `…` if truncated
    - `renderReport`: produce GFM Markdown with sections in order: Summary, Request Breakdown by Type, Slowest Requests, Errors and Failed Requests, Full Request Log
    - Full Request Log: GFM table with columns URL, method, type, status, size, TTFB, duration
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [ ]* 5.2 Write property test for report structure completeness (Property 9)
    - **Property 9: Report structure completeness**
    - **Validates: Requirements 4.2, 4.3**
    - Generate valid `ReportInput`; assert rendered string contains all five section headings in order and Summary contains URL, timestamp, count, bytes, duration

  - [ ]* 5.3 Write property test for full request log completeness (Property 10)
    - **Property 10: Full request log completeness**
    - **Validates: Requirements 4.4**
    - Generate `NetworkRequest[]` with ≥1 entry; assert every request's URL (truncated to 80 chars) appears as a table row in the Full Request Log section

  - [ ]* 5.4 Write unit tests for report renderer
    - `formatBytes` with known values: 0, 999, 1024, 1_048_576
    - `truncateUrl` at exactly 80 chars, below 80, above 80
    - _Requirements: 4.3, 4.4_

- [x] 6. Implement HAR generator (`src/har.ts`)
  - [x] 6.1 Implement `generateHar` and `parseHar`
    - `generateHar`: convert `NetworkRequest[]` to HAR 1.2 JSON object; map `ttfbMs` → `timings.wait`, `durationMs - ttfbMs` → `timings.receive`
    - `parseHar`: parse HAR JSON string back to `NetworkRequest[]` (for round-trip testing)
    - _Requirements: 5.1, 5.3_

  - [ ]* 6.2 Write property test for HAR structure validity (Property 11)
    - **Property 11: HAR structure validity**
    - **Validates: Requirements 5.1, 5.3**
    - Assert `log.version === '1.2'`, `log.entries.length === requests.length`, each entry has valid `request`, `response`, `timings`

  - [ ]* 6.3 Write property test for HAR round-trip (Property 12)
    - **Property 12: HAR round-trip**
    - **Validates: Requirements 5.4**
    - Serialize → parse → serialize → parse; assert second parse result is equivalent to first parse result

- [x] 7. Implement output writer (`src/output.ts`)
  - Implement `writeOutput(content, filePath?)`: write to file if `filePath` provided, else write to stdout
  - Throw a descriptive error (including path and OS error) if the file is not writable
  - _Requirements: 4.5, 4.6, 4.7_

- [x] 8. Checkpoint — Ensure all tests pass
  - Run `vitest --run` and confirm all pure-function tests pass. Ask the user if questions arise.

- [x] 9. Implement browser capture (`src/capture.ts`)
  - [x] 9.1 Implement the Playwright request mapper (pure function, extracted for testability)
    - Extract a pure `mapRequest(playwrightReq, playwrightResp | null, timings): NetworkRequest` function
    - Handle failed requests: set `failed: true`, `statusCode: null`, populate `errorText`
    - Map Playwright resource types to `ResourceType`; default unknown types to `'other'`
    - _Requirements: 2.2, 2.5_

  - [ ]* 9.2 Write property test for request field mapping completeness (Property 3)
    - **Property 3: Request field mapping completeness**
    - **Validates: Requirements 2.2**
    - Generate mock Playwright request/response shapes via `fc.record()`; assert all required fields are non-null in mapped result

  - [x] 9.3 Implement `captureNetwork`
    - Launch Playwright Chromium headless; attach `page.on('request')`, `page.on('response')`, `page.on('requestfinished')`, `page.on('requestfailed')` listeners
    - Navigate with `waitUntil: 'networkidle'` and `timeout: options.timeoutMs` (default 30000)
    - On timeout: close browser, throw error with timeout message
    - Return `CaptureResult` with `requests`, `captureTimestamp` (ISO 8601), `totalDurationMs`
    - _Requirements: 2.1, 2.3, 2.4, 2.5_

  - [ ]* 9.4 Write integration tests for browser capture
    - Spin up a local `http` server with known resources; assert all requests appear in `CaptureResult`
    - Server with mixed 200/404 responses; assert failed/error requests are recorded
    - Simulate timeout by never responding; assert timeout error thrown within ~31s
    - _Requirements: 2.1, 2.3, 2.4, 2.5_

- [x] 10. Implement CLI entry point (`src/cli.ts`)
  - Wire `commander` with: required URL positional arg, `--output <path>` flag, `--har <path>` flag, `--help`/`-h`
  - Validate `--har` flag requires a path argument; exit code 1 + stderr if missing
  - Print progress to stderr: "Loading page...", "Capturing network activity...", "Generating report..."
  - Call `normalizeAndValidate` → `captureNetwork` → `processRequests` → `renderReport` → `writeOutput`; call `generateHar` + write if `--har` provided
  - Handle all error cases from the error table: exit code 1, message to stderr
  - Handle unrecognized flags: print flag name + usage hint, exit code 1
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 4.5, 4.6, 4.7, 5.2, 6.1, 6.2, 6.3, 6.4_

  - [ ]* 10.1 Write unit tests for CLI
    - `--help` / `-h`: stdout contains usage, exit code 0
    - No arguments: stderr hint, exit code 1
    - Unrecognized flag: error names the flag, exit code 1
    - `--har` without path: usage error, exit code 1
    - `--output` to unwritable path: error + path, exit code 1
    - Progress messages appear on stderr, report on stdout (no `--output`)
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 11. Final checkpoint — Ensure all tests pass
  - Run `vitest --run` and confirm the full test suite passes. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests use `fast-check` with minimum 100 iterations each; tag each with `// Feature: network-tab-analyzer, Property N: <text>`
- The shared `networkRequestArbitrary()` in `src/__tests__/arbitraries.ts` must be created in Task 1 before any property tests are written
- Browser capture (Task 9) is intentionally last — all pure-function logic is validated before touching Playwright
