import { legalVersionLabel } from "./version-label";

export const COMPANY = {
  brand: "ACDH Eventos",
  legalName: "Academia Cultural de Desenvolvimento Humano LTDA",
  cnpj: "04.685.299/0001-16",
  address: "Rua Manuel Suarez, 25 – Stella Maris, Salvador – BA, CEP 41600-620",
} as const;

/** Data da versão em vigor; muda sempre que o texto da política mudar. */
export const PRIVACY_POLICY_VERSION = "2026-10-14";

export const PRIVACY_POLICY_UPDATED_LABEL = legalVersionLabel(PRIVACY_POLICY_VERSION);

export const DATA_RETENTION_YEARS = 5;
