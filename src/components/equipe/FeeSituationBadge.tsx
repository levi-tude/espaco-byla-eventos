import { StatusBadge } from "@/components/ui/StatusBadge";
import type { Tone } from "@/components/ui/tone";
import type { FeeSituation } from "@/lib/domain/fee-payout";
import { feeSituationLabel } from "@/lib/finance/situation";

const tones: Record<FeeSituation["kind"], Tone> = {
  aguardando: "neutral",
  a_pagar: "warning",
  pago: "success",
  sem_taxa: "neutral",
  desconto: "info",
};

export function FeeSituationBadge({
  situation,
  className,
}: {
  situation: FeeSituation;
  className?: string;
}) {
  return (
    <StatusBadge className={className} tone={tones[situation.kind]}>
      <span className="whitespace-normal">{feeSituationLabel(situation)}</span>
    </StatusBadge>
  );
}
