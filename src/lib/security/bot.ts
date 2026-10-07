import "server-only";

import { alertTeamSetup, type TeamSetupAlertKind } from "@/lib/alerts/team-alert";
import {
  HUMAN_TOKEN_MAX_LENGTH,
  TURNSTILE_ORIGIN,
  type HumanCheckAction,
} from "@/lib/security/human-check";
import { clientIp } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export const BOT_BLOCKED_MESSAGE =
  "Não conseguimos confirmar seu acesso. Atualize a página e tente novamente.";

export const TURNSTILE_VERIFY_URL = `${TURNSTILE_ORIGIN}/turnstile/v0/siteverify`;

const VERIFY_TIMEOUT_MS = 5000;

type SiteverifyResponse = { success?: unknown; action?: unknown };

async function notifyTeam(kind: TeamSetupAlertKind, details: string): Promise<void> {
  try {
    await alertTeamSetup(createAdminClient(), kind, details);
  } catch (error) {
    console.error("[seguranca] Falha ao avisar a equipe sobre a verificação anti-robô.", error);
  }
}

/**
 * Verificação anti-robô (Cloudflare Turnstile). Falha fechada: em produção sem as
 * chaves, sem token ou com o serviço fora do ar, a ação é recusada. Só em
 * desenvolvimento/teste sem chave a verificação é pulada.
 */
export async function isBotRequest(token: unknown, action: HumanCheckAction): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  if (!secret || !siteKey) {
    if (process.env.NODE_ENV !== "production") return false;
    console.error(
      "[seguranca] Compras bloqueadas: configure TURNSTILE_SECRET_KEY e NEXT_PUBLIC_TURNSTILE_SITE_KEY.",
    );
    await notifyTeam(
      "antirrobo_sem_chave",
      "O site está recusando compras e pagamentos porque falta a chave da verificação anti-robô (Cloudflare Turnstile). Cadastre TURNSTILE_SECRET_KEY e NEXT_PUBLIC_TURNSTILE_SITE_KEY na hospedagem e publique de novo (a chave pública entra no build).",
    );
    return true;
  }

  if (typeof token !== "string" || !token || token.length > HUMAN_TOKEN_MAX_LENGTH) {
    return true;
  }

  const body = new URLSearchParams({ secret, response: token });
  const ip = await clientIp();
  if (ip !== "desconhecido") body.set("remoteip", ip);

  let result: SiteverifyResponse;
  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    result = (await response.json()) as SiteverifyResponse;
  } catch (error) {
    console.error("[seguranca] Verificação anti-robô indisponível; recusando.", error);
    await notifyTeam(
      "antirrobo_indisponivel",
      "A verificação anti-robô (Cloudflare Turnstile) não respondeu, e o site recusou ao menos uma compra ou pagamento. Se persistir, confira https://www.cloudflarestatus.com e a chave secreta cadastrada na hospedagem.",
    );
    return true;
  }

  return result.success !== true || result.action !== action;
}
