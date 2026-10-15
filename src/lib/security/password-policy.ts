/**
 * Regra de senha das contas criadas pelo site. Roda no navegador (aviso rápido)
 * e de novo no servidor, que é quem decide. Sem dependência externa.
 */

export type PasswordCheck = { ok: true; value: string } | { ok: false; error: string };

/** Nome e e-mail da pessoa: a senha não pode conter nenhum deles. */
export type PasswordPersonalInfo = {
  email?: string | null;
  names?: ReadonlyArray<string | null | undefined>;
};

export const PASSWORD_MIN_LENGTH = 12;
/** O login aceita até 72 bytes: letra com acento conta 2. */
export const PASSWORD_MAX_BYTES = 72;

export const PASSWORD_MESSAGES = {
  tooShort: `A senha precisa ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`,
  tooLong: "A senha pode ter no máximo 72 caracteres.",
  lettersAndNumbers: "Use letras e números na senha.",
  repetitive: "A senha está repetitiva demais (como aaaa, 1111 ou abcabc). Misture mais letras e números.",
  sequence: "Evite sequências fáceis, como 12345, abcde ou qwerty.",
  common: "Essa senha é muito comum e fácil de adivinhar. Escolha outra.",
  personal: "Não use seu nome nem seu e-mail na senha.",
} as const;

/** Trechos de 5 caracteres seguidos destas linhas (nos dois sentidos) não valem. */
const SEQUENCES = ["abcdefghijklmnopqrstuvwxyz", "01234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm", "qazwsx", "azerty"];
const SEQUENCE_SIZE = 5;

/**
 * Palavras que, sozinhas ou juntas (com números e símbolos em volta), formam
 * senhas que robôs testam primeiro. Escritas sem acento e sem espaço.
 */
const COMMON_WORDS = [
  "senha", "minhasenha", "senhaforte", "novasenha", "password", "pass", "passw", "qwerty", "asdf", "abc", "abcd",
  "admin", "administrador", "root", "user", "usuario", "login", "teste", "test", "welcome", "bemvindo", "iloveyou",
  "teamo", "amor", "meuamor", "deus", "deusefiel", "jesus", "jesuscristo", "brasil", "flamengo", "corinthians",
  "palmeiras", "vasco", "bahia", "vitoria", "gremio", "santos", "saopaulo", "cruzeiro", "salvador", "dragon", "monkey",
  "letmein", "football", "sunshine", "princess", "master", "shadow", "superman", "batman", "pokemon", "secret",
  "segredo", "mudar", "trocar", "acesso", "espaco", "espacobyla", "byla", "bylaeventos", "eventos", "evento",
  "ingresso", "ingressos", "organizador", "festa",
];
const COMMON_SET = new Set(COMMON_WORDS);

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s" };

function fail(error: string): PasswordCheck {
  return { ok: false, error };
}

/** Minúsculas, sem acento: "Espaço" vira "espaco". */
function fold(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function lettersOnly(value: string): string {
  return value.replace(/[^a-z]/g, "");
}

/** Troca "4" por "a", "@" por "a" etc. só no meio de letras ("p4ssw0rd"), não em "senha2026". */
function unLeet(value: string): string {
  const chars = [...value];
  return chars
    .map((char, index) => {
      const swap = LEET[char];
      if (!swap) return char;
      const isLetter = (c: string | undefined) => c !== undefined && /[a-z]/.test(c);
      return isLetter(chars[index - 1]) || isLetter(chars[index + 1]) ? swap : char;
    })
    .join("");
}

/** A palavra inteira é feita só de palavras da lista ("espacobyla", "senhasenha", "bylaingressos")? */
function isMadeOfCommonWords(word: string): boolean {
  if (!word) return false;
  const reachable: boolean[] = Array.from({ length: word.length + 1 }, (_, index) => index === 0);
  for (let end = 1; end <= word.length; end += 1) {
    for (let start = 0; start < end && !reachable[end]; start += 1) {
      if (reachable[start] && COMMON_SET.has(word.slice(start, end))) reachable[end] = true;
    }
  }
  return reachable[word.length];
}

function hasSequence(folded: string): boolean {
  for (const line of SEQUENCES) {
    for (const source of [line, [...line].reverse().join("")]) {
      for (let index = 0; index + SEQUENCE_SIZE <= source.length; index += 1) {
        if (folded.includes(source.slice(index, index + SEQUENCE_SIZE))) return true;
      }
    }
  }
  return false;
}

function isRepetitive(folded: string): boolean {
  return /(.)\1{3,}/u.test(folded) || /^([\s\S]+?)\1+$/u.test(folded) || new Set(folded).size < 5;
}

const PERSONAL_MIN = 4;

function personalPieces(info: PasswordPersonalInfo | undefined): string[] {
  const pieces = new Set<string>();
  const add = (value: string) => {
    if (value.length >= PERSONAL_MIN) pieces.add(value);
  };
  const local = typeof info?.email === "string" ? (info.email.split("@")[0] ?? "") : "";
  if (local) {
    const folded = fold(local);
    add(folded.replace(/[^a-z0-9]/g, ""));
    for (const part of folded.split(/[^a-z0-9]+/)) {
      add(part);
      add(lettersOnly(part));
    }
  }
  for (const name of info?.names ?? []) {
    if (typeof name !== "string") continue;
    const folded = fold(name);
    add(lettersOnly(folded));
    for (const part of folded.split(/[^a-z]+/)) add(part);
  }
  return [...pieces];
}

/**
 * Pelo menos 12 caracteres (até 72 bytes), com letras e números; sem repetições,
 * sequências, senhas comuns ou o nome/e-mail da pessoa.
 */
export function checkPassword(value: unknown, personal?: PasswordPersonalInfo): PasswordCheck {
  if (typeof value !== "string" || [...value].length < PASSWORD_MIN_LENGTH) return fail(PASSWORD_MESSAGES.tooShort);
  if (new TextEncoder().encode(value).length > PASSWORD_MAX_BYTES) return fail(PASSWORD_MESSAGES.tooLong);
  // Só a-z e 0-9 contam: é o mesmo critério da opção "letras e números" do login.
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) return fail(PASSWORD_MESSAGES.lettersAndNumbers);

  const folded = fold(value);
  if (isRepetitive(folded)) return fail(PASSWORD_MESSAGES.repetitive);
  if (hasSequence(folded)) return fail(PASSWORD_MESSAGES.sequence);
  if (isMadeOfCommonWords(lettersOnly(folded)) || isMadeOfCommonWords(lettersOnly(unLeet(folded)))) {
    return fail(PASSWORD_MESSAGES.common);
  }

  const compact = folded.replace(/[^a-z0-9]/g, "");
  const leetCompact = unLeet(folded).replace(/[^a-z0-9]/g, "");
  if (personalPieces(personal).some((piece) => compact.includes(piece) || leetCompact.includes(piece))) {
    return fail(PASSWORD_MESSAGES.personal);
  }
  return { ok: true, value };
}
