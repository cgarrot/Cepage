import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  formatDate,
  makeColors,
  renderTable,
  statusTone,
  trim,
} from '../src/output.js';

test('makeColors returns identity functions when disabled', () => {
  const c = makeColors(false);
  assert.equal(c.bold('hi'), 'hi');
  assert.equal(c.green('ok'), 'ok');
});

test('makeColors wraps in ANSI sequences when enabled', () => {
  const c = makeColors(true);
  const out = c.green('ok');
  assert.ok(out.includes('\u001b['));
  assert.ok(out.endsWith('\u001b[39m'));
});

test('renderTable produces a header, separator, and aligned rows', () => {
  const out = renderTable(
    [
      { id: 'foo', status: 'succeeded' },
      { id: 'bar', status: 'failed' },
    ],
    ['id', 'status'],
  );
  const lines = out.split('\n');
  assert.equal(lines.length, 4);
  assert.ok(lines[0].startsWith('ID  '));
  assert.ok(lines[0].includes('STATUS'));
  assert.match(lines[1], /^[─ ]+$/);
  assert.ok(lines[2].startsWith('foo'));
});

test('renderTable returns empty string for empty rows', () => {
  assert.equal(renderTable([], ['id']), '');
});

test('statusTone maps status strings to tones', () => {
  assert.equal(statusTone('succeeded'), 'ok');
  assert.equal(statusTone('failed'), 'err');
  assert.equal(statusTone('cancelled'), 'err');
  assert.equal(statusTone('running'), 'info');
  assert.equal(statusTone('queued'), 'warn');
});

test('trim truncates long strings and adds an ellipsis', () => {
  assert.equal(trim('hello world', 20), 'hello world');
  assert.equal(trim('hello world', 6), 'hello…');
  assert.equal(trim(undefined, 5), '');
});

test('formatDate renders ISO timestamps without the T and Z', () => {
  assert.equal(formatDate('2026-04-14T08:05:33.123Z'), '2026-04-14 08:05:33');
  assert.equal(formatDate(''), '');
});
