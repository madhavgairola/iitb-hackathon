import { WorkspaceProvider } from '../workspace/types';
import { ContextItem, ContextBudget } from '../webview/types';

export interface AssembledContextResult {
  formattedContext: string;
  items: ContextItem[];
  budget: ContextBudget;
}

export class ContextAssembler {
  private workspace: WorkspaceProvider;
  private maxTokens: number;

  constructor(workspace: WorkspaceProvider, maxTokens: number = 8000) {
    this.workspace = workspace;
    this.maxTokens = maxTokens;
  }

  /**
   * Estimates token count for a text string (~4 chars per token).
   */
  public static estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Analyzes prompt, resolves explicit mentions, retrieves relevant code,
   * enforces token budget, and generates explainability records.
   */
  public async assembleContext(userPrompt: string): Promise<AssembledContextResult> {
    const items: ContextItem[] = [];
    let usedTokens = 0;
    let filesScanned = 0;

    // 1. Extract explicit @file and @symbol mentions
    // e.g. @file:src/flask/helpers.py or @symbol:get_debug_flag or @helpers.py
    const fileMentionRegex = /@file:([^\s]+)|@([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)/g;
    const symbolMentionRegex = /@symbol:([a-zA-Z0-9_]+)/g;

    const explicitFiles = new Set<string>();
    const explicitSymbols = new Set<string>();

    let match;
    while ((match = fileMentionRegex.exec(userPrompt)) !== null) {
      const rawFile = match[1] || match[2];
      const cleanFile = rawFile.replace(/[?!,;:.)]+$/, '');
      if (cleanFile) {
        explicitFiles.add(cleanFile);
      }
    }
    while ((match = symbolMentionRegex.exec(userPrompt)) !== null) {
      explicitSymbols.add(match[1]);
    }

    // 2. Load explicit files first (highest priority)
    for (const relPath of explicitFiles) {
      filesScanned++;
      try {
        const content = await this.workspace.readFile(relPath);
        const tokens = ContextAssembler.estimateTokens(content);
        if (usedTokens + tokens <= this.maxTokens) {
          items.push({
            file: relPath,
            reason: 'Explicitly mentioned by user in prompt (@file)',
            tokens,
            snippet: content.slice(0, 1500),
            explicitMention: true,
          });
          usedTokens += tokens;
        }
      } catch {
        // File may not exist
      }
    }

    // 3. Resolve explicit symbols
    for (const symName of explicitSymbols) {
      const symbols = await this.workspace.findSymbols(symName);
      filesScanned += symbols.length;
      for (const sym of symbols) {
        if (items.some((i) => i.file === sym.file)) continue;
        try {
          const content = await this.workspace.readFile(sym.file);
          const snippet = this.extractSymbolSnippet(content, sym.line);
          const tokens = ContextAssembler.estimateTokens(snippet);
          if (usedTokens + tokens <= this.maxTokens) {
            items.push({
              file: sym.file,
              reason: `Explicit @symbol '${sym.name}' matched at line ${sym.line}`,
              tokens,
              snippet,
              explicitMention: true,
            });
            usedTokens += tokens;
          }
        } catch {
          // Skip unreadable
        }
      }
    }

    // 4. Automatic relevance retrieval (keywords from user prompt)
    const keywords = this.extractKeywords(userPrompt);
    for (const keyword of keywords) {
      if (usedTokens >= this.maxTokens) break;
      const searchMatches = await this.workspace.searchText(keyword, { maxResults: 5 });
      filesScanned += searchMatches.length;

      for (const sm of searchMatches) {
        if (items.some((i) => i.file === sm.file)) continue;
        try {
          const fileContent = await this.workspace.readFile(sm.file);
          const snippet = this.extractContextWindow(fileContent, sm.line);
          const tokens = ContextAssembler.estimateTokens(snippet);

          if (usedTokens + tokens <= this.maxTokens) {
            items.push({
              file: sm.file,
              reason: `Matched relevant keyword '${keyword}' at line ${sm.line}`,
              tokens,
              snippet,
              explicitMention: false,
            });
            usedTokens += tokens;
          }
        } catch {
          // Skip unreadable
        }
      }
    }

    // 5. Format the context for prompt injection
    const formattedBlocks = items.map((item) => {
      return `--- File: ${item.file} [${item.reason}] ---\n${item.snippet}\n`;
    });

    const formattedContext =
      formattedBlocks.length > 0
        ? `\n=== REPOSITORY CONTEXT (Scanned: ${filesScanned}, Selected: ${items.length}, Budget: ${usedTokens}/${this.maxTokens} tokens) ===\n${formattedBlocks.join('\n')}\n=== END REPOSITORY CONTEXT ===\n`
        : '';

    const budget: ContextBudget = {
      usedTokens,
      maxTokens: this.maxTokens,
      filesScanned,
      filesSelected: items.length,
    };

    return {
      formattedContext,
      items,
      budget,
    };
  }

  private extractKeywords(prompt: string): string[] {
    const clean = prompt.replace(/[@#][a-zA-Z0-9_\-\.\/]+/g, '');
    const tokens = clean.split(/[^a-zA-Z0-9_]+/);
    const stopWords = new Set([
      'the', 'and', 'for', 'with', 'that', 'this', 'from', 'in', 'on', 'at', 'to',
      'a', 'an', 'is', 'are', 'was', 'were', 'it', 'as', 'be', 'of', 'treat', 'update',
      'add', 'new', 'print', 'should', 'all', 'values', 'false', 'true',
    ]);

    const keywords: string[] = [];
    for (const t of tokens) {
      const lower = t.toLowerCase();
      if (lower.length > 3 && !stopWords.has(lower) && !keywords.includes(t)) {
        keywords.push(t);
        if (keywords.length >= 4) break;
      }
    }
    return keywords;
  }

  private extractSymbolSnippet(content: string, lineIndex: number): string {
    const lines = content.split('\n');
    const start = Math.max(0, lineIndex - 2);
    const end = Math.min(lines.length, lineIndex + 25);
    return lines.slice(start, end).join('\n');
  }

  private extractContextWindow(content: string, lineIndex: number): string {
    const lines = content.split('\n');
    const start = Math.max(0, lineIndex - 5);
    const end = Math.min(lines.length, lineIndex + 15);
    return lines.slice(start, end).join('\n');
  }
}
