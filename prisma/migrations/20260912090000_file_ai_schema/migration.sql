-- File AI durable schema. This migration intentionally creates only the QMRMed-owned
-- File AI/exam tables and never drops unrelated tables owned by the hosting database.

DO $$ BEGIN CREATE TYPE "FileStatus" AS ENUM ('RECEIVED','DOWNLOADING','EXTRACTING','PARSING','CHUNKING','INDEXING','ANALYZING','READY','FAILED','CANCELLED','DELETED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "FileOperationStatus" AS ENUM ('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "AIJobStatus" AS ENUM ('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "AIJobType" AS ENUM ('FILE_INGESTION','FILE_ANALYSIS','FILE_RESULT','EXAM_GENERATION','PDF_GENERATION','CONTENT_SYNC'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "FileOperationType" AS ENUM ('EXPLAIN','SUMMARY','QA','MCQ','TRUE_FALSE','FILL_BLANK','MATCHING','CASES','VIVA','MIND_MAP','FLOWCHART','COMPARISON','TIMELINE','DIAGNOSTIC','EXAM','ASK_FILE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "CitationKind" AS ENUM ('FILE_PAGE','FILE_CHUNK','EXTERNAL_SOURCE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "EntitlementSource" AS ENUM ('SYSTEM','TRIAL','SUBSCRIPTION','OVERRIDE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "ExamSessionStatus" AS ENUM ('ACTIVE','COMPLETED','EXPIRED','CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE "qmr_files" (
  "id" TEXT NOT NULL,
  "userId" INTEGER NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "sha256" TEXT NOT NULL,
  "status" "FileStatus" NOT NULL DEFAULT 'RECEIVED',
  "storageKey" TEXT NOT NULL,
  "pageCount" INTEGER,
  "extractedChars" INTEGER NOT NULL DEFAULT 0,
  "contentFingerprint" TEXT,
  "metadata" JSONB,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readyAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "qmr_files_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "qmr_files_userId_fkey" FOREIGN KEY ("userId") REFERENCES "qmr_users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "qmr_files_userId_sha256_key" ON "qmr_files"("userId","sha256");
CREATE INDEX "qmr_files_userId_status_createdAt_idx" ON "qmr_files"("userId","status","createdAt");

CREATE TABLE "qmr_file_pages" (
  "id" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "pageNumber" INTEGER NOT NULL,
  "text" TEXT NOT NULL,
  "charCount" INTEGER NOT NULL DEFAULT 0,
  "contentHash" TEXT,
  "metadata" JSONB,
  CONSTRAINT "qmr_file_pages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "qmr_file_pages_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "qmr_files"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "qmr_file_pages_fileId_pageNumber_key" ON "qmr_file_pages"("fileId","pageNumber");
CREATE INDEX "qmr_file_pages_fileId_pageNumber_idx" ON "qmr_file_pages"("fileId","pageNumber");

CREATE TABLE "qmr_file_chunks" (
  "id" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "pageId" TEXT,
  "chunkIndex" INTEGER NOT NULL,
  "text" TEXT NOT NULL,
  "charCount" INTEGER NOT NULL DEFAULT 0,
  "pageStart" INTEGER,
  "pageEnd" INTEGER,
  "contentHash" TEXT,
  "metadata" JSONB,
  CONSTRAINT "qmr_file_chunks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "qmr_file_chunks_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "qmr_files"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "qmr_file_chunks_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "qmr_file_pages"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "qmr_file_chunks_fileId_chunkIndex_key" ON "qmr_file_chunks"("fileId","chunkIndex");
CREATE INDEX "qmr_file_chunks_fileId_pageStart_pageEnd_idx" ON "qmr_file_chunks"("fileId","pageStart","pageEnd");

CREATE TABLE "qmr_file_analyses" (
  "id" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "summary" TEXT NOT NULL,
  "topicMap" JSONB,
  "documentMap" JSONB,
  "evidenceIndex" JSONB,
  "language" TEXT,
  "model" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "qmr_file_analyses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "qmr_file_analyses_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "qmr_files"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "qmr_file_analyses_fileId_version_key" ON "qmr_file_analyses"("fileId","version");
CREATE INDEX "qmr_file_analyses_fileId_createdAt_idx" ON "qmr_file_analyses"("fileId","createdAt");

CREATE TABLE "qmr_ai_jobs" (
  "id" TEXT NOT NULL,
  "userId" INTEGER NOT NULL,
  "fileId" TEXT,
  "analysisId" TEXT,
  "type" "AIJobType" NOT NULL,
  "status" "AIJobStatus" NOT NULL DEFAULT 'QUEUED',
  "idempotencyKey" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "progress" INTEGER NOT NULL DEFAULT 0,
  "stage" TEXT,
  "payload" JSONB,
  "result" JSONB,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "lockedBy" TEXT,
  "heartbeatAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "qmr_ai_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "qmr_ai_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "qmr_users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "qmr_ai_jobs_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "qmr_files"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "qmr_ai_jobs_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "qmr_file_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "qmr_ai_jobs_userId_idempotencyKey_key" ON "qmr_ai_jobs"("userId","idempotencyKey");
CREATE INDEX "qmr_ai_jobs_status_availableAt_idx" ON "qmr_ai_jobs"("status","availableAt");
CREATE INDEX "qmr_ai_jobs_lockedAt_heartbeatAt_idx" ON "qmr_ai_jobs"("lockedAt","heartbeatAt");

CREATE TABLE "qmr_file_operations" (
  "id" TEXT NOT NULL,
  "userId" INTEGER NOT NULL,
  "fileId" TEXT NOT NULL,
  "jobId" TEXT,
  "type" "FileOperationType" NOT NULL,
  "status" "FileOperationStatus" NOT NULL DEFAULT 'QUEUED',
  "requestKey" TEXT NOT NULL,
  "parameters" JSONB,
  "progress" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "qmr_file_operations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "qmr_file_operations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "qmr_users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "qmr_file_operations_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "qmr_files"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "qmr_file_operations_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "qmr_ai_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "qmr_file_operations_userId_requestKey_key" ON "qmr_file_operations"("userId","requestKey");
CREATE INDEX "qmr_file_operations_fileId_status_createdAt_idx" ON "qmr_file_operations"("fileId","status","createdAt");

CREATE TABLE "qmr_file_results" (
  "id" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "structured" JSONB,
  "model" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "qmr_file_results_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "qmr_file_results_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "qmr_file_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "qmr_file_results_operationId_version_key" ON "qmr_file_results"("operationId","version");
CREATE INDEX "qmr_file_results_operationId_createdAt_idx" ON "qmr_file_results"("operationId","createdAt");

CREATE TABLE "qmr_citations" (
  "id" TEXT NOT NULL,
  "resultId" TEXT NOT NULL,
  "kind" "CitationKind" NOT NULL,
  "pageId" TEXT,
  "chunkId" TEXT,
  "sourceName" TEXT,
  "sourceUrl" TEXT,
  "quote" TEXT,
  "pageNumber" INTEGER,
  "locator" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "qmr_citations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "qmr_citations_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "qmr_file_results"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "qmr_citations_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "qmr_file_pages"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "qmr_citations_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "qmr_file_chunks"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "qmr_citations_resultId_idx" ON "qmr_citations"("resultId");
CREATE INDEX "qmr_citations_pageId_idx" ON "qmr_citations"("pageId");
CREATE INDEX "qmr_citations_chunkId_idx" ON "qmr_citations"("chunkId");

CREATE TABLE "qmr_entitlements" (
  "id" TEXT NOT NULL,
  "userId" INTEGER NOT NULL,
  "subscriptionId" INTEGER,
  "key" TEXT NOT NULL,
  "valueInt" INTEGER,
  "valueBool" BOOLEAN,
  "valueText" TEXT,
  "source" "EntitlementSource" NOT NULL,
  "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "qmr_entitlements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "qmr_entitlements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "qmr_users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "qmr_entitlements_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "qmr_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "qmr_entitlements_userId_key_validUntil_idx" ON "qmr_entitlements"("userId","key","validUntil");

CREATE TABLE "qmr_exam_sessions" (
  "id" TEXT NOT NULL,
  "userId" INTEGER NOT NULL,
  "fileId" TEXT,
  "title" TEXT NOT NULL,
  "status" "ExamSessionStatus" NOT NULL DEFAULT 'ACTIVE',
  "questionCount" INTEGER NOT NULL,
  "currentIndex" INTEGER NOT NULL DEFAULT 0,
  "score" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "qmr_exam_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "qmr_exam_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "qmr_users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "qmr_exam_sessions_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "qmr_files"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "qmr_exam_sessions_userId_status_createdAt_idx" ON "qmr_exam_sessions"("userId","status","createdAt");

CREATE TABLE "qmr_exam_questions" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "questionId" INTEGER,
  "prompt" TEXT NOT NULL,
  "options" JSONB,
  "correct" TEXT NOT NULL,
  "explanation" TEXT,
  "metadata" JSONB,
  CONSTRAINT "qmr_exam_questions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "qmr_exam_questions_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "qmr_exam_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "qmr_exam_questions_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "qmr_questions"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "qmr_exam_questions_sessionId_position_key" ON "qmr_exam_questions"("sessionId","position");
CREATE INDEX "qmr_exam_questions_questionId_idx" ON "qmr_exam_questions"("questionId");

CREATE TABLE "qmr_exam_answers" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "questionId" TEXT NOT NULL,
  "answer" TEXT NOT NULL,
  "isCorrect" BOOLEAN NOT NULL,
  "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "elapsedMs" INTEGER,
  CONSTRAINT "qmr_exam_answers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "qmr_exam_answers_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "qmr_exam_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "qmr_exam_answers_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "qmr_exam_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "qmr_exam_answers_sessionId_questionId_key" ON "qmr_exam_answers"("sessionId","questionId");
CREATE INDEX "qmr_exam_answers_sessionId_answeredAt_idx" ON "qmr_exam_answers"("sessionId","answeredAt");

-- Prisma's migration engine records the migration as applied after the statements above.
