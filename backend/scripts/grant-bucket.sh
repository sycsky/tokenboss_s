#!/usr/bin/env bash
# Usage: ./grant-bucket.sh <email> <plan_plus|plan_super|plan_ultra|topup [amount]>
set -e

EMAIL_RE='^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'

EMAIL=$1
SKU=$2
DB="${SQLITE_PATH:-backend/data/tokenboss.db}"

if [ -z "$EMAIL" ] || [ -z "$SKU" ]; then
  echo "Usage: $0 <email> <plan_plus|plan_super|plan_ultra|topup [amount]>"
  exit 1
fi

if ! [[ "$EMAIL" =~ $EMAIL_RE ]]; then
  echo "invalid email: $EMAIL"
  exit 1
fi

USER_ID=$(sqlite3 "$DB" "SELECT userId FROM users WHERE email = '$EMAIL';")
if [ -z "$USER_ID" ]; then
  echo "user not found: $EMAIL"
  exit 1
fi

NOW=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

case "$SKU" in
  plan_plus)
    sqlite3 "$DB" "INSERT INTO credit_bucket (id, userId, skuType, amountUsd, dailyCapUsd, dailyRemainingUsd, totalRemainingUsd, startedAt, expiresAt, modeLock, modelPool, createdAt) VALUES (lower(hex(randomblob(16))), '$USER_ID', 'plan_plus', 840, 30, 30, NULL, '$NOW', datetime('now', '+28 days'), 'auto_only', 'codex_only', '$NOW');"
    echo "granted plan_plus to $EMAIL"
    ;;
  plan_super)
    sqlite3 "$DB" "INSERT INTO credit_bucket (id, userId, skuType, amountUsd, dailyCapUsd, dailyRemainingUsd, totalRemainingUsd, startedAt, expiresAt, modeLock, modelPool, createdAt) VALUES (lower(hex(randomblob(16))), '$USER_ID', 'plan_super', 2240, 80, 80, NULL, '$NOW', datetime('now', '+28 days'), 'none', 'all', '$NOW');"
    echo "granted plan_super to $EMAIL"
    ;;
  plan_ultra)
    sqlite3 "$DB" "INSERT INTO credit_bucket (id, userId, skuType, amountUsd, dailyCapUsd, dailyRemainingUsd, totalRemainingUsd, startedAt, expiresAt, modeLock, modelPool, createdAt) VALUES (lower(hex(randomblob(16))), '$USER_ID', 'plan_ultra', 20160, 720, 720, NULL, '$NOW', datetime('now', '+28 days'), 'none', 'all', '$NOW');"
    echo "granted plan_ultra to $EMAIL"
    ;;
  topup)
    AMT=${3:-100}
    if ! [[ "$AMT" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
      echo "invalid amount: $AMT"
      exit 1
    fi
    sqlite3 "$DB" "INSERT INTO credit_bucket (id, userId, skuType, amountUsd, dailyCapUsd, dailyRemainingUsd, totalRemainingUsd, startedAt, expiresAt, modeLock, modelPool, createdAt) VALUES (lower(hex(randomblob(16))), '$USER_ID', 'topup', $AMT, NULL, NULL, $AMT, '$NOW', NULL, 'none', 'all', '$NOW');"
    echo "granted topup \$$AMT to $EMAIL"
    ;;
  *)
    echo "unknown sku: $SKU"
    exit 1
    ;;
esac
