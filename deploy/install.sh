#!/usr/bin/env bash
#
# Установка «Мониторинга бренда в ответах ИИ» на чистый сервер Ubuntu.
# Запускать от root:  bash install.sh
#
# Скрипт ставит Node.js и nginx, забирает код, собирает интерфейс,
# настраивает автозапуск и закрывает сервис паролем.
# Повторный запуск ничего не ломает: база, ключ и пароль сохраняются.

set -euo pipefail

REPO="https://github.com/zaripovilnur/Ai-brand-monitor.git"
BRANCH="claude/new-session-64g8ci"
DIR="/opt/ai-brand-monitor"
SERVICE_USER="monitor"
PORT="8787"

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
fail() { printf '\n\033[31mОШИБКА: %s\033[0m\n\n' "$*" >&2; exit 1; }

# --- проверки перед началом ---

[ "$(id -u)" -eq 0 ] || fail "Запустите от имени root: sudo bash install.sh"
command -v apt-get >/dev/null || fail "Скрипт рассчитан на Ubuntu или Debian."
[ -t 0 ] || fail "Скрипт спрашивает пароль и ключ, поэтому его нельзя запускать через конвейер.
Сначала скачайте файл, потом запустите: bash install.sh"

step "Проверяю сервер"
ram_mb=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)
swap_mb=$(awk '/SwapTotal/{print int($2/1024)}' /proc/meminfo)
info "оперативной памяти: ${ram_mb} МБ"

if [ "$ram_mb" -lt 1800 ] && [ "$swap_mb" -lt 512 ]; then
  step "Памяти мало — добавляю файл подкачки на 2 ГБ"
  # Без него сборка интерфейса может не влезть: ей нужно около 512 МБ
  fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  info "файл подкачки подключён"
fi

# --- системные пакеты ---

step "Ставлю системные пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq || fail "Не удалось обновить список пакетов. Проверьте интернет на сервере."
apt-get install -y -qq curl git nginx apache2-utils ca-certificates >/dev/null \
  || fail "Не удалось поставить пакеты."
info "curl, git, nginx, apache2-utils"

step "Проверяю Node.js"
need_node=1
if command -v node >/dev/null; then
  major=$(node -v | sed 's/v\([0-9]*\).*/\1/')
  if [ "$major" -ge 20 ]; then
    need_node=0
    info "уже стоит Node.js $(node -v)"
  else
    info "стоит устаревшая Node.js $(node -v), поставлю свежую"
  fi
