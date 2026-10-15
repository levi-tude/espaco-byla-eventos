import { cx } from "@/components/ui/cx";
import { Notice } from "@/components/ui/Notice";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { sessionDayKey } from "@/lib/datetime";
import { formatMoney } from "@/lib/domain/service-fee";
import { formatDayKey } from "@/lib/finance/situation";
import {
  type FinanceHistoryItem,
  type OrganizerEventFinance,
  payoutSituation,
  shortDay,
  situationLabel,
  situationTone,
} from "@/lib/organizer/finance";

const PIX_TYPE_LABEL: Record<string, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  email: "e-mail",
  telefone: "celular",
  aleatoria: "chave aleatória",
};

const minus = (cents: number) => `−${formatMoney(Math.abs(cents))}`;
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

type Row = { label: string; value: string; strong?: boolean; hint?: string };

function historyTitle(item: FinanceHistoryItem): string {
  const value = formatMoney(Math.abs(item.itemCents));
  switch (item.kind) {
    case "repasse":
      return item.itemCents >= 0 ? `Repasse de ${value}` : `Desconto de ${value} no repasse de outro evento`;
    case "compensacao":
      return item.itemCents >= 0
        ? `Saldo de ${value} usado para cobrir desconto de outro evento`
        : `Desconto de ${value} coberto pelo saldo de outro evento`;
    case "ajuste":
      return item.itemCents >= 0 ? `Ajuste a favor do Espaço: ${value}` : `Ajuste a seu favor: ${value}`;
    case "devolucao":
      return `Devolução recebida: ${value}`;
  }
}

function historyLines(item: FinanceHistoryItem): string[] {
  const day = item.pixDate ?? sessionDayKey(item.createdAt);
  return [
    item.kind === "repasse" && item.itemCents >= 0 ? `PIX em ${formatDayKey(day)}` : `Em ${formatDayKey(day)}`,
    ...(item.reason ? [`Motivo: ${item.reason}`] : []),
    ...(item.note ? [`Nota: ${item.note}`] : []),
  ];
}

type Props = {
  finance: OrganizerEventFinance;
  /** Chave PIX do Espaço para devoluções (só quando há devolução pendente). */
  refundPixKey: string | null;
};

/** Aba "Financeiro" do organizador (spec 12.2). Só leitura; nada de quem registrou. */
export function OrganizerFinancePanel({ finance: f, refundPixKey }: Props) {
  const situation = payoutSituation(f);
  const rows: Row[] = [
    { label: `Vendido (${count(f.soldOrders, "pedido", "pedidos")})`, value: formatMoney(f.soldCents) },
    { label: `Estornos (${f.refundedOrders})`, value: minus(f.refundedCents) },
    ...(f.contestedOrders > 0
      ? [{ label: `Contestações (${f.contestedOrders})`, value: minus(f.contestedCents) }]
      : []),
    ...(f.pendingFeeOrders > 0
      ? [
          {
            label: `Em conferência (${count(f.pendingFeeOrders, "pedido", "pedidos")})`,
            value: minus(f.pendingCents),
            hint: "Entram na sua parte quando o banco de pagamento informar a tarifa.",
          },
        ]
      : []),
    { label: "Tarifa do banco de pagamento", value: minus(f.bankFeeCents) },
    { label: "Sua parte", value: formatMoney(f.shareCents), strong: true },
    { label: "Já repassado", value: formatMoney(f.paidOutCents) },
    f.balanceCents >= 0
      ? { label: "A receber", value: formatMoney(f.balanceCents), strong: true }
      : { label: "A devolver ou descontar", value: formatMoney(-f.balanceCents), strong: true },
  ];
  const visibleHistory = f.history.filter((item) => item.itemCents !== 0);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <StatusBadge tone={situationTone(situation)}>{situationLabel(situation, "organizador")}</StatusBadge>
      </div>

      <dl className="divide-y divide-byla-border rounded-xl border border-byla-border bg-byla-surface">
        {rows.map((row) => (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-4 py-3" key={row.label}>
            <dt className={cx("text-base", row.strong ? "font-semibold" : "text-byla-muted")}>{row.label}</dt>
            <dd className={cx("text-right text-base tabular-nums text-foreground", row.strong && "font-semibold")}>
              {row.value}
            </dd>
            {row.hint ? <dd className="col-span-2 mt-0.5 text-sm text-byla-muted">{row.hint}</dd> : null}
          </div>
        ))}
      </dl>

      {f.serviceFeeCents > 0 ? (
        <p className="text-sm text-byla-muted">
          A taxa de serviço paga pelos compradores ({formatMoney(f.serviceFeeCents)}) não entra na sua parte.
        </p>
      ) : null}
      {f.decisionOrders > 0 ? (
        <p className="text-sm text-byla-muted">
          {count(f.decisionOrders, "pedido pago sem vaga aguarda", "pedidos pagos sem vaga aguardam")} decisão do
          Espaço e ainda não {f.decisionOrders === 1 ? "entra" : "entram"} na conta.
        </p>
      ) : null}

      {situation.kind === "devolucao" ? (
        <Notice title="Devolução ao Espaço Byla" tone={situation.overdue ? "danger" : "warning"}>
          {refundPixKey ? (
            <>
              Chave PIX do Espaço Byla para a devolução: <span className="break-all font-medium">{refundPixKey}</span>
            </>
          ) : (
            "Fale com o Espaço Byla para receber a chave PIX."
          )}
        </Notice>
      ) : null}

      <div className="rounded-xl border border-byla-border bg-byla-surface p-4">
        <p className="text-base">
          Repasse para: {PIX_TYPE_LABEL[f.pix.type] ?? "chave"} <span className="font-medium">{f.pix.masked}</span>
        </p>
        <p className="mt-0.5 break-words text-sm text-byla-muted">Titular: {f.pix.holderName}</p>
        {f.pix.changePending ? (
          <p className="mt-2 text-sm text-byla-muted">
            Troca de chave pedida: os repasses seguem na chave atual até o Espaço confirmar.
          </p>
        ) : null}
      </div>

      {f.lateChanges.length ? (
        <div>
          <h3 className="text-base font-semibold">Depois do repasse</h3>
          <ul className="mt-2 grid gap-1 text-sm text-byla-muted">
            {f.lateChanges.map((change) => (
              <li key={`${change.kind}-${change.orderId}`}>
                {change.kind === "estorno" ? "Estorno" : "Contestação"} do pedido Nº {change.orderNumber}
                {change.at ? ` em ${shortDay(sessionDayKey(change.at))}` : ""} ({minus(change.cents)})
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <h3 className="text-base font-semibold">Histórico</h3>
        {visibleHistory.length ? (
          <ul className="mt-2 grid gap-2">
            {visibleHistory.map((item) => (
              <li className="rounded-xl border border-byla-border bg-byla-surface p-3" key={item.payoutId}>
                <p className="break-words font-medium">{historyTitle(item)}</p>
                {historyLines(item).map((line) => (
                  <p className="mt-0.5 break-words text-sm text-byla-muted" key={line}>
                    {line}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-byla-muted">Nenhum repasse ainda.</p>
        )}
      </div>
    </div>
  );
}
