"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { setHiddenFromPast } from "@/app/equipe/eventos/actions";
import { cx } from "@/components/ui/cx";
import { Notice } from "@/components/ui/Notice";

export function PastVisibilityToggle({
  eventId,
  shownInPast,
  className,
}: {
  eventId: string;
  shownInPast: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const labelId = `passados-${eventId}`;

  function toggle() {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await setHiddenFromPast(eventId, shownInPast);
        if (!result.ok) return setMessage(result.error);
        router.refresh();
      } catch {
        setMessage("Não foi possível alterar a exibição do evento.");
      }
    });
  }

  return (
    <div className={cx("rounded-2xl border border-byla-border bg-byla-surface p-4", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-base font-semibold text-foreground" id={labelId}>
            Mostrar nos eventos passados
          </p>
          <p className="mt-1 text-sm text-byla-muted">
            Depois que o evento acontece, ele continua no site em Eventos passados. Desligue para
            esconder.
          </p>
        </div>
        <button
          aria-checked={shownInPast}
          aria-labelledby={labelId}
          className={cx(
            "relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue disabled:opacity-60",
            shownInPast ? "border-byla-action bg-byla-action" : "border-byla-border bg-byla-overlay",
          )}
          disabled={isPending}
          onClick={toggle}
          role="switch"
          type="button"
        >
          <span
            aria-hidden
            className={cx(
              "inline-block h-6 w-6 rounded-full bg-white shadow transition motion-reduce:transition-none",
              shownInPast ? "translate-x-7" : "translate-x-1",
            )}
          />
        </button>
      </div>
      {message ? (
        <Notice className="mt-3" tone="danger">
          {message}
        </Notice>
      ) : null}
    </div>
  );
}
