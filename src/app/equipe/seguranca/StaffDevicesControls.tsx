"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { forgetStaffDevices } from "@/app/equipe/seguranca/actions";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";

const GENERIC_ERROR = "Não foi possível esquecer os aparelhos. Tente de novo.";

/** "Esquecer aparelhos" de outra conta da equipe, com confirmação. */
export function ForgetStaffDevicesButton({ userId }: { userId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  function forget() {
    setError("");
    startTransition(async () => {
      const result = await forgetStaffDevices(userId).catch(() => null);
      if (!result?.ok) {
        setError(result?.error ?? GENERIC_ERROR);
        return;
      }
      setConfirming(false);
      setDone(true);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-2">
      {confirming ? (
        <div className="grid gap-2 rounded-xl border border-byla-border p-3">
          <p className="text-base">
            Todos os aparelhos lembrados desta conta vão pedir o código do e-mail no próximo acesso. Quem estiver
            usando o painel agora vai precisar do código de novo.
          </p>
          <div className="grid gap-2 sm:flex sm:flex-wrap">
            <Button loading={isPending} loadingLabel="Esquecendo..." onClick={forget} variant="danger">
              Confirmar
            </Button>
            <Button disabled={isPending} onClick={() => setConfirming(false)} variant="ghost">
              Voltar
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button
            onClick={() => {
              setDone(false);
              setConfirming(true);
            }}
            variant="secondary"
          >
            Esquecer aparelhos
          </Button>
        </div>
      )}
      {done ? (
        <Notice tone="success">Aparelhos esquecidos. No próximo acesso, a conta vai pedir o código do e-mail.</Notice>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </div>
  );
}
