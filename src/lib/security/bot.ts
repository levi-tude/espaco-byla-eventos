import "server-only";

import { checkBotId } from "botid/server";

export const BOT_BLOCKED_MESSAGE =
  "Não conseguimos confirmar seu acesso. Atualize a página e tente novamente.";

/**
 * Vercel BotID (invisível para o comprador). Se o serviço falhar, não barra a
 * compra: o limite de tentativas no banco continua valendo como segunda camada.
 */
export async function isBotRequest(): Promise<boolean> {
  try {
    const verification = await checkBotId();
    return verification.isBot;
  } catch (error) {
    console.error("[seguranca] BotID indisponível.", error);
    return false;
  }
}
