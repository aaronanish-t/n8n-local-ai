import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorkflow, node, runCodeNode, loadFixture } from './helpers.js';

const workflow = loadWorkflow('04-github-activity.json');
const summarizeCode = node(workflow, 'Summarize yesterday').parameters.jsCode;

// 09:00 IST on 2026-01-03, so "yesterday" is 2026-01-01T18:30Z to 2026-01-02T18:30Z.
const NOW = '2026-01-03T09:00';

async function summarize(events) {
  const items = events.map((json) => ({ json }));
  const [{ json }] = await runCodeNode(summarizeCode, { items, now: NOW });
  return json;
}

test('fetches public events for the configured user and keeps going on errors', () => {
  const user = node(workflow, 'Settings').parameters.assignments.assignments[0];
  assert.deepEqual([user.name, user.value], ['githubUser', 'aaronanish-t']);

  const request = node(workflow, 'Get public GitHub events');
  assert.equal(request.parameters.url, '=https://api.github.com/users/{{ $json.githubUser }}/events/public');
  assert.equal(request.onError, 'continueRegularOutput');
  assert.equal(request.alwaysOutputData, true, 'an empty event list must still reach the summary');
});

test('can be started by another workflow or by hand', () => {
  assert.equal(node(workflow, 'When called by another workflow').parameters.inputSource, 'passthrough');
  assert.ok(node(workflow, 'Test run'));
});

test('summarizes only yesterday\'s events, oldest first, and merges repeats', async () => {
  const result = await summarize(loadFixture('github-events.json'));
  assert.equal(result.ok, true);
  assert.equal(result.count, 9);
  assert.equal(
    result.markdown,
    [
      '- Reviewed PR #3 "Better docs" in x/y',
      '- Gollum in g/h',
      '- Created branch feat-x in a/b',
      '- Starred e/f',
      '- Merged PR #9 "Fix bug" in c/d',
      '- Commented on issue #5 "Crash on start" in c/d',
      '- Pushed to a/b (x2)',
      '- Opened PR #12 "Add tests" in a/b',
    ].join('\n'),
  );
});

test('labels comments on pull requests as PR comments', async () => {
  const result = await summarize([
    { type: 'IssueCommentEvent', created_at: '2026-01-02T07:00:00Z', repo: { name: 'c/d' }, payload: { issue: { number: 8, title: 'Speed up', pull_request: {} } } },
  ]);
  assert.equal(result.markdown, '- Commented on PR #8 "Speed up" in c/d');
});

test('copes with events that leave out titles or actions', async () => {
  const result = await summarize([
    { type: 'PullRequestEvent', created_at: '2026-01-02T07:00:00Z', repo: { name: 'c/d' }, payload: { number: 4 } },
    { type: 'CreateEvent', created_at: '2026-01-02T06:00:00Z', repo: { name: 'n/new' }, payload: { ref_type: 'repository' } },
  ]);
  assert.equal(result.markdown, '- Created repo n/new\n- Updated PR #4 in c/d');
});

test('copes with null actions and null payloads', async () => {
  const result = await summarize([
    { type: 'IssuesEvent', created_at: '2026-01-02T07:00:00Z', repo: { name: 'c/d' }, payload: { action: null, issue: { number: 2 } } },
    { type: 'PushEvent', created_at: '2026-01-02T06:00:00Z', repo: { name: 'c/d' }, payload: null },
  ]);
  assert.equal(result.markdown, '- Pushed to c/d\n- Updated issue #2 in c/d');
});

test('says there was no activity when GitHub returned no events', async () => {
  // With "Always Output Data" on, an empty response arrives as one empty item.
  const result = await summarize([{}]);
  assert.deepEqual(result, { ok: true, count: 0, markdown: '- No public activity' });
});

test('reports GitHub\'s rate limit in one short line', async () => {
  const message = '403 - "{\\"message\\":\\"API rate limit exceeded for 104.28.225.172. (But here\'s the good news: ...)\\"}"';
  const result = await summarize([{ error: { message } }]);
  assert.deepEqual(result, {
    ok: false,
    count: 0,
    markdown: '- Could not reach GitHub: rate limit reached (60 requests an hour per IP without a token)',
  });
});

test('reports other failures with the first line of the error, cut to 120 characters', async () => {
  const result = await summarize([{ error: { message: `getaddrinfo ENOTFOUND api.github.com ${'x'.repeat(200)}\nstack` } }]);
  assert.equal(result.ok, false);
  assert.equal(result.markdown, `- Could not reach GitHub: ${`getaddrinfo ENOTFOUND api.github.com ${'x'.repeat(200)}`.slice(0, 120)}`);
});
