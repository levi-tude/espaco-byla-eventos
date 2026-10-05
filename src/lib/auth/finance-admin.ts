import "server-only";

import { ActionError } from "@/lib/action-result";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

export const FINANCE_ADMIN_MESSAGE = "Acesso restrito ao Admin do Espaço.";
export const FINANCE_DEVELOPER_MESSAGE =
  "A conta do desenvolvedor não pode registrar repasses, ajustes ou contestações.";

export type FinanceAccess = {
  userId: string;
  /** Conta do desenvolvedor: vê o financeiro, mas não grava nada. */
  isDeveloper: boolean;
};

/**
 * Papel financeiro de quem está logado, conferido no banco (`staff_finance_role`).
 * `null` = não é Admin (secretaria, fora da equipe, sem login ou falha na consulta).
 */
export async function getFinanceAccess(): Promise<FinanceAccess | null> {
  const supabase = await createServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return null;

  const { data: isStaff, error: staffError } = await supabase.rpc("is_staff");
  if (staffError || !isStaff) return null;

  const { data: role, error } = await createAdminClient().rpc("staff_finance_role", {
    p_staff_user_id: user.id,
  });
  if (error) {
    console.error("[financeiro] Falha ao conferir o papel da conta.", { error: error.message });
    return null;
  }
  if (role === "admin") return { userId: user.id, isDeveloper: false };
  if (role === "admin_dev") return { userId: user.id, isDeveloper: true };
  return null;
}

/** Exige Admin; com `write`, recusa também a conta do desenvolvedor. */
export async function requireFinanceAdmin(options: { write: boolean }): Promise<FinanceAccess> {
  const access = await getFinanceAccess();
  if (!access) throw new ActionError(FINANCE_ADMIN_MESSAGE);
  if (options.write && access.isDeveloper) throw new ActionError(FINANCE_DEVELOPER_MESSAGE);
  return access;
}
