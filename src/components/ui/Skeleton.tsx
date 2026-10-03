import type { ReactNode } from "react";

import { cx } from "@/components/ui/cx";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("animate-pulse rounded-lg bg-byla-overlay", className)} />;
}

/** Wrapper anunciado por leitores de tela enquanto a página carrega. */
export function LoadingRegion({ label = "Carregando…", children }: { label?: string; children: ReactNode }) {
  return (
    <div aria-busy="true" aria-live="polite" role="status">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
