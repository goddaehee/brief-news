# brief_

한국 AI 실무자용 실시간 뉴스 터미널. 속보·중요·참고로 나눠 한 줄 시사점과 함께 보여 준다.

Next.js App Router · pnpm · Vercel · Neon(Postgres). 15분마다 글을 쌓는 시계는 GitHub Actions가 아니라 이미 켜 둔 리눅스 장비의 cron이다.

---

## 한 줄 구조

```
리눅스 cron  ──POST /api/collect──►  Vercel (Next.js)  ──INSERT──►  Neon(Postgres)
     ▲                                    │                          │
  OCI / 집 PC                             │                          └── 피드·RSS·상세가 여기를 읽음
                                          └── POST /api/ingest  (마크다운 수동 편성)
```

- **화면·API:** Vercel에 올라간 이 Next.js 앱
- **글 저장:** Neon. 런타임에 `.md` 파일을 디스크에 쓰지 않는다 (Vercel은 런타임 FS 쓰기가 없다)
- **마크다운:** 사람이 붙이는 **입력 포맷**. 편성 데스크 또는 `POST /api/ingest`
- **시계:** OCI·집 리눅스 `crontab`. GitHub는 코드 관리용

GitHub Actions로 15분마다 `.md`를 커밋하면 월 무료 분이 부족하고, 커밋마다 Vercel이 다시 빌드된다. 그 길은 쓰지 않는다. Vercel Hobby 크론은 **하루 1회**라 쓰지 않는다.

`DATABASE_URL`이 없으면 인스턴스 메모리 시드로 돌아간다. 미리보기·로컬은 이렇게 동작하고, **배포 본 서버는 Neon이 있어야** 수집 결과가 남는다.

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
| Neon serverless | `@neondatabase/serverless` |

계정 없음. 행은 소유자 없이 피드 공용.

---

## 진행 순서 (크론은 맨 마지막)

1. 피드 UI, 상세, RSS, 편성 데스크
2. Neon 스키마 (`db/schema.sql`) + 수집/입고 API
3. GitHub에 올리고 Vercel 배포, `DATABASE_URL` · `XAI_API_KEY` 연결
4. **마지막:** 리눅스 cron이 배포 URL의 `/api/collect`를 치게 한다

사이트가 비어 있어도, 버튼 **지금 수집**과 편성 데스크로 글을 넣을 수 있다. 시계는 배포 URL이 안정된 뒤에 붙인다.

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
| `DATABASE_URL` | Neon | 글·브리핑·수집 로그. 없으면 메모리 시드(재시작·인스턴스마다 리셋) |
| `XAI_API_KEY` | 서버만 | 분류·한국어 요약. 없으면 원문 제목·발췌 폴백 |
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

## 리눅스 장비로 수집 (OCI / 집 PC) — 맨 마지막 단계

둘 다 리눅스면 된다. 공인 IP가 있는 OCI를 주 시계로 두고, 집 PC는 백업으로 두어도 된다. 앱 쪽 쿨다운이 **10분**이라 두 대가 겹쳐 쳐도 같은 원문을 두 번 과금하지 않는다.

배포 URL이 안정된 뒤 `/etc/cron.d/brief-collect` 또는 `crontab -e`:

```cron
# 15분마다. 로그는 장비 로컬.
*/15 * * * *  curl -fsS -X POST "https://YOUR_DOMAIN/api/collect" >> /var/log/brief-collect.log 2>&1
```

한 번 시험:

```bash
curl -sS -X POST "https://YOUR_DOMAIN/api/collect"
# {"ok":true,"status":"ok"|"rate_limited","fetched":…,"inserted":…,"skipped":…,"note":"…"}
```

`status`가 `rate_limited`이면 정상이다. 직전 수집 후 10분이 안 지난 것이다.

선택: systemd timer (`OnCalendar=*:0/15`). cron과 둘 중 하나만.

### 나중에 넣을 보안 (크론 붙이는 그 커밋에서)

지금은 `COLLECT_SECRET`이 없으면 POST가 열려 있다. 배포 URL이 공개되면 아무나 수집을 칠 수 있다. 크론을 연결하는 커밋에서 Vercel env에 `COLLECT_SECRET`을 넣고, 크론 장비에도 같은 값을 둔다.

```bash
curl -fsS -X POST "https://YOUR_DOMAIN/api/collect" \
  -H "Authorization: Bearer $COLLECT_SECRET"
```

---

## Neon 스키마

`db/schema.sql` 을 Neon SQL Editor에 한 번 실행하면 된다. 앱도 첫 요청에서 `create table if not exists`로 같은 테이블을 만든다.

계정 없음. 행은 소유자 없이 피드 공용. 개인 글을 넣지 마세요.

---

## 운영 메모

- 주기: 15분이 기본. 더 자주 쳐도 서버 쿨다운이 10분이면 빈 호출로 끝남
- AI 비용: **새로 들어온 URL만** 요약. 주기를 줄인다고 과금이 선형으로 늘지 않음
- 한글 RSS: 국내 매체 일부는 EUC-KR일 수 있음. 글이 깨지면 파서 charset부터 볼 것
- 장애: 크론이 죽어도 사이트는 마지막 DB 상태로 계속 보인다. 편성 데스크·수집 버튼이 수동 백업
