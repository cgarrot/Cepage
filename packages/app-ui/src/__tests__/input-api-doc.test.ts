import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInputApiDoc } from '../input-api-doc.js';

test('buildInputApiDoc describes text-only multiple inputs with json transport', () => {
  const doc = buildInputApiDoc('input-template-1', {
    mode: 'template',
    key: 'brief',
    label: 'Brief',
    accepts: ['text'],
    multiple: true,
    required: true,
  });

  assert.ok(doc);
  assert.equal(doc.transport, 'application/json');
  assert.equal(doc.splitText, true);
  assert.equal(doc.path, '/api/v1/sessions/{sessionId}/inputs/input-template-1/start');
  assert.match(doc.payload, /"sourceNodeIds": \[/);
  assert.match(doc.payload, /"newExecution": false/);
  assert.match(doc.curl, /Content-Type: application\/json/);
});

test('buildInputApiDoc uses multipart examples for file inputs', () => {
  const doc = buildInputApiDoc('input-template-2', {
    mode: 'template',
    key: 'brief_file',
    label: 'Brief file',
    accepts: ['file'],
    multiple: false,
    required: false,
  });

  assert.ok(doc);
  assert.equal(doc.transport, 'multipart/form-data');
  assert.deepEqual(doc.fields, ['brief_file']);
  assert.match(doc.payload, /"field": "brief_file"/);
  assert.match(doc.curl, /-F 'payload=/);
  assert.match(doc.curl, /brief_file=@\/tmp\/brief_file\.md/);
  assert.match(doc.fetch, /form\.append\('brief_file'/);
});

test('buildInputApiDoc targets the template node for bound inputs', () => {
  const doc = buildInputApiDoc('input-bound-1', {
    mode: 'bound',
    key: 'reference_image',
    label: 'Reference image',
    accepts: ['image'],
    multiple: false,
    required: true,
    templateNodeId: 'input-template-9',
    parts: [
      {
        id: 'part-1',
        type: 'image',
        file: {
          name: 'ref.png',
          mimeType: 'image/png',
          size: 42,
          kind: 'image',
          uploadedAt: '2026-04-08T10:00:00.000Z',
        },
      },
    ],
  });

  assert.ok(doc);
  assert.equal(doc.mode, 'bound');
  assert.equal(doc.endpointNodeId, 'input-template-9');
  assert.equal(doc.path, '/api/v1/sessions/{sessionId}/inputs/input-template-9/start');
  assert.equal(doc.transport, 'multipart/form-data');
});
