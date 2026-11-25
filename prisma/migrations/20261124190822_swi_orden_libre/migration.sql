-- DropForeignKey
ALTER TABLE "SwiPago" DROP CONSTRAINT "SwiPago_tramiteId_fkey";

-- DropForeignKey
ALTER TABLE "SwiTramite" DROP CONSTRAINT "SwiTramite_studyId_fkey";

-- AlterTable
ALTER TABLE "SwiEvento" ALTER COLUMN "canal" DROP NOT NULL,
ALTER COLUMN "tipoEvento" DROP NOT NULL,
ALTER COLUMN "fecha" DROP NOT NULL;

-- AlterTable
ALTER TABLE "SwiPago" ALTER COLUMN "tramiteId" DROP NOT NULL,
ALTER COLUMN "monto" DROP NOT NULL,
ALTER COLUMN "moneda" DROP NOT NULL,
ALTER COLUMN "metodo" DROP NOT NULL,
ALTER COLUMN "estado" DROP NOT NULL;

-- AlterTable
ALTER TABLE "SwiTramite" ALTER COLUMN "studyId" DROP NOT NULL,
ALTER COLUMN "estado" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "SwiEvento_pacienteId_idx" ON "SwiEvento"("pacienteId");

-- CreateIndex
CREATE INDEX "SwiEvento_tramiteId_idx" ON "SwiEvento"("tramiteId");

-- CreateIndex
CREATE INDEX "SwiPago_tramiteId_idx" ON "SwiPago"("tramiteId");

-- AddForeignKey
ALTER TABLE "SwiTramite" ADD CONSTRAINT "SwiTramite_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "Study"("id") ON DELETE SET NULL ON UPDATE CASCADE;
