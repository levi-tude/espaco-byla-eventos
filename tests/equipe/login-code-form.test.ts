import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/equipe/verificar/actions", () => ({
  resendLoginCodeAction: vi.fn(),
  signOutTeamAction: vi.fn(),
  submitLoginCodeAction: vi.fn(),
}));

import { LoginCodeForm } from "@/components/equipe/LoginCodeForm";

const base = {
  maskedEmail: "pe***@ex***.com",
  resendCooldownSeconds: 60,
  codeMinutes: 10,
  rememberDays: 30,
};

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

describe("LoginCodeForm", () => {
  it("com código enviado: campo numérico de código único, lembrar marcado, reenviar com espera e Sair", () => {
    const html = renderToStaticMarkup(
      createElement(LoginCodeForm, { ...base, hasCode: true, resendInSeconds: 45 }),
    );
    expect(text(html)).toContain("Enviamos um código de 6 números para pe***@ex***.com");
    expect(text(html)).toContain("vale por 10 minutos");
    expect(html).toMatch(/autocomplete="one-time-code"/i);
    expect(html).toMatch(/inputmode="numeric"/i);
    expect(html).toMatch(/type="checkbox"[^>]*checked/);
    expect(text(html)).toContain("Lembrar este aparelho por 30 dias");
    expect(text(html)).toContain("Reenviar código em 0:45");
    expect(text(html)).toContain("Sair");
  });

  it("sem código aberto: botão para enviar", () => {
    const html = renderToStaticMarkup(
      createElement(LoginCodeForm, { ...base, hasCode: false, resendInSeconds: 0 }),
    );
    expect(text(html)).toContain("Enviar código");
    expect(html).not.toContain("one-time-code");
  });

  it("não cita nome de fornecedor", () => {
    const html = renderToStaticMarkup(
      createElement(LoginCodeForm, { ...base, hasCode: true, resendInSeconds: 0 }),
    );
    expect(html).not.toMatch(/supabase|resend\b|google|mercado pago/i);
  });
});
