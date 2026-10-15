import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  serverRpc: vi.fn(),
  adminRpc: vi.fn(),
  financeRole: vi.fn(),
  notifyOrganizer: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.serverRpc }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.adminRpc }) }));
vi.mock("@/lib/organizer/notify", () => ({
  notifyOrganizer: mocks.notifyOrganizer,
  organizerNoticeLink: (path: string) => `https://site.example${path}`,
}));
vi.mock("@/lib/auth/actor", () => ({ requireTeamAdmin: vi.fn() }));

import { decidePixChange, loadPixChangeDetails } from "@/app/equipe/organizadores/actions";

const staffUserId = "00000000-0000-4000-8000-0000000000ff";
const requestId = "00000000-0000-4000-8000-0000000000cc";
const organizerId = "00000000-0000-4000-8000-0000000000aa";
const DEVELOPER = "A conta do desenvolvedor não pode registrar repasses, ajustes ou contestações.";

const results: Record<string, { data: unknown; error: { message: string } | null }> = {};

function writeCalls() {
  return mocks.adminRpc.mock.calls.filter(([name]) => name !== "staff_finance_role");
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(results)) delete results[key];
  mocks.getUser.mockResolvedValue({ data: { user: { id: staffUserId } }, error: null });
  mocks.serverRpc.mockResolvedValue({ data: true, error: null });
  mocks.financeRole.mockResolvedValue({ data: "admin", error: null });
  mocks.notifyOrganizer.mockResolvedValue("sent");
  mocks.adminRpc.mockImplementation(async (name: string, args: unknown) => {
    if (name === "staff_finance_role") return mocks.financeRole(args);
    return results[name] ?? { data: null, error: { message: `rpc inesperada ${name}` } };
  });
});

const side = (key: string) => ({
  pix_key_type: "email",
  pix_key: key,
  holder_name: "Titular",
  holder_document: "52998224725",
});

describe("loadPixChangeDetails", () => {
  it("mostra antes e depois completos para o Admin do Espaço", async () => {
    results.pix_change_details = {
      data: {
        request_id: requestId,
        organizer_id: organizerId,
        public_name: "Produtora X",
        status: "pendente",
        confirm_after: "2026-10-16T18:30:00Z",
        created_at: "2026-10-15T18:30:00Z",
        current: side("antiga@exemplo.com"),
        new: side("nova@exemplo.com"),
      },
      error: null,
    };
    const result = await loadPixChangeDetails(requestId);
    expect(result.ok && result.data.current.pixKey).toBe("antiga@exemplo.com");
    expect(result.ok && result.data.next.pixKey).toBe("nova@exemplo.com");
  });

  it("desenvolvedor não abre", async () => {
    mocks.financeRole.mockResolvedValue({ data: "admin_dev", error: null });
    expect(await loadPixChangeDetails(requestId)).toEqual({ ok: false, error: DEVELOPER });
    expect(writeCalls()).toEqual([]);
  });
});

describe("decidePixChange", () => {
  it("confirma e avisa o organizador sem a chave", async () => {
    results.decide_pix_change = { data: { organizer_id: organizerId, status: "confirmada" }, error: null };
    expect(await decidePixChange({ requestId, approve: true })).toEqual({ ok: true, data: { status: "confirmada" } });
    expect(writeCalls()[0]).toEqual([
      "decide_pix_change",
      { p_admin: staffUserId, p_request_id: requestId, p_approve: true, p_note: null },
    ]);
    expect(mocks.notifyOrganizer).toHaveBeenCalledWith(organizerId, "org_pix_troca_confirmada", {
      note: undefined,
      link: "https://site.example/organizador/conta",
    });
  });

  it("recusa exige motivo e manda o motivo ao organizador", async () => {
    expect((await decidePixChange({ requestId, approve: false, note: "ab" })).ok).toBe(false);
    expect(writeCalls()).toEqual([]);
    results.decide_pix_change = { data: { organizer_id: organizerId, status: "recusada" }, error: null };
    expect(await decidePixChange({ requestId, approve: false, note: "Titular diferente" })).toEqual({
      ok: true,
      data: { status: "recusada" },
    });
    expect(mocks.notifyOrganizer).toHaveBeenCalledWith(organizerId, "org_pix_troca_recusada", {
      note: "Titular diferente",
      link: "https://site.example/organizador/conta",
    });
  });

  it("antes das 24 h o banco recusa com a hora de liberar", async () => {
    results.decide_pix_change = { data: null, error: { message: "ORG_ESPERA:2026-10-16T18:30:00Z" } };
    expect(await decidePixChange({ requestId, approve: true })).toEqual({
      ok: false,
      error: "A troca só pode ser confirmada a partir de 16/10 às 15:30.",
    });
    expect(mocks.notifyOrganizer).not.toHaveBeenCalled();
  });

  it.each([
    ["desenvolvedor", "admin_dev", DEVELOPER],
    ["secretaria", "secretaria", "Acesso restrito ao Admin do Espaço."],
  ])("conta %s não decide", async (_label, role, message) => {
    mocks.financeRole.mockResolvedValue({ data: role, error: null });
    expect(await decidePixChange({ requestId, approve: true })).toEqual({ ok: false, error: message });
    expect(writeCalls()).toEqual([]);
  });
});
