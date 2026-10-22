"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { startOrganizerLoginAction } from "@/app/organizador/verificar/actions";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import type { ActionResult } from "@/lib/action-result";
import { loginVerifyPathWithNotice } from "@/lib/auth/login-verify-notice";
import { PASSWORD_RESET_PATH } from "@/lib/organizer/invite-token-format";
import { createClient } from "@/lib/supabase/client";

const LOGIN_FAILED = "Não foi possível entrar";

type LoginDeps = {
  signIn: (email: string, password: string) => Promise<{ error: unknown }>;
  start: () => Promise<ActionResult<{ next: string; notice?: string }>>;
  signOut: () => Promise<unknown>;
};

/**
 * Senha errada, conta da equipe ou de outro tipo dão a mesma mensagem: a tela não
 * revela se o e-mail existe nem de que tipo é a conta.
 */
export async function signInOrganizer(
  input: { email: string; password: string },
  deps: LoginDeps,
): Promise<{ ok: true; next: string } | { ok: false; error: string }> {
  const { error } = await deps.signIn(input.email, input.password);
  if (error) return { ok: false, error: LOGIN_FAILED };

  // Aparelho lembrado entra direto; senão o servidor manda o código por e-mail.
  const result = await deps.start().catch(() => null);
  if (!result?.ok) {
    await deps.signOut().catch(() => undefined);
    return { ok: false, error: LOGIN_FAILED };
  }
  return { ok: true, next: loginVerifyPathWithNotice(result.data.next, result.data.notice) };
}

export function OrganizerLoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const supabase = createClient();
    const result = await signInOrganizer(
      { email: String(formData.get("email") ?? ""), password: String(formData.get("password") ?? "") },
      {
        signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
        start: startOrganizerLoginAction,
        // Só neste navegador: não derruba as outras sessões da conta.
        signOut: () => supabase.auth.signOut({ scope: "local" }),
      },
    );

    if (!result.ok) {
      setError(result.error);
      setIsSubmitting(false);
      return;
    }
    router.replace(result.next);
    router.refresh();
  }

  return (
    <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
      <Field
        autoCapitalize="none"
        autoComplete="email"
        id="email"
        inputMode="email"
        label="E-mail"
        name="email"
        required
        spellCheck={false}
        type="email"
      />
      <Field
        autoComplete="current-password"
        id="password"
        label="Senha"
        name="password"
        required
        type="password"
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Button fullWidth loading={isSubmitting} loadingLabel="Entrando..." size="lg" type="submit">
        Entrar
      </Button>

      <p className="text-center">
        <Link
          className="inline-flex min-h-11 items-center justify-center text-base font-medium text-byla-link underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue"
          href={PASSWORD_RESET_PATH}
        >
          Esqueci minha senha
        </Link>
      </p>
    </form>
  );
}
