-- 벤 목소리 분석(spec 2026-10-23 ②). additive.
ALTER TABLE premium_interviews ADD COLUMN voice_consent INTEGER NOT NULL DEFAULT 0;
CREATE TABLE voice_analysis (
    interview_id TEXT NOT NULL,
    answer INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'done', 'failed', 'unavailable')),
    result_json TEXT,
    error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (interview_id, answer)
);
CREATE TABLE baze_usage (
    id TEXT PRIMARY KEY,
    at TEXT NOT NULL,
    user_id TEXT NOT NULL,
    interview_id TEXT,
    key_index INTEGER,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    outcome TEXT NOT NULL
);
CREATE INDEX baze_usage_at ON baze_usage (at);
