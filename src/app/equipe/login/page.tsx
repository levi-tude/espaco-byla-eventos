"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { startLoginVerificationAction } from "@/app/equipe/verificar/actions";
import { BrandMark } from "@/components/brand/BrandMark";
import { ThemeToggle } from "@/components/brand/ThemeToggle";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { loginVerifyPathWithNotice } from "@/lib/auth/login-verify-notice";
import { PASSWORD_RESET_PATH } from "@/lib/organizer/invite-token-format";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError("Não foi possível entrar");
      setIsSubmitting(false);
      return;
    }

    // Aparelho lembrado entra direto; senão o servidor manda o código por e-mail.
    const result = await startLoginVerificationAction().catch(() => null);
    if (!result?.ok) {
      await supabase.auth.signOut();
      setError("Não foi possível entrar");
      setIsSubmitting(false);
      return;
    }

    router.replace(loginVerifyPathWithNotice(result.data.next, result.data.notice));
    router.refresh();
  }

  return (
    <main className="relative flex min-h-dvh flex-col bg-byla-bg">
      <div className="flex justify-end px-4 pt-3 sm:px-6 sm:pt-4">
        <ThemeToggle />
      </div>
      <div className="flex flex-1 items-start justify-center px-4 pb-12 pt-4 sm:items-center sm:pt-0">
        <section className="w-full max-w-sm rounded-2xl border border-byla-border bg-byla-surface p-6 shadow-xl shadow-black/20 sm:p-8 dark:shadow-black/40">
          <div className="flex items-center gap-3">
            <BrandMark size={40} />
            <p className="font-display text-xl tracking-wide text-foreground">
              ACDH Eventos
            </p>
          </div>
          <h1 className="mt-6 text-2xl font-semibold tracking-tight text-foreground">
            Acesso da equipe
          </h1>

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

            <Button
              fullWidth
              loading={isSubmitting}
              loadingLabel="Entrando..."
              size="lg"
              type="submit"
            >
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
        </section>
      </div>
    </main>
  );
}
