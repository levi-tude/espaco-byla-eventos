import Link from "next/link";

import { COMPANY } from "@/lib/legal/privacy";

export function SiteFooter() {
  return (
    <footer className="border-t border-byla-border bg-byla-bg">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-6 py-6 text-xs text-byla-muted sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-1">
          <p>
            {COMPANY.brand} · {COMPANY.legalName} · CNPJ {COMPANY.cnpj}
          </p>
          <p>{COMPANY.address}</p>
        </div>
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
