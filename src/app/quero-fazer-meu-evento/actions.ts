"use server";

import { ActionError, type ActionResult, runAction } from "@/lib/action-result";
import { PRIVACY_POLICY_VERSION } from "@/lib/legal/privacy";
import { organizerErrorMessage } from "@/lib/organizer/errors";
import { notifyTeamSignupRequest } from "@/lib/organizer/notify";
import { ORGANIZER_AREA_UNAVAILABLE_MESSAGE, organizerAreaEnabled } from "@/lib/organizer/settings";
import { parseSignupRequest } from "@/lib/organizer/validation";
import { BOT_BLOCKED_MESSAGE, isBotRequest } from "@/lib/security/bot";
import { clientIp, consumeRateLimit, RATE_LIMIT_MESSAGE, RATE_LIMITS } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export type OrganizerRequestInput = {
  name: string;
  contact: string;
  idea: string;
  approxDate: string;
  privacyAccepted: boolean;
  /** Token da verificação anti-robô gerado no navegador para a ação "org_request". */
  humanToken: string | null;
};

const FALLBACK_MESSAGE = "Não foi possível enviar seu pedido agora. Tente de novo em alguns minutos.";

/** Só o código ORG_* vai para o log: nunca nome, contato ou ideia. */
function refusalMessage(dbMessage: string): string {
  if (dbMessage.includes("ORG_LIMITE")) return RATE_LIMIT_MESSAGE;
  const known = /\bORG_[A-Z]+/.exec(dbMessage)?.[0];
  console.error(`[pedido-organizador] Banco recusou o pedido (${known ?? "erro inesperado"}).`);
  return (known && organizerErrorMessage(dbMessage)) || FALLBACK_MESSAGE;
}

/** "Quero fazer meu evento": nenhum e-mail sai para quem pediu, só o aviso à equipe. */
export async function submitOrganizerRequest(input: OrganizerRequestInput): Promise<ActionResult> {
  return runAction(async () => {
    if (!(await organizerAreaEnabled())) throw new ActionError(ORGANIZER_AREA_UNAVAILABLE_MESSAGE);

    const parsed = parseSignupRequest(input);
    if (!parsed.ok) throw new ActionError(parsed.error);

    if (await isBotRequest(input.humanToken, "org_request")) throw new ActionError(BOT_BLOCKED_MESSAGE);

    const admin = createAdminClient();
    if (!(await consumeRateLimit(admin, RATE_LIMITS.organizerRequestPerIp, await clientIp()))) {
      throw new ActionError(RATE_LIMIT_MESSAGE);
    }

    const { name, contact, idea, approxDate } = parsed.value;
    const { error } = await admin.rpc("submit_signup_request", {
      p_name: name,
      p_contact: contact,
      p_idea: idea,
      p_approx_date: approxDate,
      p_privacy_version: PRIVACY_POLICY_VERSION,
    });
    if (error) throw new ActionError(refusalMessage(error.message ?? ""));

    await notifyTeamSignupRequest(admin);
    return undefined;
  }, FALLBACK_MESSAGE);
}
