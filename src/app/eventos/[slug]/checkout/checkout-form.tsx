"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";

import { PRIVACY_REQUIRED_MESSAGE } from "@/lib/legal/privacy";

import { startCheckout } from "./actions";

type TicketKind = "inteira" | "meia";

type TicketType = {
  kind: TicketKind;
  priceCents: number;
};

const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const kindLabels: Record<TicketKind, string> = {
  inteira: "Inteira",
  meia: "Meia-entrada",
};

const MAX_PER_KIND = 10;

function parseQty(raw: string): number {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return 0;
  return Math.min(MAX_PER_KIND, Number(digits));
}

export function CheckoutForm({
  slug,
  ticketTypes,
}: {
  slug: string;
  ticketTypes: TicketType[];
}) {
  const [quantities, setQuantities] = useState<Record<TicketKind, number>>({
    inteira: 0,
    meia: 0,
  });
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const totalCents = ticketTypes.reduce(
    (sum, ticketType) =>
      sum + ticketType.priceCents * quantities[ticketType.kind],
    0,
  );
  const totalQty = ticketTypes.reduce(
    (sum, ticketType) => sum + quantities[ticketType.kind],
    0,
  );

  function setQty(kind: TicketKind, next: number) {
    const safe = Math.max(0, Math.min(MAX_PER_KIND, Math.trunc(next) || 0));
    setQuantities((current) =>
      current[kind] === safe ? current : { ...current, [kind]: safe },
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);

    startTransition(async () => {
      try {
        const result = await startCheckout({
          slug,
          items: ticketTypes.map(({ kind }) => ({
            kind,
            qty: quantities[kind],
          })),
          buyer: {
            name: String(data.get("name") ?? ""),
            email: String(data.get("email") ?? ""),
            phone: String(data.get("phone") ?? ""),
          },
          acceptedPrivacy: data.get("privacy") === "on",
        });
        if ("error" in result) {
          setError(result.error);
          return;
        }
        router.push(`/pedidos/${result.publicToken}`);
      } catch {
        setError("Não foi possível iniciar o pagamento. Tente novamente.");
      }
    });
  }

  const fieldClass =
    "rounded-lg border border-byla-border bg-byla-input px-3 py-2.5 text-foreground outline-none focus:border-byla-blue focus:ring-2 focus:ring-byla-ring";

  return (
    <form className="mt-8 grid gap-6" onSubmit={submit}>
      <fieldset className="grid gap-3">
        <legend className="font-semibold text-foreground">
          Escolha seus ingressos
        </legend>
        {ticketTypes.map((ticketType) => {
          const qty = quantities[ticketType.kind];
          return (
            <div
              className="flex items-center justify-between gap-4 rounded-xl border border-byla-border bg-byla-overlay p-4"
              key={ticketType.kind}
            >
              <div>
                <p className="font-medium text-foreground">
                  {kindLabels[ticketType.kind]}
                </p>
                <p className="text-sm text-byla-muted">
                  {moneyFormatter.format(ticketType.priceCents / 100)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  aria-label={`Diminuir ${kindLabels[ticketType.kind]}`}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-byla-border bg-byla-input text-xl font-semibold text-foreground disabled:opacity-40"
                  disabled={qty <= 0 || pending}
                  onClick={() => setQty(ticketType.kind, qty - 1)}
                  type="button"
                >
                  −
                </button>
                <input
                  aria-label={`Quantidade ${kindLabels[ticketType.kind]}`}
                  className={`${fieldClass} w-14 text-center`}
                  inputMode="numeric"
                  max={MAX_PER_KIND}
                  min={0}
                  onChange={(event) =>
                    setQty(ticketType.kind, parseQty(event.target.value))
                  }
                  type="text"
                  value={String(qty)}
                />
                <button
                  aria-label={`Aumentar ${kindLabels[ticketType.kind]}`}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-byla-border bg-byla-input text-xl font-semibold text-foreground disabled:opacity-40"
                  disabled={qty >= MAX_PER_KIND || pending}
                  onClick={() => setQty(ticketType.kind, qty + 1)}
                  type="button"
                >
                  +
                </button>
              </div>
            </div>
          );
        })}
      </fieldset>

      <fieldset className="grid gap-4">
        <legend className="font-semibold text-foreground">Seus dados</legend>
        <label className="grid gap-1 text-sm text-byla-muted">
          Nome
          <input className={fieldClass} name="name" required />
        </label>
        <label className="grid gap-1 text-sm text-byla-muted">
          E-mail
          <input className={fieldClass} name="email" required type="email" />
        </label>
        <label className="grid gap-1 text-sm text-byla-muted">
          Telefone (opcional)
          <input className={fieldClass} name="phone" type="tel" />
        </label>
        <label className="flex items-start gap-3 text-sm text-byla-muted">
          <input
            className="mt-0.5 h-5 w-5 shrink-0 accent-byla-blue"
            name="privacy"
            onChange={(event) => event.currentTarget.setCustomValidity("")}
            onInvalid={(event) =>
              event.currentTarget.setCustomValidity(PRIVACY_REQUIRED_MESSAGE)
            }
            required
            type="checkbox"
          />
          <span>
            Li e aceito a{" "}
            <Link
              className="font-medium text-byla-blue underline underline-offset-2"
              href="/privacidade"
              rel="noopener"
              target="_blank"
            >
              Política de Privacidade
            </Link>
            .
          </span>
        </label>
      </fieldset>

      <div className="flex items-center justify-between border-t border-byla-border pt-5">
        <span className="font-medium text-zinc-300">
          Total{totalQty > 0 ? ` · ${totalQty} ingresso${totalQty === 1 ? "" : "s"}` : ""}
        </span>
        <strong className="text-2xl text-byla-yellow">
          {moneyFormatter.format(totalCents / 100)}
        </strong>
      </div>
      {error ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-950/40 p-3 text-sm text-amber-100">
          {error}
        </p>
      ) : null}
      <button
        className="min-h-12 rounded-lg bg-byla-blue px-4 py-3 font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={pending || totalCents === 0}
        type="submit"
      >
        {pending ? "Reservando ingressos…" : "Continuar para o pagamento"}
      </button>
    </form>
  );
}
