"use client";

import { type FormEvent, useEffect, useRef, useState, useTransition } from "react";

import {
  PASSWORD_RESET_REQUEST_MESSAGE,
  requestPasswordResetLink,
  resetPasswordWithLink,
} from "@/app/redefinir-senha/actions";
import { PASSWORD_HINT, PASSWORD_MISMATCH_MESSAGE, takeTokenFromLocation } from "@/components/organizer/SignupWizard";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { AREAS } from "@/lib/auth/area";
import { inviteTokenFromHash } from "@/lib/organizer/invite-token-format";
import { parseEmail, parsePassword } from "@/lib/organizer/validation";

const RESET_FAILED_MESSAGE = "Não foi possível trocar a senha. Fale com a ACDH Eventos.";

type Phase = "carregando" | "pedir_email" | "pedido_enviado" | "formulario" | "pronto";

export function ResetPasswordForm() {
  const started = useRef(false);
  const token = useRef<string | null>(null);
  const [phase, setPhase] = useState<Phase>("carregando");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const hash = window.location.hash;
    if (inviteTokenFromHash(hash)) {
      token.current = takeTokenFromLocation().token;
      queueMicrotask(() => {
        setPhase(token.current ? "formulario" : "pedir_email");
      });
      return;
    }

    // Sem link de uso único: só pedido por e-mail. Sessão logada NÃO libera troca de senha.
    queueMicrotask(() => setPhase("pedir_email"));
  }, []);

  function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const parsed = parseEmail(email);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    startTransition(async () => {
      const result = await requestPasswordResetLink(parsed.value).catch(() => null);
      if (!result?.ok) {
        setError(result?.error ?? "Não foi possível pedir o link agora. Tente de novo em alguns minutos.");
        return;
      }
      setPhase("pedido_enviado");
    });
  }

  function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const parsed = parsePassword(password);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    if (password !== passwordConfirm) {
      setError(PASSWORD_MISMATCH_MESSAGE);
      return;
    }
    startTransition(async () => {
      const result = await resetPasswordWithLink(token.current ?? "", password).catch(() => null);
      if (!result?.ok) {
        setError(result?.error ?? RESET_FAILED_MESSAGE);
        return;
      }
      setPassword("");
      setPasswordConfirm("");
      setPhase("pronto");
    });
  }

  if (phase === "carregando") {
    return <p className="text-base text-byla-muted">Carregando…</p>;
  }

  if (phase === "pedido_enviado") {
    return (
      <div className="grid gap-4">
        <Notice title="Confira o seu e-mail" tone="success">
          {PASSWORD_RESET_REQUEST_MESSAGE}
        </Notice>
        <ButtonLink fullWidth href={AREAS.organizador.login} size="lg" variant="secondary">
          Voltar para entrar
        </ButtonLink>
      </div>
    );
  }

  if (phase === "pedir_email") {
    return (
      <form className="grid gap-4" onSubmit={submitRequest}>
        <p className="text-base text-byla-muted">
          Informe o e-mail da conta. Se ele estiver cadastrado, mandamos um link para criar uma
          senha nova.
        </p>
        <Field
          autoCapitalize="none"
          autoComplete="email"
          inputMode="email"
          label="E-mail"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          spellCheck={false}
          type="email"
          value={email}
        />
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Button fullWidth loading={pending} loadingLabel="Enviando…" size="lg" type="submit">
          Enviar link
        </Button>
      </form>
    );
  }

  if (phase === "pronto") {
    return (
      <div className="grid gap-4">
        <Notice title="Senha nova salva." tone="success">
          Entre com o seu e-mail e a senha nova. Vamos mandar um código para o seu e-mail.
        </Notice>
        <ButtonLink fullWidth href={AREAS.organizador.login} size="lg">
          Entrar
        </ButtonLink>
      </div>
    );
  }

  return (
    <form className="grid gap-4" onSubmit={submitPassword}>
      <Field
        autoComplete="new-password"
        hint={PASSWORD_HINT}
        label="Senha nova"
        minLength={12}
        name="password"
        onChange={(event) => setPassword(event.target.value)}
        required
        type="password"
        value={password}
      />
      <Field
        autoComplete="new-password"
        label="Repita a senha nova"
        minLength={12}
        name="passwordConfirm"
        onChange={(event) => setPasswordConfirm(event.target.value)}
        required
        type="password"
        value={passwordConfirm}
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button fullWidth loading={pending} loadingLabel="Salvando…" size="lg" type="submit">
        Salvar senha nova
      </Button>
    </form>
  );
}
