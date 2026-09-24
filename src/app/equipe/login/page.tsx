"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { BrandMark } from "@/components/brand/BrandMark";
import { ThemeToggle } from "@/components/brand/ThemeToggle";
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

  const fieldClass =
    "w-full rounded-lg border border-byla-border bg-byla-input px-3 py-2.5 text-foreground outline-none transition focus:border-byla-blue focus:ring-2 focus:ring-byla-ring";

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-byla-bg px-6 py-12">
      <div className="absolute right-6 top-6">
        <ThemeToggle />
      </div>
      <section className="w-full max-w-sm rounded-2xl border border-byla-border bg-byla-surface p-8 shadow-xl shadow-black/20 dark:shadow-black/40">
        <div className="flex items-center gap-3">
          <BrandMark size={40} />
          <p className="font-display text-xl tracking-wide text-foreground">
            Espaço Byla Eventos
          </p>
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-foreground">
          Acesso da equipe
        </h1>

        <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
          <div>
            <label
              className="mb-2 block text-sm font-medium text-byla-muted"
              htmlFor="email"
            >
              E-mail
            </label>
            <input
              autoComplete="email"
              className={fieldClass}
              id="email"
              name="email"
              required
              type="email"
            />
          </div>

          <div>
            <label
              className="mb-2 block text-sm font-medium text-byla-muted"
              htmlFor="password"
            >
              Senha
            </label>
            <input
              autoComplete="current-password"
              className={fieldClass}
              id="password"
              name="password"
              required
              type="password"
            />
          </div>

          {error ? (
            <p className="text-sm font-medium text-red-400" role="alert">
              {error}
            </p>
          ) : null}

          <button
            className="w-full rounded-lg bg-byla-blue px-4 py-2.5 font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </section>
    </main>
  );
}
