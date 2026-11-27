import { formatCents } from "@/lib/domain/meia-check";
import { Ban, CircleCheck, CircleX, Clock, LoaderCircle, ScanLine, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { MeiaCheckButtons, type MeiaPanelState } from "@/components/equipe/MeiaCheckButtons";
import { cx } from "@/components/ui/cx";
import {
  orderSummaryLine,
  successTone,
  type CheckInOrderTicket,
  type CheckInOrderSummary,
  type CheckInTicketKind,
} from "@/lib/domain/check-in";

export type CheckInResult =
  | { tone: "idle" }
  | { tone: "loading" }
  | {
      tone: "success" | "meia";
      buyerName: string;
      typeLabel: string;
      kind: CheckInTicketKind | null;
      sessionLine: string;
      order?: CheckInOrderSummary;
      /** Só meia: ingresso para registrar a conferência e a diferença a cobrar. */
      ticketId?: string;
      meiaDiffCents?: number | null;
    }
  | {
      tone: "used";
      message: string;
      buyerName?: string;
      usedLine?: string;
      order?: CheckInOrderSummary;
    }
  | { tone: "wrong_session"; message: string }
  | { tone: "error"; message: string };

export const IDLE_MESSAGE = "Aponte a câmera para o QR Code";

/**
 * O resultado cobre a câmera para a equipe ver de longe (o leitor já fica pausado). Fica na
 * mesma célula da grade da câmera: se o pedido for grande, a área cresce em vez de cortar.
 */
const toneStyles: Record<CheckInResult["tone"], string> = {
  idle: "col-start-1 row-start-2 px-3 pb-2 pt-3 text-white/90",
  loading: "z-10 col-start-1 row-start-1 rounded-xl bg-black/75 text-white",
  success: "z-10 col-start-1 row-start-1 rounded-xl bg-byla-success-solid text-white",
  meia: "z-10 col-start-1 row-start-1 rounded-xl bg-[#ffbd38] text-black",
  used: "z-10 col-start-1 row-start-1 rounded-xl bg-byla-danger-solid text-white",
  wrong_session: "z-10 col-start-1 row-start-1 rounded-xl bg-byla-danger-solid text-white",
  error: "z-10 col-start-1 row-start-1 rounded-xl bg-byla-danger-solid text-white",
};

const toneIcons: Record<CheckInResult["tone"], typeof ScanLine> = {
  idle: ScanLine,
  loading: LoaderCircle,
  success: CircleCheck,
  meia: TriangleAlert,
  used: Ban,
  wrong_session: Clock,
  error: CircleX,
};

function headline(result: CheckInResult): string {
  switch (result.tone) {
    case "idle":
      return IDLE_MESSAGE;
    case "loading":
      return "Verificando ingresso...";
    case "success":
      return "Pode entrar";
    case "meia":
      return "Pode entrar após conferir";
    case "used":
      return "Já utilizado";
    case "wrong_session":
      return "Sessão errada";
    case "error":
      return result.message;
  }
}

/** Texto curto do resultado (para leitores de tela e a linha embaixo do campo manual). */
export function resultSummary(result: CheckInResult): string {
  if (result.tone === "wrong_session" || result.tone === "used") {
    return `${headline(result)}: ${result.message}`;
  }
  return headline(result);
}

function Band({ className, children }: { className: string; children: ReactNode }) {
  return (
    <p
      className={cx(
        "w-full rounded-lg px-3 py-2 text-center text-xl font-black uppercase tracking-wide sm:text-2xl",
        className,
      )}
    >
      {children}
    </p>
  );
}

function OrderList({ order, dark }: { order: CheckInOrderSummary; dark: boolean }) {
  return (
    <div
      className={cx(
        "w-full rounded-xl p-3 text-left",
        dark ? "bg-black/10" : "bg-black/25",
      )}
    >
      <p className="text-base font-bold">{orderSummaryLine(order)}</p>
      <ul className="mt-2 grid gap-1">
        {order.tickets.map((ticket, index) => (
          <li
            className={cx(
              "flex items-center justify-between gap-3 rounded-lg px-2 py-1 text-base",
              ticket.current && (dark ? "bg-black/15 font-bold" : "bg-white/20 font-bold"),
            )}
            key={index}
          >
            <span className="flex min-w-0 items-center gap-2">
              {ticket.entered ? (
                <CircleCheck aria-hidden className="h-5 w-5 shrink-0" />
              ) : (
                <Clock aria-hidden className="h-5 w-5 shrink-0 opacity-80" />
              )}
              <span className="min-w-0 break-words">
                {ticket.typeLabel}
                {ticket.current ? " (este)" : ""}
              </span>
            </span>
            <span className="shrink-0 tabular-nums">
              {ticket.entered ? `entrou ${ticket.enteredAt ?? ""}`.trim() : "não entrou"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type VisualTone = CheckInResult["tone"];

/** Com a conferência ligada, a meia muda de cor conforme a marcação. */
function visualTone(result: CheckInResult, meia: MeiaPanelState | undefined): VisualTone {
  if (result.tone !== "meia" || !meia?.enabled || !meia.mark) return result.tone;
  return meia.mark === "recusado" ? "used" : "success";
}

/** Recusado desfaz a entrada: a lista do pedido mostra o ingresso lido como "não entrou". */
function orderAfterRefusal(order: CheckInOrderSummary): CheckInOrderSummary {
  const tickets: CheckInOrderTicket[] = order.tickets.map((ticket) =>
    ticket.current && ticket.entered ? { ...ticket, entered: false, enteredAt: null } : ticket,
  );
  return { ...order, tickets, entered: tickets.filter((ticket) => ticket.entered).length };
}

function meiaHeadline(mark: MeiaPanelState["mark"]): string {
  if (mark === "recusado") return "Recusado";
  if (mark) return "Pode entrar";
  return "Conferir comprovante";
}

function meiaBand(meia: MeiaPanelState): ReactNode {
  if (meia.mark === "comprovante_ok") {
    return <Band className="bg-white text-byla-success-solid">Meia · comprovante ok</Band>;
  }
  if (meia.mark === "pagou_diferenca") {
    const value = meia.diffCents != null && meia.diffCents > 0 ? ` ${formatCents(meia.diffCents)}` : "";
    return <Band className="bg-white text-byla-success-solid">Meia · pagou a diferença{value}</Band>;
  }
  if (meia.mark === "recusado") {
    return <Band className="bg-white text-byla-danger-solid">Entrada desfeita · não liberar</Band>;
  }
  return <Band className="bg-black text-[#ffbd38]">Meia – conferir comprovante</Band>;
}

/** Tela de resultado da leitura (mesma para equipe e organizador). Sem estado: só desenha. */
export function CheckInResultCard({
  result,
  action,
  meia,
  onMeiaMark,
  onRedoEntry,
}: {
  result: CheckInResult;
  action?: ReactNode;
  /** Conferência da meia (só quando o resultado é meia). */
  meia?: MeiaPanelState;
  onMeiaMark?: (mark: NonNullable<MeiaPanelState["mark"]>) => void;
  onRedoEntry?: () => void;
}) {
  const visual = visualTone(result, meia);
  const Icon = toneIcons[visual];
  const idle = result.tone === "idle";
  const meiaOn = result.tone === "meia" && Boolean(meia?.enabled);
  const dark = visual === "meia";

  if (idle) {
    return (
      <div aria-live="assertive" className={cx("flex items-center justify-center gap-2 text-center", toneStyles.idle)}>
        <Icon aria-hidden className="h-5 w-5 shrink-0" />
        <p className="text-base font-medium">{IDLE_MESSAGE}</p>
        {action}
      </div>
    );
  }

  const order =
    (result.tone === "success" || result.tone === "meia" || result.tone === "used") && result.order
      ? meiaOn && meia?.mark === "recusado"
        ? orderAfterRefusal(result.order)
        : result.order
      : null;

  return (
    <div
      aria-live="assertive"
      className={cx("flex", toneStyles[visual])}
      data-meia={meiaOn ? (meia?.mark ?? "pendente") : undefined}
      data-tone={result.tone}
    >
      <div className="m-auto flex w-full max-w-md flex-col items-center gap-3 p-4 text-center sm:p-6">
        <Icon
          aria-hidden
          className={cx(
            "h-14 w-14 shrink-0",
            result.tone === "loading" && "animate-spin motion-reduce:animate-none",
          )}
        />
        <p className="text-3xl font-black uppercase leading-tight">
          {meiaOn && meia ? meiaHeadline(meia.mark) : headline(result)}
        </p>

        {result.tone === "meia" ? (
          meiaOn && meia ? meiaBand(meia) : <Band className="bg-black text-[#ffbd38]">Meia – conferir comprovante</Band>
        ) : null}
        {result.tone === "success" && result.kind === "cortesia" ? (
          <Band className="bg-violet-700 text-white">Bônus</Band>
        ) : null}

        {(result.tone === "success" || result.tone === "meia") && result.buyerName ? (
          <p className="break-words text-4xl font-bold leading-tight">{result.buyerName}</p>
        ) : null}
        {(result.tone === "success" || result.tone === "meia") ? (
          <>
            <p className="text-xl font-semibold">{result.typeLabel}</p>
            {result.sessionLine ? <p className="text-base">{result.sessionLine}</p> : null}
          </>
        ) : null}

        {meiaOn && meia ? (
          <>
            {meia.mark === "recusado" ? (
              <p className="text-base font-semibold">
                A pessoa não entra agora. O ingresso volta a valer se ela voltar com o comprovante ou
                pagar a diferença (ler o QR de novo).
              </p>
            ) : null}
            <MeiaCheckButtons
              onMark={onMeiaMark}
              onRedoEntry={onRedoEntry}
              state={meia}
              surface={dark ? "light" : "dark"}
            />
          </>
        ) : null}

        {result.tone === "used" ? (
          <>
            {result.buyerName ? (
              <p className="break-words text-3xl font-bold leading-tight">{result.buyerName}</p>
            ) : null}
            <p className="text-xl font-semibold">{result.usedLine || "Este ingresso já entrou"}</p>
            <p className="text-base font-semibold">Não liberar com este QR</p>
          </>
        ) : null}

        {result.tone === "wrong_session" ? (
          <>
            <p className="text-xl font-semibold">{result.message}</p>
            <p className="text-base font-semibold">Não liberar nesta sessão</p>
          </>
        ) : null}

        {order && order.total > 0 ? <OrderList dark={dark} order={order} /> : null}

        {action}
      </div>
    </div>
  );
}

/** Resposta de `POST /api/check-in` (campos extras são opcionais: sem eles, card simples). */
export type CheckInResponse =
  | {
      ok: true;
      buyerName: string;
      kind: CheckInTicketKind | null;
      typeLabel?: string;
      sessionLine?: string;
      order?: CheckInOrderSummary;
      ticketId?: string;
      meiaDiffCents?: number | null;
    }
  | {
      ok: false;
      message: string;
      reason?: string;
      buyerName?: string;
      usedLine?: string;
      order?: CheckInOrderSummary;
    };

const KIND_FALLBACK_LABELS: Record<CheckInTicketKind, string> = {
  inteira: "Inteira",
  meia: "Meia-entrada",
  cortesia: "Bônus",
};

function validOrder(order: unknown): CheckInOrderSummary | undefined {
  if (!order || typeof order !== "object") return undefined;
  const candidate = order as CheckInOrderSummary;
  return Array.isArray(candidate.tickets) && typeof candidate.total === "number"
    ? candidate
    : undefined;
}

/** Converte a resposta da rota na tela: meia amarela, recusas vermelhas, sessão errada destacada. */
export function toCheckInResult(data: CheckInResponse): CheckInResult {
  if (data.ok) {
    const kind = data.kind ?? null;
    return {
      tone: successTone(kind),
      buyerName: data.buyerName,
      typeLabel: data.typeLabel ?? (kind ? KIND_FALLBACK_LABELS[kind] : "Ingresso"),
      kind,
      sessionLine: data.sessionLine ?? "",
      order: validOrder(data.order),
      ...(kind === "meia" && typeof data.ticketId === "string"
        ? {
            ticketId: data.ticketId,
            meiaDiffCents: typeof data.meiaDiffCents === "number" ? data.meiaDiffCents : null,
          }
        : {}),
    };
  }
  if (data.reason === "ja_usado") {
    return {
      tone: "used",
      message: data.message,
      buyerName: data.buyerName,
      usedLine: data.usedLine,
      order: validOrder(data.order),
    };
  }
  if (data.reason === "sessao_errada") {
    return { tone: "wrong_session", message: data.message };
  }
  return { tone: "error", message: data.message };
}
