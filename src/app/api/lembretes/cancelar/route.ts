import { NextResponse } from "next/server";

import { isReminderOptoutToken } from "@/lib/reminders/rules";
import { clientIp, RATE_LIMITS, tryConsumeRateLimit } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

type Outcome = "feito" | "invalido" | "tente-depois";

const ONE_CLICK_STATUS: Record<Outcome, number> = {
  feito: 200,
  invalido: 400,
  "tente-depois": 503,
};

/**
 * Registra "Não quero receber lembretes". Recebe o botão da página
 * `/lembretes/cancelar` e o descadastro com um clique dos programas de e-mail
 * (`List-Unsubscribe-Post`). Sem BotID: esses programas são robôs legítimos.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const form = await request.formData().catch(() => null);
  const oneClick = form?.get("List-Unsubscribe") === "One-Click";
  const token = url.searchParams.get("t") ?? form?.get("t");

  const respond = (outcome: Outcome) => {
    if (oneClick) {
      return NextResponse.json({ ok: outcome === "feito" }, { status: ONE_CLICK_STATUS[outcome] });
    }
    const target = new URL("/lembretes/cancelar", url);
    if (outcome === "feito") target.searchParams.set("feito", "1");
    else {
      target.searchParams.set("erro", outcome);
      if (outcome === "tente-depois" && isReminderOptoutToken(token)) {
        target.searchParams.set("t", token);
      }
    }
    return NextResponse.redirect(target, 303);
  };

  if (!isReminderOptoutToken(token)) return respond("invalido");

  const admin = createAdminClient();
  const limit = await tryConsumeRateLimit(admin, RATE_LIMITS.reminderOptoutPerIp, await clientIp());
  if (limit !== "allowed") return respond("tente-depois");

  const { data, error } = await admin.rpc("register_reminder_optout", { p_token: token });
  if (error) {
    console.error("[lembrete] Falha ao registrar descadastro.", error);
    return respond("tente-depois");
  }
  return respond(data === true ? "feito" : "invalido");
}
