import "server-only";

import { resumeCheckoutPath } from "@/lib/domain/public-token";
import { buildReminderEmail } from "@/lib/email/reminder-template";
import {
  reminderEmailConfig,
  sendReminderEmail,
  type ReminderEmailConfig,
} from "@/lib/email/send-reminder";
import {
  REMINDER_BATCH_SIZE,
  REMINDER_DAILY_CAP,
  REMINDER_MIN_POLICY_VERSION,
  REMINDER_SEND_INTERVAL_MS,
} from "@/lib/reminders/rules";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";

type AdminClient = ReturnType<typeof createAdminClient>;

export type ReminderRunResult =
  | { status: "not_configured" }
  | { status: "error" }
  | { status: "ok"; claimed: number; sent: number; failed: number };

export type ReminderRunDeps = {
  config?: ReminderEmailConfig | null;
  send?: typeof sendReminderEmail;
  pause?: (ms: number) => Promise<void>;
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function parseItems(value: Json): { name: string; quantity: number }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const { name, quantity } = item;
    return typeof name === "string" && typeof quantity === "number" ? [{ name, quantity }] : [];
  });
}

/**
 * Reivindica os pedidos abandonados no banco (que aplica todas as regras de quem
 * recebe), envia um lembrete por pedido e registra o resultado. Envio que falha
 * é liberado para nova tentativa.
 */
export async function runAbandonedReminders(
  admin: AdminClient,
  { config = reminderEmailConfig(), send = sendReminderEmail, pause = wait }: ReminderRunDeps = {},
): Promise<ReminderRunResult> {
  if (!config) {
    console.error(
      "[lembrete] Lembretes não enviados: configure RESEND_API_KEY, RESEND_FROM_EMAIL e NEXT_PUBLIC_APP_URL.",
    );
    return { status: "not_configured" };
  }

  const { data, error } = await admin.rpc("claim_abandoned_order_reminders", {
    p_limit: REMINDER_BATCH_SIZE,
    p_daily_cap: REMINDER_DAILY_CAP,
    p_min_policy_version: REMINDER_MIN_POLICY_VERSION,
  });
  if (error) {
    console.error("[lembrete] Falha ao buscar pedidos para lembrete.", error);
    return { status: "error" };
  }

  const rows = data ?? [];
  let sent = 0;
  let failed = 0;
  for (const [index, row] of rows.entries()) {
    if (index > 0) await pause(REMINDER_SEND_INTERVAL_MS);

    const token = encodeURIComponent(row.optout_token);
    const content = buildReminderEmail({
      buyerName: row.buyer_name,
      eventName: row.event_name,
      venue: row.event_venue,
      startsAt: row.event_starts_at,
      items: parseItems(row.items),
      resumeUrl: `${config.appUrl}${resumeCheckoutPath(row.event_slug, row.public_token)}`,
      unsubscribeUrl: `${config.appUrl}/lembretes/cancelar?t=${token}`,
    });
    const result = await send({
      config,
      to: row.buyer_email,
      content,
      oneClickUnsubscribeUrl: `${config.appUrl}/api/lembretes/cancelar?t=${token}`,
      idempotencyKey: `lembrete-abandono/${row.order_id}`,
    });

    if (result === "sent") {
      sent += 1;
      const { error: markError } = await admin.rpc("mark_abandoned_reminder_sent", {
        p_order_id: row.order_id,
      });
      if (markError) {
        console.error("[lembrete] Lembrete enviado, mas o envio não foi registrado.", markError);
      }
    } else {
      failed += 1;
      const { error: releaseError } = await admin.rpc("release_abandoned_reminder", {
        p_order_id: row.order_id,
      });
      if (releaseError) {
        console.error("[lembrete] Falha ao liberar o pedido para nova tentativa.", releaseError);
      }
    }
  }

  return { status: "ok", claimed: rows.length, sent, failed };
}
