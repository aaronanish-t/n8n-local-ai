import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorkflows, compileCodeNode } from './helpers.js';

const workflows = loadWorkflows();
const TRIGGER_TYPES = /(Trigger|\.webhook)$/;
const SUB_NODE_CONNECTIONS = ['ai_languageModel', 'ai_memory', 'ai_tool'];

test('workflow files are numbered 01, 02, 03 ... with no gaps', () => {
  assert.ok(workflows.length >= 3);
  workflows.forEach(({ file }, index) => {
    assert.match(file, /^\d{2}-[a-z0-9-]+\.json$/);
    assert.equal(Number(file.slice(0, 2)), index + 1, `${file} is out of sequence`);
  });
});

test('workflow ids are unique, and calls to other workflows point at one in this folder', () => {
  const ids = workflows.map((w) => w.workflow.id).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length, 'duplicate workflow ids');
  for (const { file, workflow } of workflows) {
    for (const n of workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.executeWorkflow')) {
      assert.ok(ids.includes(n.parameters.workflowId.value), `${file}: ${n.name} calls an unknown workflow`);
    }
  }
});

for (const { file, workflow } of workflows) {
  test(`${file}: has a name and nodes with unique names and ids`, () => {
    assert.ok(workflow.name, 'workflow name is missing');
    assert.ok(workflow.nodes.length > 0);
    const names = workflow.nodes.map((n) => n.name);
    const ids = workflow.nodes.map((n) => n.id);
    assert.equal(new Set(names).size, names.length, 'duplicate node names');
    assert.equal(new Set(ids).size, ids.length, 'duplicate node ids');
    for (const n of workflow.nodes) {
      assert.match(n.type, /^(n8n-nodes-base|@n8n\/n8n-nodes-langchain)\./, `${n.name} has an unexpected type`);
      assert.equal(typeof n.typeVersion, 'number', `${n.name} has no typeVersion`);
    }
  });

  test(`${file}: connections only point at nodes that exist`, () => {
    const names = new Set(workflow.nodes.map((n) => n.name));
    for (const [from, outputs] of Object.entries(workflow.connections)) {
      assert.ok(names.has(from), `connection from missing node "${from}"`);
      for (const targets of Object.values(outputs).flat()) {
        for (const target of targets) {
          assert.ok(names.has(target.node), `connection to missing node "${target.node}"`);
        }
      }
    }
  });

  test(`${file}: every non-trigger node is connected`, () => {
    const incoming = new Set();
    const outgoingSubNodes = new Set();
    for (const [from, outputs] of Object.entries(workflow.connections)) {
      for (const [kind, groups] of Object.entries(outputs)) {
        if (SUB_NODE_CONNECTIONS.includes(kind)) outgoingSubNodes.add(from);
        for (const target of groups.flat()) incoming.add(target.node);
      }
    }
    for (const n of workflow.nodes) {
      if (TRIGGER_TYPES.test(n.type)) continue;
      assert.ok(incoming.has(n.name) || outgoingSubNodes.has(n.name), `${n.name} is not connected`);
    }
  });

  test(`${file}: stores no secrets, only credential references`, () => {
    for (const n of workflow.nodes) {
      for (const credential of Object.values(n.credentials ?? {})) {
        assert.deepEqual(Object.keys(credential).sort(), ['id', 'name'], `${n.name} credential has extra fields`);
      }
    }
    assert.doesNotMatch(JSON.stringify(workflow), /(api[_-]?key|password|secret|token)"\s*:/i);
  });

  test(`${file}: Code nodes are valid JavaScript`, () => {
    for (const n of workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.code')) {
      assert.doesNotThrow(() => compileCodeNode(n.parameters.jsCode), `${n.name} does not compile`);
    }
  });

  test(`${file}: Ollama model nodes use the local model`, () => {
    for (const n of workflow.nodes.filter((n) => n.type.endsWith('lmChatOllama'))) {
      assert.equal(n.parameters.model, 'llama3.2:3b');
    }
  });
}
