import { isValidTaxDocument, onlyDigits } from "@/lib/organizer/documents";
import { checkPassword, type PasswordPersonalInfo } from "@/lib/security/password-policy";

export type FieldResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type SignupRequestInput = {
  name: string;
  contact: string;
  idea: string;
  approxDate: string | null;
};

export const PIX_KEY_TYPES = ["cpf", "cnpj", "email", "telefone", "aleatoria"] as const;
export type PixKeyType = (typeof PIX_KEY_TYPES)[number];

export type OrganizerProfileInput = {
  fullName: string;
  publicName: string;
  phone: string;
  pixKeyType: PixKeyType;
  pixKey: string;
  pixHolderName: string;
  pixHolderDocument: string;
};

const EMAIL_PATTERN = /^[^@\s]{1,64}@[^@\s]{1,189}\.[^@\s]{2,}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PIX_KEY_MAX = 77;

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function text(value: unknown, min: number, max: number, error: string): FieldResult<string> {
  if (typeof value !== "string") return fail(error);
  const trimmed = value.trim();
  return trimmed.length >= min && trimmed.length <= max ? { ok: true, value: trimmed } : fail(error);
}

function record(input: unknown): Record<string, unknown> | null {
  return typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
}

/** Mesmo formato que o banco aceita no código do convite (até 254, minúsculas). */
export function parseEmail(value: unknown): FieldResult<string> {
  const error = "Informe um e-mail válido.";
  if (typeof value !== "string") return fail(error);
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? { ok: true, value: email } : fail(error);
}

export function parsePassword(value: unknown, personal?: PasswordPersonalInfo): FieldResult<string> {
  return checkPassword(value, personal);
}

export function parseReason(value: unknown): FieldResult<string> {
  return text(value, 5, 500, "Escreva o motivo (de 5 a 500 caracteres).");
}

/**
 * "O que mudar" do pedido de mudança. A caixa já abre com o assunto ("Local: "),
 * que não conta como descrição: depois dele, pelo menos 5 caracteres.
 */
export function parseChangeWhat(value: unknown, topic: unknown): FieldResult<string> {
  const error = "Descreva a mudança (de 5 a 500 caracteres).";
  const full = text(value, 5, 500, error);
  if (!full.ok) return full;
  const prefix = typeof topic === "string" && topic.trim() ? `${topic.trim()}:` : null;
  const content = prefix && full.value.startsWith(prefix) ? full.value.slice(prefix.length).trim() : full.value;
  return content.length >= 5 ? full : fail(error);
}

export function parseSignupRequest(input: unknown): FieldResult<SignupRequestInput> {
  const data = record(input);
  if (!data) return fail("Confira os dados e tente de novo.");
  const name = text(data.name, 2, 120, "Informe seu nome (de 2 a 120 caracteres).");
  if (!name.ok) return name;
  const contact = text(data.contact, 5, 160, "Informe um WhatsApp ou e-mail para contato.");
  if (!contact.ok) return contact;
  const idea = text(data.idea, 10, 1000, "Conte a ideia do evento (de 10 a 1000 caracteres).");
  if (!idea.ok) return idea;
  let approxDate: string | null = null;
  if (data.approxDate !== undefined && data.approxDate !== null) {
    const date = text(data.approxDate, 0, 60, "A data aproximada pode ter no máximo 60 caracteres.");
    if (!date.ok) return date;
    approxDate = date.value || null;
  }
  if (data.privacyAccepted !== true) return fail("Marque que leu a Política de Privacidade.");
  return { ok: true, value: { name: name.value, contact: contact.value, idea: idea.value, approxDate } };
}

function parsePhoneDigits(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = onlyDigits(value);
  return digits.length >= 10 && digits.length <= 13 ? digits : null;
}

/** Celular de chave PIX no formato +55DDDNÚMERO. 12 ou 13 dígitos começando com 55 já têm o código do país. */
function parsePixPhone(value: unknown): string | null {
  const digits = parsePhoneDigits(value);
  if (!digits) return null;
  if (digits.length <= 11) return `+55${digits}`;
  return digits.startsWith("55") ? `+${digits}` : null;
}

function parsePixKey(type: PixKeyType, value: unknown, holderDocument: string): FieldResult<string> {
  if (type === "cpf" || type === "cnpj") {
    const digits = typeof value === "string" ? onlyDigits(value) : "";
    const expectedLength = type === "cpf" ? 11 : 14;
    if (digits.length !== expectedLength || digits !== holderDocument) {
      return fail("Para chave CPF/CNPJ, use o documento do titular informado.");
    }
    return { ok: true, value: digits };
  }
  if (type === "email") {
    const email = parseEmail(value);
    if (!email.ok || email.value.length > PIX_KEY_MAX) return fail("Informe um e-mail válido para a chave PIX.");
    return email;
  }
  if (type === "telefone") {
    const phone = parsePixPhone(value);
    return phone ? { ok: true, value: phone } : fail("Informe o celular da chave PIX com DDD.");
  }
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
    return fail("A chave aleatória tem o formato 123e4567-e89b-12d3-a456-426614174000.");
  }
  return { ok: true, value: value.trim().toLowerCase() };
}

export function parseOrganizerProfile(input: unknown): FieldResult<OrganizerProfileInput> {
  const data = record(input);
  if (!data) return fail("Confira os dados e tente de novo.");
  const fullName = text(data.fullName, 2, 120, "Informe seu nome completo (de 2 a 120 caracteres).");
  if (!fullName.ok) return fullName;
  const publicName = text(data.publicName, 2, 80, "Informe o nome público (de 2 a 80 caracteres).");
  if (!publicName.ok) return publicName;
  const phone = parsePhoneDigits(data.phone);
  if (!phone) return fail("Informe o WhatsApp com DDD.");
  const pix = parsePixDetails(data);
  if (!pix.ok) return pix;
  return { ok: true, value: { fullName: fullName.value, publicName: publicName.value, phone, ...pix.value } };
}

export type PixDetailsInput = Pick<OrganizerProfileInput, "pixKeyType" | "pixKey" | "pixHolderName" | "pixHolderDocument">;

/** Só os campos de recebimento (cadastro e troca de chave PIX). */
export function parsePixDetails(input: unknown): FieldResult<PixDetailsInput> {
  const data = record(input);
  if (!data) return fail("Confira os dados e tente de novo.");
  const pixKeyType = data.pixKeyType;
  if (typeof pixKeyType !== "string" || !(PIX_KEY_TYPES as readonly string[]).includes(pixKeyType)) {
    return fail("Escolha o tipo da chave PIX.");
  }
  const pixHolderName = text(data.pixHolderName, 2, 120, "Informe o nome do titular da chave (de 2 a 120 caracteres).");
  if (!pixHolderName.ok) return pixHolderName;
  const pixHolderDocument = typeof data.pixHolderDocument === "string" ? onlyDigits(data.pixHolderDocument) : "";
  if (!isValidTaxDocument(pixHolderDocument)) return fail("Confira o CPF ou CNPJ do titular.");
  const pixKey = parsePixKey(pixKeyType as PixKeyType, data.pixKey, pixHolderDocument);
  if (!pixKey.ok) return pixKey;
  return {
    ok: true,
    value: {
      pixKeyType: pixKeyType as PixKeyType,
      pixKey: pixKey.value,
      pixHolderName: pixHolderName.value,
      pixHolderDocument,
    },
  };
}
