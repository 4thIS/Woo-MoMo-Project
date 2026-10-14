-- 벤 호출 시도 횟수 상한(턴·리포트마다 +1)과 리포트 원문 보관(재요청 때 다시 보낸다). additive.
ALTER TABLE premium_interviews ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE premium_interviews ADD COLUMN report_raw TEXT;
