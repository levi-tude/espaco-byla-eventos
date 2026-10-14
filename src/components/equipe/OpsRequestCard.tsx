"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";

import { declineOpsRequest, finishEventChange, finishEventDeletion } from "@/app/equipe/aprovacoes/actions";
import { Button } from "@/components/ui/Button";
import { TextAreaField } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import type { ActionResult } from "@/lib/action-result";

const NOTE_MIN = 5;
const NOTE_MAX = 500;
const GENERIC_ERROR = "Não foi possível concluir. Tente de novo.";

export type OpsRequestView = {
  id: string;
  kind: "mudanca" | "exclusao";
  eventId: string;
  eventName: string;
  producerName: string | null;
  /** O que o organizador quer mudar (só em mudança). */
  what: string | null;
  reason: string;
  /** Já formatado no servidor (fuso do evento). */
  createdAt: string;
  /** Só em exclusão. `null` = não deu para conferir (o banco confere ao concluir). */
  paidOrders?: number;
  activeSessions?: number | null;
  /** Só em exclusão: o link abre esta sessão, onde ficam "Cancelar sessão" e "Estornar todos". */
  firstActiveSessionId?: string | null;
};

export type RefundRequestView = {
  id: string;
  buyerName: string | null;
  reason: string;
  createdAt: string;
};

/** Roda a ação, mostra o erro e atualiza a tela no sucesso. */
function useRequestAction() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [isPending, startTransition] = useTransition();

  function run(action: () => Promise<ActionResult>, doneText: string, onDone?: () => void) {
    setError("");
    startTransition(async () => {
      const result = await action().catch(() => null);
      if (!result?.ok) {
        setError(result?.error ?? GENERIC_ERROR);
        return;
      }
      onDone?.();
      setDone(doneText);
      router.refresh();
    });
  }

  return { error, done, isPending, run };
}

function DeclineForm({
  requestId,
  label,
  onCancel,
  onDeclined,
  isPending,
  run,
}: {
  requestId: string;
  label: string;
  onCancel: () => void;
  onDeclined: () => void;
  isPending: boolean;
  run: ReturnType<typeof useRequestAction>["run"];
}) {
  const [note, setNote] = useState("");
  const ready = note.trim().length >= NOTE_MIN;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || isPending) return;
    run(
      () => declineOpsRequest(requestId, note),
      "Pedido recusado. O organizador recebe o motivo por e-mail.",
      onDeclined,
    );
  }

  return (
    <form className="grid gap-2 rounded-xl border border-byla-border p-3" onSubmit={submit}>
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
        <Button disabled={!ready} loading={isPending} loadingLabel="Recusando..." type="submit" variant="danger">
          {label}
        </Button>
        <Button disabled={isPending} onClick={onCancel} variant="ghost">
          Voltar
        </Button>
      </div>
    </form>
  );
}

function paidOrdersLabel(count: number): string {
  return count === 1 ? "1 pedido pago" : `${count} pedidos pagos`;
}

