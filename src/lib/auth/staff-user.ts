import "server-only";

import { ActionError } from "@/lib/action-result";
import { STAFF_ONLY_MESSAGE } from "@/lib/auth/staff";
import { createServerClient } from "@/lib/supabase/server";

/** Exige login de equipe e devolve quem está agindo (para registrar decisões). */
export async function requireStaffUser(): Promise<{ userId: string }> {
  const supabase = await createServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) throw new ActionError(STAFF_ONLY_MESSAGE);

  const { data: isStaff, error } = await supabase.rpc("is_staff");
  if (error || !isStaff) throw new ActionError(STAFF_ONLY_MESSAGE);

  return { userId: user.id };
}
