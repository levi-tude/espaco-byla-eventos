"use client";

import { CircleCheck, CircleX, LoaderCircle, ScanLine } from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";

import { Button } from "@/components/ui/Button";
import { controlClasses } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { cx } from "@/components/ui/cx";
import { ticketKindLabels } from "@/lib/domain/ticket-types";
import type { Enums } from "@/types/database";

type CheckInResponse =
  | {
      ok: true;
      buyerName: string;
      kind: Enums<"ticket_kind">;
      typeLabel?: string;
      sessionLine?: string;
    }
  | {
      ok: false;
      message: string;
    };

type Result =
  | { tone: "idle"; message: "Aponte a câmera para o QR Code" }
  | { tone: "loading"; message: "Verificando ingresso..." }
  | { tone: "success"; message: "Pode entrar"; detail: string; sessionLine: string }
  | { tone: "error"; message: string };

/** O resultado cobre a câmera para a equipe ver de longe; o leitor já fica pausado nesse momento. */
const resultStyles: Record<Result["tone"], string> = {
  idle: "px-3 pb-2 pt-3 text-white/90",
  loading: "absolute inset-0 z-10 bg-black/75 text-white",
  success: "absolute inset-0 z-10 bg-byla-success-solid/95 text-white",
  error: "absolute inset-0 z-10 bg-byla-danger-solid/95 text-white",
};

const resultIcons: Record<Result["tone"], typeof ScanLine> = {
  idle: ScanLine,
  loading: LoaderCircle,
  success: CircleCheck,
  error: CircleX,
};

export function CheckInScanner({ eventId, sessionId }: { eventId: string; sessionId: string }) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const processingRef = useRef(false);
  const [cameraError, setCameraError] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [awaitingNext, setAwaitingNext] = useState(false);
  const [result, setResult] = useState<Result>({
    tone: "idle",
    message: "Aponte a câmera para o QR Code",
  });

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
      setResult({ tone: "loading", message: "Verificando ingresso..." });

      try {
        const response = await fetch("/api/check-in", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId, sessionId, code }),
        });
        const data = (await response.json()) as CheckInResponse;

        if (data.ok) {
          setResult({
            tone: "success",
            message: "Pode entrar",
            detail: `${data.buyerName} · ${data.typeLabel ?? ticketKindLabels[data.kind]}`,
            sessionLine: data.sessionLine ?? "",
          });
          setManualCode("");
        } else {
          setResult({ tone: "error", message: data.message });
        }
        // Pausa após qualquer resposta para não reler o mesmo QR em loop
        pauseForNext();
      } catch {
        setResult({
          tone: "error",
          message: "Falha de conexão. Tente novamente.",
        });
        pauseForNext();
      }
    },
    [eventId, sessionId, pauseForNext],
  );

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
    setAwaitingNext(false);
    setResult({ tone: "idle", message: "Aponte a câmera para o QR Code" });
    processingRef.current = false;
    try {
      scannerRef.current?.resume();
    } catch {
      setCameraError(
        "Não foi possível retomar a câmera. Digite o próximo código abaixo.",
      );
    }
  }

  const ResultIcon = resultIcons[result.tone];
  const idle = result.tone === "idle";

  return (
    <div className="space-y-4">
      <section className="relative overflow-hidden rounded-2xl bg-zinc-950 p-2 shadow-lg sm:p-3">
        <div
          aria-label="Leitor de QR Code"
          className="mx-auto aspect-square max-h-[60dvh] w-full max-w-xl overflow-hidden rounded-xl"
          id="check-in-reader"
        />

        <div
          aria-live="assertive"
          className={cx(
            "flex items-center justify-center text-center",
            idle ? "gap-2" : "flex-col gap-2 p-6",
            resultStyles[result.tone],
          )}
        >
          <ResultIcon
            aria-hidden
            className={cx(
              "shrink-0",
              idle ? "h-5 w-5" : "h-16 w-16",
              result.tone === "loading" && "animate-spin motion-reduce:animate-none",
            )}
          />
          <p className={idle ? "text-base font-medium" : "text-3xl font-bold"}>
            {result.message}
          </p>
          {"detail" in result ? (
            <p className="text-lg font-semibold">{result.detail}</p>
          ) : null}
          {"sessionLine" in result && result.sessionLine ? (
            <p className="text-base">{result.sessionLine}</p>
          ) : null}
          {awaitingNext ? (
            <button
              className="mt-3 min-h-12 rounded-xl bg-white px-6 text-base font-semibold text-zinc-900 transition hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              onClick={scanNextTicket}
              type="button"
            >
              Próximo ingresso
            </button>
          ) : null}
        </div>
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
              "mt-3 flex items-center gap-2 text-base font-semibold",
              result.tone === "success" && "text-byla-success",
              result.tone === "error" && "text-byla-danger",
              result.tone === "loading" && "text-byla-muted",
            )}
          >
            <ResultIcon
              className={cx(
                "h-5 w-5 shrink-0",
                result.tone === "loading" && "animate-spin motion-reduce:animate-none",
              )}
            />
            {result.message}
          </p>
        ) : null}
      </form>
    </div>
  );
}
