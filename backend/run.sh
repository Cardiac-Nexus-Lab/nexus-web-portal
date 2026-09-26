#!/bin/sh
# Start the Cardiac Nexus backend on http://127.0.0.1:8000.
#
# --reload restarts the server whenever backend code or the cardiac_nexus model
# code changes, so a running server never serves stale code.
# SQLite is used because PostgreSQL is not installed on this machine; set
# DATABASE_URL yourself to use PostgreSQL instead.
cd "$(dirname "$0")" || exit 1

if lsof -tiTCP:8000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port 8000 is already in use by another server. Stop it with Ctrl+C in its terminal first."
  exit 1
fi

ENGINE="${CARDIAC_NEXUS_ENGINE:-$(cd ../.. && pwd)/nexus-ai-engine}"
export DATABASE_URL="${DATABASE_URL:-sqlite:///./cardiac_nexus_local.db}"

exec .venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000 \
  --reload --reload-dir . --reload-dir "$ENGINE/src" --reload-include '*.py'
