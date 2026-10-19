"use client";

import { initMercadoPago, Payment } from "@mercadopago/sdk-react";
import { Check, Clock, Copy, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  checkOrderPayment,
  payOrder,
  type PaymentSubmission,
} from "@/app/pedidos/[publicToken]/actions";
import { ChangeSelectionButton } from "@/components/public/ChangeSelectionButton";
import { useHumanCheck } from "@/components/public/HumanCheck";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { eventDateFormatter } from "@/lib/datetime";
import {
  formatMoney,
  PIX_DISCOUNT_LINE_LABEL,
  PIX_OFF_LABEL,
} from "@/lib/domain/service-fee";
import { INSTALLMENT_INTEREST_NOTE } from "@/lib/legal/terms";
import type { PixData } from "@/lib/payments/types";

const POLL_INTERVAL_MS = 4000;

const timeFormatter = eventDateFormatter({ timeStyle: "short" });

function ReservationNotice({ expiresAt }: { expiresAt: string | null }) {
  const time = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  if (!Number.isFinite(time)) return null;
  return (
    <p className="inline-flex items-center gap-2 text-base text-byla-muted">
      <Clock aria-hidden className="h-5 w-5 shrink-0" />
      <span>
        Reserva válida até{" "}
        <strong className="text-foreground">{timeFormatter.format(new Date(time))}</strong>
      </span>
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

type MethodChoice = "pix" | "cartao";

function toApiMethod(method: MethodChoice): "pix" | "card" {
  return method === "pix" ? "pix" : "card";
}

export function OrderPayment({
  publicKey,
  publicToken,
  amountCents,
  pixTotalCents,
  cardTotalCents,
  buyerEmail,
  initialPix,
  reservationExpiresAt,
}: {
  publicKey: string;
  publicToken: string;
  /** Total atual do pedido (após a última escolha no servidor). */
  amountCents: number;
  pixTotalCents: number;
  cardTotalCents: number;
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
  const [method, setMethod] = useState<MethodChoice>("pix");
  const [totalCents, setTotalCents] = useState(amountCents);
  const [locking, setLocking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [changingSelection, setChangingSelection] = useState(false);
  const humanCheck = useHumanCheck("payment");

  const savingsCents = Math.max(0, cardTotalCents - pixTotalCents);
  const showDual = pixTotalCents !== cardTotalCents;

  ensureMercadoPago(publicKey);

  const initialization = useMemo(
    () => ({ amount: totalCents / 100, payer: { email: buyerEmail } }),
    [totalCents, buyerEmail],
  );
  const customization = useMemo(
    () => ({
      paymentMethods:
        method === "pix"
          ? { bankTransfer: "all" as const }
          : { creditCard: "all" as const },
      visual: { style: { theme: "dark" as const } },
    }),
    [method],
  );

  useEffect(() => {
    // Durante "Alterar seleção" o pedido vira cancelado; a consulta não deve recarregar a tela.
    if ((!pix && !waiting) || changingSelection) return;
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
  }, [pix, waiting, changingSelection, publicToken, router]);

  // Confirma a forma no servidor (recalcula total) ao montar e ao trocar.
  useEffect(() => {
    if (pix || waiting) return;
    let cancelled = false;
    async function lockMethod(next: MethodChoice) {
      setLocking(true);
      setMessage("");
      try {
        const response = await fetch(
          `/api/pedidos/${encodeURIComponent(publicToken)}/forma`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ method: toApiMethod(next) }),
          },
        );
        const payload = (await response.json().catch(() => null)) as {
          totalCents?: number;
          error?: string;
        } | null;
        if (cancelled) return;
        if (!response.ok || typeof payload?.totalCents !== "number") {
          setMessage(payload?.error ?? "Não foi possível atualizar o total. Tente de novo.");
          router.refresh();
          return;
        }
        setTotalCents(payload.totalCents);
        setBrickKey((key) => key + 1);
      } catch {
        if (!cancelled) {
          setMessage("Não foi possível atualizar o total. Tente de novo.");
        }
      } finally {
        if (!cancelled) setLocking(false);
      }
    }
    void lockMethod(method);
    return () => {
      cancelled = true;
    };
  }, [method, publicToken, pix, waiting, router]);

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

    const result = await payOrder(publicToken, submission, await humanCheck.takeToken());

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
    if (result.message.includes("forma de pagamento")) {
      router.refresh();
    }
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
      <section className="rounded-2xl border border-byla-border bg-byla-surface p-5 text-center sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-byla-accent-text">
          Pague com PIX
        </p>
        <h2 className="mt-1 font-display text-3xl tracking-wide text-foreground">
          Escaneie o QR Code
        </h2>
        <p className="mt-2 text-base text-byla-muted">
          Abra o app do seu banco, escolha PIX e escaneie o código ou use o
          “copia e cola”.
        </p>
        <div className="mt-3">
          <ReservationNotice expiresAt={holdExpiresAt} />
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt="QR Code PIX"
          className="mx-auto mt-5 h-56 w-56 rounded-xl bg-white p-3"
          height={224}
          src={`data:image/png;base64,${pix.qrCodeBase64}`}
          width={224}
        />
        <Button className="mt-5" fullWidth onClick={copyPixCode} size="lg">
          {copied ? (
            <Check aria-hidden className="h-5 w-5" />
          ) : (
            <Copy aria-hidden className="h-5 w-5" />
          )}
          {copied ? "Código copiado!" : "Copiar código PIX"}
        </Button>
        <p
          aria-live="polite"
          className="mt-5 flex items-center justify-center gap-2 text-base text-byla-muted"
        >
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-byla-yellow" />
          {confirmed
            ? "Pagamento confirmado! Abrindo seus ingressos…"
            : "Aguardando pagamento… esta página atualiza sozinha."}
        </p>
        {confirmed ? null : (
          <div className="mt-6 border-t border-byla-border pt-5 text-left">
            <p className="text-base text-byla-muted">
              Quer mudar os ingressos? Este pedido e o PIX acima serão
              cancelados, e você volta para a escolha com tudo preenchido. Se
              já pagou o PIX, aguarde a confirmação.
            </p>
            <ChangeSelectionButton
              className="mt-3"
              onBusyChange={setChangingSelection}
              publicToken={publicToken}
            />
          </div>
        )}
      </section>
    );
  }

  if (waiting) {
    return (
      <section className="rounded-2xl border border-byla-border bg-byla-surface p-6 text-center sm:p-8">
        <LoaderCircle
          aria-hidden
          className="mx-auto h-12 w-12 animate-spin text-byla-link motion-reduce:animate-none"
        />
        <h2 className="mt-3 font-display text-3xl tracking-wide text-foreground">
          Pagamento em análise
        </h2>
        <p aria-live="polite" className="mt-3 text-base text-byla-muted">
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
      {message ? <Notice tone="warning">{message}</Notice> : null}
      <fieldset className="grid gap-2" disabled={locking}>
        <legend className="text-sm font-medium text-foreground">Como você quer pagar</legend>
        <label
          className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 ${
            method === "pix" ? "border-byla-blue bg-byla-blue/10" : "border-byla-border bg-byla-surface"
          }`}
        >
          <input
            checked={method === "pix"}
            className="h-5 w-5 accent-byla-blue"
            name="forma-pagamento"
            onChange={() => setMethod("pix")}
            type="radio"
            value="pix"
          />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-foreground">PIX</span>
              {showDual && savingsCents > 0 ? (
                <span className="rounded-full bg-byla-yellow px-2 py-0.5 text-xs font-bold text-black">
                  {PIX_OFF_LABEL}
                </span>
              ) : (
                <span className="rounded-full bg-byla-yellow px-2 py-0.5 text-xs font-bold text-black">
                  Mais rápido
                </span>
              )}
            </span>
            <span className="mt-0.5 block text-sm text-byla-muted">
              {formatMoney(pixTotalCents)}
            </span>
          </span>
        </label>
        <label
          className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 ${
            method === "cartao" ? "border-byla-blue bg-byla-blue/10" : "border-byla-border bg-byla-surface"
          }`}
        >
          <input
            checked={method === "cartao"}
            className="h-5 w-5 accent-byla-blue"
            name="forma-pagamento"
            onChange={() => setMethod("cartao")}
            type="radio"
            value="cartao"
          />
          <span className="min-w-0 flex-1">
            <span className="font-semibold text-foreground">Cartão de crédito</span>
            <span className="mt-0.5 block text-sm text-byla-muted">
              {formatMoney(cardTotalCents)}
            </span>
          </span>
        </label>
      </fieldset>
      {showDual && method === "pix" && savingsCents > 0 ? (
        <dl className="grid gap-1 text-base text-foreground">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-byla-muted">{PIX_DISCOUNT_LINE_LABEL}</dt>
            <dd className="tabular-nums text-byla-muted">−{formatMoney(savingsCents)}</dd>
          </div>
        </dl>
      ) : null}
      <p className="text-base font-semibold text-foreground" aria-live="polite">
        Total: {formatMoney(totalCents)}
        {locking ? "…" : ""}
      </p>
      {method === "cartao" ? (
        <p className="text-sm text-byla-muted">{INSTALLMENT_INTEREST_NOTE}</p>
      ) : null}
      <Payment
        customization={customization}
        initialization={initialization}
        key={`${method}-${brickKey}-${totalCents}`}
        locale="pt"
        onError={(error) => console.error("[pagamento] Brick:", error)}
        onSubmit={handleSubmit}
      />
      {humanCheck.slot}
      {confirmed ? null : (
        <div className="border-t border-byla-border pt-4">
          <p className="text-base text-byla-muted">
            Quer mudar os ingressos? Este pedido será cancelado e você volta
            para a escolha com tudo preenchido.
          </p>
          <ChangeSelectionButton
            className="mt-3"
            onBusyChange={setChangingSelection}
            publicToken={publicToken}
          />
        </div>
      )}
    </section>
  );
}
