"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";

import { decidePixChange, loadPixChangeDetails } from "@/app/equipe/organizadores/actions";
import { FinanceDialog } from "@/components/equipe/FinanceDialog";
import { Button } from "@/components/ui/Button";
import { TextAreaField } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { formatWaitUntil } from "@/lib/organizer/finance";
import { PIX_TYPE_LABELS, type PixChangeDetails, type PixSide } from "@/lib/organizer/pix-change";

/** "Ver e decidir" a troca de chave PIX (Admin do Espaço). */
export function PixChangeDecision({ requestId }: { requestId: string }) {
  const [details, setDetails] = useState<PixChangeDetails | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [isLoading, startLoading] = useTransition();

  function open() {
    setError("");
    startLoading(async () => {
      try {
        const result = await loadPixChangeDetails(requestId);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setDetails(result.data);
      } catch {
        setError("Não foi possível abrir o pedido de troca.");
      }
    });
  }

  return (
    <div className="grid gap-2">
      <Button loading={isLoading} loadingLabel="Abrindo..." onClick={open} variant="secondary">
        Ver e decidir
      </Button>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {done ? <Notice tone="success">{done}</Notice> : null}
      {details ? (
        <DecisionDialog
          details={details}
          onClose={() => setDetails(null)}
          onDone={(message) => {
            setDetails(null);
            setDone(message);
          }}
        />
      ) : null}
    </div>
  );
}

function Side({ title, side }: { title: string; side: PixSide }) {
  return (
    <div className="grid gap-1 rounded-xl border border-byla-border p-3 text-base">
      <p className="text-sm text-byla-muted">{title}</p>
      <p>
        {PIX_TYPE_LABELS[side.pixKeyType] ?? side.pixKeyType}: <span className="break-all font-semibold">{side.pixKey}</span>
      </p>
      <p className="break-words">
        Titular: {side.holderName} · {side.holderDocument}
      </p>
    </div>
  );
}

function DecisionDialog({
  details,
  onClose,
  onDone,
}: {
  details: PixChangeDetails;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const [openedAt] = useState(() => Date.now());
  const canConfirm = openedAt >= new Date(details.confirmAfter).getTime();
  const waitLabel = formatWaitUntil(details.confirmAfter);
  const noteLength = note.trim().length;

  function decide(approve: boolean) {
    if (isPending) return;
    if (!approve && (noteLength < 5 || noteLength > 500)) {
      setError("Escreva o motivo da recusa (de 5 a 500 caracteres).");
      return;
    }
    setError("");
    startTransition(async () => {
      try {
        const result = await decidePixChange({ requestId: details.requestId, approve, note });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        onDone(
          approve
            ? "Troca confirmada. Os próximos repasses vão para a chave nova e o organizador recebe um e-mail."
            : "Troca recusada. O organizador recebe um e-mail com o motivo.",
        );
        router.refresh();
      } catch {
        setError("Não foi possível registrar a decisão.");
      }
    });
  }

  return (
    <FinanceDialog
      busy={isPending}
      eyebrow="Troca de chave PIX"
      onClose={onClose}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        decide(true);
      }}
      title={details.publicName}
      titleId={`troca-pix-${details.requestId}`}
    >
      <Side side={details.current} title="Chave atual" />
      <Side side={details.next} title="Chave nova" />
      <p className="text-base">
        Confira se o titular da chave nova é o organizador ou a empresa dele. Na dúvida, fale com ele por um canal
        conhecido antes de confirmar.
      </p>
      {!canConfirm ? (
        <Notice live={false} tone="info">
          Por segurança, a confirmação libera {waitLabel ? `a partir de ${waitLabel}` : "1 dia depois do pedido"}.
        </Notice>
      ) : null}

      <TextAreaField
        disabled={isPending}
        hint="Obrigatório para recusar. O organizador vê este motivo."
        label="Motivo (para recusar)"
        maxLength={500}
        onChange={(event) => setNote(event.target.value)}
        value={note}
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}

      <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end">
        <Button disabled={isPending} onClick={onClose} variant="secondary">
          Voltar
        </Button>
        <Button disabled={isPending} onClick={() => decide(false)} variant="danger">
          Recusar
        </Button>
        <Button disabled={!canConfirm} loading={isPending} loadingLabel="Registrando..." type="submit">
          Confirmar troca
        </Button>
      </div>
    </FinanceDialog>
  );
}
