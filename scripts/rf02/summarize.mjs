#!/usr/bin/env node
/** Explicit offline file reader only. Never imports production services. */
import fs from 'node:fs';
import { resumirMedicionSlm } from './measurementSummary.js';
try {
  const [path, judgmentsPath, ...extra] = process.argv.slice(2);
  if (!path || extra.length) throw new Error('usage: node scripts/rf02/summarize.mjs <measurement.jsonl> [judgments.json]');
  const maxBytes=4*1024*1024;
  if (fs.statSync(path).size>maxBytes) throw new Error('measurement exceeds 4 MiB');
  const data=fs.readFileSync(path,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  if (judgmentsPath && fs.statSync(judgmentsPath).size>maxBytes) throw new Error('judgments exceeds 4 MiB');
  const judgments=judgmentsPath ? JSON.parse(fs.readFileSync(judgmentsPath,'utf8')) : {};
  console.log(JSON.stringify(resumirMedicionSlm(data,{judgments}),null,2));
} catch (error) {
  // Do not print exception content, which may contain an input line or file data.
  console.error('RF02 offline analysis rejected input; verify the schema and local paths.');
  process.exitCode=1;
}
