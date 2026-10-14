import { describe, expect, it } from "vitest";

import { ORGANIZER_TERMS_UPDATED_LABEL, ORGANIZER_TERMS_VERSION } from "@/lib/legal/organizer-terms";
import { PRIVACY_POLICY_UPDATED_LABEL, PRIVACY_POLICY_VERSION } from "@/lib/legal/privacy";
import { TERMS_UPDATED_LABEL, TERMS_VERSION } from "@/lib/legal/terms";
import { legalVersionLabel } from "@/lib/legal/version-label";

describe("legalVersionLabel", () => {
  it("escreve a data da versão por extenso em português", () => {
    expect(legalVersionLabel("2026-10-14")).toBe("14 de outubro de 2026");
    expect(legalVersionLabel("2026-03-01")).toBe("1 de março de 2026");
    expect(legalVersionLabel("2027-12-31")).toBe("31 de dezembro de 2027");
  });

  it("recusa versões fora do formato de data", () => {
    expect(() => legalVersionLabel("14/10/2026")).toThrow();
    expect(() => legalVersionLabel("2026-13-01")).toThrow();
    expect(() => legalVersionLabel("2026-02-30")).toThrow();
  });
});

describe("datas de atualização dos textos legais", () => {
  it("vêm da própria versão, para nunca ficarem diferentes", () => {
    expect(PRIVACY_POLICY_UPDATED_LABEL).toBe(legalVersionLabel(PRIVACY_POLICY_VERSION));
    expect(TERMS_UPDATED_LABEL).toBe(legalVersionLabel(TERMS_VERSION));
    expect(ORGANIZER_TERMS_UPDATED_LABEL).toBe(legalVersionLabel(ORGANIZER_TERMS_VERSION));
  });
});
