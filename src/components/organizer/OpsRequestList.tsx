"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { cancelOpsRequest } from "@/app/organizador/eventos/order-actions";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { Tone } from "@/components/ui/tone";

export type OrganizerOpsRequest = {
  id: string;
  kind: "estorno" | "exclusao" | "mudanca";
  orderNumber: string | null;
  /** Só em pedido de mudança: o que o organizador pediu para mudar. */
  what: string | null;
  reason: string;
  status: "pendente" | "atendido" | "recusado" | "cancelado";
  decisionNote: string | null;
  createdLabel: string;
};

const KIND_LABEL: Record<OrganizerOpsRequest["kind"], string> = {
  estorno: "Estorno",
  exclusao: "Exclusão do evento",
  mudanca: "Mudança",
};

function statusBadge(request: OrganizerOpsRequest): { label: string; tone: Tone } {
  switch (request.status) {
    case "pendente":
      return { label: "Em análise", tone: "warning" };
    case "atendido":
      return { label: request.kind === "estorno" ? "Estornado" : "Feito", tone: "success" };
    case "recusado":
      return { label: "Recusado", tone: "danger" };
    default:
      return { label: "Cancelado", tone: "neutral" };
  }
}

function CancelRequestButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function cancel() {
    if (!window.confirm("Cancelar este pedido? A equipe do Espaço Byla não vai mais analisá-lo.")) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await cancelOpsRequest(requestId);
        if (!result.ok) return setError(result.error);
        router.refresh();
      } catch {
        setError("Não foi possível cancelar o pedido.");
      }
    });
  }

  return (
    <div className="grid gap-2">
      <Button
        className="sm:w-auto sm:justify-self-start"
        fullWidth
        loading={isPending}
        loadingLabel="Cancelando..."
        onClick={cancel}
        variant="secondary"
      >
        Cancelar pedido
      </Button>
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </div>
  );
}

/** Pedidos feitos à equipe (estorno, exclusão, mudança) com a situação de cada um. */
export function OpsRequestList({ requests }: { requests: OrganizerOpsRequest[] }) {
  if (requests.length === 0) {
    return <p className="text-base text-byla-muted">Nenhum pedido à equipe.</p>;
  }

  return (
    <ul className="grid gap-3">
      {requests.map((request) => {
        const badge = statusBadge(request);
        return (
          <li className="grid gap-2 rounded-xl border border-byla-border bg-byla-surface p-4" key={request.id}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h3 className="text-base font-semibold text-foreground">{KIND_LABEL[request.kind]}</h3>
              <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
            </div>
            <p className="text-sm text-byla-muted">
              {request.orderNumber ? `Pedido nº ${request.orderNumber} · ` : ""}
              Enviado em {request.createdLabel}
            </p>
            {request.what ? (
              <p className="whitespace-pre-line break-words text-sm text-foreground">{request.what}</p>
            ) : null}
            <p className="whitespace-pre-line break-words text-sm text-foreground">Motivo: {request.reason}</p>
            {request.status === "recusado" && request.decisionNote ? (
              <p className="whitespace-pre-line break-words text-sm text-foreground">
                Resposta da equipe: {request.decisionNote}
              </p>
            ) : null}
            {request.status === "pendente" ? <CancelRequestButton requestId={request.id} /> : null}
          </li>
        );
      })}
    </ul>
  );
}
