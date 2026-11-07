# TrueForge Coding Agent: Video Demo & Evaluation Walkthrough

This guide provides the exact script and step-by-step instructions to demonstrate the five mandatory capabilities and the three fixed Flask tasks for the **TrueFoundry Forge-a-thon at Techfest, IIT Bombay**.

---

## ⏱ 3-Minute Video Structure

| Timestamp | Section | Key Visual & Action | Scoring Rubric |
| :--- | :--- | :--- | :--- |
| **0:00 – 0:30** | **Architecture & Status** | Status bar `$(zap) TrueForge: Online`, Local MCP server (`:4545`), Context Inspector | TrueForge Integration (10 pts) |
| **0:30 – 1:15** | **Task A: Inline Editing** | `Ctrl+K` on `get_debug_flag`, prompt, side-by-side diff, hunk accept, bash verification `False` | Inline Editing (10 pts), Diff Safety (10 pts) |
| **1:15 – 2:05** | **Task B: Agent Mode** | High-level CLI prompt, autonomous discovery of 3 files, timeline events, `pytest` pass | Agent Mode (10 pts), Context Assembly (15 pts) |
| **2:05 – 2:40** | **Task C: Resilience & Fallback**| Invalid API key / network drop simulation, automatic secondary model failover, clean git status | Resilience (10 pts), Streaming (10 pts) |
| **2:40 – 3:00** | **Conclusion & Recap** | Diff Review Hub, per-hunk rejection, zero silent writes summary | Technical Depth |

---

## 🎬 Step-by-Step Recording Instructions

### 1. Pre-Recording Setup
1. Launch the local TrueForge harness:
   ```bash
   npx @truefoundry/trueforge
   ```
2. Open VS Code on the `iitb-hackathon` workspace and press `F5` to start the **Extension Development Host**.
3. Open `fixtures/flask` in the development host.

---

### 2. Scene 1: Task A — Inline Editing (`Ctrl+K`)
1. Open [`src/flask/helpers.py`](file:///fixtures/flask/src/flask/helpers.py).
2. Select lines 28–34 (`get_debug_flag` function):
   ```python
   def get_debug_flag() -> bool:
       """Get whether debug mode should be enabled..."""
       val = os.environ.get("FLASK_DEBUG")
       return bool(val and val.lower() not in {"0", "false", "no"})
   ```
3. Press `Ctrl+K` (or `Cmd+K` on macOS).
4. Enter instruction:
   > *"Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false."*
5. Show the native VS Code side-by-side diff viewer (`vscode.diff`) with the green/red additions and deletions.
6. Click **"Accept Changes"**.
7. In the terminal, run the judge's verification command:
   ```bash
   FLASK_DEBUG=off python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"
   ```
8. Highlight the terminal output: `False`.

---

### 3. Scene 2: Task B — Autonomous Multi-File Discovery & Agent Mode
1. Open the **TrueForge Agent Workspace** sidebar tab.
2. Click the **"Preset: Task B"** pill or enter:
   > *"Add a new built-in CLI command flask config that prints the loaded application's configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY as '***'. It must appear in flask --help, be covered by a test, and be documented alongside the other built-in commands."*
3. Click **Execute Run**.
4. Switch to the **Timeline** tab to show live TrueForge SSE events:
   - `searching`: Scanning repository with ripgrep.
   - `reading`: Inspecting Click command registrations.
   - `tool_call`: Executing `propose_edit` across 3 files.
5. Switch to the **Context** tab to highlight the **Explainable Context Inspector**:
   - Show token budget progress (`~1,840 / 8,000 tokens`).
   - Show why each file was selected:
     - `src/flask/cli.py` (implementation)
     - `tests/test_cli.py` (test coverage)
     - `docs/cli.rst` (documentation)
6. Switch to the **Changes** tab:
   - Show that **3 files** are staged.
   - Demonstrate hunk review: click **"Accept All"**.
7. Open terminal and run:
   ```bash
   pytest tests/test_cli.py -q
   ```
8. Show all tests passing.

---

### 4. Scene 3: Task C — Resilience & Fault Tolerance
1. Temporarily configure an invalid API key or offline endpoint.
2. Trigger a prompt run.
3. Show the **Timeline** tab:
   - Notice the primary model failure event.
   - Notice the automatic failover event: `Resilience: Failing over to secondary model [gemini/gemini-2.5-pro]...`.
   - The turn recovers and completes smoothly.
4. Show `git status` in the terminal:
   ```bash
   git status
   ```
   Highlight that the working tree is clean with **zero corrupted or half-written files**.

---

### 5. Final Key Message
> *"Our agent understands before it edits, explains why context was selected, never writes silently to disk, and gives the developer complete hunk-by-hunk control."*
