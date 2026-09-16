# brief_

한국 AI 실무자용 실시간 뉴스 터미널.

- 런타임 소스 오브 트루스는 Postgres (`DATABASE_URL`, 권장 Supabase pooler). 마크다운은 입고 포맷.
- 수집은 사용자 버튼 또는 리눅스 cron의 `POST /api/collect`. 페이지 로드에서 LLM을 부르지 않는다.
- LLM은 OpenAI 호환. `XAI_API_KEY` 또는 `GLM_API_KEY` / `LLM_API_KEY` + `LLM_BASE_URL`.
- `GET /api/collect`는 상태 조회만.
- 계정 없음. 행은 소유자 없이 피드 공용.
- 크론 연결은 배포 URL이 안정된 뒤, README 맨 마지막 단계.
- 여러 장비 시계는 `collect_lock` + 10분 쿨다운 + `source_url` unique.
