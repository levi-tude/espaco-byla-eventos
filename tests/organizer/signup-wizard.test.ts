// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkInvite: vi.fn(),
  sendInviteEmailCode: vi.fn(),
  verifyInviteEmailCode: vi.fn(),
  completeOrganizerSignup: vi.fn(),
  resetPasswordWithLink: vi.fn(),
  startOrganizerLoginAction: vi.fn(),
  signInWithPassword: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace, refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("@/app/convite/actions", () => ({
  checkInvite: mocks.checkInvite,
  sendInviteEmailCode: mocks.sendInviteEmailCode,
  verifyInviteEmailCode: mocks.verifyInviteEmailCode,
  completeOrganizerSignup: mocks.completeOrganizerSignup,
}));
vi.mock("@/app/redefinir-senha/actions", () => ({ resetPasswordWithLink: mocks.resetPasswordWithLink }));
vi.mock("@/app/organizador/verificar/actions", () => ({ startOrganizerLoginAction: mocks.startOrganizerLoginAction }));
vi.mock("@/components/public/HumanCheck", () => ({
  useHumanCheck: () => ({ slot: null, takeToken: async () => "humano" }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithPassword: mocks.signInWithPassword } }),
}));

import { ResetPasswordForm } from "@/app/redefinir-senha/ResetPasswordForm";
import { SIGNUP_STEPS, SignupWizard } from "@/components/organizer/SignupWizard";

const TOKEN = "A".repeat(20) + "b-_".repeat(7) + "z".repeat(2);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function render(element: ReturnType<typeof createElement>) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(element));
}

function pageText(): string {
  return (container.textContent ?? "").replace(/\s+/g, " ");
}

function input(name: string): HTMLInputElement | HTMLSelectElement {
  const element = container.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`);
  if (!element) throw new Error(`campo ${name} não encontrado`);
  return element;
}

async function type(name: string, value: string) {
  const element = input(name);
  const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === label);
  if (!found) throw new Error(`botão "${label}" não encontrado em: ${pageText()}`);
  return found;
}

async function click(label: string) {
  await act(async () => button(label).click());
}

async function submit() {
  const form = container.querySelector("form");
  if (!form) throw new Error("formulário não encontrado");
  await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}

function openAt(path: string) {
  window.history.replaceState(null, "", path);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkInvite.mockResolvedValue({ ok: true, data: { valid: true } });
  mocks.sendInviteEmailCode.mockResolvedValue({ ok: true, data: undefined });
  mocks.verifyInviteEmailCode.mockResolvedValue({ ok: true, data: undefined });
  mocks.completeOrganizerSignup.mockResolvedValue({ ok: true, data: { email: "fulana@exemplo.com" } });
  mocks.signInWithPassword.mockResolvedValue({ data: {}, error: null });
  mocks.startOrganizerLoginAction.mockResolvedValue({ ok: true, data: { next: "/organizador/verificar" } });
  mocks.resetPasswordWithLink.mockResolvedValue({ ok: true, data: undefined });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function fillProfile() {
  await type("fullName", "Fulana de Tal");
  await type("publicName", "Produções Fulana");
  await type("phone", "71900000003");
  await type("email", "fulana@exemplo.com");
}

async function reachCodeStep(terms?: ReactNode) {
  openAt(`/convite#${TOKEN}`);
  await render(createElement(SignupWizard, { terms }));
  await fillProfile();
  await submit();
}

async function reachTermsStep(terms?: ReactNode) {
  await reachCodeStep(terms);
  await type("code", "123456");
  await submit();
  await type("password", "Maracuja-azul-2026");
  await type("passwordConfirm", "Maracuja-azul-2026");
  await submit();
  await type("pixKeyType", "cpf");
  await type("pixHolderName", "Fulana de Tal");
  await type("pixHolderDocument", "529.982.247-25");
  await submit();
}

