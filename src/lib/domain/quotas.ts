/** Cotas opcionais de inteiras e meias do evento, em ingressos (pessoas). */
export type EventQuotas = {
  inteiraQuota: number | null;
  meiaQuota: number | null;
};

const MAX_QUOTA = 1_000_000;

/** Campo vazio = sem cota; `undefined` = valor inválido. */
export function parseQuotaInput(value: string): number | null | undefined {
  const clean = value.trim();
  if (!clean) return null;
  if (!/^\d{1,7}$/.test(clean)) return undefined;
  const quota = Number(clean);
  return quota >= 1 && quota <= MAX_QUOTA ? quota : undefined;
}

function isQuota(value: unknown): value is number | null {
  return value === null || (Number.isInteger(value) && (value as number) >= 1);
}

/** Mesmas regras do banco: cada cota cabe no total e as duas juntas também. */
export function quotasError(capacity: number, quotas: EventQuotas): string | null {
  const { inteiraQuota: inteira, meiaQuota: meia } = quotas;
  if (!isQuota(inteira)) return "Informe uma quantidade de inteiras válida ou deixe em branco.";
  if (!isQuota(meia)) return "Informe uma quantidade de meias válida ou deixe em branco.";
  if (inteira !== null && inteira > capacity) {
    return "A quantidade de inteiras não pode passar do total de ingressos.";
  }
  if (meia !== null && meia > capacity) {
    return "A quantidade de meias não pode passar do total de ingressos.";
  }
  if ((inteira ?? 0) + (meia ?? 0) > capacity) {
    return `Inteiras + meias não podem passar do total de ingressos (${capacity}).`;
  }
  return null;
}

/** Resumo para a equipe: "Total 100 · Inteiras 60 · Meias 40" e o que falta distribuir. */
export function quotaSummary(
  capacity: number,
  quotas: EventQuotas,
): { line: string; detail: string } | null {
  if (!Number.isInteger(capacity) || capacity < 1) return null;
  const { inteiraQuota: inteira, meiaQuota: meia } = quotas;
  const line = [
    `Total ${capacity}`,
    inteira === null ? "Inteiras sem cota" : `Inteiras ${inteira}`,
    meia === null ? "Meias sem cota" : `Meias ${meia}`,
  ].join(" · ");
  if (inteira === null && meia === null) {
    return { line, detail: "Inteiras e meias dividem o total, sem quantidade separada." };
  }
  if (inteira === null || meia === null) {
    const set = inteira ?? meia ?? 0;
    const other = inteira === null ? "inteiras" : "meias";
    return {
      line,
      detail: `As ${other} podem usar até ${capacity - set} ingressos (o que sobrar do total).`,
    };
  }
  const left = capacity - inteira - meia;
  return {
    line,
    detail:
      left === 0
        ? "Tudo distribuído."
        : `Faltam ${left} para distribuir. Sem distribuir, esses lugares só servem para cortesias.`,
  };
}

/** Traduz os erros `COTA_*` do banco; `null` se não for erro de cota. */
export function quotaDbErrorMessage(message: string | undefined): string | null {
  if (!message) return null;
  const below = message.match(/COTA_MENOR:(inteira|meia):(\d+)/);
  if (below) {
    const name = below[1] === "inteira" ? "inteiras" : "meias";
    return `A quantidade de ${name} não pode ser menor que ${below[2]} (já vendidos ou reservados).`;
  }
  if (message.includes("COTA_INVALIDA")) {
    return "As quantidades de inteiras e meias precisam caber no total de ingressos.";
  }
  return null;
}
