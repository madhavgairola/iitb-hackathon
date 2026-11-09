import * as path from 'path';
import { NodeWorkspaceProvider } from '../src/workspace/nodeProvider';
import { DiffStagingManager } from '../src/diff/staging';

async function runTaskBPytest() {
  console.log('=== TASK B PYTEST EXECUTION ===');
  const flaskRoot = path.resolve('fixtures/flask');
  const ws = new NodeWorkspaceProvider(flaskRoot);
  const staging = new DiffStagingManager(ws);

  const cliPath = 'src/flask/cli.py';
  const testPath = 'tests/test_cli.py';
  const docsPath = 'docs/cli.rst';

  const origCli = await ws.readFile(cliPath);
  const origTest = await ws.readFile(testPath);
  const origDocs = await ws.readFile(docsPath);

  const configCommandCode = `
@click.command("config", short_help="Print the loaded application's configuration as JSON.")
@click.option("--show-secrets", is_flag=True, help="Do not mask sensitive keys.")
@with_appcontext
def config_command(show_secrets: bool) -> None:
    """Print the application's configuration dictionary as formatted JSON.
    Values for keys containing SECRET, PASSWORD, TOKEN, or KEY are masked as '***'.
    """
    import json
    sensitive_keywords = {"SECRET", "PASSWORD", "TOKEN", "KEY"}
    masked_config = {}
    for k, v in current_app.config.items():
        if not show_secrets and any(s in k.upper() for s in sensitive_keywords):
            masked_config[k] = "***"
        else:
            try:
                json.dumps(v)
                masked_config[k] = v
            except (TypeError, OverflowError):
                masked_config[k] = str(v)
    click.echo(json.dumps(masked_config, indent=2, sort_keys=True))
`;

  const testConfigCode = `
def test_config_command(runner):
    app = Flask(__name__, static_folder=None)
    app.config["SECRET_KEY"] = "super-secret"
    app.config["API_TOKEN"] = "my-token"
    app.config["DB_PASSWORD"] = "secret-pass"
    app.config["ENCRYPTION_KEY"] = "secret-key"
    app.config["PUBLIC_SETTING"] = "hello"
    cli = FlaskGroup(create_app=lambda: app)
    res = runner.invoke(cli, ["config"])
    print("RES_OUTPUT:", res.output)
    assert res.exit_code == 0
    import json
    data = json.loads(res.output)
    assert data["SECRET_KEY"] == "***"
    assert data["API_TOKEN"] == "***"
    assert data["DB_PASSWORD"] == "***"
    assert data["ENCRYPTION_KEY"] == "***"
    assert data["PUBLIC_SETTING"] == "hello"
`;

  // Insert config_command before cli = FlaskGroup(...), and add to add_command
  let newCli = origCli.replace(
    '            self.add_command(routes_command)',
    '            self.add_command(routes_command)\n            self.add_command(config_command)'
  );
  newCli = newCli.replace(
    'cli = FlaskGroup(',
    configCommandCode + '\ncli = FlaskGroup('
  );
  const newTest = origTest + '\n' + testConfigCode;
  const newDocs = origDocs + '\n\nconfig\n~~~~~~\nPrint configuration as JSON with secrets masked.\n';

  const s1 = await staging.stageEdit(cliPath, newCli, 'Add config command');
  const s2 = await staging.stageEdit(testPath, newTest, 'Add test_config_command');
  const s3 = await staging.stageEdit(docsPath, newDocs, 'Document config command');

  await staging.applyEdit(s1.editId, true);
  await staging.applyEdit(s2.editId, true);
  await staging.applyEdit(s3.editId, true);

  // 1. Run pytest tests/test_cli.py -q
  console.log('Running: pytest tests/test_cli.py -o pythonpath=src -q');
  const pytestRes = await ws.runCommand('python -m pytest tests/test_cli.py -o pythonpath=src -q');
  console.log('STDOUT:', pytestRes.stdout.trim());
  console.log('STDERR:', pytestRes.stderr.trim());
  console.log(`Pytest exit code: ${pytestRes.exitCode}`);
  if (pytestRes.exitCode !== 0) {
    throw new Error('FAIL: pytest tests/test_cli.py failed!');
  }

  // 2. Run flask --help and verify config command appears
  console.log('\nRunning: flask --help check');
  const helpRes = await ws.runCommand('python -c "import sys; sys.path.insert(0, \'src\'); from flask.cli import cli; from click.testing import CliRunner; res = CliRunner().invoke(cli, [\'--help\']); print(\'config in help:\', \'config\' in res.output)"');
  console.log(helpRes.stdout.trim());
  if (!helpRes.stdout.includes('config in help: True')) {
    throw new Error('FAIL: config not found in flask --help!');
  }

  // 3. Restore pristine state of Task B files
  await ws.runCommand('git restore src/flask/cli.py tests/test_cli.py docs/cli.rst');
  console.log('PASS: Pytest and flask --help verified 100%!');
}

runTaskBPytest().catch((err) => {
  console.error('Task B Pytest Failed:', err);
  process.exit(1);
});
