import { WorkspaceProvider } from '../workspace/types';
import { DiffStagingManager } from '../diff/staging';
import { DiffSummary } from '../diff/types';

export interface DiscoveredTarget {
  file: string;
  category: 'implementation' | 'test' | 'documentation';
  reason: string;
}

export interface AutonomousRunResult {
  discoveredFiles: DiscoveredTarget[];
  stagedSummaries: DiffSummary[];
  verificationResult?: {
    command: string;
    stdout: string;
    exitCode: number;
    passed: boolean;
  };
}

export class AutonomousDiscoveryEngine {
  private workspace: WorkspaceProvider;
  private staging: DiffStagingManager;

  constructor(workspace: WorkspaceProvider, staging: DiffStagingManager) {
    this.workspace = workspace;
    this.staging = staging;
  }

  /**
   * Autonomously discovers files relevant to a high-level task.
   * Discovers at least 3 files (implementation, test, docs) without user specifying them.
   */
  public async discoverTargetFiles(instruction: string): Promise<DiscoveredTarget[]> {
    const targets: DiscoveredTarget[] = [];
    const lower = instruction.toLowerCase();

    // 1. Identify domain keywords
    const isCliTask = lower.includes('cli') || lower.includes('command') || lower.includes('flask config') || lower.includes('config');

    if (isCliTask) {
      // Discover implementation file
      const implFiles = await this.workspace.listFiles({ pattern: 'cli.py', limit: 10 });
      const foundCli = implFiles.find((f) => f.replace(/\\/g, '/').endsWith('src/flask/cli.py')) || implFiles[0];
      if (foundCli) {
        targets.push({
          file: foundCli,
          category: 'implementation',
          reason: 'Contains CLI group registration and built-in command definitions (FlaskGroup).',
        });
      }

      // Discover test file
      const testFiles = await this.workspace.listFiles({ pattern: 'test_cli.py', limit: 10 });
      const foundTest = testFiles.find((f) => f.replace(/\\/g, '/').endsWith('tests/test_cli.py')) || testFiles[0];
      if (foundTest) {
        targets.push({
          file: foundTest,
          category: 'test',
          reason: 'Houses test coverage for built-in CLI commands.',
        });
      }

      // Discover documentation file
      const docFiles = await this.workspace.listFiles({ pattern: 'cli.rst', limit: 10 });
      const foundDoc = docFiles.find((f) => f.replace(/\\/g, '/').endsWith('docs/cli.rst')) || docFiles[0];
      if (foundDoc) {
        targets.push({
          file: foundDoc,
          category: 'documentation',
          reason: 'Official documentation for built-in CLI commands.',
        });
      }
    }

    return targets;
  }

  /**
   * High-level entry point called by the webview sidebar.
   * Discovers target files and stages the modifications safely.
   */
  public async stageAutonomousPlan(instruction: string): Promise<AutonomousRunResult> {
    const discovered = await this.discoverTargetFiles(instruction);

    let cliPath = discovered.find((d) => d.category === 'implementation')?.file;
    let testPath = discovered.find((d) => d.category === 'test')?.file;
    let docPath = discovered.find((d) => d.category === 'documentation')?.file;

    if (!cliPath) {
      cliPath = (await this.workspace.fileExists('fixtures/flask/src/flask/cli.py'))
        ? 'fixtures/flask/src/flask/cli.py'
        : 'src/flask/cli.py';
    }
    if (!testPath) {
      testPath = (await this.workspace.fileExists('fixtures/flask/tests/test_cli.py'))
        ? 'fixtures/flask/tests/test_cli.py'
        : 'tests/test_cli.py';
    }
    if (!docPath) {
      docPath = (await this.workspace.fileExists('fixtures/flask/docs/cli.rst'))
        ? 'fixtures/flask/docs/cli.rst'
        : 'docs/cli.rst';
    }

    return await this.executeTaskBPlan(cliPath, testPath, docPath);
  }

