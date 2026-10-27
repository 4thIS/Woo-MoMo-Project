-- 계정과 세션 (spec 3.1). 세션은 토큰의 SHA-256 해시만 둔다.
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    tier TEXT NOT NULL DEFAULT 'member' CHECK (tier IN ('member', 'premium')),
    tickets INTEGER NOT NULL DEFAULT 0 CHECK (tickets >= 0),
    is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
    name TEXT,
    age INTEGER,
    created_at TEXT NOT NULL
);

CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
);

CREATE INDEX sessions_user ON sessions(user_id);
