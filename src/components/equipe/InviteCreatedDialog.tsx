"use client";

import { Copy, MessageCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button, buttonClasses } from "@/components/ui/Button";
import { controlClasses, labelClasses } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { cx } from "@/components/ui/cx";
import { eventDateFormatter } from "@/lib/datetime";

export const INVITE_ONCE_WARNING = "Este link aparece só agora. Se perder, revogue e gere outro.";

const expiresFormatter = eventDateFormatter({ dateStyle: "short", timeStyle: "short" });

type Props = {
  title: string;
  link: string;
  whatsappUrl: string;
  expiresAt: string;
  /** Aviso de que o link não aparece de novo (o banco guarda só o hash). */
  warning?: string;
  onClose: () => void;
};

/** Mostra o link uma única vez, com copiar e WhatsApp. Fechou, o link some da tela. */
export function InviteCreatedDialog({ title, link, whatsappUrl, expiresAt, warning = INVITE_ONCE_WARNING, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState<"" | "ok" | "manual">("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  const expires = new Date(expiresAt);
  const expiresLabel = Number.isNaN(expires.getTime()) ? "" : expiresFormatter.format(expires);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied("ok");
    } catch {
      inputRef.current?.select();
      setCopied("manual");
    }
  }

  return (
    <dialog
      aria-labelledby="link-gerado-titulo"
      className="m-auto max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-lg overflow-y-auto rounded-2xl border border-byla-border bg-byla-surface p-0 text-foreground backdrop:bg-black/70"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      ref={dialogRef}
    >
      <div className="grid gap-4 p-4 sm:p-6">
        <h2 className="break-words text-xl font-semibold" id="link-gerado-titulo">
          {title}
        </h2>

        <Notice live={false} tone="warning">
          {warning}
        </Notice>

        <div className="flex flex-col gap-1.5">
          <label className={labelClasses} htmlFor="link-gerado">
            Link
          </label>
          <input
            className={cx(controlClasses, "min-h-12 font-mono text-sm")}
            id="link-gerado"
            onFocus={(event) => event.currentTarget.select()}
            readOnly
            ref={inputRef}
            value={link}
          />
          {expiresLabel ? <p className="text-sm text-byla-muted">Vale até {expiresLabel}.</p> : null}
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <Button onClick={copy} variant="secondary">
            <Copy aria-hidden className="h-5 w-5" />
            Copiar link
          </Button>
          <a
            className={buttonClasses({ variant: "primary" })}
            href={whatsappUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            <MessageCircle aria-hidden className="h-5 w-5" />
            Enviar pelo WhatsApp
          </a>
        </div>
        {copied === "ok" ? <Notice tone="success">Link copiado.</Notice> : null}
        {copied === "manual" ? (
          <Notice tone="info">Não deu para copiar sozinho. O link está selecionado: copie pelo menu do aparelho.</Notice>
        ) : null}

        <div className="flex justify-end">
          <Button onClick={onClose} variant="ghost">
            Fechar
          </Button>
        </div>
      </div>
    </dialog>
  );
}
