import * as path from 'node:path';
import type {
  FileSummaryContent,
  FileSummaryFile,
  FileSummaryItem,
  FileSummaryKind,
} from '@cepage/shared-core';

const TEXT_EXTS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.css',
  '.csv',
  '.env',
  '.gitignore',
  '.go',
  '.h',
  '.hpp',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.kt',
  '.less',
  '.log',
  '.md',
  '.mjs',
  '.php',
  '.py',
  '.rb',
  '.rs',
  '.scss',
  '.sh',
  '.sql',
  '.svg',
  '.swift',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);
const BINARY_EXTS = new Set([
  '.7z',
  '.avi',
  '.bmp',
  '.doc',
  '.docx',
  '.exe',
  '.gz',
  '.ico',
  '.jar',
  '.mov',
  '.mp3',
  '.mp4',
  '.pdf',
  '.ppt',
  '.pptx',
  '.tar',
  '.wav',
  '.webm',
  '.xls',
  '.xlsx',
  '.zip',
]);
const IMAGE_EXTS = new Set(['.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp']);

export const FILE_TEXT_LIMIT = 12000;
export const FILE_PROMPT_LIMIT = 8000;

export interface FileUploadInput {
  name: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  buffer: Buffer;
}

export interface FileUploadExtract {
  file: FileSummaryFile;
  extractedText?: string;
  extractedTextChars?: number;
  extractedTextTruncated?: boolean;
}

function readExt(name: string): string | undefined {
  const ext = path.extname(name || '').toLowerCase();
  return ext || undefined;
}

function looksTextMime(mimeType: string): boolean {
  if (!mimeType) return false;
  if (mimeType.startsWith('text/')) return true;
  return [
    'application/json',
    'application/javascript',
    'application/typescript',
    'application/x-javascript',
    'application/xml',
    'image/svg+xml',
  ].includes(mimeType);
}

function hasZeroByte(buffer: Buffer): boolean {
  const size = Math.min(buffer.length, 4096);
  for (let i = 0; i < size; i += 1) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

function detectKind(name: string, mimeType: string, buffer: Buffer): FileSummaryKind {
  const ext = readExt(name);
  if (mimeType.startsWith('image/') || (ext && IMAGE_EXTS.has(ext))) {
    return 'image';
  }
  if (ext && BINARY_EXTS.has(ext)) {
    return 'binary';
  }
  if (looksTextMime(mimeType) || (ext && TEXT_EXTS.has(ext))) {
    return 'text';
  }
  return hasZeroByte(buffer) ? 'binary' : 'text';
}

function readPngSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24) return null;
  if (
    buffer[0] !== 0x89 ||
    buffer[1] !== 0x50 ||
    buffer[2] !== 0x4e ||
    buffer[3] !== 0x47
  ) {
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function readGifSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 10) return null;
  const sig = buffer.subarray(0, 6).toString('ascii');
  if (sig !== 'GIF87a' && sig !== 'GIF89a') return null;
  return {
    width: buffer.readUInt16LE(6),
    height: buffer.readUInt16LE(8),
  };
}

function readJpegSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let pos = 2;
  while (pos + 9 < buffer.length) {
    if (buffer[pos] !== 0xff) {
      pos += 1;
      continue;
    }
    const marker = buffer[pos + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const size = buffer.readUInt16BE(pos + 2);
    if (size < 2 || pos + size + 2 > buffer.length) break;
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return {
        height: buffer.readUInt16BE(pos + 5),
        width: buffer.readUInt16BE(pos + 7),
      };
    }
    pos += size + 2;
  }
  return null;
}

function readImageSize(name: string, mimeType: string, buffer: Buffer): { width: number; height: number } | null {
  if (mimeType === 'image/png' || readExt(name) === '.png') {
    return readPngSize(buffer);
  }
  if (mimeType === 'image/gif' || readExt(name) === '.gif') {
    return readGifSize(buffer);
  }
  if (
    mimeType === 'image/jpeg' ||
    mimeType === 'image/jpg' ||
    readExt(name) === '.jpg' ||
    readExt(name) === '.jpeg'
  ) {
    return readJpegSize(buffer);
  }
  return null;
}

function readText(buffer: Buffer): {
  text: string;
  chars: number;
  truncated: boolean;
} | null {
  const raw = buffer.toString('utf8');
  if (!raw) {
    return { text: '', chars: 0, truncated: false };
  }
  const text = raw.length > FILE_TEXT_LIMIT ? raw.slice(0, FILE_TEXT_LIMIT) : raw;
  return {
    text,
    chars: text.length,
    truncated: raw.length > FILE_TEXT_LIMIT,
  };
}

