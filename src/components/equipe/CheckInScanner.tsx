"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";

import type { Enums } from "@/types/database";

type CheckInResponse =
  | {
      ok: true;
      buyerName: string;
      kind: Enums<"ticket_kind">;
    }
  | {
      ok: false;
      message: string;
    };

type Result =
  | { tone: "idle"; message: "Aponte a câmera para o QR Code" }
  | { tone: "loading"; message: "Verificando ingresso..." }
  | { tone: "success"; message: "Pode entrar"; detail: string }
  | { tone: "error"; message: string };

const kindLabels: Record<Enums<"ticket_kind">, string> = {
  inteira: "Inteira",
  meia: "Meia-entrada",
  cortesia: "Cortesia",
};

const resultStyles: Record<Result["tone"], string> = {
  idle: "border-zinc-300 bg-white text-zinc-900",
  loading: "border-amber-300 bg-amber-50 text-amber-950",
  success: "border-emerald-500 bg-emerald-100 text-emerald-950",
  error: "border-red-500 bg-red-100 text-red-950",
};

export function CheckInScanner({ eventId }: { eventId: string }) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const processingRef = useRef(false);
  const [cameraError, setCameraError] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [awaitingNext, setAwaitingNext] = useState(false);
  const [result, setResult] = useState<Result>({
    tone: "idle",
    message: "Aponte a câmera para o QR Code",
  });

  const checkIn = useCallback(
    async (rawCode: string) => {
      const code = rawCode.trim();
      if (!code || processingRef.current) return;

      processingRef.current = true;
      let keepPaused = false;
      setResult({ tone: "loading", message: "Verificando ingresso..." });

      try {
        const response = await fetch("/api/check-in", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId, code }),
        });
        const data = (await response.json()) as CheckInResponse;

        if (data.ok) {
          keepPaused = true;
          if (scannerRef.current?.isScanning) {
            scannerRef.current.pause(true);
          }
          setResult({
            tone: "success",
            message: "Pode entrar",
            detail: `${data.buyerName} · ${kindLabels[data.kind]}`,
          });
          setManualCode("");
          setAwaitingNext(true);
        } else {
          setResult({ tone: "error", message: data.message });
        }
      } catch {
        setResult({
          tone: "error",
          message: "Falha de conexão. Tente novamente.",
        });
      } finally {
        if (!keepPaused) processingRef.current = false;
      }
    },
    [eventId],
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

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl bg-zinc-950 p-3 shadow-lg">
        <div
          aria-label="Leitor de QR Code"
          className="mx-auto aspect-square max-h-[62vh] w-full max-w-xl overflow-hidden rounded-xl"
          id="check-in-reader"
        />
      </section>

      {cameraError ? (
        <p
          className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-base font-medium text-amber-950"
          role="alert"
        >
          {cameraError}
        </p>
      ) : null}

      <section
        aria-live="assertive"
        className={`rounded-2xl border-2 p-6 text-center ${resultStyles[result.tone]}`}
      >
        <p className="text-3xl font-bold">{result.message}</p>
        {"detail" in result ? (
          <p className="mt-2 text-lg font-semibold">{result.detail}</p>
        ) : null}
        {awaitingNext ? (
          <button
            className="mt-5 min-h-12 rounded-xl bg-emerald-800 px-6 text-base font-semibold text-white"
            onClick={scanNextTicket}
            type="button"
          >
            Próximo ingresso
          </button>
        ) : null}
      </section>

      <form
        className="rounded-2xl border border-zinc-200 bg-white p-5"
        onSubmit={submitManualCode}
      >
        <label className="text-base font-semibold" htmlFor="manual-code">
          Digitar código do ingresso
        </label>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <input
            autoComplete="off"
            className="min-h-12 flex-1 rounded-xl border border-zinc-300 px-4 text-lg"
            id="manual-code"
            onChange={(event) => setManualCode(event.target.value)}
            placeholder="Código do ingresso"
            value={manualCode}
          />
          <button
            className="min-h-12 rounded-xl bg-zinc-950 px-6 text-base font-semibold text-white disabled:opacity-50"
            disabled={
              !manualCode.trim() || result.tone === "loading" || awaitingNext
            }
            type="submit"
          >
            Verificar
          </button>
        </div>
      </form>
    </div>
  );
}
