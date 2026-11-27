import { NextResponse } from "next/server";

import { readLoginState } from "@/lib/auth/login-verification";
import { isMeiaFeatureMissing, isMeiaResult, meiaOutcomeMessage } from "@/lib/domain/meia-check";
import { createServerClient } from "@/lib/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Conferência da meia (comprovante ok / pagou a diferença / recusado). Roda com a sessão do
 * próprio usuário: a função do banco (SECURITY DEFINER, só authenticated) confere equipe ou
 * dono do evento, o código do e-mail, se é meia e se está com check-in; "recusado" desfaz a
 * entrada na mesma transação. Sem service_role aqui.
 */
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, message: "Acesso não autorizado" }, { status: 401 });
  }
  const loginState = await readLoginState(supabase);
  if (loginState.status !== "verificado" || loginState.userId !== user.id) {
    return NextResponse.json({ ok: false, message: "Acesso não autorizado" }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Dados inválidos" }, { status: 400 });
  }
  const { eventId, ticketId, result } = (raw ?? {}) as Record<string, unknown>;
  if (
    typeof eventId !== "string" ||
    !UUID_PATTERN.test(eventId.trim()) ||
    typeof ticketId !== "string" ||
    !UUID_PATTERN.test(ticketId.trim()) ||
    !isMeiaResult(result)
  ) {
    return NextResponse.json({ ok: false, message: "Dados inválidos" }, { status: 400 });
  }

  const { data, error } = await supabase
    .rpc("record_meia_check", {
      p_event_id: eventId.trim(),
      p_ticket_id: ticketId.trim(),
      p_result: result,
    })
    .maybeSingle();

  if (error) {
    if (isMeiaFeatureMissing(error)) {
      return NextResponse.json(
        {
          ok: false,
          unavailable: true,
          message: "O registro da conferência ainda não está ativo. A entrada já foi registrada.",
        },
        { status: 503 },
      );
    }
    if (error.message?.includes("MEIA_ACESSO")) {
      return NextResponse.json({ ok: false, message: "Acesso não autorizado" }, { status: 403 });
    }
    if (error.message?.includes("MEIA_DADOS")) {
      return NextResponse.json({ ok: false, message: "Dados inválidos" }, { status: 400 });
    }
    console.error("[meia] Falha ao registrar a conferência.", error.code);
    return NextResponse.json(
      { ok: false, message: "Não foi possível registrar a conferência" },
      { status: 500 },
    );
  }

  if (data?.outcome !== "ok") {
    const outcome = typeof data?.outcome === "string" ? data.outcome : "invalido";
    return NextResponse.json(
      { ok: false, reason: outcome, message: meiaOutcomeMessage(outcome) },
      { status: outcome === "nao_encontrado" ? 404 : 409 },
    );
  }

  return NextResponse.json({
    ok: true,
    result: data.result,
    diffCents: data.diff_cents ?? null,
    checkedAt: data.checked_at ?? null,
    checkedIn: data.checked_in ?? result !== "recusado",
  });
}
