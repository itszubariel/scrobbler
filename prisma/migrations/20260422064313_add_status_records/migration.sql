-- CreateTable
CREATE TABLE "status_records" (
    "id" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "responseTime" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "available" BOOLEAN NOT NULL,

    CONSTRAINT "status_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "status_records_service_checkedAt_idx" ON "status_records"("service", "checkedAt");
