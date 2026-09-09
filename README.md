# QMRMed Bot

Standalone Telegram learning product for QMRMed, built as an interactive medical-study bot and designed for future integration with the QMRMed platform.

## Current bot sections

- 🏠 Interactive home dashboard
- 📚 Subjects → topics → lessons
- ☑️ Per-user lesson completion and progress
- 🎯 Stage and department preferences
- 🔎 Search restricted to QMRMed database content
- 🤖 AI medical study assistant through OmniRoute
- ❓ Interactive question bank with answer tracking
- 📝 Interactive ministerial-question practice
- 🧠 Timed exams with per-user sessions
- 📊 Accuracy and progress analytics
- 🎁 One-time free trial
- 💎 FREE / PLUS / PRO access model
- 💳 Subscription UI prepared for Telegram Stars verification
- 🛠️ Admin dashboard with statistics, content counts, broadcast and OmniRoute health check

## AI architecture

The bot does not call a model provider directly. It calls the OpenAI-compatible OmniRoute gateway:

```text
Telegram → QMRMed Bot → QMRMed AI service → OmniRoute → selected/fallback model
```

OmniRoute is configured with `OMNIROUTE_URL`, `OMNIROUTE_API_KEY`, and `OMNIROUTE_MODEL`. The default model is `auto`, allowing OmniRoute to route according to its configured providers/fallback policy.

## Stack

- TypeScript + Node.js 22
- grammY Telegram framework
- Prisma ORM
- SQLite for the first standalone deployment
- OmniRoute as the AI gateway
- GitHub Actions CI

## Configuration

```bash
npm install
cp .env.example .env
npx prisma generate
npx prisma db push
npm run db:seed
npm run check
npm run build
npm run dev
```

Required secrets/configuration:

```env
BOT_TOKEN=your_telegram_bot_token
DATABASE_URL="file:./dev.db"
ADMIN_IDS=your_telegram_id
OMNIROUTE_URL="http://127.0.0.1:20128"
OMNIROUTE_API_KEY=your_omniroute_endpoint_key
OMNIROUTE_MODEL=auto
```

Never commit `BOT_TOKEN` or `OMNIROUTE_API_KEY` to GitHub. Keep them in the deployment environment.

## OmniRoute

Run OmniRoute separately and configure at least one provider and an endpoint API key. Its OpenAI-compatible API is exposed under `/v1`; fallback chains and provider routing are configured in the OmniRoute dashboard.

## Future platform integration

The Telegram presentation layer remains independent. A future QMRMed API adapter can replace direct Prisma access for identity, subscriptions, content, search, analytics, and AI without redesigning the Telegram UI.
