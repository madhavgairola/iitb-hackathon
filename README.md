# TrueForge AI Coding Agent for VS Code

[![TrueForge Harness](https://img.shields.io/badge/Harness-TrueForge-blue.svg)](https://github.com/truefoundry/trueforge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/Language-TypeScript-blue.svg)](https://www.typescriptlang.org/)
[![Tests: 21 Passed](https://img.shields.io/badge/Tests-21%20Passed-brightgreen.svg)]()

An intelligent, repository-aware coding agent built as a Visual Studio Code extension for the **TrueFoundry Forge-a-thon at Techfest, IIT Bombay 2026–27**.

Powered by **TrueForge**, TrueFoundry's open-source agent harness, with custom editor capabilities exposed via the **Model Context Protocol (MCP)**.

---

## 🎯 Five Mandatory Capabilities Covered

1. **Inline Editing (`Ctrl+K` / `Cmd+K`)**:
   - Highlight any code region, press `Ctrl+K`, enter instructions.
   - Generates side-by-side diff previews directly inside VS Code (`vscode.diff`).
   - Accept or reject per hunk. No silent disk writes.
2. **Autonomous Agent Mode**:
   - High-level repository exploration where the agent independently navigates files, searches code with ripgrep, plans edits across multiple files, and runs verification commands.
   - Successfully discovers which files need modification without the user naming them (tested & verified on Task B).
3. **Explainable Context Assembly**:
   - Explicit `@file` and `@symbol` mentions with top priority.
   - Relevance-based retrieval with strict token budgeting (~4 chars per token).
   - Context Inspector shows scanned files, selected files, and *why* each file was chosen.
4. **Diff Review & Safety**:
   - Zero silent writes to disk. In-memory staging buffer.
   - Hunk-by-hunk diff view with individual accept/reject toggles.
   - Full transaction rollback and undo history via VS Code `WorkspaceEdit`.
5. **Streaming, Activity Timeline & Resilience**:
   - Token-by-token text streaming.
   - Live Activity Timeline driven directly by TrueForge SSE events (`thinking`, `tool_call`, `tool_result`, `done`).
   - Non-destructive cancellation and automatic model failover (Task C).

---

## 🏛 Architecture

```mermaid
flowchart LR
    VSCode["VS Code Extension Host"] <--> |"HTTP / SSE (SDK)"| TF["TrueForge Harness (Local :8790)"]
    TF <--> |"Model Provider API"| LLM["Configured Model Provider\n(OpenAI / Anthropic / Gemini)"]
    TF <--> |"MCP Remote (HTTP/SSE)"| MCPServer["Extension Local MCP Server (:4545)"]
    MCPServer <--> |"Workspace APIs"| Workspace["Editor / Git / Filesystem"]
```

### Components
- **Harness Client (`src/harness/client.ts`)**: Uses `@truefoundry/trueforge-sdk` to manage sessions, turns, and event streaming.
- **Local MCP Server (`src/mcp/server.ts`)**: Exposes `read_file`, `search_workspace`, `list_files`, `find_symbol`, `propose_edit`, and `run_terminal` over HTTP/SSE on port `4545`.
- **Diff Staging Engine (`src/diff/staging.ts`, `src/diff/hunks.ts`)**: Buffers proposed changes, calculates unified diff hunks, and safely applies accepted changes with reverse line order to prevent line-drift.
- **Explainable Context Assembler (`src/context/assembler.ts`)**: Token budget manager and relevance retriever.
- **Sidebar Workspace UI (`src/webview/`)**: 4-tab interface (Workspace, Timeline, Context, Changes).

---

## 🧪 Fixed Competition Tasks Verification

Evaluated against the official benchmark repository: **Flask 3.1.3** (`commit: 22d92470`):

| Task | Target | Requirements | Verification | Result |
| :--- | :--- | :--- | :--- | :--- |
| **Task A: Inline Editing** | `src/flask/helpers.py` (`get_debug_flag`) | Treat `'off'` and `'n'` as false case-insensitively, update docstring | `FLASK_DEBUG=off python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"` | ✅ Outputs `False` |
| **Task B: Multi-File Agent** | `src/flask/cli.py`, `tests/test_cli.py`, `docs/cli.rst` | Add `flask config`, mask sensitive keys (`SECRET`, `PASSWORD`, `TOKEN`, `KEY` as `***`), add tests, update docs | `pytest tests/test_cli.py -q` | ✅ 3 files discovered autonomously & passed |
| **Task C: Resilience** | Unreachable endpoint / invalid credentials | Responsive UI, automatic fallback to secondary model, zero dirty files | `tests/resilience.test.ts` | ✅ Failover verified, clean git tree |

For step-by-step recording instructions for the 10-point demo video, see [docs/DEMO_WALKTHROUGH.md](docs/DEMO_WALKTHROUGH.md).

---

## 🚀 Quickstart

### Prerequisites
- Node.js >= 20
- npm >= 10
- Git

### Build & Run Tests

```bash
# Clone the repository
git clone https://github.com/madhavgairola/iitb-hackathon.git
cd iitb-hackathon

# Install dependencies
npm install

# Bundle extension
npm run build

# Run all 6 test suites (21 tests)
npm test
```

### Running in VS Code
1. Open this workspace in Visual Studio Code.
2. Press `F5` to open the **Extension Development Host**.
3. Use `Ctrl+K` (or `Cmd+K`) on any selection for inline editing.
4. Open the **TrueForge Agent** icon in the Activity Bar for the full multi-turn workspace.

---

## 📄 License
MIT
