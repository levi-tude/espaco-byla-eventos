import "server-only";

import { cookies } from "next/headers";

import { getActor } from "@/lib/auth/actor";

/** Cookie de sessão do Supabase Auth (`sb-<ref>-auth-token` e pedaços). */
function hasAuthSessionCookie(all: { name: string }[]): boolean {
  return all.some((cookie) => /^sb-.+-auth-token/.test(cookie.name));
}

function errorMeta(error: unknown): { name: string; code?: string } {
  if (!error || typeof error !== "object") return { name: "desconhecido" };
  const name =
    "name" in error && typeof (error as { name?: unknown }).name === "string"
      ? (error as { name: string }).name
      : "Error";
  const code =
    "code" in error && (error as { code?: unknown }).code != null
      ? String((error as { code: unknown }).code)
      : undefined;
  return code ? { name, code } : { name };
}

/**
 * Destino do botão "Área do organizador" no site público.
 * Sem cookie de sessão: vai para entrar, sem consultar o banco.
 */
export async function organizerAreaPublicHref(): Promise<string> {
  const jar = await cookies();
  if (!hasAuthSessionCookie(jar.getAll())) return "/organizador/entrar";

  try {
    const actor = await getActor();
    if (actor?.kind === "organizador") return "/organizador";
  } catch (error) {
    console.error("[organizador] Falha ao resolver o link da área pública.", errorMeta(error));
  }
  return "/organizador/entrar";
}
