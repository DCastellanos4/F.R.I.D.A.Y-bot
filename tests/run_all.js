import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMOJI_REGEX } from './harness/validators.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const TESTS_DIR = path.resolve(__dirname);

/**
 * Scans all test files to verify strict zero-emoji compliance.
 */
async function auditZeroEmojisInTestFiles() {
  const violations = [];

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.name.endsWith('.js') || entry.name.endsWith('.md')) {
        const content = await fs.readFile(fullPath, 'utf8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const match = lines[i].match(EMOJI_REGEX);
          if (match) {
            violations.push({
              file: path.relative(ROOT_DIR, fullPath),
              line: i + 1,
              char: match[0],
              content: lines[i].trim()
            });
          }
        }
      }
    }
  }

  await walk(TESTS_DIR);
  return violations;
}

/**
 * Runs the test suite via Node.js native test runner.
 */
async function runTestSuite() {
  console.log('====================================================');
  console.log(' D.A.V.I.S. Sector 1 - Automated E2E Test Suite');
  console.log(' Architecture: Node.js Native Runner (node:test)');
  console.log(' Policy: Strict Zero Emojis');
  console.log('====================================================\n');

  console.log('[Step 1/2] Auditing zero-emoji compliance across test files...');
  const emojiViolations = await auditZeroEmojisInTestFiles();
  if (emojiViolations.length > 0) {
    console.error('[FAILED] Found emoji violations in test codebase:');
    for (const v of emojiViolations) {
      console.error(`  - ${v.file}:${v.line} -> character "${v.char}" in "${v.content}"`);
    }
    process.exit(1);
  }
  console.log('[PASSED] 0 emojis detected across test files.\n');

  console.log('[Step 2/2] Executing native test runner...');
  const harnessFiles = (await fs.readdir(path.join(ROOT_DIR, 'tests', 'harness')))
    .filter(f => f.endsWith('.test.js'))
    .map(f => path.join('tests', 'harness', f));

  const sector1Files = (await fs.readdir(path.join(ROOT_DIR, 'tests', 'sector1')))
    .filter(f => f.endsWith('.test.js'))
    .map(f => path.join('tests', 'sector1', f));

  const testArgs = [
    '--test',
    ...harnessFiles,
    ...sector1Files
  ];

  const child = spawn(process.execPath, testArgs, {
    cwd: ROOT_DIR,
    stdio: 'inherit'
  });

  child.on('close', (code) => {
    console.log('\n====================================================');
    if (code === 0) {
      console.log(' [SUCCESS] All Sector 1 test suites completed cleanly (exit code 0)');
    } else {
      console.error(` [FAILED] Test suite exited with failure code ${code}`);
    }
    console.log('====================================================');
    process.exit(code ?? 1);
  });
}

runTestSuite().catch((err) => {
  console.error('[FATAL] Test runner encountered uncaught error:', err);
  process.exit(1);
});
