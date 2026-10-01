"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState, useTransition } from "react";

import {
  type BrowserCart,
  browserStorage,
  type CartKind,
  readCart,
  writeCart,
} from "@/lib/cart/browser-cart";
import {
  fitSelection,
  MAX_PEOPLE_PER_ORDER,
  maxSelectableUnits,
  remainingNotice,
} from "@/lib/domain/availability";
import { PRIVACY_REQUIRED_MESSAGE } from "@/lib/legal/privacy";
import { useMounted } from "@/lib/use-mounted";

import { startCheckout } from "./actions";

type TicketKind = CartKind;

type TicketType = {
  kind: TicketKind;
  priceCents: number;
};

type Quantities = Record<TicketKind, number>;
type Buyer = Pick<BrowserCart, "name" | "email" | "phone">;

type CheckoutFormProps = {
  slug: string;
  ticketTypes: TicketType[];
  /** Lugares livres agora (descontando reservas); `null` se não foi possível consultar. */
  remaining: number | null;
};

const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const kindLabels: Record<TicketKind, string> = {
  inteira: "Inteira",
  meia: "Meia-entrada",
};

const EMPTY_QUANTITIES: Quantities = { inteira: 0, meia: 0 };
const EMPTY_BUYER: Buyer = { name: "", email: "", phone: "" };

function parseQty(raw: string): number {
  const digits = raw.replace(/\D/g, "").slice(0, 3);
  return digits ? Number(digits) : 0;
}

export function CheckoutForm(props: CheckoutFormProps) {
  // O carrinho salvo só existe no navegador: remonta depois da hidratação para lê-lo.
  const mounted = useMounted();
  return (
    <CheckoutFormFields
      key={mounted ? "browser" : "server"}
      restoreCart={mounted}
      {...props}
    />
  );
}

