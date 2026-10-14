import { Inbox, Ticket, Users } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  AccountActions,
  CreateInviteForm,
  LinkDialogProvider,
  RevokeInviteButton,
  SignupRequestActions,
} from "@/app/equipe/organizadores/OrganizerAdminControls";
import { cx } from "@/components/ui/cx";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { Tone } from "@/components/ui/tone";
import { getActor } from "@/lib/auth/actor";
import { EVENT_TIME_ZONE } from "@/lib/datetime";
import { organizerAreaEnabled } from "@/lib/organizer/settings";
import { createAdminClient } from "@/lib/supabase/admin";

const PAGE_PATH = "/equipe/organizadores";

const TABS = [
  { id: "pedidos", label: "Pedidos do site" },
  { id: "convites", label: "Convites" },
  { id: "contas", label: "Contas" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const REQUEST_FILTERS = [
  { id: "nova", label: "Nova" },
  { id: "convidada", label: "Convidada" },
  { id: "arquivada", label: "Arquivada" },
] as const;
type RequestFilter = (typeof REQUEST_FILTERS)[number]["id"];

const ACCOUNT_STATUS: Record<string, { label: string; tone: Tone }> = {
  ativo: { label: "Ativa", tone: "success" },
  suspenso: { label: "Suspensa", tone: "warning" },
  encerrado: { label: "Encerrada", tone: "neutral" },
};

const PIX_TYPE_LABEL: Record<string, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  email: "E-mail",
  telefone: "Telefone",
  aleatoria: "Chave aleatória",
};

const tabClass =
  "inline-flex min-h-11 items-center whitespace-nowrap rounded-lg border px-4 text-base font-medium no-underline transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue";

const dayMonth = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: EVENT_TIME_ZONE });
const fullDate = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: EVENT_TIME_ZONE });

function formatWith(formatter: Intl.DateTimeFormat, value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : formatter.format(date);
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function tabHref(tab: TabId, filter?: RequestFilter): string {
  const params = new URLSearchParams({ aba: tab });
  if (filter) params.set("situacao", filter);
  return `${PAGE_PATH}?${params.toString()}`;
}

function TabLink({ href, active, children }: { href: string; active: boolean; children: string }) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={cx(
        tabClass,
        active ? "border-byla-action bg-byla-action text-white" : "border-byla-border text-foreground hover:bg-byla-overlay",
      )}
      href={href}
    >
      {children}
    </Link>
  );
}

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function OrganizadoresPage({ searchParams }: Props) {
  const actor = await getActor();
  if (actor?.kind !== "equipe" || !actor.isAdmin) notFound();

  const query = await searchParams;
  const tabParam = first(query.aba);
  const tab: TabId = TABS.some((item) => item.id === tabParam) ? (tabParam as TabId) : "pedidos";
  const filterParam = first(query.situacao);
  const filter: RequestFilter = REQUEST_FILTERS.some((item) => item.id === filterParam)
    ? (filterParam as RequestFilter)
    : "nova";

  const areaEnabled = await organizerAreaEnabled();

  return (
    <LinkDialogProvider>
      <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-4 sm:px-6">
        <h1 className="font-display text-4xl tracking-wide text-foreground">Organizadores</h1>
        <p className="mt-1 text-base text-byla-muted">Pedidos do site, convites e contas de quem produz eventos.</p>

        {!areaEnabled ? (
          <Notice className="mt-4" live={false} tone="warning">
            A área do organizador está desligada: convites gerados agora só funcionam depois que ela for ligada.
          </Notice>
        ) : null}

        <nav aria-label="Seções de organizadores" className="mt-6 flex flex-wrap gap-2">
          {TABS.map((item) => (
            <TabLink active={item.id === tab} href={tabHref(item.id)} key={item.id}>
              {item.label}
            </TabLink>
          ))}
        </nav>

        <div className="mt-6">
          {tab === "pedidos" ? <RequestsSection adminId={actor.userId} filter={filter} /> : null}
          {tab === "convites" ? <InvitesSection adminId={actor.userId} /> : null}
          {tab === "contas" ? <AccountsSection adminId={actor.userId} /> : null}
        </div>
      </main>
    </LinkDialogProvider>
  );
}

