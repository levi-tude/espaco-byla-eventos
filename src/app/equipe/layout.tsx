import type { ReactNode } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/brand/BrandMark";
import { ThemeToggle } from "@/components/brand/ThemeToggle";
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
    <div className="min-h-screen bg-byla-bg text-foreground">
      <header className="border-b border-byla-border bg-byla-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <BrandMark size={32} />
            <div>
              <p className="font-display text-lg tracking-wide text-foreground">
                Espaço Byla Eventos
              </p>
              <nav className="mt-0.5" aria-label="Navegação da equipe">
                <Link
                  className="text-sm text-byla-muted transition hover:text-byla-blue"
                  href="/equipe"
                >
                  Eventos
                </Link>
              </nav>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <ThemeToggle />
            <form action={signOut}>
              <button
                className="rounded-lg border border-byla-border px-4 py-2 text-sm font-medium text-foreground transition hover:border-byla-blue/60"
                type="submit"
              >
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>

      {children}
    </div>
  );
}
