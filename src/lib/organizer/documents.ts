export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
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

export function isValidCnpj(digits: string): boolean {
  if (!/^\d{14}$/.test(digits) || allSame(digits)) return false;
  const d = [...digits].map(Number);
  const check = (weights: number[]) => {
    const rest = weights.reduce((total, weight, index) => total + d[index] * weight, 0) % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return check(CNPJ_W1) === d[12] && check(CNPJ_W2) === d[13];
}

export function isValidTaxDocument(digits: string): boolean {
  return digits.length === 11 ? isValidCpf(digits) : isValidCnpj(digits);
}

/** Nas telas: nunca o documento inteiro. */
export function maskTaxDocument(digits: string): string {
  if (digits.length === 11) return `•••.${digits.slice(3, 6)}.${digits.slice(6, 9)}-••`;
  if (digits.length === 14) return `••.•••.${digits.slice(5, 8)}/${digits.slice(8, 12)}-••`;
  return "•••";
}
