import { describe, expect, it } from "vitest";
import {
  hashInviteToken, inviteLink, inviteTokenFromHash, isInviteTokenFormat, newInviteToken, whatsappInviteUrl,
} from "@/lib/organizer/invite-token";
import * as clientFormat from "@/lib/organizer/invite-token-format";

describe("token do convite", () => {
  it("gera 32 bytes em base64url e hash hex de 64", () => {
    const token = newInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashInviteToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(newInviteToken()).not.toBe(token);
  });
  it("hash é o SHA-256 conhecido do token", () => {
    expect(hashInviteToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("só aceita o formato certo", () => {
    expect(isInviteTokenFormat("a".repeat(43))).toBe(true);
    expect(isInviteTokenFormat("a".repeat(42))).toBe(false);
    expect(isInviteTokenFormat("a b".padEnd(43, "x"))).toBe(false);
    expect(isInviteTokenFormat(123)).toBe(false);
  });
  it("lê o token do # e monta o link sem o token na parte enviada ao servidor", () => {
    expect(inviteTokenFromHash(`#${"b".repeat(43)}`)).toBe("b".repeat(43));
    expect(inviteTokenFromHash(`#token=${"e".repeat(43)}`)).toBe("e".repeat(43));
    expect(inviteTokenFromHash("#curto")).toBeNull();
    expect(inviteLink("https://ingressos.espacobyla.online/", "c".repeat(43), "convite")).toBe(
      `https://ingressos.espacobyla.online/convite#${"c".repeat(43)}`,
    );
    expect(inviteLink("https://x.test", "c".repeat(43), "redefinir_senha")).toBe(`https://x.test/redefinir-senha#${"c".repeat(43)}`);
  });
  it("monta o texto do WhatsApp do spec", () => {
    const url = whatsappInviteUrl("https://x.test/convite#abc");
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(url.split("text=")[1])).toContain("O link vale por 7 dias e só pode ser usado uma vez: https://x.test/convite#abc");
  });
  it("o módulo do navegador lê o # sem depender de node:crypto", () => {
    expect(clientFormat.inviteTokenFromHash(`#${"d".repeat(43)}`)).toBe("d".repeat(43));
    expect(clientFormat.isInviteTokenFormat("d".repeat(43))).toBe(true);
    expect(clientFormat.INVITE_PATH).toBe("/convite");
    expect(clientFormat.PASSWORD_RESET_PATH).toBe("/redefinir-senha");
  });
});
