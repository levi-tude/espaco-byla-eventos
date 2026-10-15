/** Troca da chave PIX: formatos lidos do banco (sem lógica de dinheiro). */

export type PixChangeState = {
  pending: boolean;
  requestId: string | null;
  newMasked: string | null;
  confirmAfter: string | null;
  lastDecision: { status: "confirmada" | "recusada"; note: string | null; decidedAt: string } | null;
};

export type PixSide = {
  pixKeyType: string;
  pixKey: string;
  holderName: string;
  holderDocument: string;
};

export type PixChangeDetails = {
  requestId: string;
  organizerId: string;
  publicName: string;
  status: string;
  confirmAfter: string;
  createdAt: string;
  current: PixSide;
  next: PixSide;
};

export const PIX_TYPE_LABELS: Record<string, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  email: "E-mail",
  telefone: "Celular",
  aleatoria: "Chave aleatória",
};

type Obj = Record<string, unknown>;

function obj(value: unknown): Obj | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Obj) : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function parsePixChangeState(raw: unknown): PixChangeState | null {
  const d = obj(raw);
  if (!d || typeof d.pending !== "boolean") return null;
  const last = obj(d.last_decision);
  const lastStatus = last?.status === "confirmada" || last?.status === "recusada" ? last.status : null;
  return {
    pending: d.pending,
    requestId: str(d.request_id),
    newMasked: str(d.new_masked),
    confirmAfter: str(d.confirm_after),
    lastDecision:
      last && lastStatus && str(last.decided_at)
        ? { status: lastStatus, note: str(last.note), decidedAt: last.decided_at as string }
        : null,
  };
}

function side(raw: unknown): PixSide | null {
  const d = obj(raw);
  if (!d) return null;
  const pixKeyType = str(d.pix_key_type);
  const pixKey = str(d.pix_key);
  const holderName = str(d.holder_name);
  const holderDocument = str(d.holder_document);
  if (!pixKeyType || !pixKey || !holderName || !holderDocument) return null;
  return { pixKeyType, pixKey, holderName, holderDocument };
}

export function parsePixChangeDetails(raw: unknown): PixChangeDetails | null {
  const d = obj(raw);
  if (!d) return null;
  const current = side(d.current);
  const next = side(d.new);
  const requestId = str(d.request_id);
  const organizerId = str(d.organizer_id);
  const publicName = str(d.public_name);
  const status = str(d.status);
  const confirmAfter = str(d.confirm_after);
  const createdAt = str(d.created_at);
  if (!current || !next || !requestId || !organizerId || !publicName || !status || !confirmAfter || !createdAt) {
    return null;
  }
  return { requestId, organizerId, publicName, status, confirmAfter, createdAt, current, next };
}
