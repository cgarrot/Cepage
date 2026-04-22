import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidSlug, toSlug } from '../slug.util.js';

test('toSlug normalizes accents, separators, and case', () => {
  assert.equal(toSlug('Hello World'), 'hello-world');
  assert.equal(toSlug('Café-résumé'), 'cafe-resume');
  assert.equal(toSlug('  multiple   spaces  '), 'multiple-spaces');
  assert.equal(toSlug('!!bad chars @#'), 'bad-chars');
  assert.equal(toSlug('UPPER Case'), 'upper-case');
});

test('toSlug returns a fallback when the raw is empty', () => {
  const slug = toSlug('!!!');
  assert.match(slug, /^skill-\d+$/);
});

test('toSlug caps length at 64', () => {
  const input = 'a'.repeat(200);
  const slug = toSlug(input);
  assert.equal(slug.length, 64);
});

test('isValidSlug accepts library-safe slugs', () => {
  assert.equal(isValidSlug('daily-digest'), true);
  assert.equal(isValidSlug('a1'), true);
  assert.equal(isValidSlug('a'), true);
});

test('isValidSlug rejects edge cases the API relies on', () => {
  assert.equal(isValidSlug(''), false);
  assert.equal(isValidSlug('-leading'), false);
  assert.equal(isValidSlug('trailing-'), false);
  assert.equal(isValidSlug('Has Upper'), false);
  assert.equal(isValidSlug('a'.repeat(65)), false);
});
