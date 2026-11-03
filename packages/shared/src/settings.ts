export interface RuntimeSettings {
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  codex: { binary: string; model: string };
  execution: { timeoutMs: number; concurrency: number; maxQueue: number };
  github: { enabled: boolean; repository: string; branch: string };
}
export interface SettingsView extends Omit<RuntimeSettings,'github'> {
  revision: number;
  github: RuntimeSettings['github'] & { tokenConfigured: boolean };
}
export interface SettingsUpdate extends Omit<RuntimeSettings,'github'> {
  revision: number;
  github: RuntimeSettings['github'] & { token?: string; clearToken?: boolean };
}
export interface AuthStatus { initialized: boolean; mode: 'setup' | 'password' | 'token' }