describe("SignupWizard", () => {
  it("lê o token do #, tira o # da barra de endereço e confere o convite", async () => {
    openAt(`/convite?origem=zap#${TOKEN}`);
    const replaceState = vi.spyOn(window.history, "replaceState");

    await render(createElement(SignupWizard));

    expect(mocks.checkInvite).toHaveBeenCalledTimes(1);
    expect(mocks.checkInvite).toHaveBeenCalledWith(TOKEN);
    expect(replaceState).toHaveBeenCalled();
    expect(window.location.hash).toBe("");
    expect(window.location.pathname + window.location.search).toBe("/convite?origem=zap");
    expect(pageText()).toContain("Seus dados");
  });

  it("mostra os 7 passos com barra de progresso", async () => {
    expect(SIGNUP_STEPS).toEqual(["Convite", "Seus dados", "E-mail", "Senha", "Recebimento", "Termos", "Pronto"]);
    openAt(`/convite#${TOKEN}`);
    await render(createElement(SignupWizard));

    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute("aria-valuemax")).toBe("7");
    expect(bar?.getAttribute("aria-valuenow")).toBe("2");
    expect(pageText()).toContain("Passo 2 de 7");
  });

  it("sem token no endereço não chama o servidor e explica o que fazer", async () => {
    openAt("/convite");
    await render(createElement(SignupWizard));

    expect(mocks.checkInvite).not.toHaveBeenCalled();
    expect(pageText()).toContain("Abra de novo o link do convite que você recebeu.");
  });

  it("token com formato errado mostra a mensagem genérica sem chamar o servidor", async () => {
    openAt("/convite#curto");
    await render(createElement(SignupWizard));

    expect(mocks.checkInvite).not.toHaveBeenCalled();
    expect(pageText()).toContain("Este convite não vale mais. Peça um novo ao Espaço Byla.");
  });

  it("convite recusado mostra a mensagem do servidor", async () => {
    mocks.checkInvite.mockResolvedValue({ ok: false, error: "Este convite não vale mais. Peça um novo ao Espaço Byla." });
    openAt(`/convite#${TOKEN}`);
    await render(createElement(SignupWizard));

    expect(pageText()).toContain("Este convite não vale mais. Peça um novo ao Espaço Byla.");
    expect(container.querySelector('[name="fullName"]')).toBeNull();
  });

  it("Seus dados explica o nome público e manda o código ao e-mail digitado", async () => {
    openAt(`/convite#${TOKEN}`);
    await render(createElement(SignupWizard));
    expect(pageText()).toContain("Produção:");
    expect(input("phone").getAttribute("inputmode")).toBe("tel");
    expect(input("email").getAttribute("autocomplete")).toBe("email");

    await fillProfile();
    await submit();

    expect(mocks.sendInviteEmailCode).toHaveBeenCalledWith(TOKEN, "fulana@exemplo.com", "humano");
    expect(pageText()).toContain("Passo 3 de 7");
    expect(pageText()).toContain("fulana@exemplo.com");
  });

  it("campo do código é numérico com preenchimento automático e reenvio vai no máximo 2 vezes", async () => {
    await reachCodeStep();
    const code = input("code");
    expect(code.getAttribute("inputmode")).toBe("numeric");
    expect(code.getAttribute("autocomplete")).toBe("one-time-code");

    await click("Reenviar código");
    await click("Reenviar código");

    expect(mocks.sendInviteEmailCode).toHaveBeenCalledTimes(3);
    expect([...container.querySelectorAll("button")].some((b) => b.textContent?.includes("Reenviar código"))).toBe(false);
  });

  it("erro ao conferir o código fica no mesmo passo", async () => {
    mocks.verifyInviteEmailCode.mockResolvedValue({ ok: false, error: "Código incorreto. Confira os números e tente de novo." });
    await reachCodeStep();
    await type("code", "123456");
    await submit();

    expect(mocks.verifyInviteEmailCode).toHaveBeenCalledWith(TOKEN, "123456");
    expect(pageText()).toContain("Código incorreto. Confira os números e tente de novo.");
    expect(pageText()).toContain("Passo 3 de 7");
  });

  it("senha: texto do spec e conferência das duas senhas", async () => {
    await reachCodeStep();
    await type("code", "123456");
    await submit();

    expect(pageText()).toContain("Mínimo de 12 caracteres, com letras e números.");
    expect(input("password").getAttribute("autocomplete")).toBe("new-password");
    await type("password", "Maracuja-azul-2026");
    await type("passwordConfirm", "senha-diferente!!");
    await submit();
    expect(pageText()).toContain("As senhas não são iguais.");
    expect(pageText()).toContain("Passo 4 de 7");
  });

  it.each([
    ["123456789123", "Use letras e números na senha."],
    ["Fulana festa 2026", "Não use seu nome nem seu e-mail na senha."],
  ])("senha fraca (%s) avisa no navegador e não avança", async (password, message) => {
    await reachCodeStep();
    await type("code", "123456");
    await submit();

    await type("password", password);
    await type("passwordConfirm", password);
    await submit();
    expect(pageText()).toContain(message);
    expect(pageText()).toContain("Passo 4 de 7");
  });

  it("recebimento avisa sobre o titular e confere CPF/CNPJ antes de seguir", async () => {
    await reachCodeStep();
    await type("code", "123456");
    await submit();
    await type("password", "Maracuja-azul-2026");
    await type("passwordConfirm", "Maracuja-azul-2026");
    await submit();

    expect(pageText()).toContain(
      "O repasse vai para esta chave. O titular precisa ser você ou a sua empresa. Confira com cuidado.",
    );
    await type("pixKeyType", "cpf");
    await type("pixHolderName", "Fulana de Tal");
    await type("pixHolderDocument", "111.111.111-11");
    await submit();
    expect(pageText()).toContain("Confira o CPF ou CNPJ do titular.");
    expect(pageText()).toContain("Passo 5 de 7");
  });

  it("recebimento mostra o celular já no formato que será guardado", async () => {
    await reachCodeStep();
    await type("code", "123456");
    await submit();
    await type("password", "Maracuja-azul-2026");
    await type("passwordConfirm", "Maracuja-azul-2026");
    await submit();

    await type("pixKeyType", "telefone");
    await type("pixHolderName", "Fulana de Tal");
    await type("pixHolderDocument", "529.982.247-25");
    await type("pixKey", "(71) 99999-9999");

    expect(input("pixKey").getAttribute("placeholder")).toBe("(71) 99999-9999");
    expect(pageText()).toContain("Vamos guardar esta chave: +5571999999999");
  });

  it("termos: precisa marcar a caixa; ao concluir entra e vai para a tela do código", async () => {
    await reachTermsStep();
    expect(pageText()).toContain("Li e aceito os Termos do organizador e a Política de Privacidade");
    expect(container.querySelector('a[href="/termos-organizador"]')).not.toBeNull();

    await submit();
    expect(mocks.completeOrganizerSignup).not.toHaveBeenCalled();

    await act(async () => (input("terms") as HTMLInputElement).click());
    await submit();

    expect(mocks.completeOrganizerSignup).toHaveBeenCalledWith(TOKEN, {
      profile: {
        fullName: "Fulana de Tal",
        publicName: "Produções Fulana",
        phone: "71900000003",
        pixKeyType: "cpf",
        pixKey: "529.982.247-25",
        pixHolderName: "Fulana de Tal",
        pixHolderDocument: "529.982.247-25",
      },
      password: "Maracuja-azul-2026",
      termsAccepted: true,
    });
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: "fulana@exemplo.com", password: "Maracuja-azul-2026" });
    expect(mocks.startOrganizerLoginAction).toHaveBeenCalledTimes(1);
    expect(pageText()).toContain("Passo 7 de 7");
    expect(pageText()).toContain("Sua conta está pronta. Crie seu primeiro evento.");
    expect(pageText()).toContain("A cada acesso em um aparelho novo, enviaremos um código para o seu e-mail.");

    await click("Continuar");
    expect(mocks.replace).toHaveBeenCalledWith("/organizador/verificar");
  });

  it("termos: mostra o texto completo dentro da caixa com rolagem", async () => {
    await reachTermsStep(createElement("p", { "data-testid": "termos" }, "1. Quem somos … 16. Foro"));

    const box = container.querySelector('[data-testid="termos"]')?.closest(".overflow-y-auto");
    expect(box).not.toBeNull();
    expect(box?.getAttribute("tabindex")).toBe("0");
    expect(box?.textContent).toContain("16. Foro");
    expect(box?.querySelector('a[href="/termos-organizador"]')).not.toBeNull();
  });

  it("erro ao criar a conta fica no passo dos termos, sem tentar entrar", async () => {
    mocks.completeOrganizerSignup.mockResolvedValue({ ok: false, error: "Não foi possível criar a conta. Fale com o Espaço Byla." });
    await reachTermsStep();
    await act(async () => (input("terms") as HTMLInputElement).click());
    await submit();

    expect(pageText()).toContain("Não foi possível criar a conta. Fale com o Espaço Byla.");
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it("conta criada mas a entrada automática falha: mostra o link para entrar", async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: {}, error: { message: "falhou" } });
    await reachTermsStep();
    await act(async () => (input("terms") as HTMLInputElement).click());
    await submit();

    expect(pageText()).toContain("Sua conta está pronta.");
    expect(container.querySelector('a[href="/organizador/entrar"]')).not.toBeNull();
    expect(mocks.startOrganizerLoginAction).not.toHaveBeenCalled();
  });
});

describe("ResetPasswordForm", () => {
  it("lê o token do #, tira da barra e troca a senha", async () => {
    openAt(`/redefinir-senha#${TOKEN}`);
    await render(createElement(ResetPasswordForm));
    expect(window.location.hash).toBe("");

    await type("password", "Outra frase comprida 47");
    await type("passwordConfirm", "Outra frase comprida 47");
    await submit();

    expect(mocks.resetPasswordWithLink).toHaveBeenCalledWith(TOKEN, "Outra frase comprida 47");
    expect(pageText()).toContain("Senha nova salva.");
    expect(container.querySelector('a[href="/organizador/entrar"]')).not.toBeNull();
  });

  it("sem token não deixa enviar e explica o que fazer", async () => {
    openAt("/redefinir-senha");
    await render(createElement(ResetPasswordForm));

    expect(pageText()).toContain("Este link não vale mais. Peça um novo ao Espaço Byla.");
    expect(container.querySelector('[name="password"]')).toBeNull();
  });
});
