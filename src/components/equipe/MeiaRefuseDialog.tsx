"use client";

import { useEffect, useRef } from "react";
import { Ban } from "lucide-react";

import {
  MEIA_REFUSE_BACK,
  MEIA_REFUSE_YES,
  type MeiaRefuseSecondConfirm,
} from "@/lib/domain/meia-check";

/**
 * Segunda confirmação do "Recusado" (a primeira é o confirm do navegador). "Voltar" é o
 * padrão: vem com foco, é o botão em destaque e o Esc/fundo também voltam.
 */
export function MeiaRefuseDialog({
  prompt,
  onBack,
  onConfirm,
}: {
  prompt: MeiaRefuseSecondConfirm;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const backRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    backRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onBack();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 sm:items-center"
      data-meia-refuse-dialog=""
      onClick={(event) => {
        if (event.target === event.currentTarget) onBack();
      }}
    >
      <div
        aria-describedby="meia-refuse-body"
        aria-labelledby="meia-refuse-title"
        aria-modal="true"
        className="w-full max-w-md rounded-2xl border-4 border-byla-danger bg-white p-5 text-zinc-900 shadow-2xl"
        role="alertdialog"
      >
        <Ban aria-hidden className="mx-auto size-10 text-byla-danger" />
        <h2 className="mt-2 text-center text-xl font-bold leading-snug" id="meia-refuse-title">
          {prompt.title}
        </h2>
        <div className="mt-3 space-y-2 text-base leading-snug" id="meia-refuse-body">
          {prompt.body.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        <div className="mt-5 grid gap-3">
          <button
            className="min-h-14 rounded-xl bg-zinc-900 px-4 text-lg font-bold text-white shadow focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
            data-action="voltar"
            onClick={onBack}
            ref={backRef}
            type="button"
          >
            {MEIA_REFUSE_BACK}
          </button>
          <button
            className="min-h-12 rounded-xl bg-byla-danger px-4 text-base font-semibold text-white focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-byla-danger"
            data-action="sim-recusar"
            onClick={onConfirm}
            type="button"
          >
            {MEIA_REFUSE_YES}
          </button>
        </div>
      </div>
    </div>
  );
}
