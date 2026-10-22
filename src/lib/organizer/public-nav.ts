import "server-only";

import { getActor } from "@/lib/auth/actor";

/**
 * Destino do botão "Área do organizador" no site público.
 * Sempre disponível (não depende da chave da área).
 */
export async function organizerAreaPublicHref(): Promise<string> {
  try {
    const actor = await getActor();
    if (actor?.kind === "organizador") return "/organizador";
  } catch (error) {
    console.error("[organizador] Falha ao resolver o link da área pública.", error);
  }
  return "/organizador/entrar";
}
