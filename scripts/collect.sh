#!/usr/bin/env bash
# brief_ 수집 시계. OCI(주) / 집 PC(백업)에 두고 cron 또는 systemd timer가 실행.
# 배포 URL이 안정된 뒤, README의 크론 런북을 보고 붙인다. 이 스크립트 자체는 앱을 깨우지 않는다.
set -euo pipefail

URL="${BRIEF_COLLECT_URL:?BRIEF_COLLECT_URL 이 비어 있습니다. 예: https://YOUR_DOMAIN/api/collect}"
SECRET="${COLLECT_SECRET:-}"
LOCK="${BRIEF_COLLECT_LOCK:-/var/lock/brief-collect.lock}"
LOG="${BRIEF_COLLECT_LOG:-/var/log/brief-collect.log}"

mkdir -p "$(dirname "$LOCK")" "$(dirname "$LOG")"
exec 9>"$LOCK"
if ! flock -n 9; then
  printf '%s skip: already running\n' "$(date -Is)" >>"$LOG"
  exit 0
fi

AUTH=()
if [ -n "$SECRET" ]; then
  AUTH=(-H "Authorization: Bearer ${SECRET}")
fi

# Vercel Hobby 서버리스 상한 60초. 여유를 두고 끊는다.
{
  printf '%s ' "$(date -Is)"
  curl -sS -X POST --max-time 55 "${AUTH[@]}" "$URL" || printf '{"ok":false,"status":"error","note":"curl failed"}'
  printf '\n'
} >>"$LOG" 2>&1
