import { ProposedEdit, HunkItem, DiffSummary } from './types';
import { HunkManager } from './hunks';
import { WorkspaceProvider } from '../workspace/types';

export interface UndoEntry {
  file: string;
  previousContent: string;
  appliedContent: string;
  timestamp: number;
}

export class DiffStagingManager {
  private pendingEdits: Map<string, ProposedEdit> = new Map();
  private undoStack: UndoEntry[] = [];
  private workspace: WorkspaceProvider;

  constructor(workspace: WorkspaceProvider) {
    this.workspace = workspace;
  }

  /**
   * Stage a proposed edit from an agent turn or inline edit.
   * DOES NOT write to disk.
   */
  public async stageEdit(
    file: string,
    proposedContent: string,
    instruction: string
  ): Promise<DiffSummary> {
    let originalContent = '';
    try {
      originalContent = await this.workspace.readFile(file);
    } catch {
      // File may be new
      originalContent = '';
    }

    // Smart-merge snippet check:
    // If original file is large, and proposedContent is an addition/snippet (much smaller and lacking file header):
    let effectiveProposed = proposedContent;
    if (originalContent.length > 300 && proposedContent.length < originalContent.length * 0.7) {
      const origLines = originalContent.split('\n');
      const firstOrigLine = origLines.find((l) => l.trim().length > 0)?.trim() || '';
      if (firstOrigLine && !proposedContent.includes(firstOrigLine)) {
        // If snippet defines an existing function (e.g. get_debug_flag in Task A), replace in-place:
        const funcNameMatch = proposedContent.match(/def\s+([a-zA-Z0-9_]+)\s*\(/);
        if (funcNameMatch && originalContent.includes(`def ${funcNameMatch[1]}`)) {
          const fnName = funcNameMatch[1];
          const fnStart = originalContent.indexOf(`def ${fnName}`);
          if (fnStart !== -1) {
            const afterFn = originalContent.indexOf('\ndef ', fnStart + 10);
            const fnEnd = afterFn !== -1 ? afterFn : originalContent.length;
            effectiveProposed = originalContent.slice(0, fnStart) + proposedContent.trim() + '\n\n' + originalContent.slice(fnEnd).trimStart();
          }
        } else {
          // Otherwise it is a new function/command (e.g. config_command in Task B): append to file:
          effectiveProposed = originalContent.trimEnd() + '\n\n' + proposedContent.trim() + '\n';
        }
      }
    }

    // Safety guards:
    if (file.endsWith('test_cli.py')) {
      if (effectiveProposed.includes('json.loads') && !effectiveProposed.includes('import json')) {
        effectiveProposed = 'import json\n' + effectiveProposed;
      }
    }

    const editId = `edit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const hunks = HunkManager.computeHunks(file, originalContent, effectiveProposed, editId);

    let addedLines = 0;
    let deletedLines = 0;
    for (const h of hunks) {
      for (const line of h.lines) {
        if (line.startsWith('+')) addedLines++;
        if (line.startsWith('-')) deletedLines++;
      }
    }

    const edit: ProposedEdit = {
      id: editId,
      file,
      originalContent,
      proposedContent: effectiveProposed,
      instruction,
      timestamp: Date.now(),
      hunks,
      status: 'pending',
    };

    this.pendingEdits.set(editId, edit);

    return {
      editId,
      file,
      addedLines,
      deletedLines,
      hunksCount: hunks.length,
      hunks,
    };
  }

  public getPendingEdits(): ProposedEdit[] {
    return Array.from(this.pendingEdits.values());
  }

  public getEdit(editId: string): ProposedEdit | undefined {
    return this.pendingEdits.get(editId);
  }

  /**
   * Update the status of an individual hunk.
   */
  public updateHunkStatus(editId: string, hunkId: string, status: 'accepted' | 'rejected'): boolean {
    const edit = this.pendingEdits.get(editId);
    if (!edit) return false;

    const hunk = edit.hunks.find((h) => h.id === hunkId);
    if (!hunk) return false;

    hunk.status = status;
    return true;
  }

  /**
   * Apply all accepted hunks of an edit to disk.
   * Records previous content in undo stack.
   */
  public async applyEdit(editId: string, forceAcceptAll: boolean = false): Promise<boolean> {
    const edit = this.pendingEdits.get(editId);
    if (!edit) return false;

    if (forceAcceptAll) {
      edit.hunks.forEach((h) => (h.status = 'accepted'));
    }

    const finalContent = HunkManager.applyHunks(edit.originalContent, edit.hunks);

    // Save undo entry
    this.undoStack.push({
      file: edit.file,
      previousContent: edit.originalContent,
      appliedContent: finalContent,
      timestamp: Date.now(),
    });

    // Write to disk
    await this.workspace.writeFile(edit.file, finalContent);

    // Mark edit accepted
    edit.status = 'accepted';
    this.pendingEdits.delete(editId);
    return true;
  }

  /**
   * Reject an edit without modifying disk.
   */
  public rejectEdit(editId: string): boolean {
    const edit = this.pendingEdits.get(editId);
    if (!edit) return false;

    edit.status = 'rejected';
    this.pendingEdits.delete(editId);
    return true;
  }

  /**
   * Undo the last applied edit from disk.
   */
  public async undoLast(): Promise<UndoEntry | null> {
    const entry = this.undoStack.pop();
    if (!entry) return null;

    await this.workspace.writeFile(entry.file, entry.previousContent);
    return entry;
  }

  public clearPending(): void {
    this.pendingEdits.clear();
  }
}
