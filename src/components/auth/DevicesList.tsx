"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { ActionResult } from "@/lib/action-result";
import { eventDateFormatter } from "@/lib/datetime";

export type RememberedDevice = {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  /** O aparelho deste navegador. */
  isCurrent: boolean;
};

const dateFormatter = eventDateFormatter({ dateStyle: "short" });

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : dateFormatter.format(date);
}

/** Lista de aparelhos lembrados com "Esquecer" (organizador e equipe passam a própria ação). */
export function DevicesList({
  devices,
  onForget,
}: {
  devices: RememberedDevice[];
  onForget: (deviceId: string) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  if (!devices.length) {
    return <p className="text-base text-byla-muted">Nenhum aparelho lembrado.</p>;
  }

  function forget(deviceId: string) {
    setError("");
    setPendingId(deviceId);
    startTransition(async () => {
      const result = await onForget(deviceId).catch(() => null);
      setPendingId(null);
      if (!result?.ok) {
        setError(result?.error ?? "Não foi possível esquecer o aparelho. Tente de novo.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-byla-border rounded-xl border border-byla-border">
        {devices.map((device) => (
          <li className="flex flex-wrap items-center justify-between gap-3 p-3 sm:p-4" key={device.id}>
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                {device.label}
                {device.isCurrent ? <StatusBadge tone="info">Este aparelho</StatusBadge> : null}
              </p>
              <p className="mt-0.5 text-sm text-byla-muted">
                Lembrado em {formatDate(device.createdAt)}
                {device.lastUsedAt ? ` · último uso em ${formatDate(device.lastUsedAt)}` : ""}
                {` · vale até ${formatDate(device.expiresAt)}`}
              </p>
            </div>
            <Button
              disabled={isPending && pendingId !== device.id}
              loading={pendingId === device.id}
              loadingLabel="Esquecendo..."
              onClick={() => forget(device.id)}
              variant="secondary"
            >
              Esquecer
            </Button>
          </li>
        ))}
      </ul>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <p className="text-sm text-byla-muted">
        O aparelho esquecido vai pedir o código do e-mail no próximo acesso.
      </p>
    </div>
  );
}