async function RequestsSection({ adminId, filter }: { adminId: string; filter: RequestFilter }) {
  const { data, error } = await createAdminClient().rpc("list_signup_requests", {
    p_admin: adminId,
    p_status: filter,
  });
  if (error) console.error("[organizadores] Falha ao listar pedidos do site.", error.code);
  const requests = data ?? [];

  return (
    <section aria-labelledby="pedidos-titulo">
      <h2 className="sr-only" id="pedidos-titulo">
        Pedidos do site
      </h2>
      <nav aria-label="Situação dos pedidos" className="flex flex-wrap gap-2">
        {REQUEST_FILTERS.map((item) => (
          <TabLink active={item.id === filter} href={tabHref("pedidos", item.id)} key={item.id}>
            {item.label}
          </TabLink>
        ))}
      </nav>

      {error ? (
        <Notice className="mt-4" tone="danger">
          Não foi possível carregar os pedidos. Atualize a página.
        </Notice>
      ) : requests.length === 0 ? (
        <EmptyState className="mt-4" icon={Inbox} title="Nenhum pedido nesta situação." />
      ) : (
        <ul className="mt-4 grid gap-3">
          {requests.map((request) => (
            <li className="grid gap-3 rounded-2xl border border-byla-border bg-byla-surface p-4" key={request.id}>
              <div className="grid gap-1">
                <p className="break-words text-lg font-semibold">{request.name}</p>
                <p className="break-words text-base">Contato: {request.contact}</p>
                <p className="text-sm text-byla-muted">
                  Pedido em {formatWith(fullDate, request.created_at)}
                  {request.approx_date ? ` · Data aproximada: ${request.approx_date}` : ""}
                  {request.handled_at && request.status !== "nova"
                    ? ` · ${request.status === "convidada" ? "Convidada" : "Arquivada"} em ${formatWith(fullDate, request.handled_at)}`
                    : ""}
                </p>
              </div>
              <p className="whitespace-pre-line break-words text-base">{request.idea}</p>
              {request.status !== "arquivada" ? (
                <SignupRequestActions canInvite={request.status === "nova"} requestId={request.id} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function inviteSituation(invite: {
  status: string;
  expires_at: string;
  used_at: string | null;
  used_by_public_name: string | null;
}): { label: string; tone: Tone } {
  switch (invite.status) {
    case "ativo":
      return { label: `Ativo até ${formatWith(dayMonth, invite.expires_at)}`, tone: "success" };
    case "usado":
      return {
        label: `Usado em ${formatWith(dayMonth, invite.used_at)}${invite.used_by_public_name ? ` por ${invite.used_by_public_name}` : ""}`,
        tone: "info",
      };
    case "vencido":
      return { label: "Vencido", tone: "neutral" };
    default:
      return { label: "Revogado", tone: "neutral" };
  }
}

async function InvitesSection({ adminId }: { adminId: string }) {
  const { data, error } = await createAdminClient().rpc("list_organizer_invites", { p_admin: adminId });
  if (error) console.error("[organizadores] Falha ao listar convites.", error.code);
  const invites = (data ?? []).filter((invite) => invite.kind === "convite");

  return (
    <section aria-labelledby="convites-titulo" className="grid gap-4">
      <h2 className="text-xl font-semibold" id="convites-titulo">
        Gerar convite
      </h2>
      <CreateInviteForm />
      <p className="text-sm text-byla-muted">
        O convite vale por 7 dias e só pode ser usado uma vez. O link aparece só na hora em que é gerado.
      </p>

      <h2 className="mt-4 text-xl font-semibold">Convites gerados</h2>
      {error ? (
        <Notice tone="danger">Não foi possível carregar os convites. Atualize a página.</Notice>
      ) : invites.length === 0 ? (
        <EmptyState icon={Ticket} title="Nenhum convite gerado ainda." />
      ) : (
        <ul className="grid gap-3">
          {invites.map((invite) => {
            const situation = inviteSituation(invite);
            return (
              <li
                className="grid gap-3 rounded-2xl border border-byla-border bg-byla-surface p-4 sm:flex sm:items-center sm:justify-between"
                key={invite.id}
              >
                <div className="grid min-w-0 gap-1">
                  <p className="break-words font-semibold">{invite.label || "Convite sem apelido"}</p>
                  <p className="text-sm text-byla-muted">Gerado em {formatWith(fullDate, invite.created_at)}</p>
                  <div>
                    <StatusBadge className="whitespace-normal" tone={situation.tone}>
                      {situation.label}
                    </StatusBadge>
                  </div>
                </div>
                {invite.status === "ativo" ? <RevokeInviteButton inviteId={invite.id} /> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

async function AccountsSection({ adminId }: { adminId: string }) {
  const { data, error } = await createAdminClient().rpc("list_organizers", { p_admin: adminId });
  if (error) console.error("[organizadores] Falha ao listar contas.", error.code);
  // Só campos já mascarados pelo banco chegam à tela: chave PIX e documento completos nunca saem do servidor.
  const accounts = (data ?? []).map((row) => ({
    userId: row.user_id,
    publicName: row.public_name,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    status: row.status,
    pixType: PIX_TYPE_LABEL[row.pix_key_type] ?? row.pix_key_type,
    pixKeyMasked: row.pix_key_masked,
    pixHolderName: row.pix_holder_name,
    pixHolderDocumentMasked: row.pix_holder_document_masked,
    eventsCount: row.events_count,
    devicesCount: row.devices_count,
    createdAt: row.created_at,
  }));

  return (
    <section aria-labelledby="contas-titulo">
      <h2 className="sr-only" id="contas-titulo">
        Contas
      </h2>
      {error ? (
        <Notice tone="danger">Não foi possível carregar as contas. Atualize a página.</Notice>
      ) : accounts.length === 0 ? (
        <EmptyState icon={Users} title="Nenhuma conta de organizador ainda." />
      ) : (
        <ul className="grid gap-3">
          {accounts.map((account) => {
            const status = ACCOUNT_STATUS[account.status] ?? { label: account.status, tone: "neutral" as Tone };
            return (
              <li className="grid gap-3 rounded-2xl border border-byla-border bg-byla-surface p-4" key={account.userId}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="break-words text-lg font-semibold">{account.publicName}</p>
                  <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                </div>
                <dl className="grid gap-x-6 gap-y-2 text-base sm:grid-cols-2">
                  <div className="min-w-0">
                    <dt className="text-sm text-byla-muted">Responsável</dt>
                    <dd className="break-words">{account.fullName}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-sm text-byla-muted">Contato</dt>
                    <dd className="break-words">
                      {account.email ? `${account.email} · ` : ""}
                      {account.phone}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-sm text-byla-muted">Chave PIX</dt>
                    <dd className="break-words">
                      {account.pixType}: {account.pixKeyMasked}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-sm text-byla-muted">Titular</dt>
                    <dd className="break-words">
                      {account.pixHolderName} · {account.pixHolderDocumentMasked}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-byla-muted">Eventos</dt>
                    <dd className="tabular-nums">{account.eventsCount}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-byla-muted">Aparelhos lembrados</dt>
                    <dd className="tabular-nums">{account.devicesCount}</dd>
                  </div>
                </dl>
                <p className="text-sm text-byla-muted">Conta criada em {formatWith(fullDate, account.createdAt)}</p>
                <AccountActions
                  devicesCount={account.devicesCount}
                  publicName={account.publicName}
                  status={account.status}
                  userId={account.userId}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
