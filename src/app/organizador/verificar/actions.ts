"use server";

import { redirect } from "next/navigation";

import { runAction, type ActionResult } from "@/lib/action-result";
import { AREAS } from "@/lib/auth/area";
import {
  endLoginVerification,
  resendLoginCode,
  startLoginVerification,
  submitLoginCode,
} from "@/lib/auth/login-verification";

const GENERIC_ERROR = "Não foi possível continuar. Tente de novo.";

/** Chamada pela entrada do organizador (e pelo fim do cadastro) logo depois da senha certa. */
export async function startOrganizerLoginAction(): Promise<
  ActionResult<{ next: string; notice?: string }>
> {
  return runAction(() => startLoginVerification("organizador"), "Não foi possível entrar.");
}

export async function resendOrganizerLoginCodeAction(): Promise<ActionResult<{ verified: boolean }>> {
  return runAction(() => resendLoginCode("organizador"), GENERIC_ERROR);
}

export async function submitOrganizerLoginCodeAction(
  code: string,
  remember: boolean,
): Promise<ActionResult<{ next: string }>> {
  return runAction(() => submitLoginCode({ code, remember, area: "organizador" }), GENERIC_ERROR);
}

export async function signOutOrganizerAction(): Promise<void> {
  await endLoginVerification();
  redirect(AREAS.organizador.login);
}
