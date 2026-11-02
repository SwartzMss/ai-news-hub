export class AppError extends Error {
  constructor(public readonly code: string, message = code) { super(message); }
}

export function errorCode(error: unknown): string {
  if (error instanceof AppError) return error.code;
  if (error instanceof Error && 'code' in error && typeof error.code === 'string'
    && ['EACCES', 'EPERM', 'EADDRINUSE', 'ENOENT', 'ENOSPC', 'ELOOP', 'ERR_SQLITE_ERROR'].includes(error.code)) {
    return error.code;
  }
  return 'internal_error';
}

export function assertServiceUser(): void {
  if (process.platform !== 'linux' || process.getuid?.() === 0) {
    throw new AppError('non_root_linux_required');
  }
}
