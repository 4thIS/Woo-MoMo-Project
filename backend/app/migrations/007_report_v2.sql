-- 벤 리포트 버전 2 (spec 2026-10-23). additive.
ALTER TABLE premium_interviews ADD COLUMN report_v2_json TEXT;
ALTER TABLE archive ADD COLUMN report_v2_json TEXT;
