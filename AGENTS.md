# brief_

한국 AI 실무자용 실시간 뉴스 터미널. 벤치마크는 [promppy.com](https://www.promppy.com/). 복제가 아니라 **같은 데스크 품질**.

## 운영

- 런타임 SoT는 Postgres (`DATABASE_URL`, 권장 Supabase Transaction pooler). 마크다운은 입고 포맷.
- 수집은 헤더 버튼 또는 리눅스 cron의 `POST /api/collect`. 페이지 로드에서 LLM을 부르지 않는다.
- LLM은 OpenAI 호환. `GLM_API_KEY` → `glm-5.3` (thinking 끄기 금지, `reasoning_effort=low`).
- `GET /api/collect`는 상태만. 여러 장비는 `collect_lock` + 10분 쿨다운 + `source_url` unique.
- 계정 없음. 행은 피드 공용.
- 실제 RSS가 하나라도 있으면 시드(데모) 코퍼스는 피드에 올리지 않는다.

## 데스크 품질 (수집 프롬프트 = 이 절)

새 글을 쓰거나 `classifyEntry` / `desk.ts`를 고칠 때 **원본 피드와 같은 기사를 나란히 놓고** 맞춘다. 문장 스타일을 짐작으로 바꾸지 말 것.

### 헤드라인
- 28~44자. 원문 제목을 베끼지 말고 다시 쓴다.
- 주어(회사·제품·규제) + 행위. 제품·법안만 `'따옴표'`.
- 말줄임표는 `...`. 신문 인용문·부제·수치 꼬리(`국산 협업툴 최초, AI 호출 100만 건`) 금지.
- 예: `오픈AI, 'AI 정렬 실패' 사례 보고 체계 구축` (O) / `오픈AI "AI 안전 확신 못 해…"` (X)

### 시사점
- 1~2문장, 마침표. **원문 리드 복사 금지.**
- 할 일만: 테스트 기회 / 점검 필요 / 적용 검토 / 주시.
- 금지: 존댓말, `전망이다`, `것으로 보인다`, 영어 괄호 병기.
- 예: `EU 시장 진출 서비스는 규제 리스크 점검 필요.`

### 등급
- 기본 **참고**. 원본도 열의 대부분이 참고.
- 중요: 규제·가격·출시가 파이프라인에 바로 닿을 때만.
- 속보: 장애·당일 출시·즉시 가격 변경만.
- 팁: 오늘 바로 쓰는 도구·프롬프트·무료 모델만.

### 버리지 말고 버릴 것
- 주식·공시·특징주·유튜브 라운드업·AI 무관 → `keep=false`
- 만찬·국빈·동행·포토·시상 → `keep=false` (원본도 안 올린다)

### 코드 위치
- 규칙·few-shot·폴리시: `src/lib/news/desk.ts`
- RSS 수집·락: `src/lib/news/collect.ts`
- 품질 회귀: 원본 RSS `https://www.promppy.com/rss.xml` 과 `https://brief-ai-news.vercel.app/rss.xml` 의 **같은 원문**을 비교.
