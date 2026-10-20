"use client";

import { type FormEvent, useEffect, useRef, useState, useTransition } from "react";

import { resetPasswordWithLink } from "@/app/redefinir-senha/actions";
import { PASSWORD_HINT, PASSWORD_MISMATCH_MESSAGE, takeTokenFromLocation } from "@/components/organizer/SignupWizard";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { AREAS } from "@/lib/auth/area";
import { parsePassword } from "@/lib/organizer/validation";

const LINK_INVALID_MESSAGE = "Este link não vale mais. Peça um novo ao ACDH Eventos.";

type Phase = "sem_link" | "formulario" | "pronto";

export function ResetPasswordForm() {
  const started = useRef(false);
  const token = useRef<string | null>(null);
  const [phase, setPhase] = useState<Phase>("formulario");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    token.current = takeTokenFromLocation().token;
    if (!token.current) setPhase("sem_link");
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
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
        setError(result?.error ?? "Não foi possível trocar a senha. Fale com o ACDH Eventos.");
        return;
      }
      setPassword("");
      setPasswordConfirm("");
      setPhase("pronto");
    });
  }

  if (phase === "sem_link") {
    return (
      <Notice title="Link indisponível" tone="danger">
        {LINK_INVALID_MESSAGE}
      </Notice>
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
    <form className="grid gap-4" onSubmit={submit}>
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
