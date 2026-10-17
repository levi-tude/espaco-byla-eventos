"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";

import { loadPayoutDetails, markOrganizerPaid, type PayoutDetails } from "@/app/equipe/repasses/actions";
import { FinanceDialog } from "@/components/equipe/FinanceDialog";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { formatMoney } from "@/lib/domain/service-fee";
import { FEE_NOTE_MAX } from "@/lib/finance/fee-inputs";

const PIX_TYPE_LABEL: Record<string, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  email: "E-mail",
  telefone: "Telefone",
  aleatoria: "Chave aleatória",
};

type Props = {
  eventId: string;
  eventName: string;
  /** "AAAA-MM-DD" em São Paulo. */
  today: string;
};

/** "Marcar repasse": busca a chave PIX completa só ao abrir. */
export function OrganizerPayoutButton({ eventId, eventName, today }: Props) {
  const [details, setDetails] = useState<PayoutDetails | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [isLoading, startLoading] = useTransition();

  function open() {
    setError("");
    startLoading(async () => {
      try {
        const result = await loadPayoutDetails(eventId);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setDetails(result.data);
      } catch {
        setError("Não foi possível abrir os dados do repasse.");
      }
    });
  }

  return (
    <div className="grid gap-2">
      <Button loading={isLoading} loadingLabel="Abrindo..." onClick={open}>
        Marcar repasse
      </Button>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {done ? <Notice tone="success">{done}</Notice> : null}
      {details ? (
        <PayoutDialog
          details={details}
          eventId={eventId}
          eventName={eventName}
          onClose={() => setDetails(null)}
          onDone={(message) => {
            setDetails(null);
            setDone(message);
          }}
          today={today}
        />
      ) : null}
    </div>
  );
}

function PayoutDialog({
  details,
  eventId,
  eventName,
  today,
  onClose,
  onDone,
}: Props & { details: PayoutDetails; onClose: () => void; onDone: (message: string) => void }) {
  const router = useRouter();
  const [pixDate, setPixDate] = useState(today);
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const amount = details.expectedAmountCents;
  const compensation = details.kind === "compensacao";
  const blocked = details.kind === null || (!compensation && !details.pixKey);
  const ready = !blocked && confirmed && (compensation || pixDate !== "") && !/[\r\n]/.test(note);

  async function copyKey() {
    if (!details.pixKey) return;
    try {
      await navigator.clipboard.writeText(details.pixKey);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || isPending) return;
    setError("");
    startTransition(async () => {
      try {
        const result = await markOrganizerPaid({
          eventId,
          expectedAmountCents: amount,
          pixDate: compensation ? null : pixDate,
          note,
        });
        if (!result.ok) {
          setError(result.error);
          router.refresh();
          return;
        }
        onDone(
          result.data.kind === "compensacao"
            ? "Acerto registrado sem PIX. O organizador recebe um e-mail."
            : `Repasse de ${formatMoney(result.data.amountCents)} registrado. O organizador recebe um e-mail.`,
        );
        router.refresh();
      } catch {
        setError("Não foi possível registrar o repasse.");
      }
    });
  }

  return (
    <FinanceDialog
      busy={isPending}
      eyebrow="Repasse ao organizador"
      onClose={onClose}
      onSubmit={submit}
      title={eventName}
      titleId={`repasse-${eventId}`}
    >
      <div className="rounded-xl border border-byla-border p-4">
        <p className="text-sm text-byla-muted">{compensation ? "Valor do PIX" : "Valor do PIX ao organizador"}</p>
        <p className="mt-1 text-3xl font-semibold tabular-nums">{formatMoney(amount)}</p>
        {details.discounts.length ? (
          <ul className="mt-3 grid gap-1 text-base">
            <li className="flex flex-wrap justify-between gap-x-3">
              <span>Este evento</span>
              <span className="tabular-nums">{formatMoney(details.balanceCents)}</span>
            </li>
            {details.discounts.map((d) => (
              <li className="flex flex-wrap justify-between gap-x-3 text-byla-muted" key={d.eventId}>
                <span className="min-w-0 break-words">{d.eventName} — desconto</span>
                <span className="tabular-nums">−{formatMoney(d.cents)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {details.pendingFeeOrders > 0 ? (
        <Notice live={false} tone="info">
          Ainda falta a tarifa do banco de {details.pendingFeeOrders}{" "}
          {details.pendingFeeOrders === 1 ? "pedido" : "pedidos"}. Isso não muda o valor do organizador: a tarifa
          sai da taxa de serviço. Lance pelo extrato quando quiser, para a conta da taxa.
        </Notice>
      ) : null}

      {compensation ? (
        <Notice live={false} tone="info">
          Os descontos de outros eventos cobrem todo o valor: não há PIX a fazer. Ao confirmar, o acerto fica
          registrado.
        </Notice>
      ) : details.pixKey ? (
        <div className="grid gap-1 rounded-xl border border-byla-border p-4 text-base">
          <p className="text-sm text-byla-muted">
            Chave PIX ({PIX_TYPE_LABEL[details.pixKeyType ?? ""] ?? "PIX"})
          </p>
          <p className="break-all font-semibold">{details.pixKey}</p>
          <p>
            Titular: {details.holderName ?? "—"} · {details.holderDocument ?? "—"}
          </p>
          <p className="text-sm text-byla-muted">
            Confira no app do banco se o nome do titular é o mesmo antes de enviar.
          </p>
          <div>
            <Button onClick={copyKey} variant="secondary">
              {copied ? "Chave copiada" : "Copiar chave"}
            </Button>
          </div>
        </div>
      ) : (
        <Notice live={false} tone="danger">
          O organizador não tem chave PIX cadastrada.
        </Notice>
      )}

      {details.releaseUntil ? (
        <p className="text-sm text-byla-muted">
          O banco de pagamento libera o dinheiro das vendas até {details.releaseUntil.split("-").reverse().join("/")}.
        </p>
      ) : null}

      <p className="text-base">O registro é permanente. Se algo sair errado, a correção é um ajuste com motivo.</p>

      {compensation ? null : (
        <Field
          disabled={isPending}
          label="Data do PIX"
          max={today}
          onChange={(event) => setPixDate(event.target.value)}
          required
          type="date"
          value={pixDate}
        />
      )}

      <Field
        autoComplete="off"
        disabled={isPending}
        hint={`Opcional, até ${FEE_NOTE_MAX} caracteres. Ex.: código do PIX.`}
        label="Nota"
        maxLength={FEE_NOTE_MAX}
        onChange={(event) => setNote(event.target.value)}
        value={note}
      />

      <Checkbox
        checked={confirmed}
        disabled={isPending || blocked}
        onChange={(event) => setConfirmed(event.target.checked)}
        required
      >
        {compensation ? (
          <>Confirmo o acerto sem PIX deste evento.</>
        ) : (
          <>
            Confirmo que o PIX de <strong>{formatMoney(amount)}</strong> foi feito ao organizador.
          </>
        )}
      </Checkbox>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end">
        <Button disabled={isPending} onClick={onClose} variant="secondary">
          Voltar
        </Button>
        <Button disabled={!ready} loading={isPending} loadingLabel="Registrando..." type="submit">
          {compensation ? "Registrar acerto" : "Registrar repasse"}
        </Button>
      </div>
    </FinanceDialog>
  );
}