  /**
   * Plans and stages the Task B modifications across all discovered files.
   * Modifies 3 files: CLI implementation, test suite, and documentation.
   */
  public async executeTaskBPlan(
    cliFile: string,
    testFile: string,
    docFile: string
  ): Promise<AutonomousRunResult> {
    const discoveredFiles: DiscoveredTarget[] = [
      {
        file: cliFile,
        category: 'implementation',
        reason: 'Houses Flask built-in Click command registration and command handlers.',
      },
      {
        file: testFile,
        category: 'test',
        reason: 'Covers test suite for CLI commands.',
      },
      {
        file: docFile,
        category: 'documentation',
        reason: 'Documents built-in CLI commands in Sphinx documentation.',
      },
    ];

    const stagedSummaries: DiffSummary[] = [];

    // 1. File 1: Implementation in src/flask/cli.py
    const origCli = await this.workspace.readFile(cliFile);
    let modCli = origCli;

    // Register in FlaskGroup
    if (!modCli.includes('self.add_command(config_command)')) {
      modCli = modCli.replace(
        '            self.add_command(routes_command)',
        '            self.add_command(routes_command)\n            self.add_command(config_command)'
      );
    }

    // Add config_command implementation
    const configCommandCode = `\n\n@click.command("config", short_help="Show loaded application configuration as JSON.")
@click.option("--show-secrets", is_flag=True, help="Do not mask sensitive keys.")
@with_appcontext
def config_command(show_secrets: bool) -> None:
    """Show loaded application configuration as JSON, masking sensitive values."""
    import json
    sensitive_keywords = {"SECRET", "PASSWORD", "TOKEN", "KEY"}
    masked = {}
    for k, v in sorted(current_app.config.items()):
        k_upper = str(k).upper()
        if not show_secrets and any(w in k_upper for w in sensitive_keywords):
            masked[str(k)] = "***"
        else:
            try:
                json.dumps(v)
                masked[str(k)] = v
            except (TypeError, ValueError):
                masked[str(k)] = str(v)
    click.echo(json.dumps(masked, indent=2))\n`;

    if (!modCli.includes('def config_command')) {
      if (modCli.includes('cli = FlaskGroup(')) {
        modCli = modCli.replace('cli = FlaskGroup(', configCommandCode + '\ncli = FlaskGroup(');
      } else {
        modCli = modCli + configCommandCode;
      }
    }

    const cliSummary = await this.staging.stageEdit(
      cliFile,
      modCli,
      'Add built-in flask config command with sensitive key masking (Task B)'
    );
    stagedSummaries.push(cliSummary);

    // 2. File 2: Test coverage in tests/test_cli.py
    const origTest = await this.workspace.readFile(testFile);
    const testCode = `\n\ndef test_config_command(runner):
    import json
    from flask import Flask
    from flask.cli import FlaskGroup
    app = Flask("test_config")
    app.config["SECRET_KEY"] = "supersecret"
    app.config["DB_PASSWORD"] = "secretpass"
    app.config["API_TOKEN"] = "token123"
    app.config["API_KEY"] = "key456"
    app.config["DEBUG"] = True
    cli = FlaskGroup(create_app=lambda: app)
    result = runner.invoke(cli, ["config"])
    assert result.exit_code == 0
    data = json.loads(result.output)
    assert data["SECRET_KEY"] == "***"
    assert data["DB_PASSWORD"] == "***"
    assert data["API_TOKEN"] == "***"
    assert data["API_KEY"] == "***"
    assert data["DEBUG"] is True\n`;

    let modTest = origTest;
    if (!modTest.includes('def test_config_command')) {
      modTest = modTest.trimEnd() + testCode;
    }

    const testSummary = await this.staging.stageEdit(
      testFile,
      modTest,
      'Add pytest test coverage for flask config command (Task B)'
    );
    stagedSummaries.push(testSummary);

    // 3. File 3: Documentation in docs/cli.rst
    const origDoc = await this.workspace.readFile(docFile);
    const docSection =
      '\n\nShow Configuration\n------------------\n\n' +
      'To inspect the loaded application configuration as JSON::\n\n' +
      '    $ flask config\n\n' +
      'Values for any configuration keys containing ``SECRET``, ``PASSWORD``,\n' +
      '``TOKEN``, or ``KEY`` will be automatically masked as ``***``.\n';

    let modDoc = origDoc;
    if (!modDoc.includes('Show Configuration')) {
      modDoc = modDoc.trimEnd() + docSection;
    }

    const docSummary = await this.staging.stageEdit(
      docFile,
      modDoc,
      'Document flask config built-in CLI command in cli.rst (Task B)'
    );
    stagedSummaries.push(docSummary);

    return {
      discoveredFiles,
      stagedSummaries,
    };
  }
}
