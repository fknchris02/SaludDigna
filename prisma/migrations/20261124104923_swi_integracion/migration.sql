-- AlterTable
ALTER TABLE "Patient" ALTER COLUMN "fechaNac" DROP NOT NULL;

-- CreateTable
CREATE TABLE "SwiPaciente" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "creoPaciente" BOOLEAN NOT NULL DEFAULT false,
    "datos" JSONB NOT NULL DEFAULT '{}',
    "recibidoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SwiPaciente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SwiTramite" (
    "id" TEXT NOT NULL,
    "pacienteId" TEXT,
    "patientId" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "clinicId" TEXT,
    "fechaCita" TIMESTAMP(3),
    "estado" TEXT NOT NULL,
    "canalOrigen" TEXT,
    "canalActual" TEXT,
    "folioExterno" TEXT,
    "recuperadoPor" TEXT,
    "creadoEnSwi" TIMESTAMP(3),
    "actualizadoEnSwi" TIMESTAMP(3),
    "datos" JSONB NOT NULL DEFAULT '{}',
    "recibidoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SwiTramite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SwiPago" (
    "id" TEXT NOT NULL,
    "tramiteId" TEXT NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "moneda" TEXT NOT NULL,
    "metodo" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "marca" TEXT,
    "ultimos4" TEXT,
    "referencia" TEXT,
    "canal" TEXT,
    "creadoEnSwi" TIMESTAMP(3),
    "recibidoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SwiPago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SwiEvento" (
    "id" TEXT NOT NULL,
    "patientId" TEXT,
    "pacienteId" TEXT,
    "tramiteId" TEXT,
    "canal" TEXT NOT NULL,
    "tipoEvento" TEXT NOT NULL,
    "detalle" JSONB NOT NULL DEFAULT '{}',
    "fecha" TIMESTAMP(3) NOT NULL,
    "recibidoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SwiEvento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SwiPaciente_patientId_idx" ON "SwiPaciente"("patientId");

-- CreateIndex
CREATE INDEX "SwiTramite_patientId_idx" ON "SwiTramite"("patientId");

-- CreateIndex
CREATE INDEX "SwiEvento_patientId_fecha_idx" ON "SwiEvento"("patientId", "fecha");

-- AddForeignKey
ALTER TABLE "SwiPaciente" ADD CONSTRAINT "SwiPaciente_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwiTramite" ADD CONSTRAINT "SwiTramite_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwiTramite" ADD CONSTRAINT "SwiTramite_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "Study"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwiTramite" ADD CONSTRAINT "SwiTramite_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwiPago" ADD CONSTRAINT "SwiPago_tramiteId_fkey" FOREIGN KEY ("tramiteId") REFERENCES "SwiTramite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwiEvento" ADD CONSTRAINT "SwiEvento_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
