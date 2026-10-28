/**
 * D.A.V.I.S. Sector 1 - Full System & Zero-Emoji Verification Suite
 * Executes end-to-end integration tests and full codebase zero-emoji audits.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMOJI_REGEX } from './tests/harness/validators.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = __dirname;

const EXCLUDE_DIRS = new Set([
  'node_modules',
  '.git',
  '.agents',
  'data',
  'assets',
  'briefings'
]);

/**
 * Scans all JavaScript source files in the project for emoji violations.
 */
async function auditSourceFilesForEmojis(dir) {
  const violations = [];

  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name)) {
          await walk(path.join(currentDir, entry.name));
        }
      } else if (entry.name.endsWith('.js') && !entry.name.includes('_vps.js')) {
        const filePath = path.join(currentDir, entry.name);
        const content = await fs.readFile(filePath, 'utf8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Skip regex definitions that define emoji ranges for filtering
          if (line.includes('EMOJI_REGEX') || line.includes('EMOJI_FILTER_REGEX') || line.includes('\\p{Extended_Pictographic}')) {
            continue;
          }
          const match = line.match(EMOJI_REGEX);
          if (match) {
            violations.push({
              file: path.relative(ROOT_DIR, filePath),
              line: i + 1,
              char: match[0],
              snippet: line.trim()
            });
          }
        }
      }
    }
  }

  await walk(dir);
  return violations;
}

async function runFullSystemTest() {
  console.log('====================================================');
  console.log(' D.A.V.I.S. Sector 1 - Full System Test & Verification');
  console.log(' Scope: Zero-Emoji Audit + 10 E2E Task Test Suites');
  console.log('====================================================\n');

  console.log('[Step 1/2] Auditing zero-emoji compliance across project codebase...');
  const violations = await auditSourceFilesForEmojis(ROOT_DIR);
  if (violations.length > 0) {
    console.error(`[FAILED] Found ${violations.length} emoji violation(s):`);
    for (const v of violations) {
      console.error(`  - ${v.file}:${v.line} -> "${v.char}" in: ${v.snippet}`);
    }
    process.exit(1);
  }
  console.log('[PASSED] 0 emojis detected in codebase.\n');

  console.log('[Step 2/2] Running automated E2E test suites (tests/run_all.js)...');
  const child = spawn(process.execPath, ['tests/run_all.js'], {
    cwd: ROOT_DIR,
    stdio: 'inherit'
  });

  child.on('close', (code) => {
    console.log('\n====================================================');
    if (code === 0) {
      console.log(' [SUCCESS] Full system test completed with exit code 0.');
    } else {
      console.error(` [FAILED] Test runner exited with code ${code}.`);
    }
    console.log('====================================================');
    process.exit(code ?? 1);
  });
}

runFullSystemTest().catch((err) => {
  console.error('[FATAL] Full system test encountered error:', err);
  process.exit(1);
});
