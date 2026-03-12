#!/bin/bash
# ════════════════════════════════════════════════════
# ORBITUM — Регистрация Telegram Webhook
# Запускать ОДИН РАЗ после деплоя на Vercel
# ════════════════════════════════════════════════════

BOT_TOKEN="ВСТАВЬ_ТОКЕН_БОТА_СЮДА"
APP_URL="https://ai-orbitum.vercel.app"   # или твой домен

echo "→ Регистрируем webhook..."
curl -s "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -d "url=${APP_URL}/api/bot" \
  -d "allowed_updates=[\"message\",\"callback_query\"]" \
  -d "drop_pending_updates=true" | python3 -m json.tool

echo ""
echo "→ Проверяем webhook..."
curl -s "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo" | python3 -m json.tool
