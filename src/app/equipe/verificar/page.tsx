import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/brand/BrandMark";
import { ThemeToggle } from "@/components/brand/ThemeToggle";
import { LoginCodeForm } from "@/components/equipe/LoginCodeForm";
import {
  DEVICE_REMEMBER_DAYS,
  LOGIN_CODE_RESEND_SECONDS,
  LOGIN_CODE_TTL_MINUTES,
  maskEmail,
  secondsUntil,
} from "@/lib/auth/login-code";
import { readLoginState } from "@/lib/auth/login-verification";
import { STAFF_HOME_PATH, STAFF_LOGIN_PATH } from "@/lib/auth/staff-gate";
import { createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Confirmar acesso",
  robots: { index: false, follow: false },
};

export default async function VerifyLoginPage() {
  const supabase = await createServerClient();
  const state = await readLoginState(supabase, "equipe");
  if (state.status === "fora") redirect(STAFF_LOGIN_PATH);
  if (state.status === "verificado") redirect(STAFF_HOME_PATH);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="relative flex min-h-dvh flex-col bg-byla-bg">
      <div className="flex justify-end px-4 pt-3 sm:px-6 sm:pt-4">
        <ThemeToggle />
      </div>
      <div className="flex flex-1 items-start justify-center px-4 pb-12 pt-4 sm:items-center sm:pt-0">
        <section className="w-full max-w-sm rounded-2xl border border-byla-border bg-byla-surface p-6 shadow-xl shadow-black/20 sm:p-8 dark:shadow-black/40">
          <div className="flex items-center gap-3">
            <BrandMark size={40} />
            <p className="font-display text-xl tracking-wide text-foreground">
              ACDH Eventos
            </p>
          </div>
          <h1 className="mt-6 text-2xl font-semibold tracking-tight text-foreground">
            Confirme que é você
          </h1>

          <LoginCodeForm
            codeMinutes={LOGIN_CODE_TTL_MINUTES}
            hasCode={secondsUntil(state.codeExpiresAt) > 0}
            maskedEmail={maskEmail(user?.email)}
            rememberDays={DEVICE_REMEMBER_DAYS}
            resendCooldownSeconds={LOGIN_CODE_RESEND_SECONDS}
            resendInSeconds={secondsUntil(state.resendAt)}
          />
        </section>
      </div>
    </main>
  );
}
