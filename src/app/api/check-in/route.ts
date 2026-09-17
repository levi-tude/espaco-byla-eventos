import { NextResponse } from "next/server";

import { checkInMessage, evaluateCheckIn } from "@/lib/domain/check-in";
import { createServerClient } from "@/lib/supabase/server";

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
    !("code" in body) ||
    typeof body.eventId !== "string" ||
    typeof body.code !== "string" ||
    !body.eventId.trim() ||
    !body.code.trim()
  ) {
    return NextResponse.json(
      { ok: false, message: "Dados inválidos" },
      { status: 400 },
    );
  }

  const eventId = body.eventId.trim();
  const code = body.code.trim();
  const { data: ticket, error: ticketError } = await supabase
    .from("tickets")
    .select("id, event_id, status, buyer_name, kind")
    .eq("code", code)
    .maybeSingle();

  if (ticketError) {
    return NextResponse.json(
      { ok: false, message: "Não foi possível consultar o ingresso" },
      { status: 500 },
    );
  }

  if (!ticket) {
    return NextResponse.json(
      { ok: false, message: "Ingresso não encontrado" },
      { status: 404 },
    );
  }

  const evaluation = evaluateCheckIn({
    ticketEventId: ticket.event_id,
    eventId,
    status: ticket.status,
  });

  if (!evaluation.ok) {
    return NextResponse.json({
      ok: false,
      message: checkInMessage(evaluation.reason),
    });
  }

  const { data: checkedIn, error: updateError } = await supabase
    .from("tickets")
    .update({
      status: "check_in",
      checked_in_at: new Date().toISOString(),
    })
    .eq("id", ticket.id)
    .eq("event_id", eventId)
    .eq("status", "pago")
    .select("buyer_name, kind")
    .maybeSingle();

  if (updateError) {
    return NextResponse.json(
      { ok: false, message: "Não foi possível realizar o check-in" },
      { status: 500 },
    );
  }

  if (!checkedIn) {
    return NextResponse.json({
      ok: false,
      message: checkInMessage("ja_usado"),
    });
  }

  return NextResponse.json({
    ok: true,
    buyerName: checkedIn.buyer_name,
    kind: checkedIn.kind,
  });
}
