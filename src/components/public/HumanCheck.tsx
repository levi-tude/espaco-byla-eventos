"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { type HumanCheckAction, TURNSTILE_SCRIPT_URL } from "@/lib/security/human-check";

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
const TOKEN_WAIT_MS = 30_000;

let scriptPromise: Promise<TurnstileApi> | null = null;

// Inserido por código já autorizado pelo nonce: a CSP ('strict-dynamic') permite.
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error("verificação indisponível"));
    script.onerror = () => {
      scriptPromise = null;
      script.remove();
      reject(new Error("verificação indisponível"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/**
 * Verificação anti-robô. Normalmente invisível; só aparece quando o serviço pede
 * uma interação. Sem a chave pública (desenvolvimento) não renderiza nada e
 * `takeToken` devolve `null`, que o servidor aceita só fora de produção.
 */
export function useHumanCheck(action: HumanCheckAction): {
  slot: ReactNode;
  takeToken: () => Promise<string | null>;
} {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);
  const widgetId = useRef<string | null>(null);
  const token = useRef<string | null>(null);
  const waiters = useRef<Array<(value: string | null) => void>>([]);

  useEffect(() => {
    if (!SITE_KEY || !container) return;
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled) return;
        widgetId.current = api.render(container, {
          sitekey: SITE_KEY,
          action,
          appearance: "interaction-only",
          size: "flexible",
          theme: "auto",
          language: "pt-br",
          callback: (value: string) => {
            token.current = value;
            setFailed(false);
            waiters.current.splice(0).forEach((resolve) => resolve(value));
          },
          "expired-callback": () => {
            token.current = null;
          },
          "error-callback": () => {
            token.current = null;
            setFailed(true);
          },
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
      token.current = null;
    };
  }, [action, container]);

  const takeToken = useCallback(async (): Promise<string | null> => {
    if (!SITE_KEY) return null;
    const value =
      token.current ??
      (await new Promise<string | null>((resolve) => {
        const done = (result: string | null) => {
          clearTimeout(timer);
          resolve(result);
        };
        const timer = setTimeout(() => {
          waiters.current = waiters.current.filter((waiter) => waiter !== done);
          resolve(null);
        }, TOKEN_WAIT_MS);
        waiters.current.push(done);
      }));
    // Cada token vale uma vez: já prepara o próximo para uma nova tentativa.
    token.current = null;
    if (widgetId.current) window.turnstile?.reset(widgetId.current);
    return value;
  }, []);

  const slot = SITE_KEY ? (
    <div className="grid gap-2">
      <div className="max-w-full" ref={setContainer} />
      {failed ? (
        <p className="text-sm text-byla-muted" role="status">
          Não conseguimos carregar a verificação de segurança. Confira sua conexão e
          atualize a página.
        </p>
      ) : null}
    </div>
  ) : null;

  return { slot, takeToken };
}
