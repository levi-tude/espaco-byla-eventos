"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";
import { useRouter } from "next/navigation";

import {
  CheckInResultCard,
  resultSummary,
  toCheckInResult,
  type CheckInResponse,
  type CheckInResult,
} from "@/components/equipe/CheckInResultCard";
import {
  keepScreenOn,
  playFeedback,
  unlockAudio,
  type FeedbackTone,
} from "@/components/equipe/check-in-feedback";
import type { MeiaPanelState } from "@/components/equipe/MeiaCheckButtons";
import { Button } from "@/components/ui/Button";
import { controlClasses } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { cx } from "@/components/ui/cx";
import {
  MEIA_REFUSE_CONFIRM,
  MEIA_SKIP_CONFIRM,
  type MeiaResult,
} from "@/lib/domain/meia-check";

function feedbackTone(result: CheckInResult): FeedbackTone {
  if (result.tone === "success") return "success";
  if (result.tone === "meia") return "meia";
  return "error";
}

type MeiaMarkResponse =
  | { ok: true; result: MeiaResult; diffCents: number | null; checkedIn: boolean }
  | { ok: false; message: string; unavailable?: boolean };

export function CheckInScanner({
  eventId,
  sessionId,
  meiaChecks = false,
}: {
  eventId: string;
  sessionId: string;
  /** Banco com a conferência da meia: mostra os 3 botões depois de ler uma meia. */
  meiaChecks?: boolean;
}) {
  const router = useRouter();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const processingRef = useRef(false);
  const [cameraError, setCameraError] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [awaitingNext, setAwaitingNext] = useState(false);
  const [result, setResult] = useState<CheckInResult>({ tone: "idle" });
  const [meia, setMeia] = useState<MeiaPanelState | null>(null);
  // Ref (e não estado) para não reiniciar a câmera quando a conferência for desligada.
  const meiaFeatureRef = useRef(meiaChecks);

  // Tela acesa enquanto a portaria está aberta; o som é liberado no primeiro toque (iPhone).
  useEffect(() => {
    const release = keepScreenOn();
    window.addEventListener("pointerdown", unlockAudio);
    return () => {
      release();
      window.removeEventListener("pointerdown", unlockAudio);
    };
  }, []);

  const pauseForNext = useCallback(() => {
    if (scannerRef.current?.isScanning) {
      try {
        scannerRef.current.pause(true);
      } catch {
        // Câmera pode já estar pausada
      }
    }
    setAwaitingNext(true);
  }, []);

  const checkIn = useCallback(
    async (rawCode: string) => {
      const code = rawCode.trim();
      if (!code || processingRef.current) return;

      processingRef.current = true;
      setResult({ tone: "loading" });

      let next: CheckInResult;
      try {
        const response = await fetch("/api/check-in", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId, sessionId, code }),
        });
        const data = (await response.json()) as CheckInResponse;
        next = toCheckInResult(data);
        if (data.ok) {
          setManualCode("");
          router.refresh();
        }
      } catch {
        next = { tone: "error", message: "Falha de conexão. Tente novamente." };
      }
      setResult(next);
      setMeia(
        meiaFeatureRef.current && next.tone === "meia" && next.ticketId
          ? { enabled: true, mark: null, busy: false, error: null, diffCents: next.meiaDiffCents ?? null }
          : null,
      );
      playFeedback(feedbackTone(next));
      // Pausa após qualquer resposta para não reler o mesmo QR em loop
      pauseForNext();
    },
    [eventId, sessionId, pauseForNext, router],
  );

  async function markMeia(mark: MeiaResult) {
    if (result.tone !== "meia" || !result.ticketId || !meia || meia.busy) return;
    if (mark === "recusado" && !window.confirm(MEIA_REFUSE_CONFIRM)) return;
    setMeia({ ...meia, busy: true, error: null });
    try {
      const response = await fetch("/api/check-in/meia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, ticketId: result.ticketId, result: mark }),
      });
      const data = (await response.json()) as MeiaMarkResponse;
      if (data.ok) {
        setMeia({
          ...meia,
          busy: false,
          error: null,
          mark: data.result,
          diffCents: data.diffCents ?? meia.diffCents,
        });
        playFeedback(data.result === "recusado" ? "error" : "success");
        router.refresh();
      } else if (data.unavailable) {
        // Banco ainda sem a migration: some com os botões, a entrada continua valendo.
        meiaFeatureRef.current = false;
        setMeia(null);
        setCameraError(data.message);
      } else {
        setMeia({ ...meia, busy: false, error: data.message });
      }
    } catch {
      setMeia({ ...meia, busy: false, error: "Falha de conexão. Tente de novo." });
    }
  }

  /** "Foi engano" depois de recusar: dá entrada de novo pela mesma função do check-in. */
  async function redoEntry() {
    if (result.tone !== "meia" || !result.ticketId || !meia || meia.busy) return;
    setMeia({ ...meia, busy: true, error: null });
    try {
      const response = await fetch("/api/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, sessionId, ticketId: result.ticketId }),
      });
      const data = (await response.json()) as CheckInResponse;
      if (data.ok) {
        setResult(toCheckInResult(data));
        setMeia({ ...meia, busy: false, error: null, mark: null });
        playFeedback("meia");
        router.refresh();
      } else {
        setMeia({ ...meia, busy: false, error: data.message });
      }
    } catch {
      setMeia({ ...meia, busy: false, error: "Falha de conexão. Tente de novo." });
    }
  }

  useEffect(() => {
    let disposed = false;

    async function startCamera() {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (disposed) return;

        const scanner = new Html5Qrcode("check-in-reader");
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: (width, height) => {
              const size = Math.min(width, height, 280);
              return { width: size, height: size };
            },
          },
          (decodedText) => {
            void checkIn(decodedText);
          },
          () => undefined,
        );

        if (disposed && scanner.isScanning) {
          await scanner.stop();
        }
      } catch {
        if (!disposed) {
          setCameraError(
            "Não foi possível abrir a câmera. Autorize o acesso ou digite o código abaixo.",
          );
        }
      }
    }

    void startCamera();

    return () => {
      disposed = true;
      const scanner = scannerRef.current;
      scannerRef.current = null;
      if (scanner?.isScanning) {
        void scanner.stop().catch(() => undefined);
      }
    };
  }, [checkIn]);

  function submitManualCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void checkIn(manualCode);
  }

  function scanNextTicket() {
    if (meia?.enabled && meia.mark === null && !window.confirm(MEIA_SKIP_CONFIRM)) return;
    setMeia(null);
    setAwaitingNext(false);
    setResult({ tone: "idle" });
    processingRef.current = false;
    try {
      scannerRef.current?.resume();
    } catch {
      setCameraError(
        "Não foi possível retomar a câmera. Digite o próximo código abaixo.",
      );
    }
  }

  const idle = result.tone === "idle";
  const positive = result.tone === "success" || result.tone === "meia";

  return (
    <div className="space-y-4">
      <section className="grid overflow-hidden rounded-2xl bg-zinc-950 p-2 shadow-lg sm:p-3">
        <div
          aria-label="Leitor de QR Code"
          className="col-start-1 row-start-1 mx-auto aspect-square max-h-[60dvh] w-full max-w-xl overflow-hidden rounded-xl"
          id="check-in-reader"
        />

        <CheckInResultCard
          action={
            awaitingNext ? (
              <button
                className="mt-2 min-h-12 rounded-xl bg-white px-6 text-base font-semibold text-zinc-900 shadow transition hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                onClick={scanNextTicket}
                type="button"
              >
                Próximo ingresso
              </button>
            ) : null
          }
          meia={meia ?? undefined}
          onMeiaMark={(mark) => void markMeia(mark)}
          onRedoEntry={() => void redoEntry()}
          result={result}
        />
      </section>

      {cameraError ? <Notice tone="warning">{cameraError}</Notice> : null}

      <form
        className="rounded-2xl border border-byla-border bg-byla-surface p-4 sm:p-5"
        onSubmit={submitManualCode}
      >
        <label className="text-base font-semibold text-foreground" htmlFor="manual-code">
          Digitar código do ingresso
        </label>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <input
            autoCapitalize="none"
            autoComplete="off"
            className={cx(controlClasses, "min-h-12 flex-1 text-lg")}
            id="manual-code"
            onChange={(event) => setManualCode(event.target.value)}
            placeholder="Código do ingresso"
            spellCheck={false}
            value={manualCode}
          />
          <Button
            disabled={!manualCode.trim() || result.tone === "loading" || awaitingNext}
            size="lg"
            type="submit"
          >
            Verificar
          </Button>
        </div>
        {!idle ? (
          <p
            aria-hidden
            className={cx(
              "mt-3 text-base font-semibold",
              result.tone === "success" && "text-byla-success",
              result.tone === "meia" && "text-byla-warning",
              !positive && result.tone !== "loading" && "text-byla-danger",
              result.tone === "loading" && "text-byla-muted",
            )}
          >
            {resultSummary(result)}
            {meia?.enabled && meia.mark === null ? " · conferência da meia pendente" : ""}
          </p>
        ) : null}
      </form>
    </div>
  );
}
