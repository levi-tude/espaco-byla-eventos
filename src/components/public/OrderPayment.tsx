"use client";

import { initMercadoPago, Payment } from "@mercadopago/sdk-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  checkOrderPayment,
  payOrder,
  type PaymentSubmission,
} from "@/app/pedidos/[publicToken]/actions";
import { eventDateFormatter } from "@/lib/datetime";
import type { PixData } from "@/lib/payments/types";

const POLL_INTERVAL_MS = 4000;

const timeFormatter = eventDateFormatter({ timeStyle: "short" });

function ReservationNotice({ expiresAt }: { expiresAt: string | null }) {
  const time = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  if (!Number.isFinite(time)) return null;
  return (
    <p className="text-sm text-byla-muted">
      Reserva válida até{" "}
      <strong className="text-foreground">{timeFormatter.format(new Date(time))}</strong>
    </p>
  );
}

type BrickFormData = {
  payment_method_id?: string;
  token?: string;
  installments?: number;
  payer?: {
    email?: string;
    identification?: { type?: string; number?: string };
  };
};

let initializedKey: string | null = null;

function confirmedOrderPath(publicToken: string) {
  return `/pedidos/${encodeURIComponent(publicToken)}?confirmado=1`;
}

function ensureMercadoPago(publicKey: string) {
  if (initializedKey === publicKey) return;
  initMercadoPago(publicKey, { locale: "pt-BR" });
  initializedKey = publicKey;
}

export function OrderPayment({
  publicKey,
  publicToken,
  amountCents,
  buyerEmail,
  initialPix,
  reservationExpiresAt,
}: {
  publicKey: string;
  publicToken: string;
  amountCents: number;
  buyerEmail: string;
  initialPix: PixData | null;
  /** Fim da reserva; ao gerar o PIX ela passa a acompanhar o vencimento dele. */
  reservationExpiresAt: string | null;
}) {
  const router = useRouter();
  const [pix, setPix] = useState<PixData | null>(initialPix);
  const [holdExpiresAt, setHoldExpiresAt] = useState(reservationExpiresAt);
  const [message, setMessage] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [brickKey, setBrickKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  ensureMercadoPago(publicKey);

  const initialization = useMemo(
    () => ({ amount: amountCents / 100, payer: { email: buyerEmail } }),
    [amountCents, buyerEmail],
  );
  const customization = useMemo(
    () => ({
      paymentMethods: {
        bankTransfer: "all" as const,
        creditCard: "all" as const,
      },
      visual: { style: { theme: "dark" as const } },
    }),
    [],
  );

  useEffect(() => {
    if (!pix && !waiting) return;
    let active = true;
    const timer = setInterval(async () => {
      const status = await checkOrderPayment(publicToken);
      if (!active) return;
      if (status === "paid") {
        clearInterval(timer);
        setConfirmed(true);
        router.replace(confirmedOrderPath(publicToken));
      } else if (status !== "pending") {
        clearInterval(timer);
        router.refresh();
      }
    }, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [pix, waiting, publicToken, router]);

  async function handleSubmit({
    paymentType,
    formData,
  }: {
    paymentType?: string;
    formData: BrickFormData;
  }) {
    setMessage("");
    const submission: PaymentSubmission = {
      paymentMethodId: formData.payment_method_id ?? "",
      paymentType,
      cardToken: formData.token,
      installments: formData.installments,
      email: formData.payer?.email,
      identification: formData.payer?.identification,
    };

    const result = await payOrder(publicToken, submission);

    if (result.status === "paid") {
      setConfirmed(true);
      router.replace(confirmedOrderPath(publicToken));
      return;
    }
    if (result.status === "unavailable") {
      setMessage(result.message);
      router.refresh();
      return;
    }
    if (result.status === "pix") {
      setPix(result.pix);
      if (result.holdExpiresAt) setHoldExpiresAt(result.holdExpiresAt);
      return;
    }
    if (result.status === "processing") {
      setWaiting(true);
      return;
    }
    setMessage(result.message);
    // Recria o formulário para permitir nova tentativa com dados limpos.
    setBrickKey((key) => key + 1);
  }

  async function copyPixCode() {
    if (!pix) return;
    try {
      await navigator.clipboard.writeText(pix.qrCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  if (pix) {
    return (
      <section className="rounded-2xl border border-byla-border bg-byla-surface p-6 text-center md:p-8">
        <p className="text-sm font-medium text-byla-yellow">Pague com PIX</p>
        <h2 className="mt-1 font-display text-3xl tracking-wide text-foreground">
          Escaneie o QR Code
        </h2>
        <p className="mt-2 text-sm text-byla-muted">
          Abra o app do seu banco, escolha PIX e escaneie o código ou use o
          “copia e cola”.
        </p>
        <div className="mt-2">
          <ReservationNotice expiresAt={holdExpiresAt} />
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt="QR Code PIX"
          className="mx-auto mt-6 h-56 w-56 rounded-xl bg-white p-3"
          src={`data:image/png;base64,${pix.qrCodeBase64}`}
        />
        <button
          className="mt-6 min-h-12 w-full rounded-lg bg-byla-blue px-4 py-3 font-semibold text-white transition hover:brightness-110"
          onClick={copyPixCode}
          type="button"
        >
          {copied ? "Código copiado!" : "Copiar código PIX"}
        </button>
        <p
          aria-live="polite"
          className="mt-6 flex items-center justify-center gap-2 text-sm text-byla-muted"
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-byla-yellow" />
          {confirmed
            ? "Pagamento confirmado! Abrindo seus ingressos…"
            : "Aguardando pagamento… esta página atualiza sozinha."}
        </p>
      </section>
    );
  }

  if (waiting) {
    return (
      <section className="rounded-2xl border border-byla-border bg-byla-surface p-8 text-center">
        <h2 className="font-display text-3xl tracking-wide text-foreground">
          Pagamento em análise
        </h2>
        <p aria-live="polite" className="mt-3 text-byla-muted">
          {confirmed
            ? "Pagamento confirmado! Abrindo seus ingressos…"
            : "O Mercado Pago está confirmando seu pagamento. Esta página atualiza sozinha assim que for aprovado."}
        </p>
      </section>
    );
  }

  return (
    <section className="grid gap-4">
      <p aria-live="polite" className="sr-only">
        {confirmed ? "Pagamento confirmado! Abrindo seus ingressos…" : ""}
      </p>
      <ReservationNotice expiresAt={holdExpiresAt} />
      {message ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          {message}
        </p>
      ) : null}
      <Payment
        customization={customization}
        initialization={initialization}
        key={brickKey}
        locale="pt"
        onError={(error) => console.error("[pagamento] Brick:", error)}
        onSubmit={handleSubmit}
      />
    </section>
  );
}
