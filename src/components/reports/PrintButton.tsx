"use client";

import { Printer } from "lucide-react";

import { buttonClasses } from "@/components/ui/Button";

/** Abre a impressão do navegador (Salvar como PDF). */
export function PrintButton({ label = "PDF" }: { label?: string }) {
  return (
    <button className={buttonClasses({ variant: "secondary" })} onClick={() => window.print()} type="button">
      <Printer aria-hidden className="h-4 w-4" />
      {label}
    </button>
  );
}
