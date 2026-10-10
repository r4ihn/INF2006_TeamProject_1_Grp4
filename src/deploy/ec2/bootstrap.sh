#!/bin/bash
# CafeStock app server set-up (Task 11). Runs as root once, on each new EC2 instance, from the
# launch template's user data, after the release file has been unpacked into $APP_DIR.
#
# Steps: packages → CloudWatch agent → Node.js → app user → npm ci → database secret and TLS
# certificates → migrations → demo café (+ dataset once) → systemd service → wait until ready.
#
# Settings (environment; the user data passes them in):
#   AWS_REGION, DB_SECRET_ARN, COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID   required
#   LOG_GROUP (/cafestock/app), IMPORT_DEMO_DATA (true), APP_PORT (3000)
set -Eeuo pipefail
trap 'echo "!! Set-up failed at line $LINENO: $BASH_COMMAND" >&2' ERR

: "${AWS_REGION:?}" "${DB_SECRET_ARN:?}" "${COGNITO_USER_POOL_ID:?}" "${COGNITO_CLIENT_ID:?}"
APP_DIR=${APP_DIR:-/opt/cafestock}
ENV_DIR=${ENV_DIR:-/etc/cafestock}
LOG_DIR=${LOG_DIR:-/var/log/cafestock}
LOG_GROUP=${LOG_GROUP:-/cafestock/app}
IMPORT_DEMO_DATA=${IMPORT_DEMO_DATA:-true}
APP_PORT=${APP_PORT:-3000}
NODE_MAJOR=${NODE_MAJOR:-24}
NODE_HOME=${NODE_HOME:-/opt/node}
RDS_BUNDLE_URL=${RDS_BUNDLE_URL:-https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem}
CW_CONFIG=${CW_CONFIG:-/opt/aws/amazon-cloudwatch-agent/etc/cafestock.json}
DEPLOY="$APP_DIR/deploy/ec2"

step() { echo; echo "== $(date -u +%H:%M:%S) $*"; }

# Runs a command as the unprivileged app user with a clean, explicit environment.
# Proxy and PRISMA_* settings are passed through if set (none are on a normal EC2 instance).
as_app() {
  local passthrough=()
  while IFS='=' read -r name _; do passthrough+=("$name=${!name}"); done < <(
    env | grep -E '^(PRISMA_[A-Z_]+|HTTPS?_PROXY|https?_proxy|NO_PROXY|no_proxy|NODE_EXTRA_CA_CERTS)=' || true
  )
  runuser -u cafestock -- env -i PATH="$NODE_HOME/bin:/usr/local/bin:/usr/bin:/bin" HOME="$APP_DIR/.home" \
    "${passthrough[@]}" "$@"
}

step "1/9 System packages"
dnf install -y -q jq openssl tar xz logrotate amazon-cloudwatch-agent

step "2/9 CloudWatch agent → log group $LOG_GROUP"
mkdir -p "$LOG_DIR" "$(dirname "$CW_CONFIG")"
sed "s|__LOG_GROUP__|$LOG_GROUP|g" "$DEPLOY/cloudwatch-agent.json" > "$CW_CONFIG"
amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c "file:$CW_CONFIG"

step "3/9 Node.js $NODE_MAJOR"
if [ ! -x "$NODE_HOME/bin/node" ]; then
  base="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
  curl -fsSL "$base/SHASUMS256.txt" -o /tmp/node-shasums.txt
  file=$(grep -oE "node-v${NODE_MAJOR}\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz" /tmp/node-shasums.txt | head -1)
  curl -fsSL "$base/$file" -o "/tmp/$file"
  (cd /tmp && grep " $file\$" node-shasums.txt | sha256sum -c -) # checksum from nodejs.org
  mkdir -p "$NODE_HOME"
  tar -xJf "/tmp/$file" -C "$NODE_HOME" --strip-components=1
fi
"$NODE_HOME/bin/node" --version

step "4/9 App user"
id cafestock >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --shell /sbin/nologin cafestock
mkdir -p "$APP_DIR/.home"
chown -R cafestock:cafestock "$APP_DIR" "$LOG_DIR"

step "5/9 The API's packages (npm ci, production only)"
(cd "$APP_DIR" && as_app npm ci --omit=dev --workspace backend --no-audit --no-fund --loglevel=error)

step "6/9 Database address, password and TLS certificates"
secret=$(aws secretsmanager get-secret-value --region "$AWS_REGION" --secret-id "$DB_SECRET_ARN" \
  --query SecretString --output text)
