# QMRMed Bot

Standalone Telegram learning product for QMRMed. It is intentionally independent from the future QMRMed web platform, while keeping clean domain boundaries so a future API integration can be added without rebuilding the bot.

## Product structure

- Home / dashboard
- Account and profile
- Stage and department preferences
- Medical subjects and topics
- Lessons and study progress
- Search restricted to QMRMed-approved sources
- AI medical study assistant
- Question bank
- Ministerial questions
- Timed exams and assessments
- Results, accuracy and progress analytics
- Free / Plus / Pro access model
- One-time free trial
- Subscription and Telegram Stars payment integration
- Notifications and study reminders
- Admin/content management layer

## Stack

- TypeScript + Node.js
- grammY Telegram framework
- Prisma ORM
- SQLite for the first standalone deployment; schema is designed for later PostgreSQL migration
- GitHub Actions CI

## Local setup

```bash
npm install
cp .env.example .env
npx prisma generate
npx prisma db push
npm run db:seed
npm run dev
```

Set `BOT_TOKEN` in `.env`. Never commit secrets.

## Future platform integration

The bot remains independently deployable. Later, a QMRMed API adapter can be added for identity, subscriptions, content, search, analytics, or AI without changing the Telegram presentation layer.
