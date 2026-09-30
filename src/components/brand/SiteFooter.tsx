import Link from "next/link";

import { COMPANY } from "@/lib/legal/privacy";

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-byla-border bg-byla-bg">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-2 px-6 py-6 text-center text-xs text-byla-muted sm:flex-row sm:justify-center sm:gap-3">
        <p>
          © {year} {COMPANY.brand}. Todos os direitos reservados.
        </p>
        <span aria-hidden className="hidden sm:inline">
          ·
        </span>
        <Link
          className="font-medium underline-offset-2 transition hover:text-foreground hover:underline"
          href="/privacidade"
        >
          Política de Privacidade
        </Link>
      </div>
    </footer>
  );
}
