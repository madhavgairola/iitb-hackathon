import { structuredPatch } from 'diff';
import { HunkItem } from './types';

export class HunkManager {
  /**
   * Computes hunks between original text and proposed text using Myers diff.
   */
  public static computeHunks(file: string, originalContent: string, proposedContent: string, editId: string): HunkItem[] {
    const patch = structuredPatch(file, file, originalContent, proposedContent, '', '', { context: 3 });
    const hunks: HunkItem[] = [];

    patch.hunks.forEach((hunk, index) => {
      hunks.push({
        id: `${editId}-hunk-${index}`,
        file,
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart,
        newLines: hunk.newLines,
        lines: hunk.lines,
        status: 'pending',
      });
    });

    return hunks;
  }

  /**
   * Applies accepted hunks to original content.
   * Processes hunks in bottom-to-top order to avoid line offset drift.
   */
  public static applyHunks(originalContent: string, hunks: HunkItem[]): string {
    const originalLines = originalContent.split('\n');
    const workingLines = [...originalLines];

    // Sort descending by oldStart
    const sortedHunks = [...hunks].sort((a, b) => b.oldStart - a.oldStart);

    for (const hunk of sortedHunks) {
      if (hunk.status !== 'accepted') {
        // If rejected or pending, keep original
        continue;
      }

      // Extract new lines from hunk (keep ' ' and '+' lines, omit '-' lines)
      const replacementLines: string[] = [];
      for (const line of hunk.lines) {
        const prefix = line[0];
        const text = line.substring(1);
        if (prefix === ' ' || prefix === '+') {
          replacementLines.push(text);
        }
      }

      // 1-based oldStart converts to 0-based index
      const startIndex = Math.max(0, hunk.oldStart - 1);
      const deleteCount = hunk.oldLines;

      workingLines.splice(startIndex, deleteCount, ...replacementLines);
    }

    return workingLines.join('\n');
  }

  /**
   * Generates a readable unified diff preview string for logging or UI.
   */
  public static formatHunkUnified(hunk: HunkItem): string {
    const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
    return [header, ...hunk.lines].join('\n');
  }
}
