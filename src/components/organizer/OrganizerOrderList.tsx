"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { REFUND_REQUEST_SENT_MESSAGE, RequestRefundDialog } from "@/components/organizer/RequestRefundDialog";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { Tone } from "@/components/ui/tone";

/**
 * Só o que o organizador pode ver do comprador (spec 6.6). Telefone, link do pedido e
 * código dos ingressos não entram aqui de propósito.
 */
export type OrganizerOrder = {
  orderId: string;
  orderNumber: string;
  buyerName: string;
  buyerEmail: string;
  sessionLabel: string;
  items: { name: string; quantity: number }[];
  status: "pago" | "estornado" | "aguardando_decisao";
  isCourtesy: boolean;
  ticketsTotal: number;
  ticketsCheckedIn: number;
  refundRequest: "pendente" | "atendido" | "recusado" | "cancelado" | null;
};

function statusBadge(order: OrganizerOrder): { label: string; tone: Tone } {
  if (order.isCourtesy) return { label: "Cortesia", tone: "info" };
  if (order.status === "estornado") return { label: "Estornado", tone: "neutral" };
  if (order.status === "aguardando_decisao") {
    return { label: "Pago sem vaga — a equipe vai decidir", tone: "warning" };
  }
  return { label: "Pago", tone: "success" };
}

function canRequestRefund(order: OrganizerOrder): boolean {
  return (
    order.status === "pago" &&
    !order.isCourtesy &&
    order.ticketsCheckedIn === 0 &&
    order.refundRequest !== "pendente"
  );
}

function searchable(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Pedidos do próprio evento: busca por nome ou número e "Pedir estorno". */
export function OrganizerOrderList({ orders }: { orders: OrganizerOrder[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [refunding, setRefunding] = useState<OrganizerOrder | null>(null);
  const [sent, setSent] = useState(false);

  const shown = useMemo(() => {
    const term = searchable(query.trim()).replace(/^n[º°]\s*/, "");
    if (!term) return orders;
    return orders.filter(
      (order) => searchable(order.buyerName).includes(term) || searchable(order.orderNumber).includes(term),
    );
  }, [orders, query]);

  return (
    <div className="grid gap-4">
      <Notice tone="info">Use estes dados só para a operação deste evento (Termos do organizador, item 9).</Notice>
      <p className="text-base text-byla-muted">Precisa de cortesias? Peça à equipe do Espaço Byla pelo WhatsApp.</p>

      {sent ? <Notice tone="success">{REFUND_REQUEST_SENT_MESSAGE}</Notice> : null}

      {orders.length === 0 ? (
        <p className="text-base text-byla-muted">Nenhum pedido ainda.</p>
      ) : (
        <>
          <Field
            autoComplete="off"
            inputMode="search"
            label="Buscar por nome ou número do pedido"
            name="busca"
            onChange={(event) => setQuery(event.target.value)}
            type="search"
            value={query}
          />
          {shown.length === 0 ? (
            <p className="text-base text-byla-muted">Nenhum pedido encontrado.</p>
          ) : (
            <ul className="grid gap-3">
              {shown.map((order) => {
                const badge = statusBadge(order);
                return (
                  <li
                    className="grid gap-2 rounded-xl border border-byla-border bg-byla-surface p-4"
                    key={order.orderId}
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <p className="font-mono text-sm font-semibold text-foreground">Nº {order.orderNumber}</p>
                      <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
                    </div>
                    <div className="min-w-0">
                      <p className="break-words text-base font-semibold text-foreground">{order.buyerName}</p>
                      <p className="break-all text-sm text-byla-muted">{order.buyerEmail}</p>
                    </div>
                    <p className="text-sm text-foreground">{order.sessionLabel}</p>
                    <p className="text-sm text-foreground">
                      {order.items.map((item) => `${item.quantity}× ${item.name}`).join(" · ")}
                    </p>
                    <p className="text-sm text-byla-muted">
                      {order.ticketsCheckedIn} de {order.ticketsTotal} já entraram
                    </p>
                    {order.refundRequest === "pendente" ? (
                      <p className="text-sm font-medium text-byla-warning">Estorno pedido — aguardando a equipe</p>
                    ) : null}
                    {order.refundRequest === "recusado" && order.status === "pago" ? (
                      <p className="text-sm text-byla-muted">A equipe recusou o pedido de estorno.</p>
                    ) : null}
                    {canRequestRefund(order) ? (
                      <div>
                        <Button
                          className="sm:w-auto"
                          fullWidth
                          onClick={() => {
                            setSent(false);
                            setRefunding(order);
                          }}
                          variant="secondary"
                        >
                          Pedir estorno
                        </Button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {refunding ? (
        <RequestRefundDialog
          buyerName={refunding.buyerName}
          onClose={() => setRefunding(null)}
          onSent={() => {
            setRefunding(null);
            setSent(true);
            router.refresh();
          }}
          orderId={refunding.orderId}
          orderNumber={refunding.orderNumber}
        />
      ) : null}
    </div>
  );
}
