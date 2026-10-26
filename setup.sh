#!/bin/sh
# Usage: ./setup.sh [production|demo]   (default: production)
#
# Creates the env file for the chosen mode if it doesn't exist yet
# (JWT_SECRET generated with openssl rand -hex 32), then brings up the
# matching Docker Compose stack. Safe to re-run: an existing env file, or an
# already-set JWT_SECRET in it, is never overwritten.
set -eu
cd "$(dirname "$0")"

mode="${1:-production}"
case "$mode" in
  production|demo) ;;
  *) echo "Usage: $0 [production|demo]"; exit 1 ;;
esac

if [ "$mode" = demo ]; then
  env_file=".env.demo"
  example_file=".env.demo.example"
  compose_args="-f compose.demo.yaml"
  project="bloeki-demo"
  port_var="FRONTEND_HOST_PORT"
  default_port=5175
else
  env_file=".env"
  example_file=".env.example"
  compose_args="-f docker-compose.yml"
  project="bloeki"
  port_var="FRONTEND_HOST_PORT"
  default_port=5174
fi

if [ ! -f "$env_file" ]; then
  cp "$example_file" "$env_file"
  echo "$env_file aus $example_file erstellt."
fi

current_secret="$(grep '^JWT_SECRET=' "$env_file" 2>/dev/null | tail -1 | cut -d= -f2-)"
if [ -z "$current_secret" ]; then
  secret="$(openssl rand -hex 32)"
  if grep -q '^JWT_SECRET=' "$env_file"; then
    sed "s#^JWT_SECRET=.*#JWT_SECRET=$secret#" "$env_file" > "$env_file.tmp" && mv "$env_file.tmp" "$env_file"
  else
    printf 'JWT_SECRET=%s\n' "$secret" >> "$env_file"
  fi
  echo "$env_file: JWT_SECRET zufällig erzeugt."
fi

docker compose --env-file "$env_file" -p "$project" $compose_args up --build -d

port="$(grep "^${port_var}=" "$env_file" 2>/dev/null | tail -1 | cut -d= -f2-)"
port="${port:-$default_port}"
if [ "$mode" = demo ]; then
  echo "Demo: http://localhost:$port - Admin-/Hörer-Login siehe Banner in der App, Details in docs/demo.md"
else
  echo "bloeki: http://localhost:$port"
fi
