/** Data da versão em vigor; muda sempre que o texto dos termos mudar. */
export const TERMS_VERSION = "2026-10-04";

export const TERMS_UPDATED_LABEL = "4 de outubro de 2026";

export const TERMS_PATH = "/termos";

/** Taxa descrita nos termos; o valor cobrado de fato vem do banco e aparece antes do pagamento. */
export const TERMS_SERVICE_FEE = { rateBps: 500, minCents: 100 } as const;

export const WITHDRAWAL_DAYS = 7;

export const WITHDRAWAL_MIN_HOURS_BEFORE = 48;

export const REFUND_PROCESSING_DAYS = 7;

export const MEIA_ENTRADA_MIN_PERCENT = 40;

export const CHECKOUT_ACCEPTANCE_REQUIRED_MESSAGE =
  "Para continuar, aceite os Termos de compra e a Política de Privacidade.";
