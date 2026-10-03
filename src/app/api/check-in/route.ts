import { NextResponse } from "next/server";

import {
  checkInMessage,
  checkInSessionLine,
  parseCheckInOutcome,
} from "@/lib/domain/check-in";
import { ticketTypeLabel } from "@/lib/domain/ticket-types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CODE_LENGTH = 100;

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { ok: false, message: "Acesso não autorizado" },
      { status: 401 },
    );
  }

  const { data: profile } = await supabase
    .from("staff_profiles")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profile) {
    return NextResponse.json(
      { ok: false, message: "Acesso não autorizado" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "Dados inválidos" },
      { status: 400 },
    );
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("eventId" in body) ||
    !("sessionId" in body) ||
    !("code" in body) ||
    typeof body.eventId !== "string" ||
    typeof body.sessionId !== "string" ||
    typeof body.code !== "string" ||
    !UUID_PATTERN.test(body.eventId.trim()) ||
    !UUID_PATTERN.test(body.sessionId.trim()) ||
    !body.code.trim() ||
    body.code.trim().length > MAX_CODE_LENGTH
  ) {
    return NextResponse.json(
      { ok: false, message: "Dados inválidos" },
      { status: 400 },
    );
  }

  // Trava, regras e registro de quem fez ficam na função do banco (só service_role executa).
  const { data, error } = await createAdminClient()
    .rpc("check_in_ticket", {
      p_event_id: body.eventId.trim(),
      p_session_id: body.sessionId.trim(),
      p_code: body.code.trim(),
      p_staff_user_id: user.id,
    })
    .maybeSingle();

  if (error) {
    if (error.message.includes("CHECKIN_EQUIPE")) {
      return NextResponse.json(
        { ok: false, message: "Acesso não autorizado" },
        { status: 403 },
      );
    }
    if (error.message.includes("CHECKIN_DADOS")) {
      return NextResponse.json(
        { ok: false, message: "Dados inválidos" },
        { status: 400 },
      );
    }
    console.error("[check-in] Falha ao registrar a entrada.", error.code);
    return NextResponse.json(
      { ok: false, message: "Não foi possível realizar o check-in" },
      { status: 500 },
    );
  }

  const outcome = parseCheckInOutcome(data?.outcome);
  if (!outcome.ok) {
    return NextResponse.json(
      {
        ok: false,
        message: checkInMessage(outcome.reason, data?.other_event_name, {
          name: data?.other_session_name,
          startsAt: data?.other_session_starts_at,
        }),
      },
      { status: outcome.reason === "nao_encontrado" ? 404 : 200 },
    );
  }

  // A entrada já foi registrada: nunca responder erro daqui em diante.
  const kind = data?.ticket_kind ?? null;
  return NextResponse.json({
    ok: true,
    buyerName: data?.buyer_name ?? "",
    kind,
    typeLabel: kind ? ticketTypeLabel(data?.type_name, kind) : "Ingresso",
    sessionLine: checkInSessionLine(
      data?.session_name,
      data?.session_starts_at,
      data?.event_name,
    ),
  });
}
