/**
 * Extracts proposed files and contents from markdown code blocks
 * when an LLM writes file-labeled code blocks in its text response
 * instead of invoking propose_edit.
 */
export interface ExtractedFile {
  path: string;
  content: string;
}

export function extractFilesFromMarkdownText(text: string): ExtractedFile[] {
  const results: ExtractedFile[] = [];

  // Patterns for headers preceding code blocks:
  // 1. ### HTML (index.html) or (src/app.js)
  // 2. ### `index.html` or ### index.html
  // 3. **index.html** or **File: index.html**
  // 4. File: index.html or Path: index.html
  const blockRegex =
    /(?:###?\s*(?:[A-Za-z0-9_ -]+\s*)?\(([^)]+\.[a-zA-Z0-9_-]+)\)|###?\s*[`*]{0,2}([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9_-]+)[`*]{0,2}|\*\*([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9_-]+)\*\*|(?:File|Path):\s*[`*]{0,2}([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9_-]+)[`*]{0,2})\s*\n+```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)\r?\n```/g;

  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(text)) !== null) {
    const rawPath = match[1] || match[2] || match[3] || match[4];
    const content = match[5];
    if (rawPath && content !== undefined) {
      const cleanPath = rawPath.trim().replace(/^[`*]+|[`*]+$/g, '').replace(/\\/g, '/');
      results.push({
        path: cleanPath,
        content: content,
      });
    }
  }

  return results;
}
