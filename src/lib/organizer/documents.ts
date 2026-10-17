export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/** CPF (só dígitos) ou CNPJ (dígitos e letras) sem pontuação, em maiúsculas. */
export function normalizeTaxDocument(value: string): string {
  return value.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

function allSame(digits: string): boolean {
  return /^(\d)\1*$/.test(digits);
}

export function isValidCpf(digits: string): boolean {
  if (!/^\d{11}$/.test(digits) || allSame(digits)) return false;
  const d = [...digits].map(Number);
  const check = (length: number) => {
    const sum = d.slice(0, length).reduce((total, digit, index) => total + digit * (length + 1 - index), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return check(9) === d[9] && check(10) === d[10];
}

const CNPJ_W1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_W2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

/** Valor do caractere no CNPJ alfanumérico (IN RFB 2.229/2024): código ASCII − 48. */
function cnpjValue(char: string): number {
  return char.charCodeAt(0) - 48;
}

/**
 * CNPJ numérico ou alfanumérico: 12 posições (0-9 ou A-Z) e 2 dígitos verificadores.
 * No numérico, ASCII − 48 coincide com o dígito, então a conta antiga continua valendo.
 */
export function isValidCnpj(value: string): boolean {
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(value) || allSame(value)) return false;
  const d = [...value].map(cnpjValue);
  const check = (weights: number[]) => {
    const rest = weights.reduce((total, weight, index) => total + d[index] * weight, 0) % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return check(CNPJ_W1) === d[12] && check(CNPJ_W2) === d[13];
}

export function isValidTaxDocument(value: string): boolean {
  if (/^\d{11}$/.test(value)) return isValidCpf(value);
  if (/^[0-9A-Z]{12}[0-9]{2}$/.test(value)) return isValidCnpj(value);
  return false;
}

/** Nas telas: nunca o documento inteiro. */
export function maskTaxDocument(value: string): string {
  const document = normalizeTaxDocument(value);
  if (document.length === 11 && /^\d{11}$/.test(document)) {
    return `•••.${document.slice(3, 6)}.${document.slice(6, 9)}-••`;
  }
  if (document.length === 14 && /^[0-9A-Z]{12}[0-9]{2}$/.test(document)) {
    return `••.•••.${document.slice(5, 8)}/${document.slice(8, 12)}-••`;
  }
  return "•••";
}

/** Chave PIX nas telas: só o suficiente para a pessoa reconhecer a própria chave. */
export function maskPixKey(type: string, key: string): string {
  if (type === "cpf" || type === "cnpj") return maskTaxDocument(key);
  if (type === "email") {
    const tld = /@[^@\s]+\.([a-z0-9-]+)$/i.exec(key.trim())?.[1];
    return tld ? `•••@•••.${tld.toLowerCase()}` : "•••";
  }
  if (type === "telefone") {
    const digits = onlyDigits(key);
    return digits.length >= 10 ? `(••) •••••-${digits.slice(-4)}` : "•••";
  }
  if (type === "aleatoria") {
    const value = key.trim();
    return value.length === 36 ? `••••••••-••••-••••-••••-••••••••${value.slice(-4)}` : "•••";
  }
  return "•••";
}
