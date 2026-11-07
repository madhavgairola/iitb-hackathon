import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { WorkspaceProvider } from '../workspace/types';
import { DiffStagingManager } from '../diff/staging';

export const TOOL_DEFINITIONS: Tool[] = [
  {
    name: 'list_files',
    description: 'List files in the workspace matching an optional pattern or inside a directory.',
    inputSchema: {
      type: 'object',
      properties: {
        directory: {
          type: 'string',
          description: 'Relative directory path to list (default: workspace root).',
        },
        pattern: {
          type: 'string',
          description: 'Optional substring or extension pattern to filter files (e.g. ".py" or "test").',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of files to return (default: 150).',
        },
      },
    },
  },
  {
    name: 'read_file',
    description: 'Read the text content of a file in the workspace with line numbers and optional line range.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path of the file to read.',
        },
        start_line: {
          type: 'number',
          description: '1-based starting line number to read (inclusive).',
        },
        end_line: {
          type: 'number',
          description: '1-based ending line number to read (inclusive).',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'search_workspace',
    description: 'Search text or regex across workspace files to find definitions, usages, or keywords.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search string or regex pattern.',
        },
        is_regex: {
          type: 'boolean',
          description: 'Whether query is a regular expression (default: false).',
        },
        file_pattern: {
          type: 'string',
          description: 'Optional file extension or name pattern to narrow search (e.g. "helpers.py").',
        },
        max_results: {
          type: 'number',
          description: 'Maximum search matches to return (default: 40).',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'find_symbol',
    description: 'Search for symbols (functions, classes, methods) in the workspace or within a specific file.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Symbol name or partial name to locate (e.g. "get_debug_flag").',
        },
        path: {
          type: 'string',
          description: 'Optional relative file path to restrict the symbol search.',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'propose_edit',
    description:
      'Propose modifications to a file. NEVER silently writes to disk. Changes are placed in the Diff Review staging buffer for developer review and per-hunk acceptance.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path of the file to modify.',
        },
        instruction: {
          type: 'string',
          description: 'Natural language explanation of why this modification is made.',
        },
        proposed_content: {
          type: 'string',
          description: 'The complete revised content of the file or target region.',
        },
      },
      required: ['path', 'instruction', 'proposed_content'],
    },
  },
  {
    name: 'run_terminal',
    description:
      'Execute a shell command within the workspace (e.g. running pytest, python verification, or build commands). Captures stdout, stderr, and exit code.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Shell command line to execute.',
        },
        cwd: {
          type: 'string',
          description: 'Optional relative working directory for the command.',
        },
        timeout_ms: {
          type: 'number',
          description: 'Execution timeout in milliseconds (default: 30000).',
        },
      },
      required: ['command'],
    },
  },
];

export class ToolDispatcher {
  private workspace: WorkspaceProvider;
  private staging: DiffStagingManager;

  constructor(workspace: WorkspaceProvider, staging: DiffStagingManager) {
    this.workspace = workspace;
    this.staging = staging;
  }

  public async dispatch(
    name: string,
    args: Record<string, any>
  ): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
    try {
      switch (name) {
        case 'list_files': {
          const files = await this.workspace.listFiles({
            directory: args.directory,
            pattern: args.pattern,
            limit: args.limit,
          });
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ count: files.length, files }, null, 2),
              },
            ],
          };
        }

        case 'read_file': {
          const content = await this.workspace.readFile(args.path);
          const lines = content.split('\n');
          const start = Math.max(1, args.start_line || 1);
          const end = Math.min(lines.length, args.end_line || lines.length);

          const numberedLines: string[] = [];
          for (let i = start; i <= end; i++) {
            numberedLines.push(`${i}: ${lines[i - 1]}`);
          }

          return {
            content: [
              {
                type: 'text',
                text: `File: ${args.path} (lines ${start}-${end} of ${lines.length})\n\n${numberedLines.join('\n')}`,
              },
            ],
          };
        }

        case 'search_workspace': {
          const results = await this.workspace.searchText(args.query, {
            isRegex: args.is_regex,
            filePattern: args.file_pattern,
            maxResults: args.max_results,
          });
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ match_count: results.length, matches: results }, null, 2),
              },
            ],
          };
        }

        case 'find_symbol': {
          const symbols = await this.workspace.findSymbols(args.name, args.path);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ count: symbols.length, symbols }, null, 2),
              },
            ],
          };
        }

        case 'propose_edit': {
          const summary = await this.staging.stageEdit(
            args.path,
            args.proposed_content,
            args.instruction
          );
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    status: 'staged_for_review',
                    notice:
                      'Edit has been staged into Diff Review buffer. It will NOT be written to disk until the developer accepts it.',
                    editId: summary.editId,
                    file: summary.file,
                    addedLines: summary.addedLines,
                    deletedLines: summary.deletedLines,
                    hunksCount: summary.hunksCount,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'run_terminal': {
          const result = await this.workspace.runCommand(
            args.command,
            args.cwd,
            args.timeout_ms || 30000
          );
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
            isError: result.exitCode !== 0,
          };
        }

        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Tool error (${name}): ${err.message || String(err)}` }],
        isError: true,
      };
    }
  }
}
