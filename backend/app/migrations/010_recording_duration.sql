-- 녹음 길이(초). 재생 전 길이 표시용. 기존 녹음은 NULL. additive.
ALTER TABLE recordings ADD COLUMN duration_sec REAL;
