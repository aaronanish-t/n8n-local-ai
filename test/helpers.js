import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DateTime } from 'luxon';

export const TIMEZONE = 'Asia/Kolkata';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const workflowsDir = join(root, 'workflows');
export const exampleVault = join(root, 'example-vault');

export function loadWorkflows() {
  return readdirSync(workflowsDir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => ({ file, workflow: JSON.parse(readFileSync(join(workflowsDir, file), 'utf8')) }));
}

export function loadWorkflow(file) {
  return JSON.parse(readFileSync(join(workflowsDir, file), 'utf8'));
}

export function node(workflow, name) {
  const found = workflow.nodes.find((n) => n.name === name);
  if (!found) throw new Error(`No node named "${name}" in ${workflow.name}`);
  return found;
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

export function compileCodeNode(jsCode) {
  return new AsyncFunction('$input', '$now', '$', 'DateTime', jsCode);
}

// Runs a Code node's JavaScript the way n8n does in "Run Once for All Items" mode.
// `now` is an ISO time in the workflow's time zone; `nodeOutputs` maps node names to the
// items `$('Node')` returns. Nodes listed in `executed` report `isExecuted: true`.
export async function runCodeNode(
  jsCode,
  { items = [], now = '2026-01-03T09:00', nodeOutputs = {}, executed = [] } = {},
) {
  const $input = { all: () => items, first: () => items[0] };
  const $ = (name) => {
    const output = nodeOutputs[name];
    if (!output && !executed.includes(name)) return { isExecuted: false };
    return { isExecuted: true, first: () => output?.[0], all: () => output ?? [], item: output?.[0] };
  };
  const $now = DateTime.fromISO(now, { zone: TIMEZONE });
  return compileCodeNode(jsCode)($input, $now, $, DateTime);
}

// Builds the items the "Extract text" node passes on: file text in json, file name in binary.
export function vaultItems(vault, relativePaths) {
  return relativePaths.map((path) => fileItem(path.split('/').at(-1), readFileSync(join(vault, path), 'utf8')));
}

export function fileItem(fileName, text) {
  return { json: { text }, binary: { data: { fileName } } };
}

export function loadFixture(name) {
  return JSON.parse(readFileSync(join(root, 'test', 'fixtures', name), 'utf8'));
}
