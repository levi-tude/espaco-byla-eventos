import { StatusBadge } from "@/components/ui/StatusBadge";
import { type PayoutSituation, situationLabel, situationTone } from "@/lib/organizer/finance";

export function PayoutSituationBadge({
  situation,
  className,
}: {
  situation: PayoutSituation;
  className?: string;
}) {
  return (
    <StatusBadge className={className} tone={situationTone(situation)}>
      <span className="whitespace-normal">{situationLabel(situation, "equipe")}</span>
    </StatusBadge>
  );
}
