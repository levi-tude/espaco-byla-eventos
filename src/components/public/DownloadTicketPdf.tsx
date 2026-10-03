"use client";

import { jsPDF } from "jspdf";
import { Download } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import type { TicketPdfLine } from "@/lib/tickets/ticket-content";

export type TicketPdfPayload = {
  /** Linhas já prontas (`ticketPdfLines`), com texto seguro para as fontes do PDF. */
  lines: TicketPdfLine[];
  code: string;
  qrDataUrl: string;
  fileName: string;
};

type Props = {
  ticket: TicketPdfPayload;
};

export function DownloadTicketPdf({ ticket }: Props) {
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

      doc.setFillColor(10, 10, 11);
      doc.rect(0, 0, 210, 297, "F");

      const margin = 24;
      let y = 28;

      doc.setTextColor(255, 189, 56);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text("ESPAÇO BYLA EVENTOS", margin, y);
      y += 12;

      doc.setTextColor(255, 255, 255);
      doc.setFontSize(18);
      doc.text("Ingresso", margin, y);
      y += 14;

      doc.setFontSize(11);
      for (const [label, value] of ticket.lines) {
        doc.setTextColor(161, 161, 170);
        doc.setFont("helvetica", "bold");
        doc.text(`${label}:`, margin, y);
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "normal");
        const wrapped = doc.splitTextToSize(value, 150);
        doc.text(wrapped, margin + 36, y);
        y += Math.max(8, wrapped.length * 6);
      }

      y += 6;
      doc.setTextColor(64, 128, 252);
      doc.setFont("helvetica", "bold");
      doc.text("QR Code (apresente na entrada)", margin, y);
      y += 6;

      const qrSize = 70;
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(margin - 2, y - 2, qrSize + 4, qrSize + 4, 2, 2, "F");
      doc.addImage(ticket.qrDataUrl, "PNG", margin, y, qrSize, qrSize);
      y += qrSize + 12;

      doc.setTextColor(161, 161, 170);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("Código manual", margin, y);
      y += 5;
      doc.setTextColor(255, 255, 255);
      doc.setFont("courier", "normal");
      doc.setFontSize(8);
      const codeLines = doc.splitTextToSize(ticket.code, 160);
      doc.text(codeLines, margin, y);
      y += codeLines.length * 4 + 10;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(161, 161, 170);
      doc.text(
        "Cada ingresso deve ser usado uma única vez. Guarde este PDF no celular.",
        margin,
        y,
      );

      doc.save(`${ticket.fileName}.pdf`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      className="mt-4"
      fullWidth
      loading={busy}
      loadingLabel="Gerando PDF..."
      onClick={download}
    >
      <Download aria-hidden className="h-5 w-5" />
      Baixar ingresso (PDF)
    </Button>
  );
}
