export interface ColorFns {
  bold: (s: string) => string;
  dim: (s: string) => string;
  green: (s: string) => string;
  yellow: (s: string) => string;
  red: (s: string) => string;
  cyan: (s: string) => string;
}

function ansiWrap(open: number, close: number, s: string): string {
  return `\u001b[${open}m${s}\u001b[${close}m`;
}

export function makeColors(enabled: boolean): ColorFns {
  if (!enabled) {
    const id = (s: string) => s;
    return { bold: id, dim: id, green: id, yellow: id, red: id, cyan: id };
  }
  return {
    bold: (s) => ansiWrap(1, 22, s),
    dim: (s) => ansiWrap(2, 22, s),
    green: (s) => ansiWrap(32, 39, s),
    yellow: (s) => ansiWrap(33, 39, s),
    red: (s) => ansiWrap(31, 39, s),
    cyan: (s) => ansiWrap(36, 39, s),
  };
}

export function renderTable(rows: Array<Record<string, string>>, columns: string[]): string {
  if (rows.length === 0) return '';
  const widths: Record<string, number> = {};
  for (const col of columns) widths[col] = col.length;
  for (const row of rows) {
    for (const col of columns) {
      const v = row[col] ?? '';
      if (v.length > widths[col]) widths[col] = v.length;
    }
  }

  const header = columns.map((col) => col.toUpperCase().padEnd(widths[col])).join('  ');
  const separator = columns.map((col) => '─'.repeat(widths[col])).join('  ');
  const body = rows
    .map((row) =>
      columns.map((col) => (row[col] ?? '').padEnd(widths[col])).join('  ').trimEnd(),
    )
    .join('\n');

  return [header, separator, body].join('\n');
}

export function emitJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function emitLine(line = ''): void {
  process.stdout.write(`${line}\n`);
}

export function emitStatus(label: string, tone: 'ok' | 'warn' | 'err' | 'info', colors: ColorFns) {
  switch (tone) {
    case 'ok':
      return `${colors.green('●')} ${label}`;
    case 'warn':
      return `${colors.yellow('●')} ${label}`;
    case 'err':
      return `${colors.red('●')} ${label}`;
    default:
      return `${colors.cyan('●')} ${label}`;
  }
}

export function statusTone(status: string): 'ok' | 'warn' | 'err' | 'info' {
  switch (status) {
    case 'succeeded':
      return 'ok';
    case 'failed':
    case 'cancelled':
      return 'err';
    case 'running':
      return 'info';
    default:
      return 'warn';
  }
}

export function trim(text: string | undefined, max: number): string {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

export function formatDate(iso?: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
  } catch {
    return iso;
  }
}
