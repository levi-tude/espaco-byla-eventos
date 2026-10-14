"use client";

import { type FormEvent, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  resendLoginCodeAction,
  signOutTeamAction,
  submitLoginCodeAction,
} from "@/app/equipe/verificar/actions";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";

type LoginCodeFormProps = {
  maskedEmail: string;
  hasCode: boolean;
  resendInSeconds: number;
  resendCooldownSeconds: number;
  codeMinutes: number;
  rememberDays: number;
};

function formatWait(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function LoginCodeForm({
  maskedEmail,
  hasCode: initialHasCode,
  resendInSeconds,
  resendCooldownSeconds,
  codeMinutes,
  rememberDays,
}: LoginCodeFormProps) {
  const router = useRouter();
  const [hasCode, setHasCode] = useState(initialHasCode);
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(true);
  const [wait, setWait] = useState(resendInSeconds);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [isSubmitting, startSubmit] = useTransition();
  const [isSending, startSend] = useTransition();

  useEffect(() => {
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setWait((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);

  function goTo(next: string) {
    router.replace(next);
    router.refresh();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setInfo("");
    startSubmit(async () => {
      const result = await submitLoginCodeAction(code, remember);
      if (result.ok) {
        goTo(result.data.next);
        return;
      }
      setError(result.error);
    });
  }

  function handleSend() {
    setError("");
    setInfo("");
    startSend(async () => {
      const result = await resendLoginCodeAction();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.data.verified) {
        goTo("/equipe");
        return;
      }
      setHasCode(true);
      setCode("");
      setWait(resendCooldownSeconds);
      setInfo(`Enviamos um código novo para ${maskedEmail}.`);
    });
  }

  return (
    <div className="mt-6 space-y-5">
      {hasCode ? (
        <p className="text-base text-byla-muted">
          Enviamos um código de 6 números para{" "}
          <span className="font-medium text-foreground">{maskedEmail}</span>. Ele vale por{" "}
          {codeMinutes} minutos.
        </p>
      ) : (
        <p className="text-base text-byla-muted">
          Para entrar, vamos mandar um código de 6 números para{" "}
          <span className="font-medium text-foreground">{maskedEmail}</span>.
        </p>
      )}

      {hasCode ? (
        <form className="space-y-5" onSubmit={handleSubmit}>
          <Field
            autoComplete="one-time-code"
            className="text-center font-mono text-2xl tracking-[0.4em]"
            hint="Não chegou? Confira a caixa de spam ou peça outro código."
            id="login-code"
            inputMode="numeric"
            label="Código"
            name="code"
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            pattern="[0-9]{6}"
            placeholder="000000"
            required
            value={code}
          />

          <Checkbox
            checked={remember}
            name="remember"
            onChange={(event) => setRemember(event.target.checked)}
          >
            Lembrar este aparelho por {rememberDays} dias
            <span className="block text-sm text-byla-muted">
              Desmarque em computador ou celular de outra pessoa.
            </span>
          </Checkbox>

          {error ? <Notice tone="danger">{error}</Notice> : null}
          {info && !error ? <Notice tone="success">{info}</Notice> : null}

          <Button
            disabled={code.length !== 6}
            fullWidth
            loading={isSubmitting}
            loadingLabel="Conferindo..."
            size="lg"
            type="submit"
          >
            Confirmar
          </Button>

          <Button
            disabled={wait > 0 || isSubmitting}
            fullWidth
            loading={isSending}
            loadingLabel="Enviando..."
            onClick={handleSend}
            type="button"
            variant="secondary"
          >
            {wait > 0 ? `Reenviar código em ${formatWait(wait)}` : "Reenviar código"}
          </Button>
        </form>
      ) : (
        <div className="space-y-5">
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Button
            disabled={wait > 0}
            fullWidth
            loading={isSending}
            loadingLabel="Enviando..."
            onClick={handleSend}
            size="lg"
            type="button"
          >
            {wait > 0 ? `Enviar código em ${formatWait(wait)}` : "Enviar código"}
          </Button>
        </div>
      )}

      <form action={signOutTeamAction}>
        <Button fullWidth type="submit" variant="ghost">
          Sair
        </Button>
      </form>
    </div>
  );
}
