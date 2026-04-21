import assert from 'node:assert/strict';
import test from 'node:test';
import { FILE_SUMMARY_LEGACY_ID, readFileSummaryContent } from '@cepage/shared-core';
import {
  buildCombinedFileSummaryPrompt,
  buildFileContextBlock,
  buildFileSummaryPrompt,
  extractFileUpload,
} from '../file-node.util.js';

test('extractFileUpload keeps text content for code files', () => {
  const res = extractFileUpload({
    name: 'demo.ts',
    mimeType: 'text/typescript',
    size: 27,
    uploadedAt: '2026-04-06T10:00:00.000Z',
    buffer: Buffer.from('export const demo = 1;\n'),
  });

  assert.equal(res.file.kind, 'text');
  assert.equal(res.file.extension, '.ts');
  assert.match(res.extractedText ?? '', /export const demo/);
  assert.equal(res.extractedTextTruncated, false);
});

test('extractFileUpload reads image metadata for png files', () => {
  const buffer = Buffer.alloc(24);
  buffer[0] = 0x89;
  buffer[1] = 0x50;
  buffer[2] = 0x4e;
  buffer[3] = 0x47;
  buffer.writeUInt32BE(640, 16);
  buffer.writeUInt32BE(480, 20);

  const res = extractFileUpload({
    name: 'board.png',
    mimeType: 'image/png',
    size: buffer.length,
    uploadedAt: '2026-04-06T10:00:00.000Z',
    buffer,
  });

  assert.equal(res.file.kind, 'image');
  assert.equal(res.file.width, 640);
  assert.equal(res.file.height, 480);
  assert.equal(res.extractedText, undefined);
});

test('readFileSummaryContent maps legacy single-file payloads into files[]', () => {
  const content = readFileSummaryContent({
    file: {
      name: 'notes.md',
      mimeType: 'text/markdown',
      size: 128,
      kind: 'text',
      uploadedAt: '2026-04-06T10:00:00.000Z',
      extension: '.md',
    },
    summary: 'Legacy summary',
    extractedText: '# Notes',
    extractedTextChars: 7,
    extractedTextTruncated: false,
    status: 'done',
  });

  assert.equal(content?.files?.length, 1);
  assert.equal(content?.files?.[0]?.id, FILE_SUMMARY_LEGACY_ID);
  assert.equal(content?.files?.[0]?.summary, 'Legacy summary');
  assert.equal(content?.summary, 'Legacy summary');
  assert.equal(content?.generatedSummary, 'Legacy summary');
  assert.equal(content?.summarySource, 'generated');
});

test('file prompts and context include combined and per-file data', () => {
  const item = {
    id: 'file-1',
    file: {
      name: 'notes.md',
      mimeType: 'text/markdown',
      size: 128,
      kind: 'text' as const,
      uploadedAt: '2026-04-06T10:00:00.000Z',
      extension: '.md',
    },
    summary: 'A concise markdown brief.',
    extractedText: '# Notes\nShip the file summary node.',
    extractedTextChars: 36,
    extractedTextTruncated: false,
    status: 'done' as const,
  };
  const content = {
    status: 'done' as const,
    summary: '# Combined\n- Ship the file summary node.',
    generatedSummary: '# Combined\n- Ship the file summary node.',
    files: [
      item,
      {
        id: 'file-2',
        file: {
          name: 'todo.txt',
          mimeType: 'text/plain',
          size: 24,
          kind: 'text' as const,
          uploadedAt: '2026-04-06T10:05:00.000Z',
          extension: '.txt',
        },
        status: 'pending' as const,
      },
    ],
  };

  const prompt = buildFileSummaryPrompt(item);
  const combined = buildCombinedFileSummaryPrompt(content);
  const block = buildFileContextBlock(content);

  assert.match(prompt, /Write a concise 2-4 sentence summary/);
  assert.match(prompt, /notes\.md/);
  assert.match(prompt, /Ship the file summary node/);
  assert.match(combined ?? '', /combining multiple uploaded-file summaries/i);
  assert.match(combined ?? '', /Existing file summary/);
  assert.match(block ?? '', /\[Uploaded files context\]/);
  assert.match(block ?? '', /Combined summary:/);
  assert.match(block ?? '', /Status: pending/);
});
