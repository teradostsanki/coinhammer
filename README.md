# CoinHammer Telegram Mini App — Starter

Features in this starter:
- Telegram WebApp user detection (demo fallback outside Telegram)
- Server-side demo API structure
- Coin balance
- Start earning session
- Daily bonus
- Referral link generation
- Tasks/leaderboard/withdrawal placeholders

## Run
1. Install Node.js 20+
2. `cd backend && npm install`
3. Copy `.env.example` to `.env`
4. `npm start`
5. Serve `frontend/index.html` over HTTPS in production.
6. Set the Mini App URL in @BotFather for @Coinhammer_bot.

## Important
This is a starter/demo. Before production, add PostgreSQL, Telegram initData validation, server-side ledger transactions, rate limiting, task verification, withdrawal controls, and fraud prevention.
