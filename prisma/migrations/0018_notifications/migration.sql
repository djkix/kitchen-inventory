-- Notification « réponse prête » (conception du 2026-11-02) : demandes au
-- modèle qui survivent à l'écran, et abonnements Web Push par appareil.

CREATE TYPE "AiRequestKind" AS ENUM ('SCAN_IMAGE', 'SUGGESTIONS', 'VOICE', 'RECEIPT');

CREATE TYPE "AiRequestState" AS ENUM ('RUNNING', 'DEFERRED', 'DONE', 'FAILED', 'ABANDONED');

CREATE TABLE "AiRequest" (
    -- Engendré par le téléphone : la page doit pouvoir réclamer son résultat
    -- même si elle n'a jamais reçu la réponse.
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "AiRequestKind" NOT NULL,
    "state" "AiRequestState" NOT NULL DEFAULT 'RUNNING',
    "leftScreen" BOOLEAN NOT NULL DEFAULT false,
    "inputPath" TEXT,
    "inputMime" TEXT,
    "inputJson" JSONB,
    "result" JSONB,
    "error" TEXT,
    "retryAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiRequest_state_retryAt_idx" ON "AiRequest"("state", "retryAt");

CREATE INDEX "AiRequest_userId_kind_state_idx" ON "AiRequest"("userId", "kind", "state");

ALTER TABLE "AiRequest" ADD CONSTRAINT "AiRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
