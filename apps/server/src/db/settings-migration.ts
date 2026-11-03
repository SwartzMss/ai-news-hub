export const settingsMigration = {
  version: 6, name: 'admin_credentials_and_settings', sql: `
    CREATE TABLE app_settings (
      id INTEGER PRIMARY KEY CHECK (id=1),
      revision INTEGER NOT NULL CHECK (revision>0),
      config_json TEXT NOT NULL CHECK (json_valid(config_json)),
      github_secret TEXT,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE admin_credentials (
      id INTEGER PRIMARY KEY CHECK (id=1),
      kind TEXT NOT NULL CHECK (kind IN ('password','token')),
      secret_hash TEXT NOT NULL,
      salt TEXT,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE admin_sessions (
      token_hash TEXT PRIMARY KEY NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
  `,
};