fi
if [ "$need_node" -eq 1 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null \
    || fail "Не удалось подключить репозиторий Node.js."
  apt-get install -y -qq nodejs >/dev/null || fail "Не удалось поставить Node.js."
  info "поставлена Node.js $(node -v)"
fi

# --- пользователь и код ---

step "Готовлю пользователя и папку"
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$SERVICE_USER"
  info "создан пользователь $SERVICE_USER"
else
  info "пользователь $SERVICE_USER уже есть"
fi

if [ -d "$DIR/.git" ]; then
  step "Обновляю код"
  git -C "$DIR" fetch --quiet origin "$BRANCH" || fail "Не удалось забрать обновления из GitHub."
  git -C "$DIR" checkout --quiet "$BRANCH"
  git -C "$DIR" reset --hard --quiet "origin/$BRANCH"
  info "обновлено до последней версии"
else
  step "Забираю код из GitHub"
  git clone --quiet --branch "$BRANCH" "$REPO" "$DIR" \
    || fail "Не удалось скачать код. Проверьте интернет на сервере."
  info "код в $DIR"
fi
mkdir -p "$DIR/data"
chown -R "$SERVICE_USER:$SERVICE_USER" "$DIR"

# --- ключ AITunnel ---

step "Ключ AITunnel"
if [ -f "$DIR/.env" ] && grep -q '^AITUNNEL_API_KEY=.\+' "$DIR/.env"; then
  info "ключ уже задан, не трогаю"
else
  info "Ключ создаётся в личном кабинете aitunnel.ru и начинается с sk-aitunnel-"
  info "При вводе он не отображается — это нормально."
  printf '    Вставьте ключ: '
  read -rs api_key
  echo
  [ -n "$api_key" ] || fail "Ключ пустой. Без него прогон невозможен."
  printf 'AITUNNEL_API_KEY=%s\nPORT=%s\nHOST=127.0.0.1\n' "$api_key" "$PORT" > "$DIR/.env"
  chown "$SERVICE_USER:$SERVICE_USER" "$DIR/.env"
  chmod 600 "$DIR/.env"
  info "ключ сохранён в $DIR/.env, доступ только у $SERVICE_USER"
fi

# --- сборка ---
# runuser -l запускает login-оболочку и выставляет HOME пользователя,
# иначе npm полезет в кэш root и упрётся в права

step "Устанавливаю зависимости (займёт минуту-две)"
runuser -l "$SERVICE_USER" -c "cd '$DIR' && npm install --no-audit --no-fund" >/dev/null 2>&1 \
  || fail "Не удалось установить зависимости. Запустите вручную и посмотрите причину:
  runuser -l $SERVICE_USER -c 'cd $DIR && npm install'"
info "зависимости на месте"

step "Собираю интерфейс"
runuser -l "$SERVICE_USER" -c "cd '$DIR' && npm run build" >/dev/null 2>&1 \
  || fail "Не удалось собрать интерфейс. Запустите вручную и посмотрите причину:
  runuser -l $SERVICE_USER -c 'cd $DIR && npm run build'"
info "интерфейс собран"

# --- автозапуск ---

step "Настраиваю автозапуск"
install -m 644 "$DIR/deploy/ai-brand-monitor.service" /etc/systemd/system/ai-brand-monitor.service
systemctl daemon-reload
systemctl enable --quiet ai-brand-monitor
systemctl restart ai-brand-monitor
sleep 3
systemctl is-active --quiet ai-brand-monitor \
  || fail "Программа не запустилась. Посмотрите причину: journalctl -u ai-brand-monitor -n 40"
info "программа запущена и будет подниматься после перезагрузки"

# --- пароль на вход ---

step "Пароль для входа в сервис"
if [ -f /etc/nginx/.htpasswd ]; then
  info "пароль уже настроен, не трогаю"
  info "Добавить ещё одного человека: htpasswd /etc/nginx/.htpasswd имя"
else
  info "Этот логин и пароль будут спрашиваться у всех, кто откроет адрес."
  printf '    Логин (например marketing): '
  read -r login_name
  [ -n "$login_name" ] || fail "Логин пустой."
  htpasswd -c /etc/nginx/.htpasswd "$login_name"
  info "пароль сохранён"
fi

# --- nginx ---

step "Настраиваю nginx"
install -m 644 "$DIR/deploy/nginx.conf" /etc/nginx/sites-available/ai-brand-monitor
ln -sf ../sites-available/ai-brand-monitor /etc/nginx/sites-enabled/ai-brand-monitor
rm -f /etc/nginx/sites-enabled/default
nginx -t >/dev/null 2>&1 || fail "nginx не принял настройки. Проверьте: nginx -t"
systemctl reload nginx
info "nginx принимает запросы на порт 80 и спрашивает пароль"

# --- проверка ---

step "Проверяю, что всё работает"
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/health" || true)
[ "$code" = "200" ] || fail "Программа не отвечает. Посмотрите: journalctl -u ai-brand-monitor -n 40"
info "программа отвечает"

# nginx перезагружается не мгновенно: старые рабочие процессы какое-то время
# ещё отвечают по прежнему конфигу. Поэтому проверяем с повторами.
code_nginx=""
for _ in $(seq 1 15); do
  code_nginx=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1/" || true)
  [ "$code_nginx" = "401" ] && break
  sleep 1
done
[ "$code_nginx" = "401" ] \
  || fail "nginx не спрашивает пароль (код $code_nginx). Сервис нельзя оставлять открытым.
Проверьте вручную:  curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/
Если через минуту он отвечает 401 — всё в порядке, установка завершена."
info "без пароля сервис не пускает"

addr=$(hostname -I | awk '{print $1}')

cat <<FINAL

────────────────────────────────────────────────────────
  Готово. Открывайте:  http://${addr}/

  Спросит логин и пароль, которые вы задали.
────────────────────────────────────────────────────────

  ВАЖНО, пока нет домена:

  Соединение идёт без шифрования, и пароль передаётся
  открытым текстом. Закройте сервер по адресам офиса:

      ufw allow OpenSSH
      ufw allow from АДРЕС.ОФИСА to any port 80
      ufw enable

  Когда появится домен:

      1. вписать его в /etc/nginx/sites-available/ai-brand-monitor
         вместо server_name _;
      2. apt install certbot python3-certbot-nginx
      3. certbot --nginx -d ваш.домен.ру

  Полезное:

      systemctl status ai-brand-monitor    состояние
      journalctl -u ai-brand-monitor -f    что происходит
      htpasswd /etc/nginx/.htpasswd имя    добавить человека

  Резервные копии: ${DIR}/data/app.db и ${DIR}/.env

FINAL
