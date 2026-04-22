export class UsageError extends Error {
  public readonly hint?: string;
  public readonly exitCode: number;

  constructor(message: string, options: { hint?: string; exitCode?: number } = {}) {
    super(message);
    this.name = 'UsageError';
    this.hint = options.hint;
    this.exitCode = options.exitCode ?? 2;
  }
}
