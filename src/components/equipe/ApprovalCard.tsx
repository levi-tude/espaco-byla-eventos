"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";

import { decideEventApproval } from "@/app/equipe/aprovacoes/actions";
import { Button } from "@/components/ui/Button";
import { CoverImage } from "@/components/ui/CoverImage";
import { TextAreaField } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";

const NOTE_MIN = 5;
const NOTE_MAX = 500;
const GENERIC_ERROR = "Não foi possível concluir. Tente de novo.";

export type ApprovalPrice = {
  name: string;
  preset: string | null;
  priceCents: number;
  maxUnits: number | null;
};

export type ApprovalSession = {
  id: string;
  /** Já formatado no servidor (fuso do evento). */
  label: string;
  capacity: number;
  inteiraQuota: number | null;
  meiaQuota: number | null;
  /** Só os tipos à venda nesta sessão. */
  prices: ApprovalPrice[];
};

export type ApprovalEvent = {
  id: string;
  name: string;
  venue: string | null;
  description: string;
  coverImageUrl: string | null;
  producerName: string | null;
  /** `null` quando não deu para conferir a conta. */
  organizerActive: boolean | null;
  submittedAt: string | null;
  sessions: ApprovalSession[];
};

export type HalfPriceCheck = "ok" | "diferente" | "sem_meia" | "sem_inteira";

/** A meia-entrada deve custar a metade da inteira. */
export function halfPriceCheck(inteiraCents: number | null, meiaCents: number | null): HalfPriceCheck {
  if (inteiraCents === null) return "sem_inteira";
  if (meiaCents === null) return "sem_meia";
  return meiaCents * 2 === inteiraCents ? "ok" : "diferente";
}

const HALF_PRICE_TEXT: Record<HalfPriceCheck, { text: string; className: string }> = {
  ok: { text: "A meia é metade da inteira.", className: "text-byla-success" },
  diferente: { text: "Confira: a meia não é metade da inteira.", className: "text-byla-warning" },
  sem_meia: { text: "Confira: sem meia-entrada à venda nesta sessão.", className: "text-byla-warning" },
  sem_inteira: { text: "Sem inteira à venda nesta sessão.", className: "text-byla-muted" },
};

const CHECKLIST = [
  "Data e horários (sem choque com a agenda do Espaço)",
  "Lotação",
  "Preços e meia-entrada (metade da inteira)",
  "Descrição e classificação etária",
  "Capa e fotos adequadas",
  "Nome que vai aparecer como “Produção”",
  "Organizador ativo",
];

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function money(cents: number | null): string {
  return cents === null ? "—" : currency.format(cents / 100);
}

