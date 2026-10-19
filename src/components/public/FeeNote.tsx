import { cx } from "@/components/ui/cx";
import {
  formatFeePercent,
  formatMoney,
  serviceFeeForPrice,
  serviceFeeForPriceAtRate,
  type ServiceFeePolicy,
} from "@/lib/domain/service-fee";
import { INSTALLMENT_INTEREST_NOTE } from "@/lib/legal/terms";

/** "+ R$ 2,50 de taxa" abaixo do preço; com duas taxas, mostra Pix e cartão. */
export function FeeNote({
  priceCents,
  policy,
  className,
}: {
  priceCents: number;
  policy: ServiceFeePolicy;
  className?: string;
}) {
  if (!policy.enabled) return null;

  if (policy.perMethodEnabled) {
    const pixFee = serviceFeeForPriceAtRate(priceCents, policy.pixRateBps, policy.minCents);
    const cardFee = serviceFeeForPriceAtRate(priceCents, policy.cardRateBps, policy.minCents);
    if (pixFee <= 0 && cardFee <= 0) return null;
    return (
      <span className={cx("block text-sm font-normal text-byla-muted", className)}>
        Taxa de serviço: {formatFeePercent(policy.pixRateBps)}% no Pix ({formatMoney(pixFee)}) ou{" "}
        {formatFeePercent(policy.cardRateBps)}% no cartão ({formatMoney(cardFee)}); mínimo{" "}
        {formatMoney(policy.minCents)} por ingresso. {INSTALLMENT_INTEREST_NOTE}
      </span>
    );
  }

  const fee = serviceFeeForPrice(priceCents, policy);
  if (fee <= 0) return null;
  return (
    <span className={cx("block text-sm font-normal text-byla-muted", className)}>
      + {formatMoney(fee)} de taxa
    </span>
  );
}
