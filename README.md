# brief_

한국 AI 실무자용 실시간 뉴스 터미널. 속보·중요·참고로 나눠 한 줄 시사점과 함께 보여 준다.

Next.js App Router · pnpm · Vercel · Postgres(Supabase). 15분마다 글을 쌓는 시계는 GitHub Actions가 아니라 이미 켜 둔 리눅스 장비의 cron이다.

---

## 한 줄 구조

```
리눅스 cron  ──POST /api/collect──►  Vercel (Next.js)  ──INSERT──►  Postgres (Supabase)
     ▲                                    │                          │
  OCI / 집 PC                             │                          └── 피드·RSS·상세가 여기를 읽음
                                          └── POST /api/ingest  (마크다운 수동 편성)
```

- **화면·API:** Vercel에 올라간 이 Next.js 앱
- **글 저장:** Postgres. 이미 쓰는 **Supabase** Transaction pooler 문자열을 `DATABASE_URL`에 넣는다. 런타임에 `.md` 파일을 디스크에 쓰지 않는다 (Vercel은 런타임 FS 쓰기가 없다)
- **마크다운:** 사람이 붙이는 **입력 포맷**. 편성 데스크 또는 `POST /api/ingest`
- **시계:** OCI·집 리눅스 `crontab`. GitHub는 코드 관리용. Grok 채팅 스케줄러는 프로덕션 시계가 아니다

GitHub Actions로 15분마다 `.md`를 커밋하면 월 무료 분이 부족하고, 커밋마다 Vercel이 다시 빌드된다. 그 길은 쓰지 않는다. Vercel Hobby 크론은 **하루 1회**라 쓰지 않는다.

`DATABASE_URL`이 없으면 인스턴스 메모리 시드로 돌아간다. 미리보기·로컬은 이렇게 동작하고, **배포 본 서버는 Postgres가 있어야** 수집 결과가 남는다.

---

## 스택

| 항목 | 버전 |
|---|---|
| Next.js (App Router) | 16.3 |
| React | 19.2 |
| Tailwind CSS | 4 |
| React Compiler | 켜짐 |
| pnpm | 10.17 |
| Zod / Zustand / Sonner | 최신 |
| Postgres 드라이버 | `postgres` (Supabase·Neon 등 아무 Postgres) |

계정 없음. 행은 소유자 없이 피드 공용.

---

## 진행 순서 (크론은 맨 마지막)

1. 피드 UI, 상세, RSS, 편성 데스크
2. Postgres 스키마 (`db/schema.sql`) + 수집/입고 API
3. GitHub에 올리고 Vercel 배포, `DATABASE_URL` · LLM 키 연결
4. **마지막:** 리눅스 cron이 배포 URL의 `/api/collect`를 치게 한다

사이트가 비어 있어도, 헤더 **수집**과 `/desk` 편성 데스크로 글을 넣을 수 있다. 시계는 배포 URL이 안정된 뒤에 붙인다.

이 저장소는 Vercel Import가 가능하도록 **public** 이다. 시크릿은 커밋하지 않는다.

### 대시보드에서 할 일 (여기 샌드박스에서 못 끝낸 것)

Vercel GitHub App이 이 계정에 설치되어 있지 않아, 여기서 프로젝트를 만들어도 Git 연결이 404가 난다. **새로 프로젝트를 만들지 말고** 아래만 하면 된다.

