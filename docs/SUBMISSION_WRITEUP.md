# TrueForge Coding Agent — Competition Submission Write-Up

---

## 1. Team

- **Team Name / Author:** Independent Developer Submission
- **Repository:** `https://github.com/madhavgairola/iitb-hackathon`
- **Competition:** Techfest 2026–27 TrueFoundry Forge-a-thon, IIT Bombay

---

## 2. Starting Point

- **Target Repository & Benchmark:** Pallets Flask (`https://github.com/pallets/flask`), release tag `3.1.3`, commit `22d924701a6ae2e4cd01e9a15bbaf3946094af65` (~17,000 lines of Python).
- **Extension Scaffolding:** Clean TypeScript VS Code extension architecture bundled with esbuild, utilizing `@truefoundry/trueforge-sdk` (v0.184.1) and `@modelcontextprotocol/sdk` (v1.6.1).
- **Test Infrastructure:** Built from the ground up with Vitest, including 6 dedicated test suites, 22 automated unit/integration tests, in-memory workspace abstractions, and Python fixture validation harnesses.

---

## 3. Architecture on TrueForge

```
┌─────────────────────────────────────────────────────────────┐
│                 VS Code Extension Client                    │
│                                                             │
│  ┌───────────────────────┐       ┌──────────────────────┐  │
│  │   4-Tab Webview UI    │       │ Inline Editor Ctrl+K │  │
│  │ (Chat/Timeline/Diff)  │       │ (Virtual Text Doc)   │  │
│  └───────────▲───────────┘       └──────────▲───────────┘  │
│              │                              │               │
│  ┌───────────▼──────────────────────────────▼───────────┐  │
│  │     TrueForgeHarnessClient (src/harness/client.ts)   │  │
│  │  • Session Manager  • Turn Streamer  • Fallback Engine│  │
│  └───────────────────────────▲──────────────────────────┘  │
└──────────────────────────────┼──────────────────────────────┘
                               │ HTTP / SSE (Port 8790)
┌──────────────────────────────▼──────────────────────────────┐
│                    TrueForge Agent Harness                  │
│                                                             │
│  • Agent Registry: `vscode-coding-agent`, `vscode-inline`   │
│  • Session Lifecycle & Turn Coordination                    │
│  • Tool Approval & Execution Router                         │
│  • Model Router Adapter (@ai-sdk/openai-compatible)        │
└──────────────┬──────────────────────────────▲───────────────┘
               │ Remote MCP Tools             │ LLM Tokens
               │ (Port 4545)                  │
┌──────────────▼──────────────┐ ┌─────────────▼───────────────┐
│     Local MCP Server        │ │      Requesty AI Gateway    │
│  (src/mcp/server.ts)        │ │  (router.requesty.ai/v1)    │
│                             │ │                             │
│  • read_file                │ │  Primary: openai/gpt-4o     │
│  • list_files               │ │  Fallback: gemini-2.5-pro   │
│  • search_workspace         │ └─────────────────────────────┘
│  • find_symbol              │
│  • propose_edit (Staging)   │
│  • run_terminal             │
└─────────────────────────────┘
```

- **Harness Execution Loop:** All execution cycles run strictly through the local TrueForge daemon (`http://localhost:8790`). The extension never invokes LLMs directly.
- **Remote MCP Architecture:** Editor capabilities are served over an HTTP/SSE server on port `4545` implementing the Model Context Protocol. Each incoming connection is isolated into a dedicated protocol instance to ensure high concurrency without transport contention.
- **Diff Review & Zero Silent Writes:** Agent-proposed edits invoke the `propose_edit` tool, placing changes into an in-memory staging buffer. Changes are segmented into Myers diff hunks, previewed side-by-side using `trueforge-preview:` virtual documents, and applied only upon explicit user consent.

---

## 4. How Context is Selected

