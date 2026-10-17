-- 관리자 대시보드(spec 2026-10-17 4·5절): Claude 호출 사용량과 관리자 감사 로그. additive.
CREATE TABLE claude_usage (
    id TEXT PRIMARY KEY,
    at TEXT NOT NULL,
    user_id TEXT NOT NULL,
    interview_id TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('turn', 'report', 'research')),
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens INTEGER NOT NULL DEFAULT 0,
    web_searches INTEGER NOT NULL DEFAULT 0,
    outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'error', 'refused'))
);
CREATE INDEX claude_usage_at ON claude_usage (at);
CREATE TABLE admin_audit (
    id TEXT PRIMARY KEY,
    at TEXT NOT NULL,
    admin_user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_user_id TEXT,
    detail_json TEXT NOT NULL
);
CREATE INDEX admin_audit_at ON admin_audit (at);
CREATE INDEX admin_audit_target ON admin_audit (target_user_id);
