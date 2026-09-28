#!/usr/bin/env bash
# 한 번에 수집 시계를 붙인다. root로 실행.
#   sudo bash install-collect.sh oci     # */15  주 시계
#   sudo bash install-collect.sh home    # 3,18,33,48  백업
# 시크릿을 넣을 때:
#   sudo COLLECT_SECRET='긴문자열' bash install-collect.sh oci
# 이미 /etc/brief-collect.env 가 있으면 COLLECT_SECRET 을 비우지 않고 유지한다.
# 주소만 바꿀 때: sudo BRIEF_COLLECT_URL=https://... bash install-collect.sh oci
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "root로 실행하세요: sudo bash $0 oci|home" >&2
  exit 1
fi

ROLE="${1:-}"
case "$ROLE" in
  oci|primary) SCHED="*/15 * * * *" ;;
  home|backup) SCHED="3,18,33,48 * * * *" ;;
  *)
    echo "사용법: sudo bash $0 oci|home" >&2
    exit 1
    ;;
esac

RAW="${BRIEF_RAW:-https://raw.githubusercontent.com/goddaehee/brief-news/main}"
HERE="$(cd "$(dirname "$0")" && pwd)"
install -d -m 0755 /usr/local/bin /var/log /etc
if [[ -f "$HERE/collect.sh" ]]; then
  install -m 0750 "$HERE/collect.sh" /usr/local/bin/brief-collect.sh
else
  curl -fsSL "$RAW/scripts/collect.sh" -o /usr/local/bin/brief-collect.sh
  chmod 0750 /usr/local/bin/brief-collect.sh
fi
touch /var/log/brief-collect.log
chmod 0640 /var/log/brief-collect.log

EXISTING_SECRET=""
EXISTING_URL=""
if [[ -f /etc/brief-collect.env ]]; then
  EXISTING_SECRET="$(sed -n 's/^COLLECT_SECRET=//p' /etc/brief-collect.env | tail -n 1)"
  EXISTING_URL="$(sed -n 's/^BRIEF_COLLECT_URL=//p' /etc/brief-collect.env | tail -n 1)"
fi
URL="${BRIEF_COLLECT_URL:-${EXISTING_URL:-https://brief-ai-news.vercel.app/api/collect}}"
if [[ -n "${COLLECT_SECRET+x}" ]]; then
  SECRET="$COLLECT_SECRET"
else
  SECRET="$EXISTING_SECRET"
fi

umask 077
cat >/etc/brief-collect.env <<EOF
BRIEF_COLLECT_URL=${URL}
COLLECT_SECRET=${SECRET}
EOF
chmod 0600 /etc/brief-collect.env

cat >/etc/cron.d/brief-collect <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin
${SCHED} root set -a; . /etc/brief-collect.env; set +a; /usr/local/bin/brief-collect.sh
EOF
chmod 0644 /etc/cron.d/brief-collect

cat >/etc/logrotate.d/brief-collect <<'EOF'
/var/log/brief-collect.log {
  weekly
  rotate 8
  compress
  delaycompress
  missingok
  notifempty
  copytruncate
}
EOF

if command -v systemctl >/dev/null 2>&1; then
  systemctl disable --now brief-collect.timer >/dev/null 2>&1 || true
fi

echo "role=${ROLE} schedule=${SCHED}"
echo "url=${URL}"
echo "env=/etc/brief-collect.env cron=/etc/cron.d/brief-collect"
echo "--- first collect ---"
set -a
# shellcheck disable=SC1091
. /etc/brief-collect.env
set +a
/usr/local/bin/brief-collect.sh || true
echo
tail -n 1 /var/log/brief-collect.log || true
