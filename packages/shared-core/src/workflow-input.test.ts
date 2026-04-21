import assert from 'node:assert/strict';
import test from 'node:test';
import { workflowRunRequestSchema } from './agent.js';
import { readWorkflowInputContent, summarizeWorkflowInputContent } from './workflow-input.js';

test('readWorkflowInputContent parses template nodes and summarizes them', () => {
  const content = readWorkflowInputContent({
    mode: 'template',
    key: 'brief',
    label: 'Brief',
    accepts: ['text', 'file'],
    multiple: false,
    required: true,
    instructions: 'Describe the task and attach any relevant spec files.',
  });

  assert.ok(content);
  assert.equal(content?.mode, 'template');
  assert.equal(content?.key, 'brief');
  assert.match(
    summarizeWorkflowInputContent(content),
    /Brief[\s\S]*text, file · single · required[\s\S]*Describe the task/,
  );
});

test('workflowRunRequestSchema accepts mixed text and image inputs', () => {
  const parsed = workflowRunRequestSchema.parse({
    type: 'opencode',
    role: 'builder',
    input: {
      parts: [{ type: 'text', text: 'Summarize the current bug.' }],
    },
    inputs: {
      screenshots: {
        parts: [{ type: 'image', field: 'screenshots' }],
      },
    },
  });

  assert.equal(parsed.type, 'opencode');
  assert.equal(parsed.input?.parts[0]?.type, 'text');
  assert.equal(parsed.inputs?.screenshots?.parts[0]?.type, 'image');
});