1. **Explicit Mentions (`@file:`, `@symbol:`):** Parsed with top priority. File contents and symbol definitions (extracted via AST regex matching) are loaded directly into the top of the prompt payload.
2. **Autonomous Keyword Discovery:** Scans the repository for keywords present in the user prompt (e.g. `cli`, `config`, `command`, `flag`). Files are ranked by occurrence frequency and structural relevance (e.g., separating core implementation, test files, and documentation).
3. **Strict Token Budgeting:** Context is metered at ~4 characters per token against an 8,000-token ceiling. Low-relevance files are pruned once the budget threshold is reached.
4. **Explainability Engine:** Every retrieved file is accompanied by an explainability badge detailing *why* it was selected (e.g., `Matched keyword 'get_debug_flag' at line 28`), visible in the dedicated **Context Inspector** sidebar tab.

---

## 5. Model Setup

- **AI Gateway:** Requesty Router (`https://router.requesty.ai/v1`), configured in TrueForge as a `custom` provider to leverage standard OpenAI Chat Completions streaming with tool calling.
- **Primary Model:** `openai/gpt-4o`
  - High accuracy in structured tool calling (`read_file`, `propose_edit`).
  - Low latency (~1.5s time-to-first-token).
  - Context window: 128,000 tokens; max output tokens: 16,000.
- **Fallback / Resilience Model:** `gemini/gemini-2.5-pro` (or `gemini-2.0-flash`)
  - Massive context capability and independent infrastructure.
  - Automatically engaged by the harness resilience controller if the primary provider returns 401, 429, 502, 503, or connection dropouts.

---

## 6. Scorecard

| Criterion | Target Requirement | Status | Evidence / Timestamps |
| :--- | :--- | :---: | :--- |
| **Task A: Inline Editing** | `get_debug_flag` & `get_load_dotenv` recognize `'off'` and `'n'` as false | **PASS** | Evaluated via Python 3.13: `FLASK_DEBUG=off`, `OFF`, `n`, `N` all return `False`. (Demo: 0:30–1:15) |
| **Task B: Agent Mode** | Autonomous discovery & staging across 3 files for `flask config` | **PASS** | Discovers `src/flask/cli.py`, `tests/test_cli.py`, and `docs/cli.rst`. Verified `flask --help` and JSON masking. (Demo: 1:15–2:05) |
| **Task C: Resilience** | Automatic model failover with zero dirty files in git | **PASS** | Primary model provider error triggers automatic failover to secondary model; `git status` remains clean. (Demo: 2:05–2:40) |
| **Diff Review Safety** | In-memory staging, per-hunk accept/reject, undo stack | **PASS** | Myers diff hunks, native `vscode.diff` preview, single-click rollback. (Demo: 0:50, 1:55) |
| **Context Assembly** | @mentions, token budgeter, explainability inspector | **PASS** | 8,000-token budget meter and human-readable selection reasons. (Demo: 1:30) |

---

## 7. Tools Used

- **Agent Harness:** TrueForge local daemon v0.184.2 (`@truefoundry/trueforge-sdk`)
- **Model Context Protocol:** `@modelcontextprotocol/sdk` v1.6.1
- **IDE Runtime:** Visual Studio Code Extension Host API (`vscode`)
- **Bundler:** esbuild (fast CJS bundling)
- **Test Framework:** Vitest v3.2.7 (22 automated tests)
- **AI Coding Assistant Disclosure:** Google Antigravity was utilized for architecture design, refactoring, and test authoring.

---

## 8. Known Limitations & What We Would Do With Another Month

1. **Tree-Sitter Semantic AST Parsing:** Currently, symbol detection uses regex and lexical patterns. With more time, we would embed WebAssembly-based Tree-Sitter grammars for full syntax-tree symbol resolution across Python, TypeScript, Rust, and Go.
2. **Terminal Pty Feedback Loop:** While `run_terminal` captures exit codes and stdout/stderr, integrating terminal pseudo-terminals (`vscode.window.createTerminal`) would allow developers to view interactive CLI progress in real time.
3. **Multi-Agent Swarm Collaboration:** Expand TrueForge subagents to assign specialized roles (e.g. a dedicated Test-Runner Agent and a Documentation Agent working in parallel under the master coding agent).
