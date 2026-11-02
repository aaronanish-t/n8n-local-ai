import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  return new AsyncFunction('$input', '$now', '$', jsCode);
}

// Minimal stand-in for the Luxon DateTime n8n exposes as $now.
function fakeNow(isoDate) {
  return {
    toFormat(format) {
      if (format !== 'yyyy-MM-dd') throw new Error(`fakeNow does not support format ${format}`);
      return isoDate;
    },
  };
}

// Runs a Code node's JavaScript the way n8n does in "Run Once for All Items" mode.
export async function runCodeNode(jsCode, { items = [], today = '2026-01-03', nodeOutputs = {} } = {}) {
  const $input = { all: () => items, first: () => items[0] };
  const $ = (name) => {
    if (!(name in nodeOutputs)) throw new Error(`Code node referenced unknown node "${name}"`);
    const output = nodeOutputs[name];
    return { first: () => output[0], all: () => output, item: output[0] };
  };
  return compileCodeNode(jsCode)($input, fakeNow(today), $);
}

// Builds the items the "Extract text" node passes on: file text in json, file name in binary.
export function vaultItems(vault, relativePaths) {
  return relativePaths.map((path) => ({
    json: { text: readFileSync(join(vault, path), 'utf8') },
    binary: { data: { fileName: path.split('/').at(-1) } },
  }));
}
