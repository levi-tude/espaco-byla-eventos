"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { submitEventForApproval } from "@/app/organizador/eventos/actions";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import type { Tone } from "@/components/ui/tone";

export type ApprovalBannerProps = {
  eventId: string;
  approvalStatus: string;
  /** Motivo da recusa. */
  approvalNote: string | null;
  salesOpen: boolean;
  /** O que falta para enviar (capa, sessão futura, preços); vazio = pode enviar. */
  missing: string[];
};

function bannerFor({
  approvalStatus,
  approvalNote,
  salesOpen,
}: Pick<ApprovalBannerProps, "approvalStatus" | "approvalNote" | "salesOpen">): {
  tone: Tone;
  text: string;
} {
  switch (approvalStatus) {
    case "em_analise":
      return { tone: "info", text: "Em análise: o Espaço Byla vai conferir e responder em breve." };
    case "recusado": {
      const note = approvalNote?.trim().replace(/[.!?\s]+$/u, "");
      return {
        tone: "danger",
        text: note ? `Recusado: ${note}. Ajuste e envie de novo.` : "Recusado. Ajuste e envie de novo.",
      };
    }
    case "aprovado":
      return salesOpen
        ? { tone: "success", text: "Aprovado e à venda." }
        : { tone: "warning", text: "Aprovado. As vendas estão pausadas." };
    default:
      return {
        tone: "neutral",
        text: "Rascunho: só você vê este evento. Quando estiver pronto, envie para aprovação.",
      };
  }
}

/** Faixa de estado do evento + "Enviar para aprovação" (rascunho ou recusado). */
export function ApprovalBanner(props: ApprovalBannerProps) {
  const { eventId, approvalStatus, missing } = props;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const canSubmit = approvalStatus === "rascunho" || approvalStatus === "recusado";
  const banner = bannerFor(props);

  function submit() {
    if (
      !window.confirm(
        "Enviar para aprovação? Enquanto o Espaço Byla confere, o evento fica só leitura.",
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await submitEventForApproval(eventId);
        if (!result.ok) return setError(result.error);
        router.refresh();
      } catch {
        setError("Não foi possível enviar o evento.");
      }
    });
  }

  return (
    <div className="grid gap-3">
      <Notice live={false} tone={banner.tone}>
        {banner.text}
      </Notice>
      {canSubmit ? (
        <div className="grid gap-3 rounded-xl border border-byla-border bg-byla-surface p-4">
          {missing.length ? (
            <div className="text-base">
              <p className="font-medium text-foreground">Antes de enviar, falta:</p>
              <ul className="mt-1 list-disc pl-5 text-byla-muted">
                {missing.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-base text-byla-muted">
              Tudo pronto. Salve o formulário antes, se mudou alguma coisa.
            </p>
          )}
          <Button
            className="sm:w-auto sm:justify-self-start"
            disabled={missing.length > 0}
            fullWidth
            loading={isPending}
            loadingLabel="Enviando..."
            onClick={submit}
          >
            Enviar para aprovação
          </Button>
          {error ? <Notice tone="danger">{error}</Notice> : null}
        </div>
      ) : null}
    </div>
  );
}
