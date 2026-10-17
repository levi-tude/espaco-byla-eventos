"use client";

import { Check, Copy, MessageCircle, Share2 } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import { Button, buttonClasses } from "@/components/ui/Button";
import { controlClasses, labelClasses } from "@/components/ui/Field";
import { cx } from "@/components/ui/cx";
import type { EventShareModel } from "@/lib/events/share-link";

function emptySubscribe() {
  return () => {};
}

function shareSupported() {
  return typeof navigator.share === "function";
}

function shareUnsupported() {
  return false;
}

/** Card para a equipe e o organizador copiarem ou mandarem o link público do evento. */
export function EventSharePanel({ model }: { model: EventShareModel }) {
  const [copied, setCopied] = useState<"" | "ok" | "manual">("");
  const canShare = useSyncExternalStore(emptySubscribe, shareSupported, shareUnsupported);

  if (model.kind === "hidden") return null;
  if (model.kind !== "link") {
    return <p className="mt-4 text-base text-byla-muted">{model.message}</p>;
  }

  const quiet = model.emphasis === "quiet";
  const heading = quiet ? "Link da página do evento encerrado" : "Link da página";

  async function copy() {
    try {
      await navigator.clipboard.writeText(model.kind === "link" ? model.url : "");
      setCopied("ok");
    } catch {
      setCopied("manual");
    }
  }

  async function share() {
    if (model.kind !== "link" || typeof navigator.share !== "function") return;
    const text = [model.eventName, model.whenLabel].filter(Boolean).join("\n");
    try {
      await navigator.share({ title: model.eventName, text, url: model.url });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setCopied("manual");
    }
  }

  return (
    <section
      aria-labelledby="link-publico-titulo"
      className={cx(
        "mt-4 rounded-2xl border p-4",
        quiet ? "border-byla-border bg-byla-bg" : "border-byla-blue/40 bg-byla-surface",
      )}
    >
      <h2
        className={cx("text-base font-semibold", quiet ? "text-byla-muted" : "text-foreground")}
        id="link-publico-titulo"
      >
        {heading}
      </h2>
      <div className="mt-3 flex flex-col gap-1.5">
        <label className={labelClasses} htmlFor="link-publico">
          Endereço para compartilhar
        </label>
        <input
          className={cx(controlClasses, "min-h-12 font-mono text-sm")}
          id="link-publico"
          onFocus={(event) => event.currentTarget.select()}
          readOnly
          value={model.url}
        />
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Button onClick={copy} variant="secondary">
          {copied === "ok" ? <Check aria-hidden className="h-5 w-5" /> : <Copy aria-hidden className="h-5 w-5" />}
          Copiar link
        </Button>
        <a
          className={buttonClasses({ variant: "primary" })}
          href={model.whatsappUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          <MessageCircle aria-hidden className="h-5 w-5" />
          Enviar pelo WhatsApp
        </a>
        {canShare ? (
          <Button className="sm:col-span-2" onClick={share} variant="ghost">
            <Share2 aria-hidden className="h-5 w-5" />
            Compartilhar
          </Button>
        ) : null}
      </div>
      <p aria-live="polite" className="mt-2 text-sm text-byla-muted">
        {copied === "ok" ? "Link copiado." : ""}
        {copied === "manual" ? "Não deu para copiar sozinho. Selecione o endereço e copie pelo menu do aparelho." : ""}
      </p>
    </section>
  );
}
