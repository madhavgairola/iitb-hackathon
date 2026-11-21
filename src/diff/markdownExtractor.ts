/**
 * Extracts proposed files and contents from markdown code blocks
 * when an LLM writes file-labeled code blocks in its text response
 * instead of invoking propose_edit.
 */
export interface ExtractedFile {
  path: string;
  content: string;
}

const FILE_PATH_REGEX =
  /([a-zA-Z0-9_]+(?:[\/\\][a-zA-Z0-9_.-]+)+\.(?:py|rst|md|ts|tsx|js|jsx|json|html|css|yml|yaml|toml|txt|sh)|[a-zA-Z0-9_.-]+\.(?:py|rst|md|ts|tsx|js|jsx|json|html|css|yml|yaml|toml|txt|sh))/g;

export function extractFilesFromMarkdownText(text: string): ExtractedFile[] {
  const fileMap = new Map<string, string>();
  const fenceRegex = /```([a-zA-Z0-9_-]*)\r?\n([\s\S]*?)\r?\n```/g;

  let lastFenceEnd = 0;
  let match: RegExpExecArray | null;

  while ((match = fenceRegex.exec(text)) !== null) {
    const lang = (match[1] || '').toLowerCase().trim();
    const content = match[2];
    const precedingText = text.slice(lastFenceEnd, match.index);
    lastFenceEnd = match.index + match[0].length;

    if (!content || !content.trim()) {
      continue;
    }

    // Look at the last 8 non-empty lines before the code fence
    const precedingLines = precedingText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .slice(-8);

    const precedingChunk = precedingLines.join('\n');
    const isDocSection =
      /documentation\s+update|update\s+documentation|cli\s+documentation|docs\/cli\.rst/i.test(precedingChunk) ||
      lang === 'rst' ||
      (lang === 'plaintext' && /^[a-z0-9_-]+\r?\n-{4,}/i.test(content.trim()));

    // Also check if the first line inside the code block has a file comment e.g. # File: src/flask/cli.py
    const firstContentLine = content.trim().split(/\r?\n/)[0] || '';
    let detectedPath: string | undefined;

    if (/^(?:#|\/\/|<!--)\s*(?:File|Path)?:\s*([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9_-]+)/i.test(firstContentLine)) {
      const commentMatch = firstContentLine.match(
        /^(?:#|\/\/|<!--)\s*(?:File|Path)?:\s*([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9_-]+)/i
      );
      if (commentMatch) {
        detectedPath = commentMatch[1];
      }
    }

    // Search preceding lines from bottom to top, prioritizing headings / bold lines
    if (!detectedPath) {
      const headingLines = precedingLines.filter(
        (l) => l.startsWith('#') || l.includes('**') || l.includes('File:') || l.includes('Path:') || l.includes('(')
      );
      const searchOrder = [...headingLines.reverse(), ...precedingLines.slice().reverse()];

      for (const line of searchOrder) {
        FILE_PATH_REGEX.lastIndex = 0;
        let pathMatch: RegExpExecArray | null;
        const candidates: string[] = [];
        while ((pathMatch = FILE_PATH_REGEX.exec(line)) !== null) {
          const candidate = pathMatch[1].replace(/^[`*]+|[`*]+$/g, '').replace(/\\/g, '/');
          // Ignore things like e.g. or db.example.com
          if (candidate.includes('example.com')) continue;
          candidates.push(candidate);
        }
        if (candidates.length > 0) {
          // Prefer paths with directory separators (e.g. src/flask/cli.py over cli.py)
          detectedPath = candidates.find((c) => c.includes('/')) || candidates[0];
          break;
        }
      }
    }

    // If this is clearly a documentation section in rst/plaintext format, map to docs/cli.rst
    if (isDocSection && (!detectedPath || detectedPath.endsWith('cli.py'))) {
      detectedPath = 'docs/cli.rst';
    }

    if (!detectedPath) {
      continue;
    }

    const cleanPath = detectedPath.trim().replace(/^[`*]+|[`*]+$/g, '').replace(/\\/g, '/');

    // If we already captured a larger implementation block for this file, don't overwrite it with a 2-line registration snippet
    const existing = fileMap.get(cleanPath);
    if (existing) {
      if (content.trim().split(/\r?\n/).length <= 4 && existing.split(/\r?\n/).length > 4) {
        continue;
      }
      // If both are substantial blocks for the same file, combine them
      fileMap.set(cleanPath, existing.trimEnd() + '\n\n' + content.trim());
    } else {
      fileMap.set(cleanPath, content);
    }
  }

  return Array.from(fileMap.entries()).map(([path, content]) => ({
    path,
    content,
  }));
}