export function extractFileUpload(input: FileUploadInput): FileUploadExtract {
  const kind = detectKind(input.name, input.mimeType, input.buffer);
  const size = kind === 'image' ? readImageSize(input.name, input.mimeType, input.buffer) : null;
  const text =
    kind === 'text' || input.mimeType === 'image/svg+xml' || readExt(input.name) === '.svg'
      ? readText(input.buffer)
      : null;
  return {
    file: {
      name: input.name,
      mimeType: input.mimeType || 'application/octet-stream',
      size: input.size,
      kind,
      uploadedAt: input.uploadedAt,
      extension: readExt(input.name),
      ...(size ? size : {}),
    },
    ...(text ? { extractedText: text.text, extractedTextChars: text.chars, extractedTextTruncated: text.truncated } : {}),
  };
}

function fileDetails(file: FileSummaryFile): string[] {
  const lines = [
    `name: ${file.name}`,
    `mime: ${file.mimeType}`,
    `size: ${file.size} bytes`,
    `kind: ${file.kind}`,
  ];
  if (file.width && file.height) {
    lines.push(`dimensions: ${file.width}x${file.height}`);
  }
  if (file.extension) {
    lines.push(`extension: ${file.extension}`);
  }
  return lines;
}

function trimText(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}\n[truncated]` : text;
}

function itemDetails(item: FileSummaryItem): string[] {
  return [`id: ${item.id}`, ...fileDetails(item.file)];
}

function displayNodeSummary(content: FileSummaryContent): string | null {
  if (content.summary !== undefined) {
    const text = content.summary.trim();
    return text.length > 0 ? text : null;
  }
  const text = content.generatedSummary?.trim();
  return text || null;
}

export function buildFileSummaryPrompt(item: FileSummaryItem): string {
  const lines = [
    'You are summarizing one uploaded file for a graph node.',
    'Write a concise 2-4 sentence summary in plain text.',
    'If the file is code, explain its likely purpose and notable symbols or sections.',
    'If the file is text, explain the topic and the most important points.',
    'If the file is an image and only metadata is available, explicitly say that you only know the filename, format, size, and dimensions. Do not invent visual details.',
    '',
    'File metadata:',
    ...itemDetails(item),
  ];
  const text = item.extractedText?.trim();
  if (text) {
    lines.push('', 'Extracted content:', text.slice(0, FILE_PROMPT_LIMIT));
  } else {
    lines.push('', 'Extracted content: unavailable');
  }
  return lines.join('\n');
}

export function buildCombinedFileSummaryPrompt(content: FileSummaryContent): string | null {
  const files = content.files ?? [];
  const items = files.filter((item) => item.summary?.trim() || item.extractedText?.trim());
  if (items.length === 0) return null;
  const perItemLimit = Math.max(600, Math.floor(FILE_TEXT_LIMIT / Math.max(items.length, 1)));
  const lines = [
    'You are combining multiple uploaded-file summaries into one node summary.',
    'Return concise markdown only.',
    'Use a short heading, then bullets with the most useful themes, risks, and notable files.',
    'Do not repeat raw file metadata unless it helps the reader.',
  ];
  items.forEach((item, index) => {
    lines.push('', `File ${index + 1}:`, ...itemDetails(item));
    if (item.summary?.trim()) {
      lines.push('', 'Existing file summary:', item.summary.trim());
      return;
    }
    if (item.extractedText?.trim()) {
      lines.push('', 'Extracted content:', trimText(item.extractedText.trim(), perItemLimit));
      return;
    }
    lines.push('', 'No extracted content available.');
  });
  return lines.join('\n');
}

export function buildFileContextBlock(content: FileSummaryContent): string | null {
  const files = content.files ?? [];
  if (files.length === 0) return null;
  const perItemLimit = Math.max(500, Math.floor(FILE_PROMPT_LIMIT / Math.max(files.length, 1)));
  const lines = ['[Uploaded files context]'];
  const summary = displayNodeSummary(content);
  if (summary) {
    lines.push('', 'Combined summary:', summary);
  }
  files.forEach((item, index) => {
    lines.push('', `File ${index + 1}:`, ...itemDetails(item));
    if (item.summary?.trim()) {
      lines.push('', 'Summary:', item.summary.trim());
    } else if (item.status) {
      lines.push('', `Status: ${item.status}`);
    }
    if (item.error?.trim()) {
      lines.push('', `Error: ${item.error.trim()}`);
    }
    if (item.extractedText?.trim()) {
      lines.push('', 'Extracted content:', trimText(item.extractedText.trim(), perItemLimit));
      return;
    }
    if (!item.summary?.trim()) {
      lines.push('', 'No extracted content was available for this file.');
    }
  });
  return trimText(lines.join('\n'), FILE_PROMPT_LIMIT);
}
