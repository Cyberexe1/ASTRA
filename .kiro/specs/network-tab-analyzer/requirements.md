# Requirements Document

## Introduction

The Network Tab Analyzer is a CLI tool that accepts a URL, launches a headless browser to load the page, captures all network activity (requests, responses, headers, timing, status codes, payload sizes), and produces a structured Markdown report. This mirrors what a developer sees in the browser's DevTools Network tab, but automated and exportable.

## Glossary

- **Analyzer**: The core system that orchestrates URL loading, network capture, and report generation.
- **Headless_Browser**: A browser instance (e.g., Chromium via Playwright) that runs without a GUI and intercepts all network traffic.
- **Network_Request**: A single HTTP/HTTPS request made by the page during load, including XHR, fetch, document, script, stylesheet, image, font, and other resource types.
- **Network_Report**: The structured Markdown document produced as output, containing all captured network activity details.
- **HAR**: HTTP Archive format — a JSON-based standard for logging browser network interactions.
- **Resource_Type**: The category of a network request (e.g., `document`, `script`, `stylesheet`, `image`, `xhr`, `fetch`, `font`, `media`, `other`).
- **TTFB**: Time To First Byte — the duration from request start until the first byte of the response is received.
- **URL**: A valid HTTP or HTTPS Uniform Resource Locator provided as input to the Analyzer.

---

## Requirements

### Requirement 1: URL Input and Validation

**User Story:** As a developer, I want to provide a URL to the tool, so that I can analyze the network activity of any website.

#### Acceptance Criteria

1. THE Analyzer SHALL accept a URL as a required command-line argument.
2. WHEN a URL is provided without an `http://` or `https://` scheme, THE Analyzer SHALL prepend `https://` and proceed.
3. IF the provided URL is structurally invalid after normalization, THEN THE Analyzer SHALL exit with a non-zero status code and print a descriptive error message to stderr.
4. IF the provided URL uses a scheme other than `http` or `https`, THEN THE Analyzer SHALL exit with a non-zero status code and print an error message stating only HTTP and HTTPS URLs are supported.

---

### Requirement 2: Headless Browser Network Capture

**User Story:** As a developer, I want the tool to capture real browser network activity, so that I get the same data I would see in DevTools — including dynamically loaded resources, XHR, and fetch calls.

#### Acceptance Criteria

1. WHEN a valid URL is provided, THE Headless_Browser SHALL load the page and intercept all Network_Requests made during the page load lifecycle.
2. THE Headless_Browser SHALL capture the following fields for each Network_Request: URL, HTTP method, Resource_Type, HTTP status code, response size in bytes, TTFB in milliseconds, total duration in milliseconds, request headers, and response headers.
3. WHILE the page is loading, THE Headless_Browser SHALL wait for the network to reach an idle state (no more than 2 in-flight requests for at least 500ms) before concluding capture.
4. IF the page fails to load within 30 seconds, THEN THE Analyzer SHALL terminate the browser session, exit with a non-zero status code, and print a timeout error to stderr.
5. IF a Network_Request fails (e.g., DNS failure, connection refused, HTTP 4xx/5xx), THEN THE Analyzer SHALL still record the request with its error status rather than discarding it.

---

### Requirement 3: Request Categorization and Metrics

**User Story:** As a developer, I want requests grouped by type and summarized with metrics, so that I can quickly identify performance bottlenecks and resource composition.

#### Acceptance Criteria

1. THE Analyzer SHALL group all captured Network_Requests by Resource_Type.
2. THE Analyzer SHALL compute the following aggregate metrics across all requests: total request count, total transferred bytes, total page load duration in milliseconds.
3. THE Analyzer SHALL compute per-Resource_Type metrics: request count, total bytes, and average duration in milliseconds.
4. THE Analyzer SHALL identify the 5 slowest Network_Requests by total duration and include them in a dedicated section of the Network_Report.
5. THE Analyzer SHALL identify all Network_Requests that returned HTTP status codes in the 4xx or 5xx range and list them in a dedicated errors section of the Network_Report.

---

### Requirement 4: Markdown Report Generation

**User Story:** As a developer, I want the analysis output as a Markdown document, so that I can read it in any Markdown viewer, commit it to a repo, or share it with teammates.

#### Acceptance Criteria

1. WHEN analysis is complete, THE Analyzer SHALL produce a Network_Report in valid GitHub-Flavored Markdown (GFM) format.
2. THE Network_Report SHALL contain the following sections in order: Summary, Request Breakdown by Type, Slowest Requests, Errors and Failed Requests, Full Request Log.
3. THE Network_Report Summary section SHALL include: the analyzed URL, capture timestamp (ISO 8601), total request count, total transferred bytes (human-readable, e.g., `1.2 MB`), and total page load duration.
4. THE Network_Report Full Request Log section SHALL present each Network_Request as a table row with columns: URL (truncated to 80 characters), method, type, status, size, TTFB, and duration.
5. WHEN the output file path is specified via a `--output` flag, THE Analyzer SHALL write the Network_Report to that file path.
6. WHEN no `--output` flag is provided, THE Analyzer SHALL print the Network_Report to stdout.
7. IF the specified output file path is not writable, THEN THE Analyzer SHALL exit with a non-zero status code and print a descriptive error to stderr.

---

### Requirement 5: HAR Export (Optional)

**User Story:** As a developer, I want the option to export raw HAR data alongside the Markdown report, so that I can import it into tools like Chrome DevTools or webpagetest.org for deeper analysis.

#### Acceptance Criteria

1. WHERE the `--har` flag is provided, THE Analyzer SHALL export the captured network data as a valid HAR 1.2 file to the path specified by the flag.
2. IF the `--har` flag is provided without a file path argument, THEN THE Analyzer SHALL exit with a non-zero status code and print a usage error to stderr.
3. THE Analyzer SHALL produce a HAR file that, when re-imported into Chrome DevTools, displays all captured Network_Requests without parse errors.
4. FOR ALL captured Network_Requests, parsing the HAR file then re-serializing it then parsing it again SHALL produce an equivalent set of entries (round-trip property).

---

### Requirement 6: CLI Usability

**User Story:** As a developer, I want clear CLI help and error messages, so that I can use the tool without reading documentation.

#### Acceptance Criteria

1. WHEN the `--help` or `-h` flag is provided, THE Analyzer SHALL print usage instructions including all supported flags and exit with status code 0.
2. WHEN no arguments are provided, THE Analyzer SHALL print a short usage hint to stderr and exit with a non-zero status code.
3. THE Analyzer SHALL print progress indicators to stderr during capture (e.g., "Loading page...", "Capturing network activity...", "Generating report...") so that stdout remains clean for piping the report.
4. IF an unrecognized flag is provided, THEN THE Analyzer SHALL print an error naming the unrecognized flag and exit with a non-zero status code.
