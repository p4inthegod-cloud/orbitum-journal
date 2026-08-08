# Wallet P2P screener

The screener uses the official Wallet P2P API and the existing Orbitum Telegram bot token. It reads active ads only; orders are always opened and completed manually in `@wallet`.

## Required Vercel environment variables

- `TELEGRAM_BOT_TOKEN` — already used by the Orbitum bot.
- `P2P_WALLET_API_KEY` — create in Wallet → P2P Market → My Profile → API Keys.
- `P2P_CHAT_ID` — Telegram chat that is allowed to use `/p2p` and receives automatic alerts. If it is not configured, send `/p2p` to the bot and it will show the current chat ID.
- `CRON_SECRET` — secret used to protect the automatic scan endpoint.

Optional variables:

- `P2P_CRYPTO=USDT`
- `P2P_FIAT=RUB`
- `P2P_SIDE=SELL` — `SELL` means ads where the user buys crypto.
- `P2P_FIAT_AMOUNT=2000`
- `P2P_MIN_DISCOUNT_PCT=0.5`
- `P2P_MIN_EXECUTION_RATE=95`
- `P2P_MIN_ORDERS=20`
- `P2P_PAYMENT_METHODS=sberbank,tinkoff`
- `P2P_REPEAT_MINUTES=30`

## Usage

- `/p2p` — scan using `P2P_FIAT_AMOUNT`.
- `/p2p 5000` — scan ads available for a 5,000 RUB order.

For automatic alerts, call `GET /api/p2p` every 1–5 minutes and pass `Authorization: Bearer <CRON_SECRET>`. The endpoint only sends a message when the cheapest eligible ad is at least `P2P_MIN_DISCOUNT_PCT` below the median eligible price.

Wallet currently refreshes P2P API data approximately every 30 seconds. On Vercel Hobby, use an external scheduler because Vercel Cron is limited to one invocation per day.
