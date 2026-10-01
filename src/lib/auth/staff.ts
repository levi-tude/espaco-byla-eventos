import { ActionError } from "@/lib/action-result";
import { createServerClient } from "@/lib/supabase/server";

export const STAFF_ONLY_MESSAGE = "Acesso restrito à equipe.";

export async function assertStaff(): Promise<void> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("is_staff");
  if (error || !data) throw new ActionError(STAFF_ONLY_MESSAGE);
}
