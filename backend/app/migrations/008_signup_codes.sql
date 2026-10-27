-- 가입 이메일 인증 PIN (spec 2026-10-27). 이메일당 한 줄, PIN은 해시로만 저장. additive.
CREATE TABLE signup_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at REAL NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_sent_at REAL NOT NULL,
  window_start REAL NOT NULL,
  window_count INTEGER NOT NULL
);
