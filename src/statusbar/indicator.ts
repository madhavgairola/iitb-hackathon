import * as vscode from 'vscode';
import { TrueForgeHarnessClient } from '../harness/client';

export class TrueForgeStatusBarIndicator {
  private statusBarItem: vscode.StatusBarItem;
  private harnessClient: TrueForgeHarnessClient;
  private timer?: NodeJS.Timeout;

  constructor(harnessClient: TrueForgeHarnessClient) {
    this.harnessClient = harnessClient;
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = 'trueforge.checkHealth';
    this.statusBarItem.tooltip = 'Click to check TrueForge Harness status';
  }

  public start(): void {
    this.statusBarItem.show();
    this.updateStatus();
    // Poll health status every 30 seconds
    this.timer = setInterval(() => this.updateStatus(), 30000);
  }

  public async updateStatus(): Promise<void> {
    const health = await this.harnessClient.checkHealth();
    if (health.online) {
      this.statusBarItem.text = `$(zap) TrueForge: Online`;
      this.statusBarItem.backgroundColor = undefined;
      this.statusBarItem.tooltip = `TrueForge Harness Connected: ${health.message}`;
    } else {
      this.statusBarItem.text = `$(warning) TrueForge: Offline`;
      this.statusBarItem.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.warningBackground'
      );
      this.statusBarItem.tooltip = `TrueForge Harness Unreachable: ${health.message}`;
    }
  }

  public refresh(): void {
    this.updateStatus();
  }

  public dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.statusBarItem.dispose();
  }
}
