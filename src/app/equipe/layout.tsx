import type { ReactNode } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { signOutTeamAction } from "@/app/equipe/verificar/actions";
import { BrandMark } from "@/components/brand/BrandMark";
import { ThemeToggle } from "@/components/brand/ThemeToggle";
import { buttonClasses } from "@/components/ui/Button";
import { getFinanceAccess } from "@/lib/auth/finance-admin";
import { readLoginState } from "@/lib/auth/login-verification";
import { STAFF_LOGIN_PATH, STAFF_VERIFY_PATH } from "@/lib/auth/staff-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

/** Pendências de Aprovações (eventos, mudanças e exclusões). Falha = sem número. */
async function pendingApprovals(adminId: string): Promise<number | null> {
  try {
    const { data, error } = await createAdminClient().rpc("team_pending_counts", { p_staff: adminId });
    if (error) {
      console.error("[equipe] Falha ao contar pendências do menu.", error.code);
      return null;
    }
    const counts = data?.[0];
    if (!counts) return null;
    const total = counts.approvals + counts.changes + counts.deletions;
    return Number.isFinite(total) && total > 0 ? total : null;
  } catch {
    console.error("[equipe] Falha ao contar pendências do menu.");
    return null;
  }
}

export default async function EquipeLayout({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = (await headers()).get("x-pathname");

  if (pathname === STAFF_LOGIN_PATH || pathname === STAFF_VERIFY_PATH) {
    return children;
  }

  const state = await readLoginState(await createServerClient(), "equipe");
  if (state.status === "pendente") redirect(STAFF_VERIFY_PATH);
  if (state.status !== "verificado") redirect(STAFF_LOGIN_PATH);

  const finance = await getFinanceAccess();
  const approvals = finance ? await pendingApprovals(finance.userId) : null;
  const links = finance
    ? [
        { href: "/equipe", label: "Eventos" },
        { href: "/equipe/aprovacoes", label: approvals ? `Aprovações (${approvals})` : "Aprovações" },
        { href: "/equipe/organizadores", label: "Organizadores" },
        { href: "/equipe/taxa-servico", label: "Taxa de serviço" },
        { href: "/equipe/repasses", label: "Repasses" },
        { href: "/equipe/seguranca", label: "Segurança" },
      ]
    : [
        { href: "/equipe", label: "Eventos" },
        { href: "/equipe/seguranca", label: "Segurança" },
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
            className="col-span-2 row-start-2 flex flex-wrap gap-x-3 sm:col-span-1 sm:pl-11"
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
            <form action={signOutTeamAction}>
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
