// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { INSTALLMENT_INTEREST_NOTE } from "@/lib/legal/terms";
import { PIX_OFF_LABEL } from "@/lib/domain/service-fee";

const mp = vi.hoisted(() => ({
  init: vi.fn(),
  methods: null as Record<string, string> | null,
}));

vi.mock("@mercadopago/sdk-react", () => ({
  initMercadoPago: mp.init,
  Payment: (props: { customization: { paymentMethods: Record<string, string> } }) => {
    mp.methods = props.customization.paymentMethods;
    return createElement("div", { "data-testid": "payment-brick" });
  },
}));
const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));
vi.mock("@/components/public/HumanCheck", () => ({
  useHumanCheck: () => ({ slot: null, takeToken: async () => null }),
}));
vi.mock("@/app/pedidos/[publicToken]/actions", () => ({
  payOrder: vi.fn(),
  checkOrderPayment: vi.fn(),
  changeOrderSelection: vi.fn(),
}));

import { OrderPayment } from "@/components/public/OrderPayment";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function render(element: ReturnType<typeof createElement>) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(element));
}

function payment(
  extra: {
    initialPix?: { qrCode: string; qrCodeBase64: string } | null;
    pixTotalCents?: number;
    cardTotalCents?: number;
  } = {},
) {
  return createElement(OrderPayment, {
    publicKey: "TEST-PUBLIC",
    publicToken: "pedido-1",
    amountCents: extra.cardTotalCents ?? 5500,
    pixTotalCents: extra.pixTotalCents ?? 5278,
    cardTotalCents: extra.cardTotalCents ?? 5500,
    buyerEmail: "comprador@exemplo.com",
    initialPix: extra.initialPix ?? null,
    reservationExpiresAt: null,
  });
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        paymentMethod: "pix",
        serviceFeeCents: 278,
        totalCents: 5278,
        serviceFeeRateBps: 556,
      }),
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  mp.methods = null;
  vi.unstubAllGlobals();
});

describe("pagamento do comprador", () => {
  it("abre no PIX com os dois totais e o selo de economia", async () => {
    await render(payment());
    await act(async () => {
      await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    });
    const radios = [...container.querySelectorAll<HTMLInputElement>('input[name="forma-pagamento"]')];
    expect(radios.map((radio) => radio.value)).toEqual(["pix", "cartao"]);
    expect(radios[0]?.checked).toBe(true);
    expect(container.querySelector("legend")?.textContent).toBe("Como você quer pagar");
    expect(container.textContent).toContain(PIX_OFF_LABEL);
    expect(PIX_OFF_LABEL).toBe("4% de desconto");
    expect(container.textContent).toContain("Desconto Pix");
    expect(container.textContent).toMatch(/−R\$\s*2,22/);
    expect(container.textContent).toMatch(/R\$\s*52,78/);
    expect(container.textContent).toMatch(/R\$\s*55,00/);
    expect(container.textContent).not.toMatch(/5,56/);
    expect(mp.methods).toEqual({ bankTransfer: "all" });
    expect(container.textContent).not.toContain(INSTALLMENT_INTEREST_NOTE);
    expect(mp.init).toHaveBeenCalledWith("TEST-PUBLIC", { locale: "pt-BR" });
  });

  it("no cartão mostra só o cartão e o aviso de juros das parcelas", async () => {
    await render(payment());
    await act(async () => {
      await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    });
    const card = container.querySelector<HTMLInputElement>('input[value="cartao"]');
    await act(async () => card?.click());
    expect(card?.checked).toBe(true);
    expect(mp.methods).toEqual({ creditCard: "all" });
    expect(container.textContent).toContain(INSTALLMENT_INTEREST_NOTE);
    const pix = container.querySelector<HTMLInputElement>('input[value="pix"]');

    await act(async () => pix?.click());
    expect(pix?.checked).toBe(true);
    expect(mp.methods).toEqual({ bankTransfer: "all" });
    expect(container.textContent).not.toContain(INSTALLMENT_INTEREST_NOTE);
  });

  it("PIX já gerado continua na tela do QR, sem a escolha de forma", async () => {
    await render(payment({ initialPix: { qrCode: "000201", qrCodeBase64: "aaaa" } }));
    expect(container.textContent).toContain("Pague com PIX");
    expect(container.querySelector('input[name="forma-pagamento"]')).toBeNull();
    expect(container.querySelector("[data-testid='payment-brick']")).toBeNull();
  });
});
