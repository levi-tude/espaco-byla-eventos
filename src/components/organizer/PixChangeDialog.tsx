"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";

import { cancelPixChange, sendPixChangeCode, submitPixChange } from "@/app/organizador/conta/actions";
import { FinanceDialog } from "@/components/equipe/FinanceDialog";
import { Button } from "@/components/ui/Button";
import { controlClasses, Field, labelClasses } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { PIX_TYPE_LABELS } from "@/lib/organizer/pix-change";

const PIX_KEY_INPUT: Record<string, { inputMode: "email" | "tel" | "text"; hint: string }> = {
  email: { inputMode: "email", hint: "O e-mail cadastrado como chave PIX." },
  telefone: { inputMode: "tel", hint: "O celular cadastrado como chave PIX, com DDD." },
  aleatoria: { inputMode: "text", hint: "Copie a chave aleatória do aplicativo do seu banco." },
};

function usesDocumentAsKey(type: string) {
  return type === "cpf" || type === "cnpj";
}

/** Botão "Trocar chave PIX": 1) código no e-mail; 2) código + chave nova. */
export function PixChangeButton() {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState("");

  return (
    <div className="grid gap-2">
      <Button onClick={() => setOpen(true)} variant="secondary">
        Trocar chave PIX
      </Button>
      {done ? <Notice tone="success">{done}</Notice> : null}
      {open ? (
        <PixChangeDialog
          onClose={() => setOpen(false)}
          onDone={(message) => {
            setOpen(false);
            setDone(message);
          }}
        />
      ) : null}
    </div>
  );
}

function PixChangeDialog({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => void }) {
  const router = useRouter();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [pixKeyType, setPixKeyType] = useState("");
  const [pixKey, setPixKey] = useState("");
  const [holderName, setHolderName] = useState("");
  const [holderDocument, setHolderDocument] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  function requestCode() {
    setError("");
    startTransition(async () => {
      try {
        const result = await sendPixChangeCode();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setSentTo(result.data.email);
      } catch {
        setError("Não foi possível enviar o código. Tente de novo em instantes.");
      }
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    if (!sentTo) {
      requestCode();
      return;
    }
    setError("");
    startTransition(async () => {
      try {
        const result = await submitPixChange({
          code,
          pixKeyType,
          pixKey: usesDocumentAsKey(pixKeyType) ? holderDocument : pixKey,
          pixHolderName: holderName,
          pixHolderDocument: holderDocument,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        onDone("Troca pedida. O Espaço Byla confere e confirma; até lá, os repasses ficam na chave atual.");
        router.refresh();
      } catch {
        setError("Não foi possível pedir a troca. Tente de novo.");
      }
    });
  }

  return (
    <FinanceDialog
      busy={isPending}
      eyebrow="Recebimento"
      onClose={onClose}
      onSubmit={submit}
      title="Trocar chave PIX"
      titleId="trocar-pix"
    >
      {!sentTo ? (
        <>
          <p className="text-base">
            Por segurança, enviamos um código para o e-mail da sua conta. Depois, o Espaço Byla confere a chave nova
            antes de usar nos repasses (pode levar até 1 dia).
          </p>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end">
            <Button disabled={isPending} onClick={onClose} variant="secondary">
              Voltar
            </Button>
            <Button loading={isPending} loadingLabel="Enviando..." type="submit">
              Enviar código para o meu e-mail
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-base">
            Enviamos um código para <strong>{sentTo}</strong>. Ele vale por 10 minutos.
          </p>
          <Field
            autoComplete="one-time-code"
            disabled={isPending}
            inputMode="numeric"
            label="Código"
            maxLength={7}
            onChange={(event) => setCode(event.target.value)}
            required
            value={code}
          />
          <Notice live={false} tone="warning">
            O repasse vai para esta chave. O titular precisa ser você ou a sua empresa. Confira com cuidado.
          </Notice>
          <div className="flex flex-col gap-1.5">
            <label className={labelClasses} htmlFor="nova-pix-tipo">
              Tipo da chave PIX
            </label>
            <select
              className={`${controlClasses} min-h-12`}
              disabled={isPending}
              id="nova-pix-tipo"
              onChange={(event) => setPixKeyType(event.target.value)}
              required
              value={pixKeyType}
            >
              <option disabled value="">
                Escolha
              </option>
              {Object.entries(PIX_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <Field
            autoComplete="off"
            disabled={isPending}
            hint="Como está no banco: você ou a sua empresa."
            label="Nome do titular"
            maxLength={120}
            minLength={2}
            onChange={(event) => setHolderName(event.target.value)}
            required
            value={holderName}
          />
          <Field
            autoComplete="off"
            disabled={isPending}
            hint="Só os números ou com pontos, como preferir."
            inputMode="numeric"
            label="CPF ou CNPJ do titular"
            maxLength={18}
            onChange={(event) => setHolderDocument(event.target.value)}
            required
            value={holderDocument}
          />
          {pixKeyType && !usesDocumentAsKey(pixKeyType) ? (
            <Field
              autoCapitalize="none"
              autoComplete="off"
              disabled={isPending}
              hint={PIX_KEY_INPUT[pixKeyType]?.hint}
              inputMode={PIX_KEY_INPUT[pixKeyType]?.inputMode ?? "text"}
              label="Chave PIX nova"
              maxLength={77}
              onChange={(event) => setPixKey(event.target.value)}
              required
              spellCheck={false}
              value={pixKey}
            />
          ) : null}
          {usesDocumentAsKey(pixKeyType) ? (
            <p className="text-sm text-byla-muted">A chave PIX é o CPF ou CNPJ do titular informado acima.</p>
          ) : null}
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end">
            <Button disabled={isPending} onClick={requestCode} variant="ghost">
              Enviar outro código
            </Button>
            <Button disabled={isPending} onClick={onClose} variant="secondary">
              Voltar
            </Button>
            <Button loading={isPending} loadingLabel="Enviando..." type="submit">
              Pedir troca
            </Button>
          </div>
        </>
      )}
    </FinanceDialog>
  );
}

/** "Cancelar troca" enquanto o Espaço não decidiu. */
export function CancelPixChangeButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  function cancel() {
    if (!window.confirm("Cancelar o pedido de troca da chave PIX?")) return;
    setError("");
    startTransition(async () => {
      try {
        const result = await cancelPixChange(requestId);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.refresh();
      } catch {
        setError("Não foi possível cancelar a troca. Tente de novo.");
      }
    });
  }

  return (
    <div className="grid gap-2">
      <Button loading={isPending} loadingLabel="Cancelando..." onClick={cancel} variant="secondary">
        Cancelar troca
      </Button>
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </div>
  );
}
