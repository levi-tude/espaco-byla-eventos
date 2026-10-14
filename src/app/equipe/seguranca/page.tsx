import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { forgetMyStaffDeviceAction } from "@/app/equipe/seguranca/actions";
import { ForgetStaffDevicesButton } from "@/app/equipe/seguranca/StaffDevicesControls";
import { DevicesList, type RememberedDevice } from "@/components/auth/DevicesList";
import { Card } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getActor } from "@/lib/auth/actor";
import { AREAS } from "@/lib/auth/area";
import { eventDateFormatter } from "@/lib/datetime";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Segurança",
  robots: { index: false, follow: false },
};

const DEVICE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const dateFormatter = eventDateFormatter({ dateStyle: "short" });

function formatDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : dateFormatter.format(date);
}

function devicesLabel(count: number): string {
  if (count <= 0) return "Nenhum aparelho lembrado";
  return count === 1 ? "1 aparelho lembrado" : `${count} aparelhos lembrados`;
}

type TeamAccount = {
  userId: string;
  name: string;
  roleLabel: string;
  devicesCount: number;
  lastUsedAt: string | null;
  isMe: boolean;
};

async function loadTeamAccounts(adminId: string): Promise<TeamAccount[] | null> {
  const { data, error } = await createAdminClient().rpc("staff_security_overview", { p_admin: adminId });
  if (error) {
    console.error("[seguranca] Falha ao listar as contas da equipe.", error.code ?? "sem-codigo");
    return null;
  }
  return (data ?? []).map((row) => ({
    userId: row.user_id,
    name: row.display_name?.trim() || "Conta sem nome",
    roleLabel: row.role === "admin" ? "Admin" : "Secretaria",
    devicesCount: row.devices_count,
    lastUsedAt: row.last_used_at,
    isMe: row.user_id.toLowerCase() === adminId.toLowerCase(),
  }));
}

export default async function SegurancaPage() {
  const actor = await getActor();
  if (actor?.kind !== "equipe") notFound();

  const supabase = await createServerClient();
  const deviceToken = (await cookies()).get(AREAS.equipe.deviceCookie)?.value;
  const [devicesResult, team] = await Promise.all([
    supabase.rpc("list_my_devices", {
      p_current_token: deviceToken && DEVICE_TOKEN_PATTERN.test(deviceToken) ? deviceToken : null,
    }),
    actor.isAdmin ? loadTeamAccounts(actor.userId) : Promise.resolve(null),
  ]);
  if (devicesResult.error) {
    console.error("[seguranca] Falha ao listar os aparelhos.", devicesResult.error.code ?? "sem-codigo");
  }

  const devices: RememberedDevice[] = (devicesResult.data ?? []).map((device) => ({
    id: device.id,
    label: device.label,
    createdAt: device.created_at,
    lastUsedAt: device.last_used_at,
    expiresAt: device.expires_at,
    isCurrent: device.is_current,
  }));

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-4 sm:px-6">
      <h1 className="font-display text-4xl tracking-wide text-foreground">Segurança</h1>

      <Card className="mt-6">
        <h2 className="text-lg font-semibold text-foreground">Meus aparelhos</h2>
        <p className="mb-4 mt-1 text-sm text-byla-muted">
          Aparelhos lembrados não pedem código por 30 dias. Esqueça os que você não usa mais.
        </p>
        {devicesResult.error ? (
          <Notice live={false} tone="danger">
            Não foi possível carregar seus aparelhos. Atualize a página.
          </Notice>
        ) : (
          <DevicesList devices={devices} onForget={forgetMyStaffDeviceAction} />
        )}
      </Card>

      {actor.isAdmin ? (
        <Card className="mt-4">
          <h2 className="text-lg font-semibold text-foreground">Contas da equipe</h2>
          <p className="mb-4 mt-1 text-sm text-byla-muted">
            Se alguém da equipe perder o celular ou sair da equipe, esqueça os aparelhos dessa conta: no próximo
            acesso, ela vai pedir o código do e-mail.
          </p>
          {team === null ? (
            <Notice live={false} tone="danger">
              Não foi possível carregar as contas da equipe. Atualize a página.
            </Notice>
          ) : (
            <ul className="divide-y divide-byla-border rounded-xl border border-byla-border">
              {team.map((account) => (
                <li className="grid gap-3 p-3 sm:p-4" key={account.userId}>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                      <span className="break-words">{account.name}</span>
                      <StatusBadge tone={account.roleLabel === "Admin" ? "info" : "neutral"}>
                        {account.roleLabel}
                      </StatusBadge>
                    </p>
                    <p className="mt-0.5 text-sm text-byla-muted">
                      {devicesLabel(account.devicesCount)}
                      {account.devicesCount > 0 && account.lastUsedAt
                        ? ` · último uso em ${formatDate(account.lastUsedAt)}`
                        : ""}
                    </p>
                  </div>
                  {account.isMe ? (
                    <p className="text-sm text-byla-muted">Sua conta: use “Meus aparelhos” acima.</p>
                  ) : account.devicesCount > 0 ? (
                    <ForgetStaffDevicesButton userId={account.userId} />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </main>
  );
}
