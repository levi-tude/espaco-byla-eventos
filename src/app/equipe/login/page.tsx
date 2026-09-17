"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

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
    <main className="flex min-h-screen items-center justify-center bg-zinc-100 px-6 py-12">
      <section className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-medium text-zinc-500">Espaço Byla Eventos</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">
          Acesso da equipe
        </h1>

        <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
          <div>
            <label
              className="mb-2 block text-sm font-medium text-zinc-800"
              htmlFor="email"
            >
              E-mail
            </label>
            <input
              autoComplete="email"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-950 outline-none transition focus:border-zinc-950 focus:ring-2 focus:ring-zinc-200"
              id="email"
              name="email"
              required
              type="email"
            />
          </div>

          <div>
            <label
              className="mb-2 block text-sm font-medium text-zinc-800"
              htmlFor="password"
            >
              Senha
            </label>
            <input
              autoComplete="current-password"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-950 outline-none transition focus:border-zinc-950 focus:ring-2 focus:ring-zinc-200"
              id="password"
              name="password"
              required
              type="password"
            />
          </div>

          {error ? (
            <p className="text-sm font-medium text-red-700" role="alert">
              {error}
            </p>
          ) : null}

          <button
            className="w-full rounded-lg bg-zinc-950 px-4 py-2.5 font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
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