function CheckoutFormFields({
  slug,
  ticketTypes,
  remaining: initialRemaining,
  restoreCart,
}: CheckoutFormProps & { restoreCart: boolean }) {
  const kinds = ticketTypes.map(({ kind }) => kind);
  const [remaining, setRemaining] = useState(initialRemaining);
  const capacityLeft = remaining ?? MAX_PEOPLE_PER_ORDER;
  const [initial] = useState(() => {
    const cart = restoreCart ? readCart(browserStorage(), slug) : null;
    const offered = Object.fromEntries(
      (Object.keys(EMPTY_QUANTITIES) as TicketKind[]).map((kind) => [
        kind,
        kinds.includes(kind) ? (cart?.quantities[kind] ?? 0) : 0,
      ]),
    ) as Quantities;
    return {
      quantities: fitSelection(offered, kinds, capacityLeft),
      buyer: cart
        ? { name: cart.name, email: cart.email, phone: cart.phone }
        : EMPTY_BUYER,
    };
  });
  const [quantities, setQuantities] = useState<Quantities>(initial.quantities);
  const [buyer, setBuyer] = useState<Buyer>(initial.buyer);
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
  const selectionLimit = Math.min(capacityLeft, MAX_PEOPLE_PER_ORDER);
  const notice = remaining === null ? null : remainingNotice(remaining);
  const limitHint =
    totalQty > 0 && totalQty >= selectionLimit
      ? selectionLimit < MAX_PEOPLE_PER_ORDER
        ? "Você escolheu todos os lugares disponíveis no momento."
        : `Máximo de ${MAX_PEOPLE_PER_ORDER} ingressos por compra.`
      : "";

  useEffect(() => {
    if (!restoreCart) return;
    writeCart(browserStorage(), slug, { quantities, ...buyer });
  }, [restoreCart, slug, quantities, buyer]);

  function maxFor(kind: TicketKind, current: Quantities = quantities) {
    const selected = kinds.reduce((sum, item) => sum + current[item], 0);
    return maxSelectableUnits({
      remaining: capacityLeft,
      peopleSelectedElsewhere: selected - current[kind],
    });
  }

  function setQty(kind: TicketKind, next: number | ((qty: number) => number)) {
    setQuantities((current) => {
      const wanted = typeof next === "function" ? next(current[kind]) : next;
      const safe = Math.max(0, Math.min(maxFor(kind, current), Math.trunc(wanted) || 0));
      return current[kind] === safe ? current : { ...current, [kind]: safe };
    });
  }

  function setBuyerField(field: keyof Buyer, value: string) {
    setBuyer((current) => ({ ...current, [field]: value }));
  }

  function clearSelection() {
    setQuantities(EMPTY_QUANTITIES);
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
          buyer,
          acceptedPrivacy: data.get("privacy") === "on",
        });
        if ("error" in result) {
          setError(result.error);
          const updated = result.remaining;
          if (typeof updated === "number") {
            setRemaining(updated);
            setQuantities((current) => fitSelection(current, kinds, updated));
          }
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
  const stepperClass =
    "inline-flex h-11 w-11 items-center justify-center rounded-lg border border-byla-border bg-byla-input text-xl font-semibold text-foreground disabled:opacity-40";

  return (
    <form className="mt-8 grid gap-6" onSubmit={submit}>
      <fieldset className="grid gap-3">
        <legend className="font-semibold text-foreground">
          Escolha seus ingressos
        </legend>
        {notice ? (
          <p className="text-sm font-semibold text-amber-700 dark:text-byla-yellow">
            {notice}
          </p>
        ) : null}
        {ticketTypes.map((ticketType) => {
          const qty = quantities[ticketType.kind];
          const max = maxFor(ticketType.kind);
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
                  className={stepperClass}
                  disabled={qty <= 0 || pending}
                  onClick={() => setQty(ticketType.kind, (current) => current - 1)}
                  type="button"
                >
                  −
                </button>
                <input
                  aria-label={`Quantidade ${kindLabels[ticketType.kind]}`}
                  className={`${fieldClass} w-14 text-center`}
                  disabled={pending || (max === 0 && qty === 0)}
                  inputMode="numeric"
                  max={max}
                  min={0}
                  onChange={(event) =>
                    setQty(ticketType.kind, parseQty(event.target.value))
                  }
                  type="text"
                  value={String(qty)}
                />
                <button
                  aria-label={`Aumentar ${kindLabels[ticketType.kind]}`}
                  className={stepperClass}
                  disabled={qty >= max || pending}
                  onClick={() => setQty(ticketType.kind, (current) => current + 1)}
                  type="button"
                >
                  +
                </button>
              </div>
            </div>
          );
        })}
        <div className="flex min-h-6 flex-wrap items-center justify-between gap-2">
          <p aria-live="polite" className="text-sm text-byla-muted">
            {limitHint}
          </p>
          {totalQty > 0 ? (
            <button
              className="text-sm font-medium text-byla-blue underline underline-offset-2 disabled:opacity-50"
              disabled={pending}
              onClick={clearSelection}
              type="button"
            >
              Limpar seleção
            </button>
          ) : null}
        </div>
      </fieldset>

      <fieldset className="grid gap-4">
        <legend className="font-semibold text-foreground">Seus dados</legend>
        <label className="grid gap-1 text-sm text-byla-muted">
          Nome
          <input
            autoComplete="name"
            className={fieldClass}
            maxLength={200}
            name="name"
            onChange={(event) => setBuyerField("name", event.target.value)}
            required
            value={buyer.name}
          />
        </label>
        <label className="grid gap-1 text-sm text-byla-muted">
          E-mail
          <input
            autoComplete="email"
            className={fieldClass}
            maxLength={320}
            name="email"
            onChange={(event) => setBuyerField("email", event.target.value)}
            required
            type="email"
            value={buyer.email}
          />
        </label>
        <label className="grid gap-1 text-sm text-byla-muted">
          Telefone (opcional)
          <input
            autoComplete="tel"
            className={fieldClass}
            inputMode="tel"
            maxLength={40}
            name="phone"
            onChange={(event) => setBuyerField("phone", event.target.value)}
            type="tel"
            value={buyer.phone}
          />
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
        <span className="font-medium text-foreground">
          Total{totalQty > 0 ? ` · ${totalQty} ingresso${totalQty === 1 ? "" : "s"}` : ""}
        </span>
        <strong className="text-2xl text-amber-700 dark:text-byla-yellow">
          {moneyFormatter.format(totalCents / 100)}
        </strong>
      </div>
      {error ? (
        <p
          className="rounded-lg border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
          role="alert"
        >
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