db_user=$(jq -r '.username | @uri' <<<"$secret")
db_pass=$(jq -r '.password | @uri' <<<"$secret")
db_host=$(jq -r '.host' <<<"$secret")
db_port=$(jq -r '.port // 5432' <<<"$secret")
db_name=$(jq -r '.dbname // "cafestock"' <<<"$secret")
unset secret
[ "$db_host" != "null" ] || { echo "The database secret has no host (is the RDS instance attached?)" >&2; exit 1; }

bundle="$APP_DIR/rds-global-bundle.pem"
curl -fsSL "$RDS_BUNDLE_URL" -o "$bundle"
# Prisma's migration tool only reads the FIRST certificate in a file, so it gets its own file
# with just the CA this database uses (RDS's default for new instances: RSA2048 G1).
prisma_ca="$APP_DIR/rds-ca-prisma.pem"
rm -rf /tmp/rds-certs && mkdir -p /tmp/rds-certs
awk '/BEGIN CERTIFICATE/{n++} n{print > ("/tmp/rds-certs/" n ".pem")}' "$bundle"
: > "$prisma_ca"
for cert in /tmp/rds-certs/*.pem; do
  if openssl x509 -in "$cert" -noout -subject | grep -q "Amazon RDS $AWS_REGION Root CA RSA2048 G1"; then
    cp "$cert" "$prisma_ca"
  fi
done
[ -s "$prisma_ca" ] || { echo "No 'Amazon RDS $AWS_REGION Root CA RSA2048 G1' in $RDS_BUNDLE_URL" >&2; exit 1; }
chmod 644 "$bundle" "$prisma_ca"

base_url="postgresql://$db_user:$db_pass@$db_host:$db_port/$db_name"
# node-postgres (the running API): verify the server certificate against the whole bundle
runtime_url="$base_url?sslmode=verify-full&sslrootcert=$bundle"
# Prisma migrate: its own parameter names (it ignores sslrootcert) — also fully verified
migrate_url="$base_url?sslmode=require&sslcert=$prisma_ca&sslaccept=strict"

APP_ENV=(
  NODE_ENV=production
  PORT="$APP_PORT"
  DATABASE_URL="$runtime_url"
  COGNITO_USER_POOL_ID="$COGNITO_USER_POOL_ID"
  COGNITO_CLIENT_ID="$COGNITO_CLIENT_ID"
  CORS_ORIGIN=
  STATIC_DIR="$APP_DIR/frontend/dist"
  DEMO_ORG_SLUG=demo-cafe
)
mkdir -p "$ENV_DIR"
(
  umask 077 # the password is in here: root only (systemd reads it before dropping privileges)
  for kv in "${APP_ENV[@]}"; do printf '%s="%s"\n' "${kv%%=*}" "${kv#*=}"; done > "$ENV_DIR/app.env"
)

step "7/9 Database tables (prisma migrate deploy)"
(cd "$APP_DIR/backend" && as_app DATABASE_URL="$migrate_url" "$APP_DIR/node_modules/.bin/prisma" migrate deploy)

step "8/9 Demo café and data"
(cd "$APP_DIR/backend" && as_app "${APP_ENV[@]}" node dist/cli/seed.js)
if [ "$IMPORT_DEMO_DATA" = "true" ]; then
  # Only the first server imports; dates are moved so the history ends in the last week
  (cd "$APP_DIR/backend" && as_app "${APP_ENV[@]}" node dist/cli/import-dataset.js --shift-to-recent --if-empty)
fi

step "9/9 Start the API (systemd) and wait until it's ready"
sed -e "s|__APP_DIR__|$APP_DIR|g" -e "s|__NODE_HOME__|$NODE_HOME|g" -e "s|__ENV_DIR__|$ENV_DIR|g" \
  -e "s|__LOG_DIR__|$LOG_DIR|g" "$DEPLOY/cafestock.service" > /etc/systemd/system/cafestock.service
sed "s|__LOG_DIR__|$LOG_DIR|g" "$DEPLOY/logrotate.conf" > /etc/logrotate.d/cafestock
systemctl daemon-reload
systemctl enable cafestock
systemctl restart cafestock
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$APP_PORT/health/ready" >/dev/null 2>&1; then
    curl -fsS "http://127.0.0.1:$APP_PORT/health/ready"; echo
    echo "CafeStock is running on port $APP_PORT."
    exit 0
  fi
  sleep 2
done
echo "The API didn't become ready within 2 minutes. Last lines of $LOG_DIR/app.log:" >&2
tail -n 30 "$LOG_DIR/app.log" >&2 || true
exit 1
