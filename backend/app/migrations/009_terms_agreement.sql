-- 가입 약관 동의 기록 (spec 2026-10-28). 기존 계정은 NULL. additive.
ALTER TABLE users ADD COLUMN terms_version TEXT;
ALTER TABLE users ADD COLUMN terms_agreed_at TEXT;
