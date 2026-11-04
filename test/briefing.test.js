import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadWorkflow, node, runCodeNode, vaultItems, fileItem, exampleVault } from './helpers.js';

const workflow = loadWorkflow('03-daily-study-briefing.json');
const collectCode = node(workflow, 'Collect open tasks').parameters.jsCode;
const buildCode = node(workflow, 'Build note').parameters.jsCode;

const HOURLY = 'Every hour, 8:00 to 23:00';
const VAULT_FILES = ['Tasks/_Tracker.md', 'Daily/2026-01-01.md', 'Daily/2026-01-02.md'];
const MODEL_TEXT = '## Focus today\n* Finish OS assignment - write the scheduler section\n\n## Quick win\n* Solve two graph problems on LeetCode.';

async function collect({ files = VAULT_FILES, extra = [], executed = [] } = {}) {
  const items = [...vaultItems(exampleVault, files), ...extra];
  return runCodeNode(collectCode, { items, executed });
}

async function collectJson(options) {
  const [result] = await collect(options);
  return result.json;
}

async function buildNote({ info, github }) {
  const [{ json: note }] = await runCodeNode(buildCode, {
    items: [{ json: github }],
    nodeOutputs: {
      'Collect open tasks': [{ json: info }],
      'Write briefing': [{ json: { text: `  ${MODEL_TEXT}\n` } }],
    },
  });
  return note;
}

test('schedule checks every hour from 8:00 to 23:00 in the configured time zone', () => {
  assert.deepEqual(node(workflow, HOURLY).parameters.rule.interval[0], { field: 'cronExpression', expression: '0 8-23 * * *' });
  assert.equal(workflow.settings.timezone, 'Asia/Kolkata');
});

test('reads the tracker, daily notes and past briefings, and writes only to Inbox', () => {
  assert.equal(
    node(workflow, 'Read tracker and daily notes').parameters.fileSelector,
    '/vault/{Tasks/_Tracker.md,Daily/*.md,**/*Morning Briefing.md}',
  );
  assert.match(node(workflow, 'Save to vault Inbox').parameters.fileName, /^=\/vault\/Inbox\//);
  for (const path of VAULT_FILES) assert.ok(existsSync(join(exampleVault, path)), `example vault is missing ${path}`);
});

test('GitHub activity comes from workflow 04 and a failure there does not stop the briefing', () => {
  const call = node(workflow, 'Get GitHub activity');
  assert.equal(call.parameters.workflowId.value, 'GithubActivity04');
  assert.equal(call.onError, 'continueRegularOutput');
});

test('catch-up: an hourly run stops once today\'s briefing exists', async () => {
  const result = await collect({ extra: [fileItem('2026-01-03 Morning Briefing.md', 'x')], executed: [HOURLY] });
  assert.deepEqual(result, []);
});

test('catch-up: an hourly run writes a briefing when only older briefings exist', async () => {
  const result = await collect({ extra: [fileItem('2026-01-02 Morning Briefing.md', 'x')], executed: [HOURLY] });
  assert.equal(result.length, 1);
});

test('catch-up: Test run writes a briefing even if today\'s already exists, without overwriting it', async () => {
  const result = await collect({ extra: [fileItem('2026-01-03 Morning Briefing.md', 'x')] });
  assert.equal(result.length, 1);
  assert.equal(result[0].json.briefedToday, true);
  const note = await buildNote({ info: result[0].json, github: { markdown: '- x' } });
  assert.equal(note.fileName, '2026-01-03 Morning Briefing 090000.md');
});

test('collect: briefings in Inbox are not mistaken for daily notes', async () => {
  const result = await collectJson({ extra: [fileItem('2026-01-02 Morning Briefing.md', '## Next steps\n- Wrong\n')] });
  assert.equal(result.latestDailyName, '2026-01-02');
  assert.doesNotMatch(result.nextStepsList, /Wrong/);
});

test('collect: lists active tasks without dates and skips the briefing task itself', async () => {
  const result = await collectJson();
  assert.equal(result.activeList, '- Finish OS assignment\n- Revise graph algorithms');
});

test('collect: open tasks become the "Waiting on me" list with wikilinks', async () => {
  const result = await collectJson();
  assert.equal(
    result.waitingOnMe,
    '- [[2026-01-01 Reply to project mentor|Reply to project mentor]]\n- [[2026-01-02 Fix laptop battery|Fix laptop battery]]',
  );
});

test('collect: done tasks are left out', async () => {
  const result = await collectJson();
  assert.doesNotMatch(JSON.stringify(result), /Install Ollama/);
});

test('collect: takes Next steps from the newest daily note and strips links', async () => {
  const result = await collectJson();
  assert.equal(result.today, '2026-01-03');
  assert.equal(result.latestDailyName, '2026-01-02');
  assert.equal(
    result.nextStepsList,
    '- Write the scheduler section of the OS assignment\n- Solve two graph problems on LeetCode.',
  );
});

test('collect: newest daily note wins whatever order the files arrive in', async () => {
  const result = await collectJson({ files: ['Daily/2026-01-02.md', 'Tasks/_Tracker.md', 'Daily/2026-01-01.md'] });
  assert.equal(result.latestDailyName, '2026-01-02');
});

test('collect: handles a vault with no daily notes and no open tasks', async () => {
  const items = [fileItem('_Tracker.md', '| Status | Started | Task |\n|---|---|---|\n')];
  const [{ json: result }] = await runCodeNode(collectCode, { items });
  assert.equal(result.activeList, '- (none)');
  assert.equal(result.nextStepsList, '- (none)');
  assert.equal(result.waitingOnMe, '- Nothing');
  assert.equal(result.latestDailyName, '');
});

test('build note: wraps the model text and GitHub summary in the vault note format', async () => {
  const info = await collectJson();
  const note = await buildNote({ info, github: { ok: true, markdown: '- Pushed to someone/repo' } });

  assert.equal(info.briefedToday, false);
  assert.equal(note.fileName, '2026-01-03 Morning Briefing.md');
  assert.match(note.content, /^---\ncreated: 2026-01-03\ntype: daily\ntags: \[briefing, n8n\]\nstatus: active\n---\n# Morning Briefing 2026-01-03\n/);
  assert.ok(note.content.includes(`\n${MODEL_TEXT}\n`), 'model text is missing or not trimmed');
  assert.ok(note.content.includes(`## Waiting on me\n${info.waitingOnMe}\n`));
  assert.ok(note.content.includes('## Yesterday on GitHub\n- Pushed to someone/repo\n'));
  assert.ok(note.content.endsWith('## Links\n- [[Tasks/_Tracker|Task Tracker]]\n- [[2026-01-02]]\n'));
});

test('build note: says GitHub is unavailable when the sub-workflow call failed', async () => {
  const info = await collectJson();
  const note = await buildNote({ info, github: { error: { message: 'Workflow not found' } } });
  assert.ok(note.content.includes('## Yesterday on GitHub\n- GitHub activity unavailable\n'));
});

test('build note: leaves out the daily link when there is no daily note', async () => {
  const info = { today: '2026-01-03', waitingOnMe: '- Nothing', latestDailyName: '' };
  const note = await buildNote({ info, github: { markdown: '- No public activity' } });
  assert.ok(note.content.endsWith('## Links\n- [[Tasks/_Tracker|Task Tracker]]\n'));
});
