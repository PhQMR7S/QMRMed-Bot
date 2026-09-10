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
ContentSource + ContentChunk index (Prisma/PostgreSQL)
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

Scanned/image-only PDFs still require OCR and are not falsely marked as successfully indexed when no text can be extracted. Binary files outside the supported formats are skipped safely.

## File size policy

There is **no application-level file-size limit** for QMRMed Drive sources. Large textbooks, reference PDFs and other source files are allowed because the Drive corpus is expected to contain substantial medical references.

The synchronizer downloads a supported file and extracts its text before chunking it. Therefore, very large PDFs can still be constrained by available memory, processing time, Google Drive/API behavior, or runner resources; these are infrastructure/runtime constraints, not an imposed QMRMed file-size ceiling.

For production, large-file processing should run in a sufficiently resourced persistent worker rather than relying on GitHub Actions as the production indexer.

## AI architecture

The bot does not call a model provider directly. It calls the OpenAI-compatible OmniRoute gateway. Before calling OmniRoute, QMRMed retrieves approved content from the indexed Google Drive corpus.

```text
Student question
      ↓
Saved department/stage profile
      ↓
Approved QMRMed Drive index
      ↓
Relevant source / case / question / ministerial chunks
      ↓
Section-specific OmniRoute group (or OmniRoute auto fallback)
      ↓
Arabic answer grounded in QMRMed content
```

Section-specific groups can be configured with:

```env
OMNIROUTE_GROUP_DEFAULT=auto
OMNIROUTE_GROUP_STUDY=study-combo
OMNIROUTE_GROUP_CASES=cases-combo
OMNIROUTE_GROUP_QUESTIONS=questions-combo
OMNIROUTE_GROUP_MINISTERIAL=ministerial-combo
OMNIROUTE_GROUP_EXAMS=exams-combo
OMNIROUTE_GROUP_SEARCH=search-combo
OMNIROUTE_GROUP_ADMIN=fast-combo
```

These values are OmniRoute model/combo identifiers. When a specific group is not configured, the gateway default is used; for PRO the gateway's normal default/auto routing remains available.

If no approved QMRMed context is found, the AI refuses to invent an answer from general knowledge. Any legacy lesson context passed by older bot code is ignored as an AI source; Drive-approved retrieval is authoritative.

## Stack

- TypeScript + Node.js 22
- grammY Telegram framework
- Prisma ORM
- PostgreSQL for the persistent production database
- Google Drive API (read-only service-account access)
- OmniRoute as the AI gateway
- GitHub Actions CI with PostgreSQL service containers

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
DATABASE_URL="postgresql://user:password@host:5432/qmrmed"
ADMIN_IDS=your_telegram_id
OMNIROUTE_URL="http://127.0.0.1:20128"
OMNIROUTE_API_KEY=your_omniroute_endpoint_key
OMNIROUTE_MODEL=auto
OMNIROUTE_GROUP_DEFAULT=auto
OMNIROUTE_GROUP_STUDY=
OMNIROUTE_GROUP_CASES=
OMNIROUTE_GROUP_QUESTIONS=
OMNIROUTE_GROUP_MINISTERIAL=
OMNIROUTE_GROUP_EXAMS=
OMNIROUTE_GROUP_SEARCH=
OMNIROUTE_GROUP_ADMIN=
```

Google Drive configuration:

```env
GOOGLE_DRIVE_ROOT_FOLDER_ID=your_qmrmed_root_folder_id
GOOGLE_SERVICE_ACCOUNT_JSON_BASE64=base64_encoded_service_account_json
DRIVE_AUTO_APPROVE=true
DRIVE_CHUNK_CHARS=6000
```

The service account must have read access to the QMRMed root folder. For a Shared Drive, grant the service account the minimum read role needed for the content corpus. Never commit service-account JSON, private keys, `BOT_TOKEN`, or `OMNIROUTE_API_KEY` to GitHub.

## Syncing Drive content

After the Drive credentials and root folder are configured:

```bash
npm run content:sync
```

The command recursively scans the configured root folder, extracts supported text, normalizes department/stage metadata, updates source metadata and rebuilds content chunks. Re-running the command is safe for the same Drive file because unchanged files are skipped and changed files have their chunks replaced. Files removed from the configured Drive tree are removed from the searchable index and approval is revoked.

The synchronizer refuses stale-content cleanup when a scan returns zero files or no indexable QMRMed files, protecting the existing index from an accidental empty-folder/credential outage.

## Telegram commands

```text
/start
/help
/study
/search
/ai
/questions
/ministerial
/exams
/progress
/plans
/trial
/account
/settings
/about
/cancel
/admin
```

The bot verifies its Telegram identity and command surface with `npm run check:telegram`.

## Payments

QMRMed subscription buttons are deliberately not treated as payment by themselves. Production digital-goods purchases inside Telegram must use Telegram Stars (`XTR`), with the normal invoice → pre-checkout → successful-payment flow and persistent transaction identifiers. The bot should only grant PLUS/PRO after receiving and validating a successful payment update. Telegram also recommends `/terms` and `/paysupport` for live digital-goods bots. See the official Telegram Payments guide for the current requirements. https://core.telegram.org/bots/payments-stars

The repository currently keeps the payment UI in a safe non-granting state until the exact PLUS/PRO Star prices and billing durations are finalized.

## OmniRoute

Run OmniRoute separately and configure at least one provider and an endpoint API key. Its OpenAI-compatible API is exposed under `/v1`; fallback chains and provider routing are configured in the OmniRoute dashboard. QMRMed can select a named OmniRoute group per feature while retaining gateway-level auto fallback.

## Production database

The repository is prepared for PostgreSQL, but the currently connected Neon project contains a different broader schema and is not yet a drop-in match for the bot's Prisma models. A production database reconciliation/migration must be completed before the deployed bot switches to that database. Existing SQLite deployments also require an explicit data migration before changing providers.

## Future platform integration

The Telegram presentation layer remains independent. A future QMRMed API adapter can replace direct Prisma access for identity, subscriptions, content, search, analytics, and AI without redesigning the Telegram UI.
