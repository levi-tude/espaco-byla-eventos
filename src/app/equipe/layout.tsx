import type { ReactNode } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/brand/BrandMark";
import { ThemeToggle } from "@/components/brand/ThemeToggle";
import { buttonClasses } from "@/components/ui/Button";
import { getFinanceAccess } from "@/lib/auth/finance-admin";
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

  const finance = await getFinanceAccess();
  const links = [
    { href: "/equipe", label: "Eventos" },
    ...(finance ? [{ href: "/equipe/taxa-servico", label: "Taxa de serviço" }] : []),
  ];

  return (
    <div className="min-h-screen bg-byla-bg text-foreground">
      <header className="border-b border-byla-border bg-byla-surface">
        <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 px-4 py-2 sm:gap-x-4 sm:px-6 sm:py-3">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <BrandMark size={32} />
            <p className="truncate font-display text-lg tracking-wide text-foreground">
              Espaço Byla Eventos
            </p>
          </div>

          {/* No celular o menu ocupa a linha de baixo inteira para não apertar "Sair". */}
          <nav
            aria-label="Navegação da equipe"
            className="col-span-2 row-start-2 flex gap-x-3 sm:col-span-1 sm:pl-11"
          >
            {links.map((link) => (
              <Link
                aria-current={pathname === link.href ? "page" : undefined}
                className="-ml-1 inline-flex min-h-11 items-center whitespace-nowrap rounded-lg px-1 text-base text-byla-muted transition hover:text-byla-link focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue aria-[current=page]:font-semibold aria-[current=page]:text-foreground"
                href={link.href}
                key={link.href}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="col-start-2 row-start-1 flex shrink-0 items-center gap-2 sm:row-span-2">
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
