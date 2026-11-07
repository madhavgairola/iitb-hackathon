import * as http from 'http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { TOOL_DEFINITIONS, ToolDispatcher } from './tools';
import { WorkspaceProvider } from '../workspace/types';
import { DiffStagingManager } from '../diff/staging';

export class LocalMcpServer {
  private server: Server;
  private httpServer?: http.Server;
  private dispatcher: ToolDispatcher;
  private transports: Map<string, SSEServerTransport> = new Map();
  private port: number = 4545;

  constructor(workspace: WorkspaceProvider, staging: DiffStagingManager) {
    this.dispatcher = new ToolDispatcher(workspace, staging);

    this.server = new Server(
      {
        name: 'vscode-editor-mcp',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.registerHandlers();
  }

  private registerHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: TOOL_DEFINITIONS,
      };
    });

    // Execute tool call
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const result = await this.dispatcher.dispatch(name, args || {});
      return result;
    });
  }

  /**
   * Start the HTTP and SSE server on the specified port.
   */
  public async start(port: number = 4545): Promise<string> {
    this.port = port;

    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer(async (req, res) => {
        // Enable CORS for local cross-origin connections
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

        // Health check endpoint
        if (url.pathname === '/health' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              status: 'ok',
              name: 'vscode-editor-mcp',
              tools: TOOL_DEFINITIONS.map((t) => t.name),
            })
          );
          return;
        }

        // SSE endpoint for TrueForge connection
        if (url.pathname === '/sse' && req.method === 'GET') {
          const transport = new SSEServerTransport('/messages', res);
          const sessionId = transport.sessionId;
          this.transports.set(sessionId, transport);

          req.on('close', () => {
            this.transports.delete(sessionId);
          });

          await this.server.connect(transport);
          return;
        }

        // Message post endpoint for client RPC calls
        if (url.pathname === '/messages' && req.method === 'POST') {
          const sessionId = url.searchParams.get('sessionId');
          const transport = sessionId ? this.transports.get(sessionId) : undefined;

          if (!transport) {
            // If no specific sessionId matched or only one active transport exists, fallback
            const firstTransport = this.transports.values().next().value;
            if (firstTransport) {
              await firstTransport.handlePostMessage(req, res);
              return;
            }
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'SSE session not found or inactive' }));
            return;
          }

          await transport.handlePostMessage(req, res);
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      });

      this.httpServer.on('error', (err) => {
        reject(err);
      });

      this.httpServer.listen(this.port, '0.0.0.0', () => {
        resolve(this.getEndpointUrl());
      });
    });
  }

  public getEndpointUrl(): string {
    return `http://localhost:${this.port}/sse`;
  }

  public getPort(): number {
    return this.port;
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.httpServer) {
        this.httpServer.close(() => {
          this.transports.clear();
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
