import { NextResponse } from "next/server";

import { readLoginState } from "@/lib/auth/login-verification";
import {
  findEventTicket,
  loadMeiaDiff,
  loadOrderSummary,
  validatorName,
  type CurrentTicket,
  type TicketRef,
} from "@/lib/check-in/details";
import {
  checkInMessage,
  checkInSessionLine,
  parseCheckInOutcome,
  usedByLine,
  type CheckInOrderSummary,
} from "@/lib/domain/check-in";
import { ticketTypeLabel } from "@/lib/domain/ticket-types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CODE_LENGTH = 100;

type CheckInBody = { eventId: string; sessionId: string; ref: TicketRef };

/** Evento, sessão e exatamente um: `code` (QR/digitado) ou `ticketId` (lista de participantes). */
function parseBody(body: unknown): CheckInBody | null {
  if (!body || typeof body !== "object") return null;
  const { eventId, sessionId, code, ticketId } = body as Record<string, unknown>;
  if (typeof eventId !== "string" || !UUID_PATTERN.test(eventId.trim())) return null;
  if (typeof sessionId !== "string" || !UUID_PATTERN.test(sessionId.trim())) return null;
  const hasCode = code !== undefined;
  const hasTicketId = ticketId !== undefined;
  if (hasCode === hasTicketId) return null;
  if (hasCode) {
    if (typeof code !== "string") return null;
    const clean = code.trim();
    if (!clean || clean.length > MAX_CODE_LENGTH) return null;
    return { eventId: eventId.trim(), sessionId: sessionId.trim(), ref: { code: clean } };
  }
  if (typeof ticketId !== "string" || !UUID_PATTERN.test(ticketId.trim())) return null;
  return {
    eventId: eventId.trim(),
    sessionId: sessionId.trim(),
    ref: { ticketId: ticketId.trim() },
  };
}

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

  // Equipe ou organizador com o código do e-mail confirmado nesta sessão; o check-in usa
  // service_role, então a RLS não faria essa checagem por nós. Quem pode registrar entrada
  // em qual evento (equipe em todos, organizador só nos próprios) a função do banco decide.
  const loginState = await readLoginState(supabase);
  if (loginState.status !== "verificado" || loginState.userId !== user.id) {
    return NextResponse.json(
      { ok: false, message: "Acesso não autorizado" },
      { status: 403 },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "Dados inválidos" },
      { status: 400 },
    );
  }

  const body = parseBody(raw);
  if (!body) {
    return NextResponse.json(
      { ok: false, message: "Dados inválidos" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { eventId } = body;

  // Pela lista de participantes: o servidor acha o código do ingresso (só deste evento) e
  // usa a MESMA função do banco. Sem ingresso, vai código vazio: a função confere o acesso
  // primeiro e responde "nao_encontrado", igual a um QR desconhecido.
  let ticket: CurrentTicket | null = null;
  let code: string;
  if ("ticketId" in body.ref) {
    try {
      ticket = await findEventTicket(admin, body.eventId, body.ref);
    } catch (lookupError) {
      console.error("[check-in] Falha ao achar o ingresso da lista.", String(lookupError));
      return NextResponse.json(
        { ok: false, message: "Não foi possível realizar o check-in" },
        { status: 500 },
      );
    }
    code = ticket?.code ?? "";
  } else {
    code = body.ref.code;
  }

  // Trava, regras e registro de quem fez ficam na função do banco (só service_role executa).
  const { data, error } = await admin
    .rpc("check_in_ticket", {
      p_event_id: body.eventId,
      p_session_id: body.sessionId,
      p_code: code,
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

  /**
   * Detalhes extras (pedido, quem validou) só depois de "ok" ou "ja_usado": nos dois casos a
   * função do banco já conferiu o acesso, o evento e a sessão. Falhou? Responde sem eles.
   */
  async function details(withValidator: boolean): Promise<{
    ticket: CurrentTicket;
    order: CheckInOrderSummary;
    validatedBy: string | null;
  } | null> {
    try {
      // Pela lista, o ingresso já foi lido antes da função; "ja_usado" não muda nada nele.
      const current = ticket ?? (await findEventTicket(admin, eventId, { code }));
      if (!current) return null;
      const [order, validatedBy] = await Promise.all([
        loadOrderSummary(admin, eventId, current),
        withValidator ? validatorName(admin, eventId, current.checkedInBy) : null,
      ]);
      return { ticket: current, order, validatedBy };
    } catch (detailsError) {
      console.error("[check-in] Detalhes do pedido indisponíveis.", String(detailsError));
      return null;
    }
  }

  const outcome = parseCheckInOutcome(data?.outcome);
  if (!outcome.ok) {
    const message = checkInMessage(outcome.reason, data?.other_event_name, {
      name: data?.other_session_name,
      startsAt: data?.other_session_starts_at,
    });
    if (outcome.reason === "ja_usado") {
      const extra = await details(true);
      return NextResponse.json({
        ok: false,
        reason: outcome.reason,
        message,
        ...(extra
          ? {
              buyerName: extra.ticket.buyerName,
              usedLine: usedByLine(extra.ticket.checkedInAt, extra.validatedBy),
              order: extra.order,
            }
          : {}),
      });
    }
    return NextResponse.json(
      { ok: false, reason: outcome.reason, message },
      { status: outcome.reason === "nao_encontrado" ? 404 : 200 },
    );
  }

  // A entrada já foi registrada: nunca responder erro daqui em diante.
  const kind = data?.ticket_kind ?? null;
  const extra = await details(false);
  // Meia: a tela precisa do ingresso para registrar a conferência (o id não dá acesso a
  // nada sozinho; a função da conferência confere tudo de novo) e do valor da diferença.
  let meia: { ticketId: string; meiaDiffCents: number | null } | null = null;
  if (kind === "meia" && extra) {
    let diff: number | null = null;
    try {
      diff = await loadMeiaDiff(admin, eventId, extra.ticket.id);
    } catch (diffError) {
      console.error("[check-in] Diferença da meia indisponível.", String(diffError));
    }
    meia = { ticketId: extra.ticket.id, meiaDiffCents: diff };
  }
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
    ...(extra ? { order: extra.order } : {}),
    ...(meia ?? {}),
  });
}
