import type { ReactNode } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createServerClient } from "@/lib/supabase/server";

export default async function EquipeLayout({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = (await headers()).get("x-pathname");

  if (pathname === "/equipe/login") {
    return children;
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/equipe/login");
  }

  const { data: profile } = await supabase
    .from("staff_profiles")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profile) {
    redirect("/equipe/login");
  }

  async function signOut() {
    "use server";

    const supabase = await createServerClient();
    await supabase.auth.signOut();
    redirect("/equipe/login");
  }

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-950">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-sm font-semibold">Espaço Byla Eventos</p>
            <nav className="mt-1" aria-label="Navegação da equipe">
              <Link
                className="text-sm text-zinc-600 transition hover:text-zinc-950"
                href="/equipe"
              >
                Eventos
              </Link>
            </nav>
          </div>

          <form action={signOut}>
            <button
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition hover:bg-zinc-100"
              type="submit"
            >
              Sair
            </button>
          </form>
        </div>
      </header>

      {children}
    </div>
  );
}
