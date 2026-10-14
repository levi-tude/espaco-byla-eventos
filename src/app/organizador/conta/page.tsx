import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { forgetMyDeviceAction } from "@/app/organizador/conta/actions";
import { DevicesList, type RememberedDevice } from "@/components/auth/DevicesList";
import { OrganizerNoAccess } from "@/components/organizer/OrganizerNoAccess";
import { Card } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { getActor } from "@/lib/auth/actor";
import { AREAS } from "@/lib/auth/area";
import { maskEmail } from "@/lib/auth/login-code";
import { eventDateFormatter } from "@/lib/datetime";
import { maskPixKey, maskTaxDocument, onlyDigits } from "@/lib/organizer/documents";
import { organizerAreaEnabled } from "@/lib/organizer/settings";
import { createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Minha conta",
  robots: { index: false, follow: false },
};

const DEVICE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const dateFormatter = eventDateFormatter({ dateStyle: "short" });

const PIX_TYPE_LABELS: Record<string, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  email: "E-mail",
  telefone: "Celular",
  aleatoria: "Chave aleatória",
};

/** "(71) 99999-8888"; com o 55 do país na frente, tira o 55. */
function formatPhone(phone: string): string {
  let digits = onlyDigits(phone);
  if (digits.length > 11 && digits.startsWith("55")) digits = digits.slice(2);
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return digits;
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <dt className="text-sm text-byla-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-base text-foreground">{children}</dd>
    </div>
  );
}

export default async function OrganizerAccountPage() {
  const actor = await getActor();
  if (actor?.kind !== "organizador") {
    return <OrganizerNoAccess areaEnabled={await organizerAreaEnabled()} />;
  }

  const supabase = await createServerClient();
  const deviceToken = (await cookies()).get(AREAS.organizador.deviceCookie)?.value;
  const [profileResult, devicesResult, userResult] = await Promise.all([
    supabase
      .from("organizer_profiles")
      .select(
        "full_name, public_name, phone, pix_key_type, pix_key, pix_holder_name, pix_holder_document, terms_version, terms_accepted_at",
      )
      .eq("user_id", actor.userId)
      .maybeSingle(),
    supabase.rpc("list_my_devices", {
      p_current_token: deviceToken && DEVICE_TOKEN_PATTERN.test(deviceToken) ? deviceToken : null,
    }),
    supabase.auth.getUser(),
  ]);

  const profile = profileResult.data;
  if (profileResult.error) console.error("[conta] Falha ao ler o perfil.", profileResult.error.code);
  if (devicesResult.error) console.error("[conta] Falha ao listar os aparelhos.", devicesResult.error.code);

  // Só valores mascarados seguem para a página: a chave e o documento completos não saem do servidor.
  const account = profile
    ? {
        fullName: profile.full_name,
        publicName: profile.public_name,
        phone: formatPhone(profile.phone),
        email: maskEmail(userResult.data.user?.email),
        pixType: PIX_TYPE_LABELS[profile.pix_key_type] ?? "Chave PIX",
        pixKey: maskPixKey(profile.pix_key_type, profile.pix_key),
        pixHolderName: profile.pix_holder_name,
        pixHolderDocument: maskTaxDocument(onlyDigits(profile.pix_holder_document)),
        termsVersion: profile.terms_version,
        termsAcceptedAt: dateFormatter.format(new Date(profile.terms_accepted_at)),
      }
    : null;

  const devices: RememberedDevice[] = (devicesResult.data ?? []).map((device) => ({
    id: device.id,
    label: device.label,
    createdAt: device.created_at,
    lastUsedAt: device.last_used_at,
    expiresAt: device.expires_at,
    isCurrent: device.is_current,
  }));

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      <h1 className="font-display text-4xl tracking-wide text-foreground">Minha conta</h1>

      {!account ? (
        <Notice className="mt-6" tone="danger">
          Não foi possível carregar seus dados. Atualize a página.
        </Notice>
      ) : (
        <>
          <Card className="mt-6">
            <h2 className="text-lg font-semibold text-foreground">Seus dados</h2>
            <dl className="mt-3 divide-y divide-byla-border">
              <Item label="Nome">{account.fullName}</Item>
              <Item label="Nome público (aparece para os compradores)">{account.publicName}</Item>
              <Item label="WhatsApp">{account.phone}</Item>
              <Item label="E-mail">{account.email}</Item>
            </dl>
          </Card>

          <Card className="mt-4">
            <h2 className="text-lg font-semibold text-foreground">Recebimento (PIX)</h2>
            <dl className="mt-3 divide-y divide-byla-border">
              <Item label={`Chave PIX (${account.pixType})`}>{account.pixKey}</Item>
              <Item label="Titular da chave">{account.pixHolderName}</Item>
              <Item label="CPF/CNPJ do titular">{account.pixHolderDocument}</Item>
            </dl>
            <p className="mt-4 text-sm text-byla-muted">
              Para trocar a chave PIX, fale com o Espaço Byla.
            </p>
          </Card>

          <Card className="mt-4">
            <h2 className="text-lg font-semibold text-foreground">Termos do organizador</h2>
            <p className="mt-2 text-base text-foreground">
              Versão {account.termsVersion} · aceitos em {account.termsAcceptedAt}
            </p>
          </Card>
        </>
      )}

      <Card className="mt-4">
        <h2 className="text-lg font-semibold text-foreground">Meus aparelhos</h2>
        <p className="mb-4 mt-1 text-sm text-byla-muted">
          Aparelhos lembrados não pedem código por 30 dias. Esqueça os que você não usa mais.
        </p>
        {devicesResult.error ? (
          <Notice live={false} tone="danger">
            Não foi possível carregar seus aparelhos.
          </Notice>
        ) : (
          <DevicesList devices={devices} onForget={forgetMyDeviceAction} />
        )}
      </Card>
    </main>
  );
}
