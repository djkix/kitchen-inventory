-- Sauvegarde vers le NAS (section 9) : tentatives et demandes « Sauvegarder maintenant ».
CREATE TABLE "BackupAttempt" (
    "id" SERIAL NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "succeeded" BOOLEAN NOT NULL,
    "message" TEXT NOT NULL,
    "dumpBytes" INTEGER,

    CONSTRAINT "BackupAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BackupAttempt_finishedAt_idx" ON "BackupAttempt"("finishedAt");

CREATE TABLE "BackupRequest" (
    "id" SERIAL NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackupRequest_pkey" PRIMARY KEY ("id")
);
