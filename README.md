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

사이트가 비어 있어도, 헤더 **수집**과 `/desk` 편성 데스크로 글을 넣을 수 있다. 시계는 배포 URL이 안정된 뒤에 붙인다.

이 저장소는 Vercel Import가 가능하도록 **public** 이다. 시크릿은 커밋하지 않는다.

### 대시보드에서 할 일 (여기 샌드박스에서 못 끝낸 것)

Vercel GitHub App이 이 계정에 설치되어 있지 않아, 여기서 프로젝트를 만들어도 Git 연결이 404가 난다. **새로 프로젝트를 만들지 말고** 아래만 하면 된다.

1. [github.com/goddaehee/brief-news](https://github.com/goddaehee/brief-news) 가 public인지 확인
2. [vercel.com/new](https://vercel.com/new) → Import `goddaehee/brief-news`
   - GitHub App 권한을 이 저장소에 허용
   - 이름이 `brief-news` 또는 `brief-terminal` 로 이미 보이면 **그걸 골라 Git 연결**. 같은 이름 프로젝트를 또 만들지 말 것
3. Environment Variables
   - `DATABASE_URL` — Neon Postgres (풀링 커넥션 문자열)
   - `XAI_API_KEY` — 분류·한국어 요약. 없으면 원문 제목 폴백
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

**지금은 붙이지 않는다.** 배포 URL이 안정되고 Neon `DATABASE_URL`이 붙은 뒤에 이 절만 따라 한다. 이 저장소·샌드박스에서 crontab을 설치하지 않는다.

둘 다 리눅스면 된다. **공인 IP가 있는 OCI를 주 시계**, 집 PC는 백업. 앱 쿨다운이 10분이라 두 대가 겹쳐 쳐도 같은 원문을 두 번 과금하지 않는다 (`status: rate_limited`).

```
OCI crontab  ──┐
               ├──POST /api/collect──►  Vercel  ──INSERT──►  Neon
집 PC crontab ─┘     (Bearer COLLECT_SECRET)
```

GitHub Actions 15분 스케줄은 쓰지 않는다. 비공개 Free는 월 2,000분이고 `schedule`이 밀리거나 건너뛴다. Vercel Hobby 크론은 **하루 1회**라 시계로 못 쓴다.

### 0. 준비

1. Vercel 배포 URL이 `https://YOUR_DOMAIN` 으로 열린다.
2. Vercel env에 `DATABASE_URL`(Neon) · `XAI_API_KEY` 가 있다.
3. Vercel env에 `COLLECT_SECRET` 을 넣는다. 크론 장비에도 같은 값을 둔다.
   - 시크릿이 없으면 POST가 열려 있어 아무나 수집을 칠 수 있다.
4. 이 저장소의 `scripts/collect.sh` 를 장비에 복사한다.

```bash
sudo install -m 0750 -o root -g root scripts/collect.sh /usr/local/bin/brief-collect.sh
sudo mkdir -p /var/log
sudo touch /var/log/brief-collect.log
sudo chmod 0640 /var/log/brief-collect.log
```

`/etc/brief-collect.env` (권한 0600, git에 넣지 않음):

```bash
BRIEF_COLLECT_URL=https://YOUR_DOMAIN/api/collect
COLLECT_SECRET=긴무작위문자열
```

한 번 시험 (시크릿 없이 열려 있을 때 / 있을 때):

```bash
# 시크릿 없을 때
curl -sS -X POST --max-time 55 "https://YOUR_DOMAIN/api/collect"

# 시크릿 있을 때
curl -sS -X POST --max-time 55 \
  -H "Authorization: Bearer $COLLECT_SECRET" \
  "https://YOUR_DOMAIN/api/collect"
```

응답 예:

```json
{"ok":true,"status":"ok","fetched":80,"inserted":3,"skipped":77,"note":"RSS 80건 중 3건 편성"}
{"ok":true,"status":"rate_limited","fetched":0,"inserted":0,"skipped":0,"note":"최근 수집 후 10분이 지나지 않았습니다. ..."}
```

| status | 의미 | 조치 |
|---|---|---|
| `ok` | 파이프라인 끝 | `inserted` 가 0이어도 정상(중복) |
| `rate_limited` | 직전 수집 후 10분 미만 | 정상. 로그에만 남긴다 |
| `error` | RSS/AI/DB 실패 | 로그 `note` 보고 재시도. 사이트는 마지막 DB 상태로 계속 보임 |
| HTTP 401 | `COLLECT_SECRET` 불일치 | env 확인 |

`GET /api/collect` 는 상태 조회만 한다. 크론은 반드시 **POST**.

### 1. crontab (가장 단순)

`crontab -e` 또는 root crontab:

```cron
SHELL=/bin/bash
*/15 * * * *  set -a; . /etc/brief-collect.env; set +a; /usr/local/bin/brief-collect.sh
```

### 2. /etc/cron.d (권장, OCI)

`/etc/cron.d/brief-collect` 권한 0644:

```cron
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin
*/15 * * * * root set -a; . /etc/brief-collect.env; set +a; /usr/local/bin/brief-collect.sh
```

`flock` 은 스크립트 안에도 있다. 두 줄이 겹치면 한쪽은 `skip: already running`.

`--max-time 55`: Vercel Hobby 함수 상한 60초를 넘기지 않게 한다.

### 3. systemd timer (cron 대신, 둘 중 하나만)

`/etc/systemd/system/brief-collect.service`:

```ini
[Unit]
Description=brief_ RSS collect
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=/etc/brief-collect.env
ExecStart=/usr/local/bin/brief-collect.sh
Nice=10
```

`/etc/systemd/system/brief-collect.timer`:

```ini
[Unit]
Description=brief_ collect every 15 minutes

[Timer]
OnCalendar=*:0/15
Persistent=true
RandomizedDelaySec=40

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now brief-collect.timer
sudo systemctl list-timers brief-collect.timer
```

### 4. 주/백업 시계

| 장비 | 역할 | 주기 |
|---|---|---|
| OCI | 주. 항상 켜 둔다 | 15분 |
| 집 PC | 백업. OCI가 죽어도 피드가 멈춤 | 15분, 분 오프셋 다르게 (`3,18,33,48`) |

둘 다 같은 URL·같은 시크릿. 서버가 `rate_limited` 를 돌려 주면 백업은 그냥 끝난다.

### 5. 로그 로테이션

`/etc/logrotate.d/brief-collect`:

```
/var/log/brief-collect.log {
  weekly
  rotate 8
  compress
  delaycompress
  missingok
  notifempty
  copytruncate
}
```

### 6. 운영 메모

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

## Neon 스키마

`db/schema.sql` 을 Neon SQL Editor에 한 번 실행하면 된다. 앱도 첫 요청에서 `create table if not exists`로 같은 테이블을 만든다.

계정 없음. 행은 소유자 없이 피드 공용. 개인 글을 넣지 마세요.

