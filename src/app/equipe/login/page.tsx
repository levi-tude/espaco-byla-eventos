"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { BrandMark } from "@/components/brand/BrandMark";
import { ThemeToggle } from "@/components/brand/ThemeToggle";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
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

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: profile } = user
      ? await supabase
          .from("staff_profiles")
          .select("user_id")
          .eq("user_id", user.id)
          .maybeSingle()
      : { data: null };

    if (!profile) {
      await supabase.auth.signOut();
      setError("Não foi possível entrar");
      setIsSubmitting(false);
      return;
    }

    router.replace("/equipe");
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
              Espaço Byla Eventos
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
          </form>
        </section>
      </div>
    </main>
  );
}
