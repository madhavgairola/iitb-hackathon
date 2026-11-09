import { ProposedEdit, HunkItem } from '../diff/types';

export interface ContextItem {
  file: string;
  reason: string;
  tokens: number;
  snippet?: string;
  explicitMention?: boolean;
}

export interface ContextBudget {
  usedTokens: number;
  maxTokens: number;
  filesScanned: number;
  filesSelected: number;
}

export interface TimelineEntry {
  id: string;
  timestamp: number;
  kind: 'thinking' | 'searching' | 'reading' | 'planning' | 'tool_call' | 'tool_result' | 'proposing' | 'done' | 'error';
  title: string;
  details?: string;
}

// Messages sent from Webview to Extension Host
export type WebviewToExtensionMessage =
  | { type: 'sendMessage'; prompt: string; model?: string }
  | { type: 'cancelRun' }
  | { type: 'openFile'; file: string }
  | { type: 'acceptHunk'; editId: string; hunkId: string }
  | { type: 'rejectHunk'; editId: string; hunkId: string }
  | { type: 'applyEdit'; editId: string; acceptAll?: boolean }
  | { type: 'rejectEdit'; editId: string }
  | { type: 'undoEdit' }
  | { type: 'checkHealth' }
  | { type: 'getWorkspaceFiles' }
  | { type: 'toggleAutoSave' }
  | { type: 'getAutoSaveState' };

// Messages sent from Extension Host to Webview
export type ExtensionToWebviewMessage =
  | { type: 'healthStatus'; online: boolean; message: string }
  | { type: 'autoSaveState'; enabled: boolean }
  | { type: 'workspaceFiles'; files: string[] }
  | { type: 'streamDelta'; text: string }
  | { type: 'timelineEvent'; entry: TimelineEntry }
  | { type: 'turnDone'; success: boolean; error?: string; usedFallback?: boolean }
  | { type: 'stagedEdits'; edits: ProposedEdit[] }
  | { type: 'contextInspected'; items: ContextItem[]; budget: ContextBudget }
  | { type: 'systemNotice'; message: string; level: 'info' | 'warning' | 'error' };
