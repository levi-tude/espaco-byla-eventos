import { beforeEach, describe, expect, it, vi } from "vitest";

import { ActionError } from "@/lib/action-result";

const mocks = vi.hoisted(() => ({
  requireOrganizer: vi.fn(),
  getUser: vi.fn(),
  adminRpc: vi.fn(),
  profileLookup: vi.fn(),
  sendLoginCodeEmail: vi.fn(),
  generateLoginCode: vi.fn(),
  notifyOrganizer: vi.fn(),
  notifyTeam: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/actor", () => ({ requireOrganizer: mocks.requireOrganizer }));
vi.mock("@/lib/auth/login-code", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/login-code")>()),
  generateLoginCode: mocks.generateLoginCode,
}));
vi.mock("@/lib/email/send-login-code", () => ({ sendLoginCodeEmail: mocks.sendLoginCodeEmail }));
vi.mock("@/lib/organizer/notify", () => ({
  notifyOrganizer: mocks.notifyOrganizer,
  notifyTeam: mocks.notifyTeam,
  organizerNoticeLink: (path: string) => `https://site.example${path}`,
}));
vi.mock("@/lib/supabase/server", () => ({
  // organizer_profiles é lido com a sessão do organizador (RLS), não com o service_role.
  createServerClient: async () => ({
    auth: { getUser: mocks.getUser },
    rpc: vi.fn(),
    from: () => {
      const chain = { select: () => chain, eq: () => chain, maybeSingle: mocks.profileLookup };
      return chain;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.adminRpc }),
}));

import { cancelPixChange, sendPixChangeCode, submitPixChange } from "@/app/organizador/conta/actions";

const userId = "00000000-0000-4000-8000-0000000000aa";
const requestId = "00000000-0000-4000-8000-0000000000cc";
const CODE_SEND_ERROR = "Não foi possível enviar o código. Tente de novo em instantes.";

const validInput = () => ({
  code: "123 456",
  pixKeyType: "email",
  pixKey: "Nova@Exemplo.com",
  pixHolderName: "Titular Novo",
  pixHolderDocument: "529.982.247-25",
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireOrganizer.mockResolvedValue({ userId });
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId, email: "pessoa@exemplo.com" } } });
  mocks.generateLoginCode.mockReturnValue("654321");
  mocks.sendLoginCodeEmail.mockResolvedValue("sent");
  mocks.profileLookup.mockResolvedValue({ data: { public_name: "Produtora X" }, error: null });
  mocks.notifyOrganizer.mockResolvedValue("sent");
  mocks.notifyTeam.mockResolvedValue("sent");
});

describe("sendPixChangeCode", () => {
  it("registra o código no banco e envia com a finalidade troca_pix", async () => {
    mocks.adminRpc.mockResolvedValue({ data: "ok", error: null });
    const result = await sendPixChangeCode();
    expect(result.ok).toBe(true);
    expect(result.ok && result.data.email).not.toBe("pessoa@exemplo.com");
    expect(mocks.adminRpc).toHaveBeenCalledWith("issue_organizer_action_code", {
      p_actor: userId,
      p_purpose: "pix_change",
      p_code: "654321",
    });
    expect(mocks.sendLoginCodeEmail).toHaveBeenCalledWith({
      to: "pessoa@exemplo.com",
      code: "654321",
      purpose: "troca_pix",
    });
  });

  it.each([
    ["aguarde", "Aguarde 1 minuto para pedir outro código."],
    ["limite", "Limite de códigos de hoje atingido. Tente amanhã."],
  ])("resposta %s do banco vira mensagem e não envia", async (status, message) => {
    mocks.adminRpc.mockResolvedValue({ data: status, error: null });
    expect(await sendPixChangeCode()).toEqual({ ok: false, error: message });
    expect(mocks.sendLoginCodeEmail).not.toHaveBeenCalled();
  });

  it.each(["quota", "failed", "skipped"])("e-mail %s vira erro genérico", async (sent) => {
    mocks.adminRpc.mockResolvedValue({ data: "ok", error: null });
    mocks.sendLoginCodeEmail.mockResolvedValue(sent);
    expect(await sendPixChangeCode()).toEqual({ ok: false, error: CODE_SEND_ERROR });
  });

  it("quem não é organizador não chega ao banco", async () => {
    mocks.requireOrganizer.mockRejectedValue(new ActionError("Acesso negado."));
    expect(await sendPixChangeCode()).toEqual({ ok: false, error: "Acesso negado." });
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });
});

