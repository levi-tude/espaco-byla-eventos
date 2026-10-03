import type { ReactNode } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/brand/BrandMark";
import { ThemeToggle } from "@/components/brand/ThemeToggle";
import { buttonClasses } from "@/components/ui/Button";
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
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-2 sm:gap-4 sm:px-6 sm:py-3">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <BrandMark size={32} />
            <div className="min-w-0">
              <p className="truncate font-display text-lg tracking-wide text-foreground">
                Espaço Byla Eventos
              </p>
              <nav aria-label="Navegação da equipe">
                <Link
                  className="-ml-1 inline-flex min-h-11 items-center rounded-lg px-1 text-base text-byla-muted transition hover:text-byla-link focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue"
                  href="/equipe"
                >
                  Eventos
                </Link>
              </nav>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <ThemeToggle />
            <form action={signOut}>
              <button className={buttonClasses({ variant: "secondary" })} type="submit">
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
