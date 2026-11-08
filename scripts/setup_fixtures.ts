import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const FIXTURE_DIR = path.resolve('fixtures/flask');
const FLASK_REPO = 'https://github.com/pallets/flask.git';
const TARGET_COMMIT = '22d924701a6ae2e4cd01e9a15bbaf3946094af65';

export function setupFixtures() {
  if (fs.existsSync(path.join(FIXTURE_DIR, 'src/flask/cli.py'))) {
    console.log('[Fixtures] Flask 3.1.3 fixture already exists at:', FIXTURE_DIR);
    return;
  }

  console.log('[Fixtures] Cloning Pallets Flask benchmark repository...');
  fs.mkdirSync(path.dirname(FIXTURE_DIR), { recursive: true });

  execSync(`git clone ${FLASK_REPO} "${FIXTURE_DIR}"`, { stdio: 'inherit' });
  execSync(`git checkout ${TARGET_COMMIT}`, { cwd: FIXTURE_DIR, stdio: 'inherit' });
  console.log('[Fixtures] Successfully checked out Flask 3.1.3 at commit:', TARGET_COMMIT);
}

if (require.main === module) {
  setupFixtures();
}
