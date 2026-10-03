import type { Metadata } from "next";

import { SiteHeader } from "@/components/brand/SiteHeader";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { isReminderOptoutToken } from "@/lib/reminders/rules";

export const metadata: Metadata = {
  title: "Lembretes por e-mail · Espaço Byla Eventos",
  robots: { index: false, follow: false },
};

/**
 * Só mostra o botão: o descadastro acontece no POST, porque leitores de e-mail
 * abrem os links sozinhos para verificar segurança.
 */
export default async function CancelRemindersPage({
  searchParams,
}: PageProps<"/lembretes/cancelar">) {
  const query = await searchParams;
  const token = isReminderOptoutToken(query.t) ? query.t : null;
  const done = query.feito === "1";
  const retry = query.erro === "tente-depois";

  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-12">
        <h1 className="font-display text-4xl tracking-wide text-foreground">
          Lembretes por e-mail
        </h1>
        {done ? (
          <>
            <Notice className="mt-6" tone="success" title="Pronto!">
              Você não vai mais receber lembretes de compra não finalizada. Os
              e-mails com os seus ingressos continuam chegando normalmente.
            </Notice>
            <ButtonLink className="mt-8" href="/" size="lg">
              Ver programação
            </ButtonLink>
          </>
        ) : token ? (
          <>
            <p className="mt-4 text-base leading-relaxed text-byla-muted">
              Quando alguém começa uma compra e não termina, mandamos um único
              lembrete por e-mail. Se não quiser receber esses lembretes, confirme
              abaixo. Os e-mails com os seus ingressos continuam chegando
              normalmente.
            </p>
            {retry ? (
              <Notice className="mt-6" tone="warning">
                Não foi possível concluir agora. Tente de novo em alguns minutos.
              </Notice>
            ) : null}
            <form action="/api/lembretes/cancelar" className="mt-8" method="post">
              <input name="t" type="hidden" value={token} />
              <Button fullWidth size="lg" type="submit">
                Não quero receber lembretes
              </Button>
            </form>
          </>
        ) : (
          <>
            <Notice className="mt-6" live={false} tone="neutral">
              Este link está incompleto ou não vale mais. Use o link do e-mail de
              lembrete mais recente.
            </Notice>
            <ButtonLink className="mt-8" href="/" size="lg" variant="secondary">
              Ver programação
            </ButtonLink>
          </>
        )}
      </main>
    </div>
  );
}
