"use client";

import { type FormEvent, type ReactNode, useEffect, useRef } from "react";

type Props = {
  titleId: string;
  title: ReactNode;
  eyebrow?: ReactNode;
  /** Enquanto grava, Esc não fecha. */
  busy: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
};

/** Caixa de confirmação dos lançamentos do financeiro (mesmo padrão do estorno). */
export function FinanceDialog({ titleId, title, eyebrow, busy, onClose, onSubmit, children }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      aria-labelledby={titleId}
      className="m-auto max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-lg overflow-y-auto rounded-2xl border border-byla-border bg-byla-surface p-0 text-foreground backdrop:bg-black/70"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      ref={dialogRef}
    >
      <form className="grid gap-4 p-4 sm:p-6" onSubmit={onSubmit}>
        <div>
          {eyebrow ? (
            <p className="text-sm font-medium uppercase tracking-wide text-byla-muted">{eyebrow}</p>
          ) : null}
          <h2 className="mt-1 break-words text-xl font-semibold" id={titleId}>
            {title}
          </h2>
        </div>
        {children}
      </form>
    </dialog>
  );
}