1. [github.com/goddaehee/brief-news](https://github.com/goddaehee/brief-news) 가 public인지 확인
2. [vercel.com/new](https://vercel.com/new) → Import `goddaehee/brief-news`
   - GitHub App 권한을 이 저장소에 허용
   - 이름이 `brief-news` 또는 `brief-terminal` 로 이미 보이면 **그걸 골라 Git 연결**. 같은 이름 프로젝트를 또 만들지 말 것
3. Environment Variables
   - `DATABASE_URL` — Supabase Transaction pooler URI (포트 6543)
   - LLM 키 하나 — 아래 표. 없으면 원문 제목 폴백
   - `COLLECT_SECRET` — 크론 붙이는 그 커밋에서
4. 배포 URL이 200으로 열린 뒤, 아래 크론 절을 따른다

---

## 스크립트

```bash
pnpm install
pnpm dev          # 개발 서버
pnpm typecheck
pnpm build
pnpm start        # 빌드 산출물
```

---

## 환경 변수 (Vercel 프로젝트 Settings → Environment Variables)

`.env` 파일은 커밋하지 않는다. 값은 Vercel 대시보드에만 둔다.

| 키 | 어디서 | 용도 |
|---|---|---|
| `DATABASE_URL` | Supabase (권장) 또는 아무 Postgres | 글·브리핑·수집 로그. 없으면 메모리 시드(재시작·인스턴스마다 리셋) |
| `GLM_API_KEY` 또는 `ZAI_API_KEY` | 서버만 | GLM으로 한국어 분류·요약. 기본 `https://api.z.ai/api/paas/v4` · `glm-5.3` |
| `XAI_API_KEY` | 서버만 | xAI grok-4.5. GLM과 둘 다 있으면 `LLM_API_KEY` → xAI → GLM 순 |
| `LLM_API_KEY` | 서버만 | OpenAI 호환 키. `LLM_BASE_URL` · `LLM_MODEL`과 같이 쓰면 제공자를 직접 고른다 |
| `LLM_BASE_URL` | 선택 | 예: `https://open.bigmodel.cn/api/paas/v4`, `https://openrouter.ai/api/v1` |
| `LLM_MODEL` | 선택 | 예: `glm-5.3`, `grok-4.5` |
| `COLLECT_SECRET` | 나중 | 크론 붙일 때. 없으면 `/api/collect` POST가 열려 있음 |

페이지 로드마다 AI를 부르지 않는다. 수집 버튼·크론·입고 API만 호출한다. `GET /api/collect`는 상태 조회만 하고 수집하지 않는다.

---

## API

| 방법 | 경로 | 역할 |
|---|---|---|
| GET | `/api/collect` | 마지막 수집 시각만. AI 호출 없음 |
| POST | `/api/collect` | RSS 수집 → (있으면) 한국어 분류·요약 → DB. 신규 최대 6건, 10분 쿨다운 |
| POST JSON | `/api/ingest` | `{ "markdown": "---\\n..." }` 또는 `{ "files": ["..."] }` 또는 `{ "items": [ ... ] }` |
| GET | `/rss.xml` | 머신리더용 RSS |
| GET | `/desk` | 마크다운 편성 UI + 수집 로그 |
| GET | `/rss` | RSS 읽기용 페이지 |

수집 파이프라인은 `src/lib/news/sources.ts` 목록을 그대로 당긴다. 출처를 늘리려면 그 배열만 고친다.

---

## 마크다운 입고 계약

`content/news/_example.md` 와 동일하다.

```markdown
---
title: 한국어 헤드라인
grade: breaking | important | note
tip: false
source: GeekNews
source_url: https://…
original_title: Original headline
topics: agent, openai
published: 2026-09-15T16:00:00+09:00
---

한 줄 시사점. 실무자가 뭘 하면 되는지.

## 요약

3~5문장.
```

같은 `source_url`은 unique index로 한 번만 들어간다. 파일은 git에 남겨 두되, **런타임 소스는 항상 DB**다.

---

## 리눅스 장비로 수집 (OCI / 집 PC)

배포 URL은 `https://brief-ai-news.vercel.app` 이다. **OCI가 주 시계**, 집 PC는 백업. 겹치면 서버가 `collect_lock` + 10분 쿨다운으로 한쪽만 수집한다.

한 장비에 cron과 systemd를 같이 두지 않는다. 아래 스크립트가 cron만 남긴다.

**OCI (주)**

```bash
curl -fsSL https://raw.githubusercontent.com/goddaehee/brief-news/main/scripts/install-collect.sh | sudo bash -s -- oci
```

**집 PC (백업)**

```bash
curl -fsSL https://raw.githubusercontent.com/goddaehee/brief-news/main/scripts/install-collect.sh | sudo bash -s -- home
```

하는 일: `brief-collect.sh` 설치, `/etc/brief-collect.env` (0600), `/etc/cron.d/brief-collect`, logrotate, 수집 1회. 이미 env가 있으면 `COLLECT_SECRET`은 유지한다.

시크릿을 같이 넣을 때 (Vercel `COLLECT_SECRET`과 같은 값, 두 대 동일):

```bash
curl -fsSL https://raw.githubusercontent.com/goddaehee/brief-news/main/scripts/install-collect.sh | sudo COLLECT_SECRET='긴문자열' bash -s -- oci
```

주소만 바꿀 때: `sudo BRIEF_COLLECT_URL=https://다른주소/api/collect bash -s -- oci`

| 장비 | 인자 | 분 |
|---|---|---|
| OCI | `oci` | `*/15` |
| 집 PC | `home` | `3,18,33,48` |

로그: `tail -n 20 /var/log/brief-collect.log`

| status | 의미 |
|---|---|
| `ok` | 끝. `inserted` 0이어도 정상 |
| `rate_limited` | 다른 대/직전 10분 안. 정상 |
| `error` | RSS·키·DB. 사이트는 마지막 글 유지 |
| HTTP 401 | 시크릿 불일치 |

GitHub Actions 15분, Vercel Hobby cron(하루 1회)은 시계로 쓰지 않는다.

### 운영 메모

- 주기: 15분이 기본. 더 자주 쳐도 서버 쿨다운이 10분이면 빈 호출로 끝남
- AI 비용: **새로 들어온 URL만** 요약. 주기를 줄인다고 과금이 선형으로 늘지 않음. 상한은 `COLLECT_MAX_NEW=6`
- 한글 RSS: EUC-KR/CP949 은 파서가 charset을 읽어 디코드한다
- 장애: 크론이 죽어도 사이트는 마지막 DB 상태로 계속 보인다. `/desk` 편성 데스크와 헤더 **수집** 버튼이 수동 백업
- `/desk` 는 공개 푸터에 없다. 운영자만 주소를 안다. `robots.txt` 가 `/desk`, `/api/` 를 막는다
- `GET /api/collect` 로 브라우저를 새로고침하지 말 것. 수집은 POST만

### 나중에 넣을 보안 (크론 붙이는 그 커밋에서)

지금은 `COLLECT_SECRET`이 없으면 POST가 열려 있다. 크론을 연결하는 커밋에서:

1. Vercel → Settings → Environment Variables → `COLLECT_SECRET`
2. `/etc/brief-collect.env` 에 같은 값
3. 한 번 `curl -H "Authorization: Bearer …"` 로 200 확인
4. 시크릿 없이 치면 401인지 확인

---

## Postgres 스키마 (Supabase)

`db/schema.sql` 을 Supabase SQL Editor에 한 번 실행해도 되고, 앱이 첫 요청에서 `create table if not exists`로 같은 테이블을 만든다. RLS는 켜지 않는다. 행은 소유자 없이 피드 공용.

### Supabase 연결 문자열

1. 이미 쓰는 프로젝트 → **Settings → Database → Connection string → URI**
2. Mode는 **Transaction** (포트 `6543`). Session(`5432`)은 Vercel 서버리스와 안 맞는다
3. 비밀번호에 `@` `#` `%` 가 있으면 URL 인코딩
4. 그 URI를 Vercel `DATABASE_URL`에 그대로 붙인다

Auth·로그인은 쓰지 않는다. 테이블 네 개(`news_items`, `briefings`, `ingest_runs`, `collect_lock`)만 쓴다.

계정 없음. 개인 글을 넣지 마세요.

---

## 시계: 되는 것 / 안 되는 것

문장 품질(한국어 한 줄 시사점, 속보·중요)은 **수집 시점에 LLM을 호출하는 것**에서 나온다. 스케줄은 “언제 돌릴지”일 뿐, 키를 대체하지 않는다.

| 방법 | 프로덕션 시계? | 이유 |
|---|---|---|
| 리눅스 crontab 여러 대 → `POST /api/collect` | 예 | 락 + 10분 쿨다운 + `source_url` unique. OCI 주, 집 PC 백업 |
| Grok 채팅 Automations / 이 대화 스케줄 | 아니오 | 대화에 묶이고 기본 7일 만료. 사이트가 혼자 안 돌아감 |
| Grok Build CLI를 각 PC cron에 | 가능하지만 과함 | 하는 일은 결국 같은 POST. PC마다 CLI 로그인이 필요 |
| GitHub Actions `schedule` | 아니오 | 무료 분 부족, 밀리거나 건너뜀 |
| Vercel Hobby cron | 아니오 | 하루 1회 |

여러 PC에서 같은 URL·같은 시크릿으로 쳐도 된다. 먼저 도착한 쪽이 락을 잡고, 나머지는 `rate_limited`로 끝난다. 글은 `source_url` unique라 두 줄로 안 쌓인다.

---

## GLM / 다른 LLM 키

어렵지 않다. 수집은 OpenAI 호환 `/chat/completions`만 부른다. Vercel env에 키만 넣으면 된다.

| 이미 가진 것 | 넣을 env |
|---|---|
| GLM (z.ai) | `GLM_API_KEY` 또는 `ZAI_API_KEY` |
| GLM 중국 콘솔 | `GLM_API_KEY` + `LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4` |
| xAI | `XAI_API_KEY` |
| OpenRouter 등 | `LLM_API_KEY` + `LLM_BASE_URL` + `LLM_MODEL` |

키가 없으면 수집은 되고 제목은 원문 폴백이다. 페이지를 열 때마다 과금되지 않는다. 새로 들어온 URL만, 한 번에 최대 6건.


