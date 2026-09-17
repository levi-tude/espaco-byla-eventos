import QRCode from "qrcode";

import type { Enums } from "@/types/database";

type TicketQrProps = {
  code: string;
  eventName: string;
  holderName: string;
  kind: Enums<"ticket_kind">;
  status: "pago" | "check_in";
};

const kindLabels: Record<Enums<"ticket_kind">, string> = {
  inteira: "Inteira",
  meia: "Meia-entrada",
  cortesia: "Cortesia",
};

const statusLabels: Record<TicketQrProps["status"], string> = {
  pago: "Pago",
  check_in: "Check-in",
};

export async function TicketQr({
  code,
  eventName,
  holderName,
  kind,
  status,
}: TicketQrProps) {
  const qrDataUrl = await QRCode.toDataURL(code, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 280,
  });

  return (
    <article className="rounded-2xl border border-zinc-200 bg-white p-6 text-center shadow-sm">
      <h2 className="text-xl font-semibold">{eventName}</h2>
      <p className="mt-1 text-sm text-zinc-600">{kindLabels[kind]}</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt={`QR Code do ingresso de ${holderName}`}
        className="mx-auto my-5 h-64 w-64"
        height={256}
        src={qrDataUrl}
        width={256}
      />
      <p className="font-medium">{holderName}</p>
      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Código para digitação manual
        </p>
        <code className="mt-1 block select-all break-all rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-900">
          {code}
        </code>
      </div>
      <p
        className={`mt-3 inline-flex rounded-full px-3 py-1 text-sm font-medium ${
          status === "pago"
            ? "bg-emerald-100 text-emerald-800"
            : "bg-zinc-200 text-zinc-700"
        }`}
      >
        {statusLabels[status]}
      </p>
    </article>
  );
}