export function OpsRequestCard({ request }: { request: OpsRequestView }) {
  const { error, done, isPending, run } = useRequestAction();
  const [declining, setDeclining] = useState(false);
  const deletion = request.kind === "exclusao";
  const activeSessions = request.activeSessions ?? null;
  const sessionsLeft = activeSessions !== null && activeSessions > 0;
  const eventHref = `/equipe/eventos/${request.eventId}`;
  const panelHref = request.firstActiveSessionId
    ? `${eventHref}?sessao=${request.firstActiveSessionId}#vendas`
    : `${eventHref}#vendas`;

  return (
    <article className="grid gap-3 rounded-2xl border border-byla-border bg-byla-surface p-4">
      <div className="grid gap-1">
        <h3 className="break-words text-lg font-semibold">{request.eventName}</h3>
        <p className="break-words text-sm text-byla-muted">
          Organizador: {request.producerName ?? "—"} · Pedido em {request.createdAt}
        </p>
      </div>

      <dl className="grid gap-2 text-base">
        {request.what ? (
          <div>
            <dt className="text-sm text-byla-muted">O que mudar</dt>
            <dd className="whitespace-pre-line break-words">{request.what}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-sm text-byla-muted">Motivo</dt>
          <dd className="whitespace-pre-line break-words">{request.reason}</dd>
        </div>
        {deletion ? (
          <div>
            <dt className="text-sm text-byla-muted">Vendas</dt>
            <dd>
              {paidOrdersLabel(request.paidOrders ?? 0)}
              {activeSessions === null
                ? ""
                : activeSessions === 0
                  ? " · todas as sessões canceladas"
                  : activeSessions === 1
                    ? " · 1 sessão ativa"
                    : ` · ${activeSessions} sessões ativas`}
            </dd>
          </div>
        ) : null}
      </dl>

      {deletion ? (
        <p className="text-base">
          Para aceitar, cancele cada sessão no painel do evento (“Cancelar sessão”) e devolva o dinheiro com
          “Estornar todos”. Depois volte aqui e conclua a exclusão.
        </p>
      ) : (
        <p className="text-base">
          Faça a mudança pelo painel do evento (editor de sessões, troca de horário com aviso aos compradores) e
          depois marque como feito.
        </p>
      )}

      <Link
        className="inline-flex min-h-11 items-center gap-1.5 font-medium text-byla-link"
        href={deletion ? panelHref : eventHref}
      >
        {deletion ? "Abrir painel de sessões" : "Abrir evento"}
        <ExternalLink aria-hidden className="h-4 w-4" />
      </Link>

      {done ? (
        <Notice tone="success">{done}</Notice>
      ) : declining ? (
        <DeclineForm
          isPending={isPending}
          label="Confirmar recusa"
          onCancel={() => setDeclining(false)}
          onDeclined={() => setDeclining(false)}
          requestId={request.id}
          run={run}
        />
      ) : (
        <div className="grid gap-2 sm:flex sm:flex-wrap">
          {deletion ? (
            <Button
              disabled={isPending || sessionsLeft}
              loading={isPending}
              loadingLabel="Concluindo..."
              onClick={() =>
                run(() => finishEventDeletion(request.id), "Exclusão concluída. O evento saiu do site e o organizador foi avisado.")
              }
            >
              Concluir exclusão
            </Button>
          ) : (
            <Button
              disabled={isPending}
              loading={isPending}
              loadingLabel="Salvando..."
              onClick={() => run(() => finishEventChange(request.id), "Pedido marcado como feito. O organizador foi avisado.")}
            >
              Marcar como feito
            </Button>
          )}
          <Button disabled={isPending} onClick={() => setDeclining(true)} variant="secondary">
            Recusar
          </Button>
        </div>
      )}
      {deletion && sessionsLeft && !done ? (
        <p className="text-sm text-byla-muted">“Concluir exclusão” libera quando todas as sessões estiverem canceladas.</p>
      ) : null}

      {error ? <Notice tone="danger">{error}</Notice> : null}
    </article>
  );
}

function RefundRequestItem({ request }: { request: RefundRequestView }) {
  const { error, done, isPending, run } = useRequestAction();
  const [declining, setDeclining] = useState(false);

  return (
    <li className="grid gap-2 border-t border-byla-border pt-3 first:border-t-0 first:pt-0">
      <p className="break-words text-base">
        <strong>{request.buyerName ?? "Pedido"}</strong> · pedido em {request.createdAt}
      </p>
      <p className="whitespace-pre-line break-words text-base">Motivo: {request.reason}</p>
      {done ? (
        <Notice tone="success">{done}</Notice>
      ) : declining ? (
        <DeclineForm
          isPending={isPending}
          label="Recusar pedido de estorno"
          onCancel={() => setDeclining(false)}
          onDeclined={() => setDeclining(false)}
          requestId={request.id}
          run={run}
        />
      ) : (
        <div>
          <Button disabled={isPending} onClick={() => setDeclining(true)} variant="secondary">
            Recusar pedido de estorno
          </Button>
        </div>
      )}
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </li>
  );
}

/** Faixa da página do evento (equipe) com os pedidos de estorno pendentes do organizador. */
export function OrganizerRefundRequests({ requests }: { requests: RefundRequestView[] }) {
  if (!requests.length) return null;
  const title =
    requests.length === 1
      ? "1 pedido de estorno solicitado pelo organizador"
      : `${requests.length} pedidos de estorno solicitados pelo organizador`;

  return (
    <Notice live={false} title={title} tone="warning">
      <p className="text-base">
        Para estornar, use “Estornar pedido” na lista de participantes. Se não for o caso, recuse com o motivo.
      </p>
      <ul className="mt-3 grid gap-3">
        {requests.map((request) => (
          <RefundRequestItem key={request.id} request={request} />
        ))}
      </ul>
    </Notice>
  );
}
