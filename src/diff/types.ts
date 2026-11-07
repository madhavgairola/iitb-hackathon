export interface HunkItem {
  id: string;
  file: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
  status: 'pending' | 'accepted' | 'rejected';
}

export interface ProposedEdit {
  id: string;
  file: string;
  originalContent: string;
  proposedContent: string;
  instruction: string;
  timestamp: number;
  hunks: HunkItem[];
  status: 'pending' | 'partially_accepted' | 'accepted' | 'rejected';
}

export interface DiffSummary {
  editId: string;
  file: string;
  addedLines: number;
  deletedLines: number;
  hunksCount: number;
  hunks: HunkItem[];
}
