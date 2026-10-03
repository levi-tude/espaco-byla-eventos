import { describe, expect, it } from "vitest";

import { PRIVACY_POLICY_VERSION } from "@/lib/legal/privacy";
import {
  isReminderOptoutToken,
  REMINDER_BATCH_SIZE,
  REMINDER_DAILY_CAP,
  REMINDER_MIN_POLICY_VERSION,
} from "@/lib/reminders/rules";
import { bearerMatches } from "@/lib/security/bearer";

describe("regras do lembrete", () => {
  it("a política em vigor já avisa sobre o lembrete", () => {
    expect(REMINDER_MIN_POLICY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(PRIVACY_POLICY_VERSION >= REMINDER_MIN_POLICY_VERSION).toBe(true);
  });

  it("deixa a maior parte da cota diária de e-mails para os ingressos", () => {
    expect(REMINDER_DAILY_CAP).toBeLessThanOrEqual(30);
    expect(REMINDER_BATCH_SIZE).toBeGreaterThan(0);
    expect(REMINDER_BATCH_SIZE).toBeLessThanOrEqual(REMINDER_DAILY_CAP);
  });

  it("aceita só o token de 64 caracteres hexadecimais gerado no banco", () => {
    expect(isReminderOptoutToken("a1".repeat(32))).toBe(true);
    expect(isReminderOptoutToken("A1".repeat(32))).toBe(false);
    expect(isReminderOptoutToken("a1".repeat(31))).toBe(false);
    expect(isReminderOptoutToken(`${"a".repeat(64)}'`)).toBe(false);
    expect(isReminderOptoutToken(undefined)).toBe(false);
    expect(isReminderOptoutToken(["a".repeat(64)])).toBe(false);
  });
});

describe("bearerMatches", () => {
  const secret = "s".repeat(64);

  it("aceita só o segredo exato no formato Bearer", () => {
    expect(bearerMatches(`Bearer ${secret}`, secret)).toBe(true);
    expect(bearerMatches(`Bearer ${secret}x`, secret)).toBe(false);
    expect(bearerMatches(`Bearer ${secret.slice(1)}`, secret)).toBe(false);
    expect(bearerMatches(secret, secret)).toBe(false);
    expect(bearerMatches(`bearer ${secret}`, secret)).toBe(false);
    expect(bearerMatches(null, secret)).toBe(false);
  });

  it("sem segredo configurado, recusa sempre (falha fechada)", () => {
    expect(bearerMatches("Bearer ", undefined)).toBe(false);
    expect(bearerMatches("Bearer ", "")).toBe(false);
    expect(bearerMatches("Bearer undefined", undefined)).toBe(false);
  });
});
