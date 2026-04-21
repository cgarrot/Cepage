import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectMimeType, isTextMime } from '../workspace-files.util';

describe('detectMimeType', () => {
  it('maps text and code extensions to text/* mimes', () => {
    assert.equal(detectMimeType('README.md'), 'text/markdown');
    assert.equal(detectMimeType('src/foo/bar.ts'), 'text/typescript');
    assert.equal(detectMimeType('packages/api/file.tsx'), 'text/tsx');
    assert.equal(detectMimeType('docs/readme.MD'), 'text/markdown');
  });

  it('handles extensionless special filenames', () => {
    assert.equal(detectMimeType('Dockerfile'), 'text/x-dockerfile');
    assert.equal(detectMimeType('subdir/Dockerfile.dev'), 'text/x-dockerfile');
    assert.equal(detectMimeType('build/Makefile'), 'text/x-makefile');
  });

  it('detects standard image, video, and audio mimes', () => {
    assert.equal(detectMimeType('avatar.png'), 'image/png');
    assert.equal(detectMimeType('photo.JPG'), 'image/jpeg');
    assert.equal(detectMimeType('icon.svg'), 'image/svg+xml');
    assert.equal(detectMimeType('clip.mp4'), 'video/mp4');
    assert.equal(detectMimeType('song.mp3'), 'audio/mpeg');
  });

  it('falls back to application/octet-stream for unknown binary extensions', () => {
    assert.equal(detectMimeType('payload.bin'), 'application/octet-stream');
    assert.equal(detectMimeType('archive.dmg'), 'application/octet-stream');
    assert.equal(detectMimeType('weird'), 'application/octet-stream');
  });
});

describe('isTextMime', () => {
  it('returns true for text/* prefixes', () => {
    assert.equal(isTextMime('text/plain'), true);
    assert.equal(isTextMime('text/typescript'), true);
    assert.equal(isTextMime('text/x-shellscript'), true);
  });

  it('treats JSON and XML as text even though they start with application/', () => {
    assert.equal(isTextMime('application/json'), true);
    assert.equal(isTextMime('application/xml'), true);
    assert.equal(isTextMime('application/javascript'), true);
    assert.equal(isTextMime('image/svg+xml'), true);
  });

  it('returns false for binary mimes', () => {
    assert.equal(isTextMime('image/png'), false);
    assert.equal(isTextMime('video/mp4'), false);
    assert.equal(isTextMime('application/octet-stream'), false);
    assert.equal(isTextMime('application/pdf'), false);
  });
});
