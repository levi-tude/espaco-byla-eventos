import { isValidTaxDocument, normalizeTaxDocument, onlyDigits } from "@/lib/organizer/documents";

/**
 * Chave PIX no formato do DICT (BCB): CPF, CNPJ, e-mail, telefone E.164 e EVP.
 * O aplicativo normaliza o que a pessoa cola; o banco só aceita o formato já normalizado.
 * https://www.bcb.gov.br/content/estabilidadefinanceira/pix/API-DICT.html
 */

export const PIX_KEY_TYPES = ["cpf", "cnpj", "email", "telefone", "aleatoria"] as const;
export type PixKeyType = (typeof PIX_KEY_TYPES)[number];

export const PIX_KEY_MAX = 77;

export const PIX_TYPE_LABELS: Record<string, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  email: "E-mail",
  telefone: "Celular",
  aleatoria: "Chave aleatória",
};

/** Mesmo formato de e-mail que o banco aceita no código do convite (até 254 no cadastro). */
export const ORGANIZER_EMAIL_PATTERN = /^[^@\s]{1,64}@[^@\s]{1,189}\.[^@\s]{2,}$/;

/**
 * DDDs em uso no Brasil (Anatel). A lista também entra na função do banco
 * (`PIX_PHONE_DB_PATTERN`); o teste da migração confere os dois lados.
 */
export const BRAZIL_DDDS = [
  "11", "12", "13", "14", "15", "16", "17", "18", "19",
  "21", "22", "24", "27", "28",
  "31", "32", "33", "34", "35", "37", "38",
  "41", "42", "43", "44", "45", "46", "47", "48", "49",
  "51", "53", "54", "55",
  "61", "62", "63", "64", "65", "66", "67", "68", "69",
  "71", "73", "74", "75", "77", "79",
  "81", "82", "83", "84", "85", "86", "87", "88", "89",
  "91", "92", "93", "94", "95", "96", "97", "98", "99",
] as const;

const BRAZIL_DDD_SET = new Set<string>(BRAZIL_DDDS);

/** Trecho SQL do telefone canônico: +55, DDD válido, 9 e mais 8 dígitos. */
export const PIX_PHONE_DB_PATTERN = `^\\+55(${BRAZIL_DDDS.join("|")})9[0-9]{8}$`;

const PIX_PHONE_PATTERN = new RegExp(PIX_PHONE_DB_PATTERN);

export type PixKeyField = {
  inputMode: "email" | "tel" | "text" | "numeric";
  placeholder: string;
  hint: string;
  autoCapitalize: "none" | "characters";
};

export const PIX_KEY_FIELDS: Record<PixKeyType, PixKeyField> = {
  cpf: {
    inputMode: "numeric",
    autoCapitalize: "none",
    placeholder: "000.000.000-00",
    hint: "Pode colar com pontos. A chave é o CPF do titular.",
  },
  cnpj: {
    inputMode: "text",
    autoCapitalize: "characters",
    placeholder: "00.000.000/0000-00",
    hint: "Pode colar com pontos. CNPJ com letras também vale. A chave é o CNPJ do titular.",
  },
  email: {
    inputMode: "email",
    autoCapitalize: "none",
    placeholder: "nome@email.com",
    hint: "Pode ter letras maiúsculas. Guardamos em minúsculas, com no máximo 77 caracteres.",
  },
  telefone: {
    inputMode: "tel",
    autoCapitalize: "none",
    placeholder: "(71) 99999-9999",
    hint: "Pode colar com espaços, parênteses, traço, 0 na frente ou +55.",
  },
  aleatoria: {
    inputMode: "text",
    autoCapitalize: "none",
    placeholder: "123e4567-e89b-12d3-a456-426614174000",
    hint: "Pode colar com ou sem traços, em maiúsculas.",
  },
};

export function isPixKeyType(value: string): value is PixKeyType {
  return (PIX_KEY_TYPES as readonly string[]).includes(value);
}

export function pixKeyIsDocument(type: string): boolean {
  return type === "cpf" || type === "cnpj";
}

export function canonicalPixEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > PIX_KEY_MAX || !ORGANIZER_EMAIL_PATTERN.test(email)) return null;
  return email;
}

/**
 * Celular PIX: +55 + DDD + 9 + 8 dígitos.
 * Aceita espaços, parênteses, traços, 0 à esquerda, 55 e +55.
 */
export function canonicalPixPhone(value: string): string | null {
  let digits = onlyDigits(value).replace(/^0+/, "");
  if (digits.startsWith("55")) {
    const national = digits.slice(2).replace(/^0+/, "");
    if (national.length === 11 || (digits.length > 11 && national.length >= 10 && national.length <= 11)) {
      digits = national;
    }
  }
  if (!PIX_PHONE_PATTERN.test(`+55${digits}`)) return null;
  if (!BRAZIL_DDD_SET.has(digits.slice(0, 2))) return null;
  return `+55${digits}`;
}

/** EVP: 32 hexadecimais, com ou sem traços, em qualquer caixa. Não exige UUID versão 4. */
export function canonicalPixRandom(value: string): string | null {
  const compact = value.trim().toLowerCase().replace(/[\s-]/g, "");
  if (!/^[0-9a-f]{32}$/.test(compact)) return null;
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

export function canonicalTaxDocument(value: string): string | null {
  const document = normalizeTaxDocument(value);
  return isValidTaxDocument(document) ? document : null;
}

/** Chave já no formato que o banco guarda, ou null se ainda não dá para normalizar. */
export function storedPixKey(type: string, rawKey: string, rawDocument: string): string | null {
  if (!isPixKeyType(type)) return null;
  if (type === "cpf" || type === "cnpj") {
    const document = canonicalTaxDocument(rawDocument);
    const key = canonicalTaxDocument(rawKey);
    if (!document || key !== document) return null;
    if (type === "cpf" && document.length !== 11) return null;
    if (type === "cnpj" && document.length !== 14) return null;
    return document;
  }
  if (type === "email") return canonicalPixEmail(rawKey);
  if (type === "telefone") return canonicalPixPhone(rawKey);
  return canonicalPixRandom(rawKey);
}
