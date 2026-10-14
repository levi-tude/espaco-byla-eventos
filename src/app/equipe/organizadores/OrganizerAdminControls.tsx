"use client";

import { useRouter } from "next/navigation";
import { createContext, type FormEvent, type ReactNode, useContext, useState, useTransition } from "react";

import {
  archiveSignupRequest,
  createInvite,
  createPasswordResetLink,
  forgetAccountDevices,
  revokeInvite,
  setOrganizerStatus,
  type GeneratedLink,
} from "@/app/equipe/organizadores/actions";
import { FinanceDialog } from "@/components/equipe/FinanceDialog";
import { InviteCreatedDialog } from "@/components/equipe/InviteCreatedDialog";
import { Button } from "@/components/ui/Button";
import { Field, TextAreaField } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import type { ActionResult } from "@/lib/action-result";

const LABEL_MAX = 80;
const REASON_MAX = 500;
const GENERIC_ERROR = "Não foi possível concluir. Tente de novo.";

type ShownLink = GeneratedLink & { title: string; warning?: string };

const ShowLinkContext = createContext<(link: ShownLink) => void>(() => {});

/**
 * Fica no topo da página: o link continua na tela mesmo quando o card que o gerou
 * some da lista (ex.: pedido que vira "Convidada").
 */
export function LinkDialogProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<ShownLink | null>(null);
  return (
    <ShowLinkContext.Provider value={setShown}>
      {children}
      {shown ? (
        <InviteCreatedDialog
          expiresAt={shown.expiresAt}
          link={shown.link}
          onClose={() => setShown(null)}
          title={shown.title}
          warning={shown.warning}
          whatsappUrl={shown.whatsappUrl}
        />
      ) : null}
    </ShowLinkContext.Provider>
  );
}

/** Roda a ação, mostra o erro e atualiza a tela no sucesso. */
function useActionRunner() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  function run<T>(action: () => Promise<ActionResult<T>>, onDone?: (data: T) => void) {
    setError("");
    startTransition(async () => {
      const result = await action().catch(() => null);
      if (!result?.ok) {
        setError(result?.error ?? GENERIC_ERROR);
        return;
      }
      onDone?.(result.data);
      router.refresh();
    });
  }

  return { error, isPending, run, clearError: () => setError("") };
}

export function CreateInviteForm() {
  const showLink = useContext(ShowLinkContext);
  const { error, isPending, run } = useActionRunner();
  const [label, setLabel] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    run(
      () => createInvite({ label }),
      (data) => {
        setLabel("");
        showLink({ ...data, title: "Convite gerado" });
      },
    );
  }

  return (
    <form className="grid gap-3 rounded-2xl border border-byla-border bg-byla-surface p-4 sm:flex sm:items-end" onSubmit={submit}>
      <Field
        autoComplete="off"
        disabled={isPending}
        hint="Não coloque dados pessoais no apelido."
        label="Apelido interno (opcional)"
        maxLength={LABEL_MAX}
        onChange={(event) => setLabel(event.target.value)}
        placeholder="Ex.: Peça de dezembro"
        value={label}
        wrapperClassName="sm:flex-1"
      />
      <Button className="sm:mb-7" loading={isPending} loadingLabel="Gerando..." type="submit">
        Gerar convite
      </Button>
      {error ? (
        <div className="sm:basis-full">
          <Notice tone="danger">{error}</Notice>
        </div>
      ) : null}
    </form>
  );
}

export function SignupRequestActions({ requestId, canInvite }: { requestId: string; canInvite: boolean }) {
  const showLink = useContext(ShowLinkContext);
  const { error, isPending, run } = useActionRunner();

  return (
    <div className="grid gap-2">
      <div className="grid gap-2 sm:flex sm:flex-wrap">
        {canInvite ? (
          <Button
            disabled={isPending}
            onClick={() => run(() => createInvite({ label: "", requestId }), (data) => showLink({ ...data, title: "Convite gerado" }))}
          >
            Gerar convite
          </Button>
        ) : null}
        <Button disabled={isPending} onClick={() => run(() => archiveSignupRequest(requestId))} variant="secondary">
          Arquivar
        </Button>
      </div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </div>
  );
}

export function RevokeInviteButton({ inviteId }: { inviteId: string }) {
  const { error, isPending, run } = useActionRunner();
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="grid gap-2">
      {confirming ? (
        <div className="grid gap-2 sm:flex sm:flex-wrap">
          <Button
            loading={isPending}
            loadingLabel="Revogando..."
            onClick={() => run(() => revokeInvite(inviteId), () => setConfirming(false))}
            variant="danger"
          >
            Confirmar revogação
          </Button>
          <Button disabled={isPending} onClick={() => setConfirming(false)} variant="ghost">
            Voltar
          </Button>
        </div>
      ) : (
        <Button onClick={() => setConfirming(true)} variant="secondary">
          Revogar
        </Button>
      )}
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </div>
  );
}

