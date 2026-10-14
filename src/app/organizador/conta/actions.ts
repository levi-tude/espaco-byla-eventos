"use server";

import { revalidatePath } from "next/cache";

import { ActionError, runAction, type ActionResult } from "@/lib/action-result";
import { requireOrganizer } from "@/lib/auth/actor";
import { createServerClient } from "@/lib/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GENERIC_ERROR = "Não foi possível esquecer o aparelho. Tente de novo.";

/** Com a sessão do próprio usuário: o banco só esquece aparelho da conta que está logada. */
export async function forgetMyDeviceAction(deviceId: string): Promise<ActionResult> {
  return runAction(async () => {
    await requireOrganizer();
    if (typeof deviceId !== "string" || !UUID_PATTERN.test(deviceId)) {
      throw new ActionError("Aparelho não encontrado.");
    }

    const supabase = await createServerClient();
    const { data, error } = await supabase.rpc("forget_my_device", { p_device_id: deviceId });
    if (error) {
      console.error("[aparelhos] Falha ao esquecer o aparelho.", error.code);
      throw new ActionError(GENERIC_ERROR);
    }
    if (data !== true) throw new ActionError("Este aparelho não está mais na lista. Atualize a página.");

    revalidatePath("/organizador/conta");
    return undefined;
  }, GENERIC_ERROR);
}
