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

## Google Drive content architecture

Google Drive is the source repository for QMRMed educational content. The bot does not give students direct Drive access and does not send the whole Drive to the model.

```text
Google Drive
    ↓
QMRMed Content Sync
    ↓
ContentSource + ContentChunk index (Prisma)
    ↓
Approved-content retrieval
    ↓
OmniRoute
    ↓
Telegram / future QMRMed platform
```

Recommended Drive structure:

```text
QMRMed/
├── 01 - Medicine/
│   └── Stage / Subject/
│       ├── 01 - Sources/
│       ├── 02 - References/
│       ├── 03 - Question Bank/
│       ├── 04 - Ministerial/
│       └── 99 - Other/
├── 02 - Dentistry/
├── 03 - Pharmacy/
├── 04 - Shared References/
└── 99 - System/
```

Cases are generated from approved Sources/References content by the application layer; they are not required to exist as a separate Drive folder. Question Bank and Ministerial content remain independent source types.

The synchronizer records the Drive file ID, filename, MIME type, modified time, source kind, department, stage and subject. It chunks supported text content into the QMRMed database. Only `approved=true` content is eligible for AI retrieval.

Supported directly by the current synchronizer:

- Google Docs → plain text
- Google Sheets → CSV text
- Google Slides → plain text export
- PDF → text extraction with `unpdf` when the PDF contains selectable text
- TXT / Markdown / CSV / JSON files

Scanned/image-only PDFs still require OCR and are not falsely marked as successfully indexed when no text can be extracted. Binary files outside the supported formats are skipped safely. A configurable file-size limit is enforced with `DRIVE_MAX_FILE_MB` (100 MB by default; maximum 100 MB) to protect the sync worker.

## AI architecture

The bot does not call a model provider directly. It calls the OpenAI-compatible OmniRoute gateway. Before calling OmniRoute, QMRMed retrieves approved content from the indexed Google Drive corpus.

```text
Student question
      ↓
Approved QMRMed Drive index
      ↓
Relevant source / case / question / ministerial chunks
      ↓
OmniRoute
      ↓
Arabic answer grounded in QMRMed content
```

If no approved QMRMed context is found, the AI refuses to invent an answer from general knowledge. Any legacy lesson context passed by older bot code is ignored as an AI source; Drive-approved retrieval is authoritative.

## Stack

- TypeScript + Node.js 22
- grammY Telegram framework
- Prisma ORM
- SQLite for the first standalone deployment
- Google Drive API (read-only service-account access)
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
npm test
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

Google Drive configuration:

```env
GOOGLE_DRIVE_ROOT_FOLDER_ID=your_qmrmed_root_folder_id
GOOGLE_SERVICE_ACCOUNT_JSON_BASE64=base64_encoded_service_account_json
DRIVE_AUTO_APPROVE=true
DRIVE_CHUNK_CHARS=6000
DRIVE_MAX_FILE_MB=100
```

The service account must have read access to the QMRMed root folder. For a Shared Drive, grant the service account the minimum read role needed for the content corpus. Never commit service-account JSON, private keys, `BOT_TOKEN`, or `OMNIROUTE_API_KEY` to GitHub.

## Syncing Drive content

After the Drive credentials and root folder are configured:

```bash
npm run content:sync
```

The command recursively scans the configured root folder, extracts supported text, updates the source metadata and rebuilds its content chunks. Re-running the command is safe for the same Drive file because unchanged files are skipped and changed files have their chunks replaced. Files removed from the configured Drive tree are removed from the searchable index and approval is revoked.

The GitHub full-sync check uses an ephemeral SQLite database only for validation. It verifies that the configured Drive corpus can be scanned and indexed successfully; it does not populate the production database.

For production, run this command from the deployment scheduler whenever Drive content changes. Google Drive also provides APIs/events for monitoring file activity, so the same sync layer can later be changed from scheduled full scans to event-driven incremental synchronization.

## OmniRoute

Run OmniRoute separately and configure at least one provider and an endpoint API key. Its OpenAI-compatible API is exposed under `/v1`; fallback chains and provider routing are configured in the OmniRoute dashboard.

## Future platform integration

The Telegram presentation layer remains independent. A future QMRMed API adapter can replace direct Prisma access for identity, subscriptions, content, search, analytics, and AI without redesigning the Telegram UI.
