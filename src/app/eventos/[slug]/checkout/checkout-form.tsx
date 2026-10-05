"use client";

import { ArrowRight, CalendarDays, Minus, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { StickyActionBar } from "@/components/ui/StickyActionBar";

import {
  type BrowserCart,
  browserStorage,
  readCart,
  writeCart,
} from "@/lib/cart/browser-cart";
import type { CheckoutResume } from "@/lib/cart/resume";
import {
  type CategoryRemaining,
  fitSelection,
  MAX_PEOPLE_PER_ORDER,
  maxSelectableUnits,
  remainingNotice,
  type SelectableType,
  typeRemainingNotice,
  typeUnitsLeft,
} from "@/lib/domain/availability";
import {
  effectiveFeeTerms,
  formatMoney,
  orderFeeBreakdown,
  SERVICE_FEE_HELP,
  SERVICE_FEE_LABEL,
  serviceFeeForPrice,
  type ServiceFeePolicy,
} from "@/lib/domain/service-fee";
import {
  ticketKindLabels,
  unitContentsLabel,
} from "@/lib/domain/ticket-types";
import { PRIVACY_REQUIRED_MESSAGE } from "@/lib/legal/privacy";
import { useMounted } from "@/lib/use-mounted";
import type { Enums } from "@/types/database";

import { findPendingOrder, startCheckout } from "./actions";
import { PendingOrderBanner } from "./pending-order-banner";

export type CheckoutTicketType = {
  id: string;
  name: string;
  kind: Enums<"ticket_kind">;
  preset: string | null;
  priceCents: number;
  peoplePerUnit: number;
  /** Unidades restantes do limite próprio do tipo; `null` = sem limite. */
  remainingUnits: number | null;
};

/** Sessão da compra, sempre à vista do comprador. */
export type CheckoutSession = {
  id: string;
  /** "Nome · sáb, 10/10 · 19h00 – 21h30". */
  label: string;
  /** Evento com mais de uma sessão: mostra "Trocar sessão". */
  canChange: boolean;
};

type Quantities = Record<string, number>;
type Buyer = Pick<BrowserCart, "name" | "email" | "phone">;

type CheckoutFormProps = {
  slug: string;
  /** `null` só quando não foi possível consultar as sessões (o banco usa a sessão única). */
  session: CheckoutSession | null;
  ticketTypes: CheckoutTicketType[];
  /** Lugares livres agora (descontando reservas); `null` se não foi possível consultar. */
  remaining: number | null;
  /** Pessoas restantes nas cotas de inteiras e meias (`null` = sem cota). */
  categoryRemaining: CategoryRemaining;
  /** Pedido anterior (`?retomar=`) que preenche a escolha e os dados. */
  resume: CheckoutResume | null;
  /** Taxa vigente, só para exibir; o banco recalcula e confere os termos enviados. */
  feePolicy: ServiceFeePolicy;
};

const EMPTY_BUYER: Buyer = { name: "", email: "", phone: "" };

function parseQty(raw: string): number {
  const digits = raw.replace(/\D/g, "").slice(0, 3);
  return digits ? Number(digits) : 0;
}

function qtyOf(quantities: Quantities, id: string): number {
  return quantities[id] ?? 0;
}

function sameSelection(a: Quantities, b: Quantities, ids: readonly string[]) {
  return ids.every((id) => qtyOf(a, id) === qtyOf(b, id));
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
  session,
  ticketTypes,
  remaining: initialRemaining,
  categoryRemaining: initialCategoryRemaining,
  resume,
  feePolicy,
  restoreCart,
}: CheckoutFormProps & { restoreCart: boolean }) {
  const ids = ticketTypes.map(({ id }) => id);
  const [remaining, setRemaining] = useState(initialRemaining);
  const [categoryRemaining, setCategoryRemaining] = useState(initialCategoryRemaining);
  const [typeRemaining, setTypeRemaining] = useState<Record<string, number | null>>(
    () => Object.fromEntries(ticketTypes.map((type) => [type.id, type.remainingUnits])),
  );
  const capacityLeft = remaining ?? MAX_PEOPLE_PER_ORDER;
  const selectable = (limits: Record<string, number | null>): SelectableType[] =>
    ticketTypes.map((type) => ({
      id: type.id,
      kind: type.kind,
      peoplePerUnit: type.peoplePerUnit,
      remainingUnits: limits[type.id] ?? null,
    }));

  const [initial] = useState(() => {
    // Carrinho de antes dos tipos configuráveis: inteira/meia viram os tipos prontos.
    const legacyKinds = {
      inteira: ticketTypes.find((type) => type.preset === "inteira")?.id,
      meia: ticketTypes.find((type) => type.preset === "meia")?.id,
    };
    const savedCart = restoreCart
      ? readCart(browserStorage(), slug, Date.now(), legacyKinds)
      : null;
    // Carrinho de outra sessão: aproveita só os dados do comprador.
    const otherSession = Boolean(
      savedCart?.sessionId && session && savedCart.sessionId !== session.id,
    );
    const cart =
      savedCart && otherSession
        ? { ...savedCart, quantities: {}, pendingOrderToken: undefined, droppedItems: undefined }
        : savedCart;
    const cartToken = cart?.pendingOrderToken ?? null;
    // Um pedido mais novo feito neste navegador vale mais que o link de retomada.
    const preferCart = Boolean(cart && cartToken && cartToken !== resume?.publicToken);
    const source = resume && !preferCart ? resume : null;
    const requested = source?.quantities ?? cart?.quantities ?? {};
    const offered: Quantities = Object.fromEntries(
      ids.map((id) => [id, qtyOf(requested, id)]),
    );
    const droppedFromRequest = Object.entries(requested).some(
      ([id, qty]) => qty > 0 && !ids.includes(id),
    );
    // Pedido ainda reservado: os lugares dele não entram em "restantes"; mostra como está.
    const quantities = source?.awaitingUntil
      ? offered
      : fitSelection(offered, selectable(typeRemaining), capacityLeft, categoryRemaining);
    const pendingToken = resume?.awaitingUntil
      ? resume.publicToken
      : cartToken && cartToken !== resume?.publicToken
        ? cartToken
        : null;
    const fromCart = source === null && cart !== null;
    return {
      quantities,
      buyer: source
        ? source.buyer
        : cart
          ? { name: cart.name, email: cart.email, phone: cart.phone }
          : EMPTY_BUYER,
      adjusted:
        (source !== null &&
          !source.awaitingUntil &&
          (source.droppedItems ||
            droppedFromRequest ||
            !sameSelection(quantities, source.quantities, ids))) ||
        (fromCart && (Boolean(cart.droppedItems) || droppedFromRequest)),
      pendingToken,
      pendingUntil: pendingToken && resume?.awaitingUntil ? resume.awaitingUntil : null,
      // Seleção guardada antes das sessões: os preços agora são os da sessão escolhida.
      pricesUpdated:
        fromCart &&
        Boolean(session?.canChange) &&
        !cart.sessionId &&
        Object.values(quantities).some((qty) => qty > 0),
    };
  });
  const [quantities, setQuantities] = useState<Quantities>(initial.quantities);
  const [buyer, setBuyer] = useState<Buyer>(initial.buyer);
  const [pendingToken, setPendingToken] = useState(initial.pendingToken);
  const [pendingUntil, setPendingUntil] = useState(initial.pendingUntil);
  const [checkingPending, setCheckingPending] = useState(
    restoreCart && initial.pendingToken !== null && initial.pendingUntil === null,
  );
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const awaitingPayment = pendingToken !== null && pendingUntil !== null;
  const { ticketsCents, feeCents, totalCents } = orderFeeBreakdown(
    ticketTypes.map((type) => ({
      unitPriceCents: type.priceCents,
      quantity: qtyOf(quantities, type.id),
    })),
    feePolicy,
  );
  const feeShown = ticketTypes.some((type) => serviceFeeForPrice(type.priceCents, feePolicy) > 0);
  const peopleIn = (current: Quantities, kind?: string) =>
    ticketTypes.reduce(
      (sum, type) =>
        kind === undefined || type.kind === kind
          ? sum + type.peoplePerUnit * qtyOf(current, type.id)
          : sum,
      0,
    );
  const totalPeople = peopleIn(quantities);
  const selectionLimit = Math.min(capacityLeft, MAX_PEOPLE_PER_ORDER);
  const notice = remaining === null ? null : remainingNotice(remaining);
  const limitHint =
    totalPeople > 0 && totalPeople >= selectionLimit
      ? selectionLimit < MAX_PEOPLE_PER_ORDER
        ? "Você escolheu todos os lugares disponíveis no momento."
        : `Máximo de ${MAX_PEOPLE_PER_ORDER} pessoas por compra.`
      : "";

  useEffect(() => {
    if (!restoreCart) return;
    writeCart(browserStorage(), slug, {
      quantities,
      ...buyer,
      ...(pendingToken ? { pendingOrderToken: pendingToken } : {}),
      ...(session ? { sessionId: session.id } : {}),
    });
  }, [restoreCart, slug, quantities, buyer, pendingToken, session]);

  // Voltar da tela de pagamento não cria outro pedido: o anterior é oferecido primeiro.
  useEffect(() => {
    if (!checkingPending || !pendingToken) return;
    let active = true;
    findPendingOrder(slug, pendingToken)
      .then((found) => {
        if (!active) return;
        if (found.state === "awaiting_payment") setPendingUntil(found.expiresAt);
        else setPendingToken(null);
      })
      .catch(() => {
        // Sem resposta: segue sem o aviso; o pedido anterior vence sozinho.
      })
      .finally(() => {
        if (active) setCheckingPending(false);
      });
    return () => {
      active = false;
    };
  }, [checkingPending, pendingToken, slug]);

  // Os lugares do pedido cancelado voltaram: recarrega a disponibilidade já preenchido.
  function selectionChanged(checkoutPath: string) {
    setPendingUntil(null);
    setPendingToken(null);
    router.replace(checkoutPath);
  }

  function maxFor(type: CheckoutTicketType, current: Quantities = quantities) {
    const own = type.peoplePerUnit * qtyOf(current, type.id);
    return maxSelectableUnits({
      remaining: capacityLeft,
      peopleSelectedElsewhere: peopleIn(current) - own,
      peoplePerUnit: type.peoplePerUnit,
      typeRemainingUnits: typeRemaining[type.id] ?? null,
      categoryRemaining:
        type.kind === "inteira" || type.kind === "meia"
          ? categoryRemaining[type.kind]
          : null,
      categoryPeopleSelectedElsewhere: peopleIn(current, type.kind) - own,
    });
  }

  function setQty(
    type: CheckoutTicketType,
    next: number | ((qty: number) => number),
  ) {
    setQuantities((current) => {
      const currentQty = qtyOf(current, type.id);
      const wanted = typeof next === "function" ? next(currentQty) : next;
      const safe = Math.max(0, Math.min(maxFor(type, current), Math.trunc(wanted) || 0));
      return currentQty === safe ? current : { ...current, [type.id]: safe };
    });
  }

  function setBuyerField(field: keyof Buyer, value: string) {
    setBuyer((current) => ({ ...current, [field]: value }));
  }

  function clearSelection() {
    setQuantities({});
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (awaitingPayment || checkingPending) return;
    setError("");
    const data = new FormData(event.currentTarget);

    startTransition(async () => {
      try {
        const result = await startCheckout({
          slug,
          ...(session ? { sessionId: session.id } : {}),
          items: ticketTypes
            .filter((type) => qtyOf(quantities, type.id) > 0)
            .map((type) => ({ ticketTypeId: type.id, qty: qtyOf(quantities, type.id) })),
          buyer,
          acceptedPrivacy: data.get("privacy") === "on",
          expectedFee: effectiveFeeTerms(feePolicy),
        });
        if ("error" in result) {
          setError(result.error);
          // A seleção fica no estado e no carrinho; só a taxa e os preços são recarregados.
          if (result.feeChanged) router.refresh();
          const updated = result.availability;
          if (updated) {
            const limits = { ...typeRemaining, ...updated.typeRemaining };
            setRemaining(updated.remaining);
            setCategoryRemaining(updated.categoryRemaining);
            setTypeRemaining(limits);
            setQuantities((current) =>
              fitSelection(
                current,
                selectable(limits),
                updated.remaining,
                updated.categoryRemaining,
              ),
            );
          }
          return;
        }
        // Gravado já, antes de sair da página: ao voltar, o pedido é reconhecido.
        writeCart(browserStorage(), slug, {
          quantities,
          ...buyer,
          pendingOrderToken: result.publicToken,
          ...(session ? { sessionId: session.id } : {}),
        });
        setPendingToken(result.publicToken);
        router.push(`/pedidos/${result.publicToken}`);
      } catch {
        setError("Não foi possível iniciar o pagamento. Tente novamente.");
      }
    });
  }

  const submitDisabled = ticketsCents === 0 || awaitingPayment || checkingPending;
  const selected = ticketTypes.filter((type) => qtyOf(quantities, type.id) > 0);
  const totalLabel = `Total${
    totalPeople > 0 ? ` · ${totalPeople} ingresso${totalPeople === 1 ? "" : "s"}` : ""
  }`;
  const errorNotice = error ? <Notice tone="danger">{error}</Notice> : null;
  const awaitingHint = awaitingPayment ? (
    <p className="text-center text-sm text-byla-muted">
      Para mudar ingressos ou dados, toque em “Alterar seleção” acima.
    </p>
  ) : null;

  return (
    <form
      className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-10"
      onSubmit={submit}
    >
      <div className="grid min-w-0 gap-8">
        {session ? (
          <section
            aria-label="Sessão escolhida"
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border border-byla-link/50 bg-byla-surface p-4"
          >
            <div className="min-w-0">
              <p className="text-sm text-byla-muted">Você está comprando para</p>
              <p className="break-words text-lg font-semibold text-foreground">
                <CalendarDays
                  aria-hidden
                  className="mr-1.5 inline h-5 w-5 align-[-0.2em] text-byla-accent-text"
                />
                {session.label}
              </p>
            </div>
            {session.canChange && !awaitingPayment ? (
              <Link
                className="inline-flex min-h-11 items-center rounded-lg px-1 text-base font-medium text-byla-link underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue"
                href={`/eventos/${slug}?sessao=${session.id}#sessoes`}
              >
                Trocar sessão
              </Link>
            ) : null}
          </section>
        ) : null}
        {initial.pricesUpdated ? (
          <Notice tone="info">Os preços foram atualizados para esta sessão.</Notice>
        ) : null}
        {pendingToken && pendingUntil ? (
          <PendingOrderBanner
            expiresAt={pendingUntil}
            onChanged={selectionChanged}
            publicToken={pendingToken}
          />
        ) : null}
        {initial.adjusted ? (
          <Notice tone="warning">
            Alguns itens não estão mais disponíveis. Ajustamos sua seleção.
          </Notice>
        ) : null}

        <fieldset className="grid gap-3" disabled={awaitingPayment}>
          <legend className="mb-1 text-xl font-semibold text-foreground">
            Escolha seus ingressos
          </legend>
          {notice ? (
            <p className="-mt-2 text-base font-semibold text-byla-accent-text">{notice}</p>
          ) : null}
          <ul className="divide-y divide-byla-border rounded-2xl border border-byla-border bg-byla-surface">
            {ticketTypes.map((type) => {
              const qty = qtyOf(quantities, type.id);
              const max = maxFor(type);
              const typeNotice = typeRemainingNotice(
                typeUnitsLeft(
                  { ...type, remainingUnits: typeRemaining[type.id] ?? null },
                  categoryRemaining,
                ),
              );
              const showContents =
                type.peoplePerUnit > 1 || type.name !== ticketKindLabels[type.kind];
              const typeFee = serviceFeeForPrice(type.priceCents, feePolicy);
              return (
                <li className="flex items-center justify-between gap-3 p-4" key={type.id}>
                  <div className="min-w-0">
                    <p className="break-words text-base font-semibold text-foreground">
                      {type.name}
                    </p>
                    <p className="text-base text-byla-muted">
                      {formatMoney(type.priceCents)}
                      {typeFee > 0 ? (
                        <>
                          {" "}
                          <span className="whitespace-nowrap">+ {formatMoney(typeFee)} de taxa</span>
                        </>
                      ) : null}
                    </p>
                    {showContents ? (
                      <p className="text-sm text-byla-muted">
                        {unitContentsLabel(type.peoplePerUnit, type.kind)}
                      </p>
                    ) : null}
                    {typeNotice ? (
                      <p className="mt-0.5 text-sm font-semibold text-byla-accent-text">
                        {typeNotice}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      aria-label={`Diminuir ${type.name}`}
                      className={stepperClass}
                      disabled={qty <= 0 || pending}
                      onClick={() => setQty(type, (current) => current - 1)}
                      type="button"
                    >
                      <Minus aria-hidden className="h-5 w-5" />
                    </button>
                    <input
                      aria-label={`Quantidade ${type.name}`}
                      className={qtyInputClass}
                      disabled={pending || (max === 0 && qty === 0)}
                      inputMode="numeric"
                      max={max}
                      min={0}
                      onChange={(event) => setQty(type, parseQty(event.target.value))}
                      type="text"
                      value={String(qty)}
                    />
                    <button
                      aria-label={`Aumentar ${type.name}`}
                      className={stepperClass}
                      disabled={qty >= max || pending}
                      onClick={() => setQty(type, (current) => current + 1)}
                      type="button"
                    >
                      <Plus aria-hidden className="h-5 w-5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {feeShown ? (
            <p className="text-sm text-byla-muted lg:hidden">
              {SERVICE_FEE_LABEL}: {SERVICE_FEE_HELP}
            </p>
          ) : null}
          <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
            <p aria-live="polite" className="text-sm text-byla-muted">
              {limitHint}
            </p>
            {totalPeople > 0 ? (
              <button
                className="inline-flex min-h-11 items-center rounded-lg px-1 text-base font-medium text-byla-link underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue disabled:opacity-50"
                disabled={pending}
                onClick={clearSelection}
                type="button"
              >
                Limpar seleção
              </button>
            ) : null}
          </div>
        </fieldset>

        <fieldset className="grid gap-4" disabled={awaitingPayment}>
          <legend className="mb-1 text-xl font-semibold text-foreground">Seus dados</legend>
          <p className="-mt-2 text-sm text-byla-muted">
            Os ingressos chegam no e-mail informado.
          </p>
          <Field
            autoComplete="name"
            label="Nome"
            maxLength={200}
            name="name"
            onChange={(event) => setBuyerField("name", event.target.value)}
            required
            value={buyer.name}
          />
          <Field
            autoCapitalize="none"
            autoComplete="email"
            inputMode="email"
            label="E-mail"
            maxLength={320}
            name="email"
            onChange={(event) => setBuyerField("email", event.target.value)}
            required
            spellCheck={false}
            type="email"
            value={buyer.email}
          />
          <Field
            autoComplete="tel"
            inputMode="tel"
            label="Telefone (opcional)"
            maxLength={40}
            name="phone"
            onChange={(event) => setBuyerField("phone", event.target.value)}
            type="tel"
            value={buyer.phone}
          />
          <Checkbox
            name="privacy"
            onChange={(event) => event.currentTarget.setCustomValidity("")}
            onInvalid={(event) =>
              event.currentTarget.setCustomValidity(PRIVACY_REQUIRED_MESSAGE)
            }
            required
          >
            Li e aceito a{" "}
            <Link
              className="font-medium text-byla-link underline underline-offset-2"
              href="/privacidade"
              rel="noopener"
              target="_blank"
            >
              Política de Privacidade
            </Link>
            .
          </Checkbox>
        </fieldset>

        <div className="grid gap-3 lg:hidden">
          {errorNotice}
          {awaitingHint}
        </div>
      </div>

      <aside
        aria-label="Resumo do pedido"
        className="hidden rounded-2xl border border-byla-border bg-byla-surface p-5 lg:sticky lg:top-6 lg:grid lg:gap-4"
      >
        <h2 className="text-lg font-semibold text-foreground">Resumo do pedido</h2>
        {session ? (
          <p className="-mt-2 text-base font-medium text-foreground">{session.label}</p>
        ) : null}
        {selected.length ? (
          <ul className="grid gap-2 text-base">
            {selected.map((type) => (
              <li className="flex justify-between gap-3" key={type.id}>
                <span className="min-w-0 break-words text-foreground">
                  {qtyOf(quantities, type.id)}× {type.name}
                </span>
                <span className="shrink-0 tabular-nums text-byla-muted">
                  {formatMoney(type.priceCents * qtyOf(quantities, type.id))}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-base text-byla-muted">Escolha pelo menos um ingresso.</p>
        )}
        {feeCents > 0 ? (
          <div className="grid gap-2 border-t border-byla-border pt-4 text-base">
            <dl className="grid gap-2">
              <div className="flex justify-between gap-3">
                <dt className="text-foreground">Ingressos</dt>
                <dd className="shrink-0 tabular-nums text-byla-muted">{formatMoney(ticketsCents)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-foreground">{SERVICE_FEE_LABEL}</dt>
                <dd className="shrink-0 tabular-nums text-byla-muted">{formatMoney(feeCents)}</dd>
              </div>
            </dl>
            <p className="text-sm text-byla-muted">{SERVICE_FEE_HELP}</p>
          </div>
        ) : null}
        <div className="flex items-baseline justify-between gap-3 border-t border-byla-border pt-4">
          <span className="font-medium text-foreground">{totalLabel}</span>
          <strong className="text-2xl tabular-nums text-byla-accent-text">
            {formatMoney(totalCents)}
          </strong>
        </div>
        {errorNotice}
        <Button
          disabled={submitDisabled}
          fullWidth
          loading={pending || checkingPending}
          loadingLabel={pending ? "Reservando ingressos…" : "Conferindo pedido anterior…"}
          size="lg"
          type="submit"
        >
          Continuar para o pagamento
        </Button>
        {awaitingHint}
      </aside>

      <StickyActionBar hideFrom="lg">
        <div className="min-w-0 shrink">
          {session?.canChange ? (
            <p className="max-w-[11rem] truncate text-sm font-medium text-foreground">
              {session.label}
            </p>
          ) : null}
          <p className="text-sm text-byla-muted">{totalLabel}</p>
          <p className="text-xl font-bold tabular-nums text-byla-accent-text">
            {formatMoney(totalCents)}
          </p>
          {feeCents > 0 ? (
            <p className="text-xs text-byla-muted">
              inclui {formatMoney(feeCents)} de taxa de serviço
            </p>
          ) : null}
        </div>
        <Button
          className="flex-1"
          disabled={submitDisabled}
          loading={pending || checkingPending}
          loadingLabel={pending ? "Reservando…" : "Conferindo…"}
          size="lg"
          type="submit"
        >
          Continuar
          <ArrowRight aria-hidden className="h-5 w-5" />
        </Button>
      </StickyActionBar>
    </form>
  );
}

const qtyInputClass =
  "h-11 w-12 rounded-lg border border-byla-border bg-byla-input px-1 text-center text-base font-semibold text-foreground transition focus:border-byla-blue focus:outline-none focus:ring-2 focus:ring-byla-ring disabled:opacity-60";
const stepperClass =
  "inline-flex h-11 w-11 items-center justify-center rounded-lg border border-byla-border bg-byla-input text-foreground transition hover:border-byla-link/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue disabled:cursor-not-allowed disabled:opacity-40";

