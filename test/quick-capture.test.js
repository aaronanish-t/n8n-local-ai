import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorkflow, node, runCodeNode } from './helpers.js';

const workflow = loadWorkflow('05-quick-capture.json');
const validateCode = node(workflow, 'Validate input').parameters.jsCode;
const buildCode = node(workflow, 'Build note').parameters.jsCode;
const NOW = '2026-01-03T21:05:09.042';
const JSON_HEADERS = { 'content-type': 'application/json' };

async function validate(body, headers = JSON_HEADERS) {
  const [{ json }] = await runCodeNode(validateCode, { items: [{ json: { body, headers } }] });
  return json;
}

async function build(text, modelOutput) {
  const [{ json }] = await runCodeNode(buildCode, {
    items: [{ json: modelOutput }],
    now: NOW,
    nodeOutputs: { 'Validate input': [{ json: { valid: true, text } }] },
  });
  return json;
}

test('webhook takes POST /webhook/capture, only from n8n\'s own origin, and answers from Respond nodes', () => {
  const hook = node(workflow, 'POST /webhook/capture').parameters;
  assert.deepEqual([hook.httpMethod, hook.path, hook.responseMode], ['POST', 'capture', 'responseNode']);
  assert.equal(hook.options.allowedOrigins, 'http://localhost:5678');
  assert.equal(node(workflow, 'Respond 201').parameters.options.responseCode, 201);
  assert.equal(node(workflow, 'Respond 400').parameters.options.responseCode, 400);
});

test('valid input goes to the model, invalid input straight to a 400', () => {
  const [onTrue, onFalse] = workflow.connections['Valid?'].main;
  assert.equal(onTrue[0].node, 'Suggest title and tags');
  assert.equal(onFalse[0].node, 'Respond 400');
});

test('the model is asked for JSON, and a model failure still saves the note', () => {
  assert.equal(node(workflow, 'Ollama Chat Model').parameters.options.format, 'json');
  assert.equal(node(workflow, 'Suggest title and tags').onError, 'continueRegularOutput');
});

test('validate: accepts {"text": ...} sent as JSON and trims it', async () => {
  assert.deepEqual(await validate({ text: '  read about raft  ' }), { valid: true, text: 'read about raft' });
  const withCharset = await validate({ text: 'x' }, { 'content-type': 'application/json; charset=utf-8' });
  assert.equal(withCharset.valid, true);
});

test('validate: rejects anything not sent as JSON, which is what a web page can send without CORS', async () => {
  for (const headers of [{ 'content-type': 'text/plain' }, { 'content-type': 'application/x-www-form-urlencoded' }, {}]) {
    const result = await validate({ text: 'from a web page' }, headers);
    assert.equal(result.valid, false, `accepted ${JSON.stringify(headers)}`);
  }
  assert.equal((await validate('{"text": "plain body"}', { 'content-type': 'text/plain' })).valid, false);
});

test('validate: rejects missing, blank and non-text input', async () => {
  for (const body of [undefined, {}, { text: '   ' }, { text: 42 }, { note: 'wrong key' }]) {
    const result = await validate(body);
    assert.equal(result.valid, false, `accepted ${JSON.stringify(body)}`);
    assert.match(result.error, /Send JSON like/);
  }
});

test('validate: accepts 5000 characters and rejects 5001', async () => {
  assert.equal((await validate({ text: 'a'.repeat(5000) })).valid, true);
  const tooLong = await validate({ text: 'a'.repeat(5001) });
  assert.deepEqual(tooLong, { valid: false, error: 'Text is longer than 5000 characters' });
});

test('build: reads the {title, tags} object the chain outputs after parsing JSON itself', async () => {
  // This is the shape n8n's Basic LLM Chain produced in a real run with format "json".
  const note = await build('Look into Raft consensus for the distributed systems course.', {
    title: 'Raft Consensus Overview',
    tags: 'distributed-systems consensus',
  });
  assert.equal(note.title, 'Raft Consensus Overview');
  assert.equal(note.usedFallback, false);
  assert.match(note.content, /^tags: \[capture, distributed-systems, consensus\]$/m);
});

test('build: uses the model\'s title and tags from a JSON string', async () => {
  const note = await build('Raft uses leader election and log replication.', {
    text: '{"title": "Raft Consensus Basics", "tags": ["distributed-systems", "Reading"]}',
  });
  assert.equal(note.title, 'Raft Consensus Basics');
  assert.equal(note.fileName, '2026-01-03 210509042 Raft Consensus Basics.md');
  assert.equal(
    note.content,
    [
      '---',
      'created: 2026-01-03',
      'type: idea',
      'tags: [capture, distributed-systems, reading]',
      'status: active',
      '---',
      '# Raft Consensus Basics',
      '',
      'Raft uses leader election and log replication.',
      '',
      '## Links',
      '- [[Home]]',
      '',
    ].join('\n'),
  );
});

test('build: strips path characters so the file stays inside Inbox', async () => {
  const note = await build('x', { text: '{"title": "../../etc/passwd: a \\"test\\""}' });
  assert.equal(note.title, 'Etc Passwd A Test');
  assert.doesNotMatch(note.fileName, /[\\/:"*?<>|]/);
});

test('build: keeps titles to 60 characters, so a long pasted word cannot break the file name', async () => {
  const note = await build(`https://example.com/${'a'.repeat(4000)}`, { error: { message: 'down' } });
  assert.ok(note.title.length <= 60, `title is ${note.title.length} characters`);
  const words = await build('x', { title: 'Distributed consensus algorithms explained thoroughly everywhere' });
  assert.equal(words.title, 'Distributed Consensus Algorithms Explained Thoroughly');
});

test('build: keeps accented and non-Latin words whole', async () => {
  const note = await build('x', { title: 'हिन्दी नोट्स café notes' });
  assert.equal(note.title, 'हिन्दी नोट्स Café Notes');
});

test('build: keeps at most 6 title words and 3 clean, unique tags', async () => {
  const note = await build('x', {
    text: '{"title": "one two three four five six seven", "tags": ["a b", "-", "A-B", "capture", "c", "d", "e"]}',
  });
  assert.equal(note.title, 'One Two Three Four Five Six');
  assert.match(note.content, /^tags: \[capture, ab, a-b, c\]$/m);
});

test('build: falls back to the note\'s first words when the model reply is not JSON', async () => {
  const note = await build('Ask the mentor about the GSoC proposal deadline next week', { text: 'Sure! Here is a title:' });
  assert.equal(note.title, 'Ask The Mentor About The GSoC');
  assert.equal(note.usedFallback, true);
  assert.match(note.content, /^tags: \[capture\]$/m);
});

test('build: falls back when the model call failed', async () => {
  const note = await build('ollama was down', { error: { message: 'connect ECONNREFUSED' } });
  assert.equal(note.title, 'Ollama Was Down');
  assert.equal(note.usedFallback, true);
});

test('build: uses "Quick Capture" when there are no usable words at all', async () => {
  const note = await build('!!! ???', { text: '{"title": "..."}' });
  assert.equal(note.title, 'Quick Capture');
});
