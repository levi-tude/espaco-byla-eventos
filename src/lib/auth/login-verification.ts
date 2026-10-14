import "server-only";

import { cookies, headers } from "next/headers";

import { ActionError } from "@/lib/action-result";
import {
  DEVICE_COOKIE_NAME,
  DEVICE_COOKIE_PATH,
  DEVICE_REMEMBER_DAYS,
  deviceLabel,
  generateLoginCode,
  newDeviceToken,
  normalizeLoginCode,
  secondsUntil,
} from "@/lib/auth/login-code";
import { sendLoginCodeEmail } from "@/lib/email/send-login-code";
import { RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createServerClient>>;

export type LoginState = {
  status: "fora" | "pendente" | "verificado";
  userId: string | null;
  sessionId: string | null;
  codeExpiresAt: string | null;
  resendAt: string | null;
};

export const TEAM_HOME = "/equipe";
export const VERIFY_PATH = "/equipe/verificar";

export const LOGIN_FAILED_MESSAGE = "Não foi possível entrar.";
export const SESSION_ENDED_MESSAGE = "Sua sessão terminou. Entre de novo.";
const SEND_FAILED_MESSAGE = "Não conseguimos enviar o código agora. Tente de novo em alguns minutos.";
const CHECK_FAILED_MESSAGE = "Não foi possível conferir o código. Tente de novo.";

const DEVICE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

const OUT: LoginState = {
  status: "fora",
  userId: null,
  sessionId: null,
  codeExpiresAt: null,
  resendAt: null,
};

/** Estado da sessão atual no banco. Qualquer falha conta como "fora" (falha fechada). */
export async function readLoginState(supabase: ServerClient): Promise<LoginState> {
  const { data, error } = await supabase.rpc("login_session_state");
  if (error) {
    console.error("[login] Falha ao ler o estado da verificação.", error.message);
    return OUT;
  }
  const row = Array.isArray(data) ? data[0] : null;
  if (!row || (row.status !== "pendente" && row.status !== "verificado")) return OUT;
  if (!row.user_id || !row.session_id) return OUT;
  return {
    status: row.status,
    userId: row.user_id,
    sessionId: row.session_id,
    codeExpiresAt: row.code_expires_at,
    resendAt: row.resend_at,
  };
}

/** Gera e envia um código novo para a sessão pendente. O banco aplica espera e limites. */
async function sendNewCode(supabase: ServerClient, state: LoginState): Promise<"enviado" | "verificado"> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || user.id !== state.userId || !state.sessionId) {
    throw new ActionError(SESSION_ENDED_MESSAGE);
  }

  const code = generateLoginCode();
  const { data: status, error } = await createAdminClient().rpc("issue_login_code", {
    p_user_id: user.id,
    p_session_id: state.sessionId,
    p_code: code,
  });
  if (error) {
    console.error("[login] Falha ao registrar o código.", error.message);
    throw new ActionError(SEND_FAILED_MESSAGE);
  }

  switch (status) {
    case "ok":
      break;
    case "verificado":
      return "verificado";
    case "aguarde":
      throw new ActionError("Aguarde um minuto para pedir outro código.");
    case "limite":
      throw new ActionError(RATE_LIMIT_MESSAGE);
    default:
      throw new ActionError(SESSION_ENDED_MESSAGE);
  }

  const sent = await sendLoginCodeEmail({ to: user.email, code });
  if (sent !== "sent") {
    console.error("[login] Código não enviado por e-mail.", sent);
    throw new ActionError(SEND_FAILED_MESSAGE);
  }
  return "enviado";
}

/** Logo depois da senha: aparelho lembrado entra direto; senão manda o código. */
export async function startLoginVerification(): Promise<{ next: string }> {
  const supabase = await createServerClient();
  const state = await readLoginState(supabase);
  if (state.status === "fora") throw new ActionError(LOGIN_FAILED_MESSAGE);
  if (state.status === "verificado") return { next: TEAM_HOME };

  const deviceToken = (await cookies()).get(DEVICE_COOKIE_NAME)?.value;
  if (deviceToken && DEVICE_TOKEN_PATTERN.test(deviceToken)) {
    const { data, error } = await supabase.rpc("verify_session_with_device", {
      p_device_token: deviceToken,
    });
    if (error) console.error("[login] Falha ao conferir o aparelho lembrado.", error.message);
    if (data === true) return { next: TEAM_HOME };
  }

  if (secondsUntil(state.codeExpiresAt) > 0) return { next: VERIFY_PATH };

  try {
    if ((await sendNewCode(supabase, state)) === "verificado") return { next: TEAM_HOME };
  } catch (error) {
    // A tela do código mostra "Enviar código" e a mensagem certa ao tentar de novo.
    if (!(error instanceof ActionError)) throw error;
  }
  return { next: VERIFY_PATH };
}

export async function resendLoginCode(): Promise<{ verified: boolean }> {
  const supabase = await createServerClient();
  const state = await readLoginState(supabase);
  if (state.status === "fora") throw new ActionError(SESSION_ENDED_MESSAGE);
  if (state.status === "verificado") return { verified: true };
  return { verified: (await sendNewCode(supabase, state)) === "verificado" };
}

const VERIFY_ERRORS: Record<string, string> = {
  invalido: "Código incorreto. Confira os números e tente de novo.",
  expirado: "Este código venceu. Toque em “Reenviar código”.",
  bloqueado: "Muitas tentativas erradas. Toque em “Reenviar código” para receber outro.",
  fora: SESSION_ENDED_MESSAGE,
};

export async function submitLoginCode(input: {
  code: unknown;
  remember: unknown;
}): Promise<{ next: string }> {
  const code = normalizeLoginCode(input.code);
  if (!code) throw new ActionError("Digite os 6 números do código.");

  const deviceToken = input.remember === true ? newDeviceToken() : null;
  const label = deviceToken ? deviceLabel((await headers()).get("user-agent")) : null;

  const supabase = await createServerClient();
  const { data: status, error } = await supabase.rpc("verify_login_code", {
    p_code: code,
    p_device_token: deviceToken,
    p_device_label: label,
  });
  if (error) {
    console.error("[login] Falha ao conferir o código.", error.message);
    throw new ActionError(CHECK_FAILED_MESSAGE);
  }

  if (status === "verificado") return { next: TEAM_HOME };
  if (status !== "ok") throw new ActionError(VERIFY_ERRORS[status] ?? CHECK_FAILED_MESSAGE);

  if (deviceToken) {
    (await cookies()).set(DEVICE_COOKIE_NAME, deviceToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: DEVICE_COOKIE_PATH,
      maxAge: DEVICE_REMEMBER_DAYS * 24 * 60 * 60,
    });
  }
  return { next: TEAM_HOME };
}

/** Sair: apaga a verificação desta conta antes de encerrar a sessão. */
export async function endLoginVerification(): Promise<void> {
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("end_login_verification");
  if (error) console.error("[login] Falha ao apagar a verificação ao sair.", error.message);
  await supabase.auth.signOut();
}