export function AccountActions({
  userId,
  publicName,
  status,
  devicesCount,
}: {
  userId: string;
  publicName: string;
  status: string;
  devicesCount: number;
}) {
  const showLink = useContext(ShowLinkContext);
  const { error, isPending, run, clearError } = useActionRunner();
  const [dialog, setDialog] = useState<"" | "suspender" | "reativar">("");
  const [confirmForget, setConfirmForget] = useState(false);
  const [done, setDone] = useState("");
  const active = status === "ativo";

  function forget() {
    setDone("");
    run(
      () => forgetAccountDevices(userId),
      ({ forgotten }) => {
        setConfirmForget(false);
        setDone(
          forgotten === 1
            ? "1 aparelho esquecido. No próximo acesso, vai pedir o código do e-mail."
            : `${forgotten} aparelhos esquecidos. No próximo acesso, vai pedir o código do e-mail.`,
        );
      },
    );
  }

  function resetLink() {
    setDone("");
    run(
      () => createPasswordResetLink(userId),
      (data) =>
        showLink({
          ...data,
          title: `Link para nova senha: ${publicName}`,
          warning: "Este link aparece só agora. Se perder, gere outro (o anterior deixa de valer).",
        }),
    );
  }

  return (
    <div className="grid gap-2">
      <div className="grid gap-2 sm:flex sm:flex-wrap">
        {active ? (
          <Button disabled={isPending} onClick={() => setDialog("suspender")} variant="danger">
            Suspender
          </Button>
        ) : (
          <Button disabled={isPending} onClick={() => setDialog("reativar")} variant="secondary">
            Reativar
          </Button>
        )}
        {active ? (
          <Button disabled={isPending} onClick={resetLink} variant="secondary">
            Link para nova senha
          </Button>
        ) : null}
        {devicesCount > 0 && !confirmForget ? (
          <Button disabled={isPending} onClick={() => setConfirmForget(true)} variant="secondary">
            Esquecer aparelhos lembrados
          </Button>
        ) : null}
      </div>

      {confirmForget ? (
        <div className="grid gap-2 rounded-xl border border-byla-border p-3">
          <p className="text-base">
            Todos os aparelhos lembrados desta conta vão pedir o código do e-mail no próximo acesso. Quem estiver
            usando a área agora sai na hora.
          </p>
          <div className="grid gap-2 sm:flex sm:flex-wrap">
            <Button loading={isPending} loadingLabel="Esquecendo..." onClick={forget} variant="danger">
              Esquecer aparelhos
            </Button>
            <Button disabled={isPending} onClick={() => setConfirmForget(false)} variant="ghost">
              Voltar
            </Button>
          </div>
        </div>
      ) : null}

      {done ? <Notice tone="success">{done}</Notice> : null}
      {error && !dialog ? <Notice tone="danger">{error}</Notice> : null}

      {dialog ? (
        <StatusDialog
          error={error}
          isPending={isPending}
          mode={dialog}
          onClose={() => {
            setDialog("");
            clearError();
          }}
          onSubmit={(reason) =>
            run(
              () => setOrganizerStatus(userId, dialog === "suspender" ? "suspenso" : "ativo", reason),
              () => {
                setDialog("");
                setDone(dialog === "suspender" ? "Conta suspensa. O organizador recebe um e-mail." : "Conta reativada.");
              },
            )
          }
          publicName={publicName}
          userId={userId}
        />
      ) : null}
    </div>
  );
}

function StatusDialog({
  mode,
  userId,
  publicName,
  isPending,
  error,
  onClose,
  onSubmit,
}: {
  mode: "suspender" | "reativar";
  userId: string;
  publicName: string;
  isPending: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const suspend = mode === "suspender";
  const ready = !suspend || reason.trim().length >= 5;

  return (
    <FinanceDialog
      busy={isPending}
      eyebrow={publicName}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !isPending) onSubmit(reason);
      }}
      title={suspend ? "Suspender conta" : "Reativar conta"}
      titleId={`situacao-${userId}`}
    >
      {suspend ? (
        <>
          <p className="text-base">
            O organizador perde o acesso na hora e recebe um e-mail com o motivo. Os eventos dele que já estão à venda
            continuam vendendo até a equipe pausar ou cancelar.
          </p>
          <TextAreaField
            disabled={isPending}
            hint="De 5 a 500 caracteres. O organizador vê este texto."
            label="Motivo"
            maxLength={REASON_MAX}
            onChange={(event) => setReason(event.target.value)}
            required
            value={reason}
          />
        </>
      ) : (
        <p className="text-base">O organizador volta a entrar na área com o mesmo e-mail e senha.</p>
      )}

      {error ? <Notice tone="danger">{error}</Notice> : null}

      <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end">
        <Button disabled={isPending} onClick={onClose} variant="secondary">
          Voltar
        </Button>
        <Button
          disabled={!ready}
          loading={isPending}
          loadingLabel={suspend ? "Suspendendo..." : "Reativando..."}
          type="submit"
          variant={suspend ? "danger" : "primary"}
        >
          {suspend ? "Suspender conta" : "Reativar conta"}
        </Button>
      </div>
    </FinanceDialog>
  );
}
