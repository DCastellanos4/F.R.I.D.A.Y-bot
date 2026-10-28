import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMOJI_REGEX } from './harness/validators.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const TESTS_DIR = path.resolve(__dirname);

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.agents',
  'data',
  'assets',
  'briefings'
]);

/**
 * Scans all test files and project source files to verify strict zero-emoji compliance.
 */
async function auditZeroEmojisAcrossProject() {
  const violations = [];

  async function checkFile(fullPath) {
    const ext = path.extname(fullPath).toLowerCase();
    if (ext !== '.js' && ext !== '.cjs' && ext !== '.md') {
      return;
    }

    try {
      const content = await fs.readFile(fullPath, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(EMOJI_REGEX);
        if (match) {
          violations.push({
            file: path.relative(ROOT_DIR, fullPath).replace(/\\/g, '/'),
            line: i + 1,
            char: match[0],
            content: lines[i].trim()
          });
        }
      }
    } catch {
      // Ignore unreadable files
    }
  }

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          await walk(path.join(dir, entry.name));
        }
      } else {
        await checkFile(path.join(dir, entry.name));
      }
    }
  }

  // 1. Scan tests directory
  await walk(TESTS_DIR);

  // 2. Scan root directory source files
  const rootEntries = await fs.readdir(ROOT_DIR, { withFileTypes: true });
  for (const entry of rootEntries) {
    if (!entry.isDirectory()) {
      await checkFile(path.join(ROOT_DIR, entry.name));
    }
  }

  return violations;
}

/**
 * Runs the full test suite via Node.js native test runner.
 */
async function runTestSuite() {
  console.log('====================================================');
  console.log(' D.A.V.I.S. Master Test Runner (Sector 1 & Sector 2)');
  console.log(' Architecture: Node.js Native Runner (node:test)');
  console.log(' Policy: Strict Zero Emojis');
  console.log('====================================================\n');

  console.log('[Step 1/2] Auditing zero-emoji compliance across test & source files...');
  const emojiViolations = await auditZeroEmojisAcrossProject();
  if (emojiViolations.length > 0) {
    console.error('[FAILED] Found emoji violations in codebase:');
    for (const v of emojiViolations) {
      console.error(`  - ${v.file}:${v.line} -> character "${v.char}" in "${v.content}"`);
    }
    process.exit(1);
  }
  console.log('[PASSED] 0 emojis detected across project and test files.\n');

  console.log('[Step 2/2] Discovering test suites and executing native runner...');

  // Helper to discover test files safely
  async function getTestFiles(subDir) {
    const dir = path.join(ROOT_DIR, subDir);
    try {
      const files = await fs.readdir(dir);
      return files
        .filter((f) => f.endsWith('.test.js'))
        .sort()
        .map((f) => path.join(subDir, f));
    } catch {
      return [];
    }
  }

  const harnessFiles = await getTestFiles(path.join('tests', 'harness'));
  const sector1Files = await getTestFiles(path.join('tests', 'sector1'));
  const sector2HelperFiles = await getTestFiles(path.join('tests', 'sector2', 'helpers'));
  const sector2Files = await getTestFiles(path.join('tests', 'sector2'));

  const allTestFiles = [
    ...harnessFiles,
    ...sector1Files,
    ...sector2HelperFiles,
    ...sector2Files
  ];

  console.log(`Discovered ${allTestFiles.length} test suites:`);
  console.log(`- Sector 1 & Harness: ${harnessFiles.length + sector1Files.length} suites`);
  console.log(`- Sector 2: ${sector2HelperFiles.length + sector2Files.length} suites\n`);

  const testArgs = [
    '--test',
    ...allTestFiles
  ];

  const child = spawn(process.execPath, testArgs, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'test'
    }
  });

  child.on('close', (code) => {
    console.log('\n====================================================');
    if (code === 0) {
      console.log(' [SUCCESS] All Sector 1 and Sector 2 test suites completed cleanly (exit code 0)');
    } else {
      console.error(` [FAILED] Test runner exited with failure code ${code}`);
    }
    console.log('====================================================');
    process.exit(code ?? 1);
  });
}

runTestSuite().catch((err) => {
  console.error('[FATAL] Test runner encountered uncaught error:', err);
  process.exit(1);
});
