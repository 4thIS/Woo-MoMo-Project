-- 이력서 슬롯·벤 면접·보관함·녹음 (spec 3.1).
-- 대화·리포트는 해석하지 않고 JSON 문자열 그대로 둔다.
CREATE TABLE resumes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('company', 'admission')),
    title TEXT NOT NULL,
    text TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX resumes_user_kind ON resumes(user_id, kind);

CREATE TABLE premium_interviews (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track TEXT NOT NULL CHECK (track IN ('company', 'admission')),
    inputs_json TEXT NOT NULL,
    messages_json TEXT NOT NULL DEFAULT '[]',
    model_turns INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done')),
    created_at TEXT NOT NULL
);
CREATE INDEX premium_interviews_created ON premium_interviews(created_at);

CREATE TABLE archive (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    interviewer_id TEXT NOT NULL,
    premium INTEGER NOT NULL CHECK (premium IN (0, 1)),
    premium_interview_id TEXT REFERENCES premium_interviews(id),
    track TEXT NOT NULL CHECK (track IN ('company', 'admission')),
    field TEXT,
    job TEXT,
    name TEXT,
    age INTEGER,
    university TEXT,
    department TEXT,
    question_count INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    messages_json TEXT NOT NULL,
    report_json TEXT NOT NULL,
    report_raw TEXT NOT NULL
);
CREATE INDEX archive_user ON archive(user_id, premium, started_at);
-- 벤 면접 하나는 보관함에 한 번만 저장된다
CREATE UNIQUE INDEX archive_premium_interview
    ON archive(premium_interview_id) WHERE premium_interview_id IS NOT NULL;

CREATE TABLE recordings (
    id TEXT PRIMARY KEY,
    archive_id TEXT NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    turn INTEGER NOT NULL,
    path TEXT NOT NULL,
    mime TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (archive_id, turn)
);
