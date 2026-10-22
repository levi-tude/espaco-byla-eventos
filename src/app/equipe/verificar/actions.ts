"use server";

import { redirect } from "next/navigation";

import { runAction, type ActionResult } from "@/lib/action-result";
import {
  endLoginVerification,
  resendLoginCode,
  startLoginVerification,
  submitLoginCode,
} from "@/lib/auth/login-verification";
import { STAFF_LOGIN_PATH } from "@/lib/auth/staff-gate";

const GENERIC_ERROR = "Não foi possível continuar. Tente de novo.";

/** Chamada pela tela de login logo depois da senha certa. */
export async function startLoginVerificationAction(): Promise<
  ActionResult<{ next: string; notice?: string }>
> {
  return runAction(() => startLoginVerification(), "Não foi possível entrar.");
}

export async function resendLoginCodeAction(): Promise<ActionResult<{ verified: boolean }>> {
  return runAction(() => resendLoginCode(), GENERIC_ERROR);
}

export async function submitLoginCodeAction(
  code: string,
  remember: boolean,
): Promise<ActionResult<{ next: string }>> {
  return runAction(() => submitLoginCode({ code, remember }), GENERIC_ERROR);
}

export async function signOutTeamAction(): Promise<void> {
  await endLoginVerification();
  redirect(STAFF_LOGIN_PATH);
}
