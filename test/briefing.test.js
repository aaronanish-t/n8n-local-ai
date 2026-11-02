import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadWorkflow, node, runCodeNode, vaultItems, exampleVault } from './helpers.js';

const workflow = loadWorkflow('03-daily-study-briefing.json');
const collectCode = node(workflow, 'Collect open tasks').parameters.jsCode;
const buildCode = node(workflow, 'Build note').parameters.jsCode;

const VAULT_FILES = ['Tasks/_Tracker.md', 'Daily/2026-01-01.md', 'Daily/2026-01-02.md'];

async function collect(files = VAULT_FILES) {
  const [result] = await runCodeNode(collectCode, { items: vaultItems(exampleVault, files) });
  return result.json;
}

test('schedule runs daily at 8:00 in the configured time zone', () => {
  const schedule = node(workflow, 'Every day at 8:00');
  assert.equal(schedule.parameters.rule.interval[0].triggerAtHour, 8);
  assert.equal(workflow.settings.timezone, 'Asia/Kolkata');
});

test('reads the tracker and daily notes, and writes only to Inbox', () => {
  assert.equal(node(workflow, 'Read tracker and daily notes').parameters.fileSelector, '/vault/{Tasks/_Tracker.md,Daily/*.md}');
  assert.match(node(workflow, 'Save to vault Inbox').parameters.fileName, /^=\/vault\/Inbox\//);
  for (const path of VAULT_FILES) assert.ok(existsSync(join(exampleVault, path)), `example vault is missing ${path}`);
});

test('collect: lists active tasks without dates and skips the briefing task itself', async () => {
  const result = await collect();
  assert.equal(result.activeList, '- Finish OS assignment\n- Revise graph algorithms');
});

test('collect: open tasks become the "Waiting on me" list with wikilinks', async () => {
  const result = await collect();
  assert.equal(
    result.waitingOnMe,
    '- [[2026-01-01 Reply to project mentor|Reply to project mentor]]\n- [[2026-01-02 Fix laptop battery|Fix laptop battery]]',
  );
});

test('collect: done tasks are left out', async () => {
  const result = await collect();
  assert.doesNotMatch(JSON.stringify(result), /Install Ollama/);
});

test('collect: takes Next steps from the newest daily note and strips links', async () => {
  const result = await collect();
  assert.equal(result.latestDailyName, '2026-01-02');
  assert.equal(
    result.nextStepsList,
    '- Write the scheduler section of the OS assignment\n- Solve two graph problems on LeetCode.',
  );
});

test('collect: newest daily note wins whatever order the files arrive in', async () => {
  const result = await collect(['Daily/2026-01-02.md', 'Tasks/_Tracker.md', 'Daily/2026-01-01.md']);
  assert.equal(result.latestDailyName, '2026-01-02');
});

test('collect: handles a vault with no daily notes and no open tasks', async () => {
  const items = [{ json: { text: '| Status | Started | Task |\n|---|---|---|\n' }, binary: { data: { fileName: '_Tracker.md' } } }];
  const [{ json: result }] = await runCodeNode(collectCode, { items });
  assert.equal(result.activeList, '- (none)');
  assert.equal(result.nextStepsList, '- (none)');
  assert.equal(result.waitingOnMe, '- Nothing');
  assert.equal(result.latestDailyName, '');
});

test('build note: wraps the model text in the vault note format', async () => {
  const info = await collect();
  const modelText = '## Focus today\n* Finish OS assignment - write the scheduler section\n\n## Quick win\n* Solve two graph problems on LeetCode.';
  const [{ json: note }] = await runCodeNode(buildCode, {
    items: [{ json: { text: `  ${modelText}\n` } }],
    nodeOutputs: { 'Collect open tasks': [{ json: info }] },
  });

  assert.equal(note.fileName, '2026-01-03 Morning Briefing.md');
  assert.match(note.content, /^---\ncreated: 2026-01-03\ntype: daily\ntags: \[briefing, n8n\]\nstatus: active\n---\n# Morning Briefing 2026-01-03\n/);
  assert.ok(note.content.includes(modelText), 'model text is missing or not trimmed');
  assert.ok(note.content.includes(`## Waiting on me\n${info.waitingOnMe}\n`));
  assert.ok(note.content.endsWith('## Links\n- [[Tasks/_Tracker|Task Tracker]]\n- [[2026-01-02]]\n'));
});

test('build note: leaves out the daily link when there is no daily note', async () => {
  const [{ json: note }] = await runCodeNode(buildCode, {
    items: [{ json: { text: 'x' } }],
    nodeOutputs: { 'Collect open tasks': [{ json: { today: '2026-01-03', waitingOnMe: '- Nothing', latestDailyName: '' } }] },
  });
  assert.ok(note.content.endsWith('## Links\n- [[Tasks/_Tracker|Task Tracker]]\n'));
});
