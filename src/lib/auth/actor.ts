import "server-only";

import { cache } from "react";

import { ActionError } from "@/lib/action-result";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

export type Actor =
  | { kind: "equipe"; userId: string; isAdmin: boolean; isDeveloper: boolean }
  | { kind: "organizador"; userId: string };

export const ACCESS_DENIED_MESSAGE = "Acesso não permitido.";
export const EVENT_NOT_FOUND_MESSAGE = "Evento não encontrado.";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Quem está agindo, conferido com a sessão do usuário (is_staff/is_organizer exigem
 * o código do e-mail). Qualquer falha = null (falha fechada).
 */
export const getActor = cache(async (): Promise<Actor | null> => {
  const supabase = await createServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return null;

  const [staff, organizer] = await Promise.all([supabase.rpc("is_staff"), supabase.rpc("is_organizer")]);
  if (staff.error || organizer.error) {
    console.error("[acesso] Falha ao conferir o tipo da conta.", staff.error?.code ?? organizer.error?.code);
    return null;
  }
  if (staff.data === true) {
    const { data: role, error } = await createAdminClient().rpc("staff_finance_role", {
      p_staff_user_id: user.id,
    });
    if (error) {
      console.error("[acesso] Falha ao conferir o papel da conta.", error.code);
      return null;
    }
    return {
      kind: "equipe",
      userId: user.id,
      isAdmin: role === "admin" || role === "admin_dev",
      isDeveloper: role === "admin_dev",
    };
  }
  if (organizer.data === true) return { kind: "organizador", userId: user.id };
  return null;
});

export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new ActionError(ACCESS_DENIED_MESSAGE);
  return actor;
}

export async function requireOrganizer(): Promise<{ userId: string }> {
  const actor = await requireActor();
  if (actor.kind !== "organizador") throw new ActionError(ACCESS_DENIED_MESSAGE);
  return { userId: actor.userId };
}

export async function requireTeamAdmin(): Promise<{ userId: string; isDeveloper: boolean }> {
  const actor = await requireActor();
  if (actor.kind !== "equipe" || !actor.isAdmin) throw new ActionError(ACCESS_DENIED_MESSAGE);
  return { userId: actor.userId, isDeveloper: actor.isDeveloper };
}

/** Equipe acessa qualquer evento; organizador, só os próprios (resposta do banco). */
export const requireEventAccess = cache(
  async (eventId: unknown): Promise<{ actor: Actor; access: "equipe" | "dono" }> => {
    if (typeof eventId !== "string" || !UUID_PATTERN.test(eventId)) {
      throw new ActionError(EVENT_NOT_FOUND_MESSAGE);
    }
    const actor = await requireActor();
    const { data, error } = await createAdminClient().rpc("actor_event_access", {
      p_actor_user_id: actor.userId,
      p_event_id: eventId,
    });
    if (error) {
      console.error("[acesso] Falha ao conferir o evento.", error.code);
      throw new ActionError(EVENT_NOT_FOUND_MESSAGE);
    }
    if (data !== "equipe" && data !== "dono") throw new ActionError(EVENT_NOT_FOUND_MESSAGE);
    return { actor, access: data };
  },
);