function SessionPrices({ session }: { session: ApprovalSession }) {
  const inteira = session.prices.find((price) => price.preset === "inteira") ?? null;
  const meia = session.prices.find((price) => price.preset === "meia") ?? null;
  const others = session.prices.filter((price) => price.preset !== "inteira" && price.preset !== "meia");
  const check = HALF_PRICE_TEXT[halfPriceCheck(inteira?.priceCents ?? null, meia?.priceCents ?? null)];
  const quotas = [
    session.inteiraQuota !== null ? `até ${session.inteiraQuota} inteiras` : null,
    session.meiaQuota !== null ? `até ${session.meiaQuota} meias` : null,
  ].filter(Boolean);

  return (
    <li className="grid gap-2 rounded-xl border border-byla-border p-3">
      <p className="font-semibold">{session.label}</p>
      <p className="text-sm text-byla-muted">
        {session.capacity} lugares{quotas.length ? ` · ${quotas.join(" · ")}` : ""}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-byla-overlay p-2">
          <p className="text-sm text-byla-muted">Inteira</p>
          <p className="text-lg font-semibold tabular-nums">{money(inteira?.priceCents ?? null)}</p>
        </div>
        <div className="rounded-lg bg-byla-overlay p-2">
          <p className="text-sm text-byla-muted">Meia-entrada</p>
          <p className="text-lg font-semibold tabular-nums">{money(meia?.priceCents ?? null)}</p>
        </div>
      </div>
      <p className={`text-sm font-medium ${check.className}`}>{check.text}</p>
      {others.length ? (
        <ul className="grid gap-1 text-base">
          {others.map((price) => (
            <li className="flex flex-wrap items-baseline justify-between gap-x-3" key={price.name}>
              <span>{price.name}</span>
              <span className="text-byla-muted tabular-nums">
                {money(price.priceCents)}
                {price.maxUnits !== null ? ` · até ${price.maxUnits}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function ApprovalCard({ event }: { event: ApprovalEvent }) {
  return (
    <article className="grid gap-4 rounded-2xl border border-byla-border bg-byla-surface p-4 sm:p-5">
      <div className="grid gap-4 sm:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-xl">
          <CoverImage markSize={48} src={event.coverImageUrl} />
        </div>
        <div className="grid min-w-0 content-start gap-1">
          <h3 className="break-words text-xl font-semibold">{event.name}</h3>
          {event.venue ? <p className="break-words text-base">{event.venue}</p> : null}
          <p className="break-words text-base">
            Produção: <strong>{event.producerName ?? "nome não encontrado"}</strong>
          </p>
          {event.submittedAt ? (
            <p className="text-sm text-byla-muted">Enviado para aprovação em {event.submittedAt}</p>
          ) : null}
          <Link
            className="inline-flex min-h-11 items-center gap-1.5 font-medium text-byla-link"
            href={`/equipe/eventos/${event.id}`}
          >
            Abrir evento (fotos e detalhes)
            <ExternalLink aria-hidden className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {event.organizerActive === false ? (
        <Notice live={false} tone="warning">
          A conta deste organizador não está ativa. O evento só pode ser aprovado com a conta ativa.
        </Notice>
      ) : null}

      <section className="grid gap-2">
        <h4 className="text-base font-semibold">
          {event.sessions.length === 1 ? "Sessão" : `${event.sessions.length} sessões`}
        </h4>
        {event.sessions.length ? (
          <ul className="grid gap-2 sm:grid-cols-2">
            {event.sessions.map((session) => (
              <SessionPrices key={session.id} session={session} />
            ))}
          </ul>
        ) : (
          <p className="text-base text-byla-muted">Nenhuma sessão ativa.</p>
        )}
      </section>

      <section className="grid gap-1">
        <h4 className="text-base font-semibold">Descrição</h4>
        <p className="whitespace-pre-line break-words text-base">{event.description || "Sem descrição."}</p>
      </section>

      <fieldset className="grid gap-1 rounded-xl border border-byla-border p-3">
        <legend className="px-1 text-base font-semibold">Lista de conferência</legend>
        {CHECKLIST.map((item) => (
          <label className="flex min-h-11 items-center gap-3 text-base" key={item}>
            <input className="h-5 w-5 shrink-0 accent-byla-action" type="checkbox" />
            {item}
          </label>
        ))}
        <p className="text-sm text-byla-muted">As caixas são só para ajudar na conferência; nada é gravado.</p>
      </fieldset>

      <ApprovalActions eventId={event.id} eventName={event.name} />
    </article>
  );
}

function ApprovalActions({ eventId, eventName }: { eventId: string; eventName: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"" | "publicar" | "recusar">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [isPending, startTransition] = useTransition();

  function decide(decision: "aprovar" | "recusar", publish: boolean, doneText: string) {
    setError("");
    startTransition(async () => {
      const result = await decideEventApproval(eventId, { decision, publish, note }).catch(() => null);
      if (!result?.ok) {
        setError(result?.error ?? GENERIC_ERROR);
        return;
      }
      setMode("");
      setDone(doneText);
      router.refresh();
    });
  }

  function refuse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending || note.trim().length < NOTE_MIN) return;
    decide("recusar", false, "Evento recusado. O organizador recebe o motivo por e-mail.");
  }

  if (done) return <Notice tone="success">{done}</Notice>;

  return (
    <div className="grid gap-3">
      {mode === "" ? (
        <div className="grid gap-2 sm:flex sm:flex-wrap">
          <Button disabled={isPending} onClick={() => setMode("publicar")}>
            Aprovar e publicar
          </Button>
          <Button
            disabled={isPending}
            loading={isPending}
            loadingLabel="Aprovando..."
            onClick={() =>
              decide("aprovar", false, "Evento aprovado sem publicar. O organizador abre as vendas quando quiser.")
            }
            variant="secondary"
          >
            Aprovar sem publicar
          </Button>
          <Button disabled={isPending} onClick={() => setMode("recusar")} variant="danger">
            Recusar
          </Button>
        </div>
      ) : null}

      {mode === "publicar" ? (
        <div className="grid gap-2 rounded-xl border border-byla-border p-3">
          <p className="text-base">
            <strong>{eventName}</strong> entra no site e as vendas abrem agora.
          </p>
          <div className="grid gap-2 sm:flex sm:flex-wrap">
            <Button
              loading={isPending}
              loadingLabel="Publicando..."
              onClick={() => decide("aprovar", true, "Evento aprovado e publicado. As vendas estão abertas.")}
            >
              Confirmar e publicar
            </Button>
            <Button disabled={isPending} onClick={() => setMode("")} variant="ghost">
              Voltar
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "recusar" ? (
        <form className="grid gap-2 rounded-xl border border-byla-border p-3" onSubmit={refuse}>
          <TextAreaField
            disabled={isPending}
            hint="De 5 a 500 caracteres. O organizador vê este texto."
            label="Motivo da recusa"
            maxLength={NOTE_MAX}
            onChange={(change) => setNote(change.target.value)}
            required
            value={note}
          />
          <div className="grid gap-2 sm:flex sm:flex-wrap">
            <Button
              disabled={note.trim().length < NOTE_MIN}
              loading={isPending}
              loadingLabel="Recusando..."
              type="submit"
              variant="danger"
            >
              Confirmar recusa
            </Button>
            <Button disabled={isPending} onClick={() => setMode("")} variant="ghost">
              Voltar
            </Button>
          </div>
        </form>
      ) : null}

      {error ? <Notice tone="danger">{error}</Notice> : null}
    </div>
  );
}
