-- 벤 회사 브리핑(spec 2026-10-15 2.4): 회사·직무별 7일 공유 캐시와 면접별 브리핑. additive.
CREATE TABLE company_briefings (
    key TEXT PRIMARY KEY,
    company TEXT NOT NULL,
    job TEXT NOT NULL,
    briefing TEXT NOT NULL,
    sources_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
ALTER TABLE premium_interviews ADD COLUMN briefing TEXT;
ALTER TABLE premium_interviews ADD COLUMN briefing_status TEXT NOT NULL DEFAULT 'none';