describe("submitPixChange", () => {
  it("valida os dados como no cadastro e avisa organizador e equipe sem a chave", async () => {
    mocks.adminRpc.mockResolvedValue({
      data: { status: "ok", request_id: requestId, confirm_after: "2026-10-16T18:30:00Z" },
      error: null,
    });
    const result = await submitPixChange(validInput());
    expect(result).toEqual({ ok: true, data: { confirmAfter: "2026-10-16T18:30:00Z" } });
    expect(mocks.adminRpc).toHaveBeenCalledWith("request_pix_change", {
      p_actor: userId,
      p_code: "123456",
      p_pix_key_type: "email",
      p_pix_key: "nova@exemplo.com",
      p_holder_name: "Titular Novo",
      p_holder_document: "52998224725",
    });
    expect(mocks.notifyOrganizer).toHaveBeenCalledWith(userId, "org_pix_troca_pedida", {
      link: "https://site.example/organizador/conta",
    });
    expect(mocks.notifyTeam).toHaveBeenCalledWith("equipe_pix_troca_pedida", {
      organizerName: "Produtora X",
      confirmAfter: "2026-10-16T18:30:00Z",
      link: "https://site.example/equipe/organizadores",
    });
    const sent = JSON.stringify([mocks.notifyOrganizer.mock.calls, mocks.notifyTeam.mock.calls]);
    expect(sent).not.toContain("nova@exemplo.com");
    expect(sent).not.toContain("52998224725");
  });

  it.each([
    ["invalido", "Código incorreto. Confira e tente de novo."],
    ["bloqueado", "Muitas tentativas erradas. Peça um novo código."],
    ["expirado", "Código vencido ou já usado. Peça um novo código."],
  ])("código %s vira mensagem e não avisa ninguém", async (status, message) => {
    mocks.adminRpc.mockResolvedValue({ data: { status }, error: null });
    expect(await submitPixChange(validInput())).toEqual({ ok: false, error: message });
    expect(mocks.notifyOrganizer).not.toHaveBeenCalled();
    expect(mocks.notifyTeam).not.toHaveBeenCalled();
  });

  it("dados inválidos param antes do banco (o código não é gasto)", async () => {
    const result = await submitPixChange({ ...validInput(), pixHolderDocument: "111.111.111-11" });
    expect(result).toEqual({ ok: false, error: "Confira o CPF ou CNPJ do titular." });
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("código fora do formato para antes do banco", async () => {
    expect((await submitPixChange({ ...validInput(), code: "12" })).ok).toBe(false);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it.each([
    ["ORG_PIX_IGUAL: x", "Essa já é a chave PIX cadastrada."],
    ["ORG_PIX_PENDENTE: x", "Existe uma troca de chave PIX aguardando decisão."],
  ])("recusa %s do banco vira mensagem", async (message, expected) => {
    mocks.adminRpc.mockResolvedValue({ data: null, error: { message } });
    expect(await submitPixChange(validInput())).toEqual({ ok: false, error: expected });
  });

  it("erro desconhecido fica genérico", async () => {
    mocks.adminRpc.mockResolvedValue({ data: null, error: { message: "boom pix_key", code: "XX000" } });
    expect(await submitPixChange(validInput())).toEqual({
      ok: false,
      error: "Não foi possível pedir a troca. Tente de novo.",
    });
  });
});

describe("cancelPixChange", () => {
  it("cancela o próprio pedido", async () => {
    mocks.adminRpc.mockResolvedValue({ data: null, error: null });
    expect(await cancelPixChange(requestId)).toEqual({ ok: true, data: undefined });
    expect(mocks.adminRpc).toHaveBeenCalledWith("cancel_pix_change", { p_actor: userId, p_request_id: requestId });
  });

  it("id inválido não chega ao banco", async () => {
    expect((await cancelPixChange("x")).ok).toBe(false);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("pedido de outra pessoa é recusado pelo banco", async () => {
    mocks.adminRpc.mockResolvedValue({ data: null, error: { message: "ORG_ACESSO: x" } });
    expect(await cancelPixChange(requestId)).toEqual({ ok: false, error: "Você não tem acesso a esta ação." });
  });
});
