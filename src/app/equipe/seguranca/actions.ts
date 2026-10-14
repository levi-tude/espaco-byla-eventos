"use server";

import { revalidatePath } from "next/cache";

import { ActionError, runAction, type ActionResult } from "@/lib/action-result";
import { requireTeamAdmin } from "@/lib/auth/actor";
import { requireStaffUser } from "@/lib/auth/staff-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

const PAGE_PATH = "/equipe/seguranca";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEVICE_ERROR = "Não foi possível esquecer o aparelho. Tente de novo.";
const ACCOUNT_DEVICES_ERROR = "Não foi possível esquecer os aparelhos. Tente de novo.";
const ACCOUNT_NOT_FOUND = "Conta não encontrada.";

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** "Meus aparelhos": com a sessão do próprio usuário, o banco só esquece aparelho da conta logada. */
export async function forgetMyStaffDeviceAction(deviceId: string): Promise<ActionResult> {
  return runAction(async () => {
    await requireStaffUser();
    if (!isUuid(deviceId)) throw new ActionError("Aparelho não encontrado.");

    const supabase = await createServerClient();
    const { data, error } = await supabase.rpc("forget_my_device", { p_device_id: deviceId });
    if (error) {
      console.error("[seguranca] Falha ao esquecer o aparelho.", error.code ?? "sem-codigo");
      throw new ActionError(DEVICE_ERROR);
    }
    if (data !== true) throw new ActionError("Este aparelho não está mais na lista. Atualize a página.");

    revalidatePath(PAGE_PATH);
    return undefined;
  }, DEVICE_ERROR);
}

/** Admin esquece todos os aparelhos de outra conta da equipe (a própria usa "Meus aparelhos"). */
export async function forgetStaffDevices(userId: string): Promise<ActionResult> {
  return runAction(async () => {
    const admin = await requireTeamAdmin();
    if (!isUuid(userId)) throw new ActionError(ACCOUNT_NOT_FOUND);
    if (userId.toLowerCase() === admin.userId.toLowerCase()) {
      throw new ActionError("Para a sua conta, use “Meus aparelhos”.");
    }

    const client = createAdminClient();
    const { data: role, error: roleError } = await client.rpc("staff_finance_role", {
      p_staff_user_id: userId,
    });
    if (roleError) {
      console.error("[seguranca] Falha ao conferir a conta.", roleError.code ?? "sem-codigo");
      throw new ActionError(ACCOUNT_DEVICES_ERROR);
    }
    // Contas de organizador ficam na página Organizadores.
    if (!role) throw new ActionError(ACCOUNT_NOT_FOUND);

    const { error } = await client.rpc("admin_forget_devices", {
      p_admin: admin.userId,
      p_user_id: userId,
    });
    if (error) {
      console.error("[seguranca] Falha ao esquecer os aparelhos da conta.", error.code ?? "sem-codigo");
      throw new ActionError(ACCOUNT_DEVICES_ERROR);
    }

    revalidatePath(PAGE_PATH);
    return undefined;
  }, ACCOUNT_DEVICES_ERROR);
}
