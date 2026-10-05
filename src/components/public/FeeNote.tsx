import { cx } from "@/components/ui/cx";
import { formatMoney, serviceFeeForPrice, type ServiceFeePolicy } from "@/lib/domain/service-fee";

/** "+ R$ 2,50 de taxa" abaixo do preço; nada com a taxa desligada. */
export function FeeNote({
  priceCents,
  policy,
  className,
}: {
  priceCents: number;
  policy: ServiceFeePolicy;
  className?: string;
}) {
  const fee = serviceFeeForPrice(priceCents, policy);
  if (fee <= 0) return null;
  return (
    <span className={cx("block text-sm font-normal text-byla-muted", className)}>
      + {formatMoney(fee)} de taxa
    </span>
  );
}
