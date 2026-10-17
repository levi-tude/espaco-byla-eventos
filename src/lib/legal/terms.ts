import { legalVersionLabel } from "./version-label";

/** Data da versão em vigor; muda sempre que o texto dos termos mudar. */
export const TERMS_VERSION = "2026-10-17";

export const TERMS_UPDATED_LABEL = legalVersionLabel(TERMS_VERSION);

export const TERMS_PATH = "/termos";

/** Taxa descrita nos termos; o valor cobrado de fato vem do banco e aparece antes do pagamento. */
export const TERMS_SERVICE_FEE = { rateBps: 700, minCents: 100 } as const;

export const WITHDRAWAL_DAYS = 7;

export const WITHDRAWAL_MIN_HOURS_BEFORE = 48;

/** Prazo para pedir reembolso após troca de horário, contado do novo horário. */
export const SCHEDULE_CHANGE_REFUND_MIN_HOURS_BEFORE = 24;

export const REFUND_PROCESSING_DAYS = 7;

export const CHECKOUT_ACCEPTANCE_REQUIRED_MESSAGE =
  "Para continuar, aceite os Termos de compra e a Política de Privacidade.";

/** Perto da escolha de parcelas e nos Termos de compra. Sem nome de fornecedor. */
export const INSTALLMENT_INTEREST_NOTE =
  "Parcelas podem ter juros do banco. O valor total aparece antes de você confirmar.";
