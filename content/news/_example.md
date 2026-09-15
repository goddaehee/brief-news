---
title: 예시 — 마크다운 한 건이 피드 한 줄이 됩니다
grade: important
tip: false
source: brief
source_url: https://example.com/ai-news-example
original_title: Example markdown ingest item
topics: agent, korea-ai
published: 2026-09-15T15:00:00+09:00
---

크론이나 수동 수집은 이 형식의 .md를 POST /api/ingest 하면 DB에 올라갑니다.

## 요약

frontmatter + 한 줄 시사점 + 요약 본문. 같은 source_url은 중복 저장되지 않습니다. 런타임 소스는 Postgres(미리보기는 PGLite)이고, 마크다운은 편성 입력 포맷입니다.
