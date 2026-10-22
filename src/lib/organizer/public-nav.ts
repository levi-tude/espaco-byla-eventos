import "server-only";

import { getActor } from "@/lib/auth/actor";
import { organizerAreaEnabled } from "@/lib/organizer/settings";

/**
 * Destino do botão "Área do organizador" no site público.
 * `null` = área desligada (não mostrar o botão).
 */
export async function organizerAreaPublicHref(): Promise<string | null> {
  if (!(await organizerAreaEnabled())) return null;
  const actor = await getActor();
  if (actor?.kind === "organizador") return "/organizador";
  return "/organizador/entrar";
}
