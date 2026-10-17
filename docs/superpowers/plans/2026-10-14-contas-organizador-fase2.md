# Contas de organizador — fase 2 (convite, cadastro, eventos próprios e aprovação) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pessoas convidadas pelo Espaço Byla criam uma conta de organizador (com e-mail confirmado por código e código de acesso obrigatório), montam eventos próprios que só vão ao ar depois da aprovação do Admin, operam as vendas e a portaria **só dos próprios eventos** e fazem pedidos (estorno, mudança, exclusão) à equipe. Tudo publicado **desligado** (`organizer_settings.enabled = false`), sem mudar nada para compradores e equipe até o dono ligar.

**Architecture:** O organizador é um tipo de conta separado (`organizer_profiles`), que nunca está em `staff_profiles`; um gatilho impede alguém de ser os dois ao mesmo tempo, então toda regra que hoje exige "equipe" continua recusando o organizador sem mudança (falha fechada). A identidade reaproveita a fase 1: `login_code_eligible()` passa a aceitar organizador ativo, e `is_organizer()` exige `session_is_verified()`. O acesso a evento é conferido duas vezes: no servidor (`requireEventAccess` em `src/lib/auth/actor.ts`) e no banco (`actor_event_access` nas funções `service_role`, `owns_event` nas políticas RLS). O organizador **não** lê `orders`/`tickets` direto: só funções com colunas fixas. A conta é criada no servidor com a API de administração do Supabase Auth (`auth.admin.createUser`) depois de conferir um convite de uso único (só o hash no banco) e o e-mail confirmado por código, porque o cadastro público do Supabase continua desligado.

**Tech Stack:** Next.js 16.3.8 (App Router, Server Actions, `proxy.ts`), Supabase (Auth, Postgres, RLS, Storage), Vitest + jsdom, Cloudflare Turnstile (anti-robô já usado no checkout), serviço de e-mail já usado (Resend), Cloud Run.

Spec (fonte da verdade, todas as decisões fechadas): `docs/superpowers/specs/2026-10-13-contas-organizador-design.md`. Fase 1 (pronta e no ar): `docs/superpowers/plans/2026-10-14-codigo-email-equipe.md`, migrations `20261017100000_staff_email_code.sql` e `20261017110000_staff_email_code_enforce.sql`.

## Global Constraints

- Banco: **somente** MCP `user-supabase-eventos`, projeto **Espaço Byla Eventos** (`rlzyjlrcasqbjztgbgit`). Antes de qualquer SQL: declarar MCP + projeto no chat e conferir `events`, `tickets`, `orders`, `ticket_types`, `staff_profiles` e ausência de `alunos`/`transacoes`/`fluxo_*`. Nunca `user-supabase` nem `plugin-supabase-supabase`.
- Só existe o banco de produção. Migration nova: primeiro testes locais (Vitest estático + Postgres temporário em `scripts/db-tests/`), depois **ensaio em produção numa única chamada que termina em `raise exception`** (desfaz tudo) e conferência só de leitura de que nada ficou. **Aplicar** migration, **push** e **deploy** só com o "pode" explícito do dono.
- Tabela nova: `enable row level security`, `revoke all ... from public, anon, authenticated, service_role`, políticas explícitas só onde o spec pede leitura direta (`organizer_profiles`). Função nova: `set search_path = ''`, `security definer` quando ler tabelas novas, `revoke all on function ... from public, anon, authenticated` e `grant execute` mínimo (`service_role`; `authenticated`/`anon` só nas usadas em políticas, que devolvem só verdadeiro/falso ou o nome público).
- Toda Server Action e `route.ts` chama um helper de acesso **dentro dela** (`requireOrganizer`, `requireEventAccess`, `requireTeamAdmin`, `requireActor`, `requireStaffUser`, `assertStaff`, `requireFinanceAdmin`); ações públicas chamam anti-robô e/ou limite de tentativas. Um teste de inventário garante isso.
- IDs vindos do navegador: validar UUID; o evento de um pedido vem **do pedido no banco**, nunca do navegador.
- Erro ao usuário genérico (`ActionError` via `runAction`); detalhe só no log, **sem** nome, e-mail, telefone, chave PIX, CPF/CNPJ, token de convite, código de e-mail ou código de ingresso.
- Só hashes no banco: token do convite = `sha256` (hex) de 32 bytes aleatórios; código do e-mail do cadastro = `sha256(sal || ':' || código)` com sal por linha que nunca sai do banco (mesmo esquema da fase 1).
- Formulários públicos: Turnstile (falha fechada, como no checkout) + `consume_rate_limit` (chaves com hash, nunca IP/e-mail em claro).
- Textos ao comprador e páginas públicas **não citam fornecedores** ("banco responsável pelo pagamento", "serviço de e-mail"). Textos para quem opera (Admin, organizador), em português simples, sem jargão.
- Celular primeiro em todas as telas novas (1 coluna no celular, toques de 44 px, `inputMode`/`autoComplete` certos).
- Zero dado pessoal no Git (testes usam nomes e e-mails fictícios, como `fulana@exemplo.com`). Nunca ler `.env*` nem `.superpowers/sdd/staff-credentials.local.txt`.
- Sem dependência nova: `node:crypto` para tokens e códigos, `@supabase/supabase-js` para criar contas, Turnstile e e-mail já existentes.
- Antes de escrever código Next.js, ler o guia em `node_modules/next/dist/docs/` (versão com mudanças; ver `AGENTS.md`).
- Commits com `git add <caminhos explícitos>`; nunca `git add .` (vários arquivos aparecem modificados só por fim de linha CRLF).

## Decisões de desenho (e por quê)

1. **Cadastro por convite sem abrir o cadastro público (spec 5.3, já decidido).** O Supabase continua com o cadastro público desligado. O servidor, com a chave `service_role`, só cria a conta (`auth.admin.createUser({ email, password, email_confirm: true })`) depois de: (a) o token do convite conferir no banco (hash, validade, uso, revogação, área ligada); (b) o e-mail ter sido confirmado por código **naquele convite**; (c) o e-mail usado vir **do banco** (`email_code_email`), nunca do navegador. Em seguida `accept_organizer_invite` trava o convite (`for update`), confere que o e-mail da conta criada é o confirmado, valida CPF/CNPJ e cria o perfil na mesma transação. Se falhar, o servidor apaga a conta recém-criada (compensação) e mostra erro genérico. Dois envios ao mesmo tempo: o segundo `createUser` falha (e-mail já existe) ou a trava do convite recusa.
2. **Token depois do `#`** (`/convite#<token>`): o navegador não manda essa parte ao servidor, então ela não aparece em registros nem em `Referer`; a página lê o token no navegador e envia por POST (Server Action). `Referrer-Policy: no-referrer` na página.
3. **Hashes em `text` hex** (`^[0-9a-f]{64}$`) em vez de `bytea` do spec: o cliente do Supabase em JavaScript manda e recebe texto sem conversão; a segurança é a mesma.
4. **Código do e-mail do cadastro comparado dentro do banco**, igual à fase 1 (sal por linha, tentativa contada na mesma transação com `for update`, 5 erros invalidam, 15 minutos, no máximo 3 envios por convite).
5. **Duas migrations, aplicadas juntas antes do deploy:** `20261018100000_organizer_accounts.sql` (tabelas, identidade, convites, cadastro, eventos de organizador, aprovação, mudanças de RLS) e `20261018110000_organizer_operations.sql` (pedidos à equipe, lista de compradores, exclusão, portaria). Ambas aditivas e compatíveis com o código no ar: as funções alteradas mantêm assinatura e, para a equipe, o mesmo comportamento. Separadas só para a revisão caber na cabeça.
6. **Colunas de aprovação protegidas por gatilho** (achado nesta investigação): hoje `events_staff_write` deixa qualquer conta da equipe atualizar `events` direto. Sem trava, a secretaria poderia mudar `approval_status` para `aprovado` sem passar pelo Admin. O gatilho `events_guard_organizer` recusa mudança em `organizer_id`, `approval_status`, `submitted_at`, `approval_decided_*`, `approval_note`, `deleted_at`, `deleted_by` fora das funções do fluxo (que ligam `byla.organizer_flow` com `set_config(..., true)`, no mesmo padrão de `byla.session_editor`), e recusa `sales_open = true` em evento de organizador não aprovado ou excluído.
7. **`audit_log` sem chaves estrangeiras** (diferente do spec): o histórico é imutável (gatilho `reject_finance_record_change`), e um `on delete set null` viraria um `update` recusado; e o evento sem pedidos é apagado de verdade. Os IDs ficam como `uuid` soltos.
8. **Funções de administração funcionam com a área desligada** (gerar convite, ver pedidos do site): o Admin pode se preparar. Tudo do lado do organizador (entrar, cadastrar, pedido público, ações) recusa com a área desligada.
9. **Tudo que é do organizador fica em `/organizador`** (área com login, cookie do aparelho `byla_org_aparelho` com `path=/organizador`) e as páginas públicas novas ficam fora dela: `/convite`, `/redefinir-senha`, `/quero-fazer-meu-evento`, `/termos-organizador`. Com a área desligada, as públicas respondem 404 e o link do rodapé some.
10. **O mesmo formulário de evento** (`EventForm`) serve equipe e organizador. As regras de validação saem de `src/app/equipe/eventos/actions.ts` para `src/lib/events/event-input.ts` (sem mudar comportamento) e são usadas pelas duas áreas.
11. **Mudanças depois da aprovação (decisão 12, regra exata [R]):** o banco recusa com `ORG_ESTADO:mudanca:<campos>` quando o dono, em evento `aprovado`, muda o **nome**, o **local** (decisão 2A), ou, numa **sessão com vendas** (`session_has_live_orders`): horário de início/fim, preço de um tipo que já estava à venda, tirar um tipo de venda, reduzir lotação, reduzir cota de inteira/meia ou reduzir limite por tipo; remover sessão com vendas já é recusado hoje (`SESSAO_COM_VENDAS`). Valem na hora: descrição, capa, fotos, sessão nova, tudo em sessão sem vendas (respeitando o limite de lugares) e aumentos. A tela trava os mesmos campos (só conforto; quem decide é o banco).
12. **Anti-robô** no pedido público "Quero fazer meu evento" e no envio do código de e-mail do cadastro (o único passo do convite que manda e-mail). Conferir o convite e concluir o cadastro ficam só com limite por IP (o convite já é um segredo de 256 bits).
13. **Ninguém do organizador vê a chave PIX completa de outro**; o Admin vê só mascarado nesta fase (a tela de repasse com dados completos é da fase 3).

## O que fica para a fase 3 (não fazer agora)

Tarifa do banco por pagamento (`order_payment_fees`), painel "Financeiro"/"Sua parte" do organizador, `organizer_payouts` e itens, página "Repasses", feriados e prazo de repasse (`business_holidays`), desconto pendente e devolução (`ORG_DEVOLUCAO`, `ORG_TARIFA_PENDENTE`, `ORG_PIX_PENDENTE`), e o pedido de troca de chave PIX (`organizer_pix_change_requests`, decisão 1A de 2026-10-14). A fase 2 só **prepara**: guarda chave PIX, titular e CPF/CNPJ no cadastro (decisão 14), mostra tudo mascarado e deixa `audit_log` com a lista de ações aberta a novas (a fase 3 troca o `check` por migration).

**Regra de ordem (spec 18):** a área pode ser ligada para teste do dono depois da fase 2, mas o **primeiro evento real de organizador só é aprovado depois da fase 3 no ar**.

## Decisões do dono (fechadas em 2026-10-14; decisões 21 a 23 do spec, seção 2.1)

1. **Troca da chave PIX depois do cadastro — 1A:** fica para a fase 3, antes do primeiro repasse. Na fase 2 a tela "Minha conta" (Tarefa 10) mostra a chave mascarada e "Para trocar a chave PIX, fale com o Espaço Byla"; não existe ação nem tabela de troca nesta fase.
2. **Trocar o local do evento depois de aprovado — 2A:** vira "Pedir mudança" ao Admin, como nome e preço (Tarefas 1, 4 e 16; os Termos do organizador têm "local" no item 3).
3. **Publicar os textos legais — 3B:** Termos do organizador, nova Política de Privacidade e novos Termos de compra (Tarefas 16 e 17) vão ao ar **junto com o resto da fase 2**, no mesmo push e deploy (sem deploy só de textos). Continua valendo: a leitura do advogado/contador (spec 21.1) acontece antes de aprovar o **primeiro evento real de organizador**, que só é aprovado depois da fase 3 no ar; se a leitura pedir ajustes, eles saem como nova versão dos textos.

## File Structure

| Arquivo | Responsabilidade |
| --- | --- |
| `supabase/migrations/20261018100000_organizer_accounts.sql` (novo) | Tabelas novas, colunas em `events`, gatilhos, identidade (`is_organizer`, `owns_event`, `actor_event_access`, `my_account_kind`), convites, cadastro, pedido público, contas, aparelhos, evento de organizador, aprovação, mudanças em `save_event_*`/`set_session_sales_open`/`event_is_past`/políticas, "Produção", limpeza |
| `supabase/migrations/20261018110000_organizer_operations.sql` (novo) | Pedidos à equipe (estorno, mudança, exclusão), lista de compradores do organizador, exclusão de evento, vendas do evento pelo dono, portaria v3 (e remoção da assinatura antiga), contagens do painel |
| `tests/db/organizer-migrations.test.ts` (novo) | Teste estático das duas migrations |
| `scripts/db-tests/organizer-accounts.mjs` (novo) | Matriz de permissões num Postgres temporário |
| `supabase/tests/organizer_accounts_check.sql` (novo) | Ensaio em produção (transação desfeita) |
| `src/types/database.ts` | Tipos das tabelas/funções novas (editado à mão, como nas fases anteriores) |
| `src/lib/organizer/documents.ts` (novo) | CPF/CNPJ: dígitos verificadores, máscara |
| `src/lib/organizer/invite-token.ts` (novo) | Gerar, conferir formato e calcular hash do token; ler o token do `#` |
| `src/lib/organizer/validation.ts` (novo) | Validação dos formulários (pedido público, cadastro, chave PIX, senha, motivos) |
| `src/lib/organizer/post-approval.ts` (novo) | Quais campos ficam travados depois da aprovação (espelho da regra do banco, para a tela) |
| `src/lib/organizer/errors.ts` (novo) | Prefixos `ORG_*` do banco → mensagens para quem usa |
| `src/lib/organizer/settings.ts` (novo, `server-only`) | `organizerAreaEnabled()` (lê a chave geral) |
| `src/lib/auth/area.ts` (novo) | Áreas com login (`equipe`, `organizador`): caminhos, cookie, redirecionamentos |
| `src/lib/auth/staff-gate.ts` | Vira atalho para `area.ts` (mantém as exportações atuais) |
| `src/lib/auth/login-code.ts`, `src/lib/auth/login-verification.ts` | Recebem a área; conferem o tipo de conta |
| `src/lib/auth/actor.ts` (novo, `server-only`) | `getActor`, `requireActor`, `requireOrganizer`, `requireTeamAdmin`, `requireEventAccess` |
| `src/proxy.ts` | Protege `/equipe` e `/organizador` com o tipo de conta certo |
| `src/lib/events/event-input.ts` (novo) | Validação do formulário de evento, extraída de `src/app/equipe/eventos/actions.ts` |
| `src/app/equipe/eventos/media-actions.ts` | Capa: equipe ou organizador; galeria: `requireEventAccess` |
| `src/lib/email/login-code-template.ts` | Texto do código por finalidade (equipe, organizador, cadastro) |
| `src/lib/email/organizer-notice-template.ts`, `src/lib/email/send-organizer-notice.ts` (novos) | Avisos da área do organizador (teto de 10/dia) |
| `src/lib/organizer/notify.ts` (novo, `server-only`) | Quem recebe qual aviso (equipe, organizador) |
| `src/lib/security/human-check.ts`, `src/lib/security/rate-limit.ts` | Ações novas do anti-robô e regras de limite |
| `src/app/quero-fazer-meu-evento/page.tsx`, `actions.ts`, `src/components/public/OrganizerRequestForm.tsx` (novos) | Pedido público |
| `src/app/convite/page.tsx`, `actions.ts`, `src/components/organizer/SignupWizard.tsx` (novos) | Convite e cadastro |
| `src/app/redefinir-senha/page.tsx`, `actions.ts` (novos) | Nova senha por link do Admin |
| `src/app/organizador/layout.tsx`, `page.tsx`, `entrar/page.tsx`, `verificar/page.tsx`, `verificar/actions.ts`, `conta/page.tsx`, `conta/actions.ts` (novos) | Área do organizador |
| `src/app/organizador/eventos/novo/page.tsx`, `eventos/[id]/page.tsx`, `eventos/[id]/portaria/page.tsx`, `eventos/actions.ts`, `eventos/order-actions.ts` (novos) | Eventos, vendas, pedidos, portaria |
| `src/components/organizer/*` (novos) | Cards, selos, faixas de estado, "Pedir mudança", "Pedir estorno", exclusão |
| `src/components/equipe/EventForm.tsx` | Prop `area` e campos travados |
| `src/components/auth/DevicesList.tsx` (novo) | "Meus aparelhos" (equipe e organizador) |
| `src/app/equipe/organizadores/page.tsx`, `actions.ts` (novos) | Pedidos do site, convites, contas |
| `src/app/equipe/aprovacoes/page.tsx`, `actions.ts` (novos) | Aprovar/recusar eventos, mudanças, exclusões, recusar estorno pedido |
| `src/app/equipe/seguranca/page.tsx`, `actions.ts` (novos) | Meus aparelhos + Segurança da equipe (Admin) |
| `src/app/equipe/layout.tsx`, `src/app/equipe/page.tsx`, `src/app/equipe/eventos/[id]/page.tsx` | Menu novo, selos "Organizador", faixa de estorno pedido |
| `src/app/eventos/[slug]/page.tsx`, `src/lib/payments/confirm-order.ts`, `src/lib/email/send-tickets.ts`, `src/lib/email/tickets-template.ts` | "Produção: <nome público>" |
| `src/components/brand/SiteFooter.tsx`, `src/app/page.tsx` | Link "Quero fazer meu evento" (só com a área ligada) |
| `src/lib/legal/organizer-terms.ts`, `src/app/termos-organizador/page.tsx` (novos) | Termos do organizador |
| `src/lib/legal/privacy.ts`, `src/app/privacidade/page.tsx`, `src/lib/legal/terms.ts`, `src/app/termos/page.tsx` | Novas versões (Tarefa 17; vão ao ar com o resto da fase 2, decisão 3B) |
| `src/app/api/cron/keep-alive/route.ts` | Limpeza diária de convites e pedidos antigos |
| `tests/security/action-inventory.test.ts` (novo) | Inventário: toda ação/rota chama um helper de acesso |

---

### Task 1: Migration A — contas, convites, cadastro, eventos de organizador e aprovação

**Files:**
- Create: `supabase/migrations/20261018100000_organizer_accounts.sql`
- Create: `tests/db/organizer-migrations.test.ts`

**Interfaces (banco; todas `set search_path = ''`, `security definer`):**

| Função | Quem executa | Devolve / erros |
| --- | --- | --- |
| `organizer_area_enabled()` | `anon`, `authenticated`, `service_role` | `boolean` |
| `organizer_is_active(p_user_id uuid)` | interna (sem grant) | `boolean`: área ligada e perfil `ativo` |
| `login_code_eligible(p_user_id uuid)` (troca) | interna (como na fase 1) | equipe **ou** `organizer_is_active` |
| `my_account_kind()` | `authenticated` | `'equipe'` \| `'organizador'` \| `null` |
| `is_organizer()` | `anon`, `authenticated` (RLS) | `organizer_is_active(auth.uid()) and session_is_verified()` |
| `owns_event(p_event_id uuid)` | `anon`, `authenticated` (RLS) | `is_organizer()` e dono e `deleted_at is null` |
| `actor_event_access(p_actor_user_id uuid, p_event_id uuid)` | `service_role` | `'equipe'` \| `'dono'` \| `null` |
| `staff_is_admin(p_user_id uuid)` | interna | `role = 'admin'` (inclui desenvolvedor) |
| `log_audit(p_actor uuid, p_action text, p_event_id uuid, p_order_id uuid, p_organizer_id uuid, p_details jsonb)` | `service_role` | `void` |
| `valid_tax_document(p_doc text)` | `service_role` | `boolean` (CPF/CNPJ só dígitos, dígitos verificadores) |
| `create_organizer_invite(p_admin uuid, p_token_hash text, p_kind text, p_label text, p_request_id uuid, p_target_user_id uuid)` | `service_role` | `uuid`; `ORG_ACESSO`, `ORG_CONVITE`, `ORG_LIMITE` |
| `revoke_organizer_invite(p_admin uuid, p_invite_id uuid)` | `service_role` | `boolean` (false se não estava ativo) |
| `list_organizer_invites(p_admin uuid)` | `service_role` | `id, kind, label, status ('ativo'\|'usado'\|'vencido'\|'revogado'), expires_at, used_at, used_by_public_name, created_at` |
| `check_organizer_invite(p_token_hash text)` | `service_role` | `'valido'` \| `'invalido'` (só `kind='convite'`) |
| `start_invite_email_code(p_token_hash text, p_email text, p_code text)` | `service_role` | `'ok'` \| `'limite'` \| `'email_indisponivel'` \| `'invalido'` |
| `verify_invite_email_code(p_token_hash text, p_code text)` | `service_role` | `'ok'` \| `'invalido'` \| `'expirado'` \| `'bloqueado'` \| `'convite_invalido'` |
| `invite_verified_email(p_token_hash text)` | `service_role` | e-mail confirmado ou `null` |
| `accept_organizer_invite(p_token_hash text, p_user_id uuid, p_full_name text, p_public_name text, p_phone text, p_pix_key_type text, p_pix_key text, p_pix_holder_name text, p_pix_holder_document text, p_terms_version text)` | `service_role` | `void`; `ORG_CONVITE`, `ORG_EMAIL`, `ORG_DADOS` |
| `use_password_reset_invite(p_token_hash text)` | `service_role` | `uuid` do organizador; `ORG_CONVITE` |
| `submit_signup_request(p_name text, p_contact text, p_idea text, p_approx_date text, p_privacy_version text)` | `service_role` | `uuid`; `ORG_DESLIGADO`, `ORG_LIMITE`, `ORG_DADOS` |
| `list_signup_requests(p_admin uuid, p_status text)` / `archive_signup_request(p_admin uuid, p_id uuid)` | `service_role` | lista / `boolean` |
| `list_organizers(p_admin uuid)` | `service_role` | `user_id, full_name, public_name, email, phone, status, pix_key_type, pix_key_masked, pix_holder_name, pix_holder_document_masked, events_count, devices_count, created_at` |
| `set_organizer_status(p_admin uuid, p_user_id uuid, p_status text, p_reason text)` | `service_role` | `void`; suspender/encerrar apaga as sessões verificadas dele |
| `list_my_devices(p_current_token text)` | `authenticated` | `id, label, created_at, last_used_at, expires_at, is_current` (só os do `auth.uid()`) |
| `forget_my_device(p_device_id uuid)` | `authenticated` | `boolean` |
| `admin_forget_devices(p_admin uuid, p_user_id uuid)` | `service_role` | `integer` (aparelhos esquecidos) |
| `staff_security_overview(p_admin uuid)` | `service_role` | `user_id, display_name, role, is_developer, devices_count, last_used_at` |
| `create_organizer_event(p_actor uuid, p_slug text, p_name text, p_venue text, p_description text, p_cover_image_url text, p_ticket_types jsonb, p_sessions jsonb)` | `service_role` | `uuid`; `ORG_ACESSO`, `ORG_LOTACAO:<max>`, erros de `save_event_with_sessions` |
| `submit_event_for_approval(p_actor uuid, p_event_id uuid)` | `service_role` | `void`; `ORG_DONO`, `ORG_ESTADO:<motivo>` |
| `withdraw_event_submission(p_actor uuid, p_event_id uuid)` | `service_role` | `void` |
| `decide_event_approval(p_admin uuid, p_event_id uuid, p_decision text, p_publish boolean, p_note text)` | `service_role` | `void`; `ORG_ACESSO`, `ORG_ESTADO`, `ORG_DADOS` |
| `organizer_change_violations(p_event_id uuid, p_name text, p_venue text, p_sessions jsonb)` | interna | `text[]` com `nome`, `local`, `horario`, `preco`, `lotacao` |
| `save_event_with_sessions(...)` / `save_event_sessions(...)` / `set_session_sales_open(...)` (troca, mesma assinatura) | `service_role` | `p_staff_user_id` passa a significar "quem age"; dono com regras abaixo |
| `public_event_producer(p_event_id uuid)` | `anon`, `authenticated` | nome público só de evento visível ao público |
| `event_producer_names(p_event_ids uuid[])` | `service_role` | `event_id, public_name` |
| `purge_organizer_records()` | `service_role` | `integer` |

- [ ] **Step 1: Escrever o teste estático (falha porque o arquivo não existe)**

`tests/db/organizer-migrations.test.ts` (mesmo estilo de `tests/db/staff-email-code-migration.test.ts`):

```ts
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function migration(name: string) {
  return readFileSync(path.resolve(__dirname, "../../supabase/migrations", name), "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

const accounts = migration("20261018100000_organizer_accounts.sql");
const NEW_TABLES = [
  "organizer_settings",
  "organizer_profiles",
  "organizer_signup_requests",
  "organizer_invites",
  "organizer_ops_requests",
  "audit_log",
];

function functionBodies(sql: string) {
  return [...sql.matchAll(/create (?:or replace )?function public\.(\w+)\(([\s\S]*?)\$\$;/g)].map(
    (match) => ({ name: match[1], text: match[0] }),
  );
}

describe("migration organizer_accounts", () => {
  it.each(NEW_TABLES)("%s tem RLS ligada e nenhum acesso direto por padrão", (table) => {
    expect(accounts).toContain(`alter table public.${table} enable row level security;`);
    expect(accounts).toMatch(
      new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated, service_role;`),
    );
  });

  it("só organizer_profiles tem política, e só de leitura do próprio com sessão verificada", () => {
    const policies = [...accounts.matchAll(/create policy (\w+) on public\.(\w+)/g)].map((m) => m[2]);
    expect(policies).toEqual(["organizer_profiles"]);
    expect(accounts).toMatch(
      /create policy organizer_profiles_self_read on public\.organizer_profiles\s+for select to authenticated\s+using \(user_id = \(select auth\.uid\(\)\) and public\.is_organizer\(\)\);/,
    );
  });

  it("toda função fixa search_path vazio e tem revoke de public/anon/authenticated", () => {
    for (const fn of functionBodies(accounts)) {
      expect(fn.text, fn.name).toContain("set search_path = ''");
      expect(accounts, fn.name).toMatch(
        new RegExp(`revoke all on function public\\.${fn.name}\\([^)]*\\) from public, anon, authenticated`),
      );
    }
  });

  it("is_organizer e owns_event exigem sessão verificada", () => {
    const isOrganizer = functionBodies(accounts).find((fn) => fn.name === "is_organizer");
    expect(isOrganizer?.text).toContain("public.session_is_verified()");
    const owns = functionBodies(accounts).find((fn) => fn.name === "owns_event");
    expect(owns?.text).toContain("public.is_organizer()");
  });

  it("convite e código do e-mail guardam só hashes", () => {
    expect(accounts).toMatch(/token_hash text not null unique check \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
    expect(accounts).toMatch(/email_code_hash text/);
    expect(accounts).not.toMatch(/\btoken text\b/);
    expect(accounts).not.toMatch(/\bemail_code text\b/);
  });

  it("gatilho protege dono, aprovação e venda de evento de organizador", () => {
    expect(accounts).toMatch(/create trigger events_guard_organizer\s+before insert or update on public\.events/);
    expect(accounts).toContain("byla.organizer_flow");
  });

  it("funções sensíveis só para service_role", () => {
    for (const name of [
      "accept_organizer_invite",
      "create_organizer_invite",
      "decide_event_approval",
      "actor_event_access",
      "start_invite_email_code",
    ]) {
      expect(accounts).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to service_role;`));
      expect(accounts).not.toMatch(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to [^;]*(anon|authenticated)`));
    }
  });

  it("histórico é imutável", () => {
    expect(accounts).toMatch(/create trigger audit_log_immutable\s+before update or delete on public\.audit_log/);
    expect(accounts).toMatch(/create trigger audit_log_no_truncate\s+before truncate on public\.audit_log/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/db/organizer-migrations.test.ts`
Expected: FAIL com `ENOENT ... 20261018100000_organizer_accounts.sql`.

- [ ] **Step 3: Escrever a migration — tabelas**

Cabeçalho do arquivo (comentário): spec, plano, "ADITIVA; aplicar antes do deploy; área nasce desligada; voltar atrás = `update public.organizer_settings set enabled = false`".

```sql
-- 1) Tabelas ---------------------------------------------------------------------

create table public.organizer_settings (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default false,
  max_session_capacity integer not null default 100 check (max_session_capacity between 1 and 2000),
  updated_at timestamptz not null default now()
);
insert into public.organizer_settings (id) values (1);

create table public.organizer_signup_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  contact text not null check (char_length(btrim(contact)) between 5 and 160),
  idea text not null check (char_length(btrim(idea)) between 10 and 1000),
  approx_date text check (approx_date is null or char_length(approx_date) <= 60),
  privacy_policy_version text not null check (char_length(privacy_policy_version) between 8 and 20),
  status text not null default 'nova' check (status in ('nova', 'convidada', 'arquivada')),
  handled_by uuid references auth.users (id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.organizer_invites (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'convite' check (kind in ('convite', 'redefinir_senha')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  target_user_id uuid references auth.users (id) on delete cascade,
  label text check (label is null or char_length(label) <= 80),
  request_id uuid references public.organizer_signup_requests (id) on delete set null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  email_code_salt text,
  email_code_hash text,
  email_code_email text check (email_code_email is null or char_length(email_code_email) <= 254),
  email_code_expires_at timestamptz,
  email_code_attempts smallint not null default 0 check (email_code_attempts between 0 and 5),
  email_code_sends smallint not null default 0 check (email_code_sends between 0 and 3),
  email_verified_at timestamptz,
  check (used_at is null or revoked_at is null),
  check ((kind = 'redefinir_senha') = (target_user_id is not null))
);

create table public.organizer_profiles (
  user_id uuid primary key references auth.users (id) on delete restrict,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 120),
  public_name text not null check (char_length(btrim(public_name)) between 2 and 80),
  phone text not null check (phone ~ '^[0-9]{10,13}$'),
  pix_key_type text not null check (pix_key_type in ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria')),
  pix_key text not null check (char_length(pix_key) between 1 and 77),
  pix_holder_name text not null check (char_length(btrim(pix_holder_name)) between 2 and 120),
  pix_holder_document text not null check (pix_holder_document ~ '^([0-9]{11}|[0-9]{14})$'),
  pix_key_changed_at timestamptz,
  status text not null default 'ativo' check (status in ('ativo', 'suspenso', 'encerrado')),
  status_reason text check (status_reason is null or char_length(status_reason) between 5 and 500),
  terms_version text not null,
  terms_accepted_at timestamptz not null,
  invite_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.events
  add column organizer_id uuid references public.organizer_profiles (user_id),
  add column approval_status text not null default 'aprovado'
    check (approval_status in ('rascunho', 'em_analise', 'aprovado', 'recusado')),
  add column submitted_at timestamptz,
  add column approval_decided_by uuid references auth.users (id) on delete set null,
  add column approval_decided_at timestamptz,
  add column approval_note text check (approval_note is null or char_length(approval_note) between 5 and 500),
  add column deleted_at timestamptz,
  add column deleted_by uuid references auth.users (id) on delete set null;
create index events_organizer_id_idx on public.events (organizer_id) where organizer_id is not null;

create table public.organizer_ops_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('estorno', 'exclusao', 'mudanca')),
  event_id uuid not null references public.events (id) on delete cascade,
  order_id uuid references public.orders (id),
  details jsonb not null default '{}'::jsonb,
  reason text not null check (char_length(btrim(reason)) between 5 and 500),
  status text not null default 'pendente' check (status in ('pendente', 'atendido', 'recusado', 'cancelado')),
  requested_by uuid not null references auth.users (id),
  decided_by uuid references auth.users (id) on delete set null,
  decision_note text check (decision_note is null or char_length(decision_note) between 5 and 500),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check ((kind = 'estorno') = (order_id is not null))
);
create unique index organizer_ops_requests_refund_pending
  on public.organizer_ops_requests (order_id) where kind = 'estorno' and status = 'pendente';
create unique index organizer_ops_requests_deletion_pending
  on public.organizer_ops_requests (event_id) where kind = 'exclusao' and status = 'pendente';
create index organizer_ops_requests_event_idx on public.organizer_ops_requests (event_id, created_at desc);

-- Sem chaves estrangeiras: o histórico é imutável e sobrevive a evento apagado.
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  actor_kind text not null check (actor_kind in ('admin', 'secretaria', 'organizador', 'sistema')),
  action text not null check (action in (
    'convite_gerado', 'convite_revogado', 'convite_usado', 'link_senha_gerado', 'senha_redefinida_link',
    'conta_criada', 'conta_suspensa', 'conta_reativada', 'conta_encerrada', 'aparelhos_esquecidos',
    'evento_criado', 'evento_enviado', 'evento_envio_desfeito', 'evento_aprovado', 'evento_recusado',
    'evento_alterado_pos_aprovacao', 'evento_excluido', 'vendas_abertas', 'vendas_pausadas',
    'pedido_estorno_criado', 'pedido_exclusao_criado', 'pedido_mudanca_criado',
    'pedido_atendido', 'pedido_recusado', 'pedido_cancelado'
  )),
  event_id uuid,
  order_id uuid,
  organizer_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_event_idx on public.audit_log (event_id, created_at desc) where event_id is not null;

create trigger audit_log_immutable
  before update or delete on public.audit_log
  for each row execute function public.reject_finance_record_change();
create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function public.reject_finance_record_change();

alter table public.organizer_settings enable row level security;
alter table public.organizer_signup_requests enable row level security;
alter table public.organizer_invites enable row level security;
alter table public.organizer_profiles enable row level security;
alter table public.organizer_ops_requests enable row level security;
alter table public.audit_log enable row level security;

revoke all on table public.organizer_settings from public, anon, authenticated, service_role;
revoke all on table public.organizer_signup_requests from public, anon, authenticated, service_role;
revoke all on table public.organizer_invites from public, anon, authenticated, service_role;
revoke all on table public.organizer_profiles from public, anon, authenticated, service_role;
revoke all on table public.organizer_ops_requests from public, anon, authenticated, service_role;
revoke all on table public.audit_log from public, anon, authenticated, service_role;

grant select on table public.organizer_profiles to authenticated;
```

Nota: `details` do `audit_log` nunca leva nome, e-mail, telefone, chave PIX, CPF/CNPJ ou token (só nomes de campos, estados e IDs). A política `organizer_profiles_self_read` vem depois de `is_organizer()` (Step 4).

- [ ] **Step 4: Escrever a migration — identidade, histórico e documento**

```sql
-- 2) Identidade --------------------------------------------------------------------

create function public.organizer_area_enabled()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select s.enabled from public.organizer_settings s where s.id = 1), false);
$$;

create function public.organizer_is_active(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user_id is not null
    and public.organizer_area_enabled()
    and exists (
      select 1 from public.organizer_profiles op
      where op.user_id = p_user_id and op.status = 'ativo'
    );
$$;

-- Fase 1 deixou este ponto preparado: agora o organizador ativo também usa o código.
create or replace function public.login_code_eligible(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user_id is not null
    and (
      exists (select 1 from public.staff_profiles sp where sp.user_id = p_user_id)
      or public.organizer_is_active(p_user_id)
    );
$$;

-- Para o proxy e o login escolherem a área; não exige o código e não revela mais nada.
create function public.my_account_kind()
returns text language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.staff_profiles sp where sp.user_id = (select auth.uid())) then 'equipe'
    when exists (select 1 from public.organizer_profiles op where op.user_id = (select auth.uid())) then 'organizador'
  end;
$$;

create function public.is_organizer()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.organizer_is_active((select auth.uid())) and public.session_is_verified();
$$;

create function public.owns_event(p_event_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_organizer()
    and exists (
      select 1 from public.events e
      where e.id = p_event_id and e.organizer_id = (select auth.uid()) and e.deleted_at is null
    );
$$;

-- Base de toda função compartilhada (service_role). O servidor já conferiu a sessão
-- verificada com is_staff()/is_organizer() antes de chamar.
create function public.actor_event_access(p_actor_user_id uuid, p_event_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when p_actor_user_id is null or p_event_id is null then null
    when exists (select 1 from public.staff_profiles sp where sp.user_id = p_actor_user_id) then
      case when exists (select 1 from public.events e where e.id = p_event_id) then 'equipe' end
    when public.organizer_is_active(p_actor_user_id)
      and exists (
        select 1 from public.events e
        where e.id = p_event_id and e.organizer_id = p_actor_user_id and e.deleted_at is null
      ) then 'dono'
  end;
$$;

create function public.staff_is_admin(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff_profiles sp where sp.user_id = p_user_id and sp.role = 'admin'
  );
$$;

create policy organizer_profiles_self_read on public.organizer_profiles
  for select to authenticated
  using (user_id = (select auth.uid()) and public.is_organizer());

-- Ninguém é equipe e organizador ao mesmo tempo.
create function public.forbid_staff_and_organizer()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'organizer_profiles'
     and exists (select 1 from public.staff_profiles sp where sp.user_id = new.user_id) then
    raise exception 'ORG_ACESSO: Conta da equipe não pode ser organizador.';
  end if;
  if tg_table_name = 'staff_profiles'
     and exists (select 1 from public.organizer_profiles op where op.user_id = new.user_id) then
    raise exception 'ORG_ACESSO: Conta de organizador não pode ser da equipe.';
  end if;
  return new;
end;
$$;
create trigger organizer_profiles_not_staff
  before insert or update of user_id on public.organizer_profiles
  for each row execute function public.forbid_staff_and_organizer();
create trigger staff_profiles_not_organizer
  before insert or update of user_id on public.staff_profiles
  for each row execute function public.forbid_staff_and_organizer();

create function public.log_audit(
  p_actor uuid, p_action text, p_event_id uuid, p_order_id uuid, p_organizer_id uuid, p_details jsonb
)
returns void language sql volatile security definer set search_path = '' as $$
  insert into public.audit_log (actor_user_id, actor_kind, action, event_id, order_id, organizer_id, details)
  values (
    p_actor,
    case
      when p_actor is null then 'sistema'
      when public.staff_is_admin(p_actor) then 'admin'
      when exists (select 1 from public.staff_profiles sp where sp.user_id = p_actor) then 'secretaria'
      else 'organizador'
    end,
    p_action, p_event_id, p_order_id, p_organizer_id, coalesce(p_details, '{}'::jsonb)
  );
$$;

create function public.valid_tax_document(p_doc text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  d integer[];
  s integer;
  r integer;
  i integer;
  w1 integer[] := array[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  w2 integer[] := array[6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
begin
  if p_doc is null or p_doc !~ '^([0-9]{11}|[0-9]{14})$' or p_doc ~ '^(.)\1*$' then
    return false;
  end if;
  d := array(select substr(p_doc, g, 1)::integer from generate_series(1, length(p_doc)) g);
  if length(p_doc) = 11 then
    s := 0;
    for i in 1..9 loop s := s + d[i] * (11 - i); end loop;
    r := (s * 10) % 11; if r = 10 then r := 0; end if;
    if r <> d[10] then return false; end if;
    s := 0;
    for i in 1..10 loop s := s + d[i] * (12 - i); end loop;
    r := (s * 10) % 11; if r = 10 then r := 0; end if;
    return r = d[11];
  end if;
  s := 0;
  for i in 1..12 loop s := s + d[i] * w1[i]; end loop;
  r := s % 11; r := case when r < 2 then 0 else 11 - r end;
  if r <> d[13] then return false; end if;
  s := 0;
  for i in 1..13 loop s := s + d[i] * w2[i]; end loop;
  r := s % 11; r := case when r < 2 then 0 else 11 - r end;
  return r = d[14];
end;
$$;
```

- [ ] **Step 5: Escrever a migration — trava em `events`**

```sql
-- 3) Trava do evento de organizador -------------------------------------------------

-- Só as funções do fluxo (que ligam byla.organizer_flow) mudam dono, aprovação e
-- exclusão. Mesmo um erro no servidor ou uma conta da equipe escrevendo direto pela
-- política events_staff_write não publica rascunho nem pula o Admin.
create function public.events_guard_organizer()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_flow boolean := coalesce(current_setting('byla.organizer_flow', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if not v_flow and (
      new.organizer_id is not null or new.approval_status <> 'aprovado'
      or new.submitted_at is not null or new.approval_decided_by is not null
      or new.approval_decided_at is not null or new.approval_note is not null
      or new.deleted_at is not null or new.deleted_by is not null
    ) then
      raise exception 'ORG_ESTADO: Evento de organizador só pelo fluxo próprio.';
    end if;
  else
    if new.organizer_id is distinct from old.organizer_id then
      raise exception 'ORG_DONO: O dono do evento não muda.';
    end if;
    if not v_flow and (
      new.approval_status, new.submitted_at, new.approval_decided_by, new.approval_decided_at,
      new.approval_note, new.deleted_at, new.deleted_by
    ) is distinct from (
      old.approval_status, old.submitted_at, old.approval_decided_by, old.approval_decided_at,
      old.approval_note, old.deleted_at, old.deleted_by
    ) then
      raise exception 'ORG_ESTADO: Aprovação e exclusão só pelo fluxo próprio.';
    end if;
  end if;

  if new.sales_open and (
    new.deleted_at is not null
    or (new.organizer_id is not null and new.approval_status <> 'aprovado')
  ) then
    raise exception 'ORG_ESTADO: Evento de organizador só abre vendas depois de aprovado.';
  end if;
  return new;
end;
$$;

-- Nome em ordem alfabética antes de events_mark_published: dispara primeiro.
create trigger events_guard_organizer
  before insert or update on public.events
  for each row execute function public.events_guard_organizer();
```

- [ ] **Step 6: Escrever a migration — convites, código do e-mail e cadastro**

Regras de cada função (todas travam a linha do convite com `for update` antes de mudar algo; "convite válido" = `kind='convite'`, `used_at`/`revoked_at` nulos, `expires_at > now()` e `organizer_area_enabled()`):

- `create_organizer_invite`: `staff_is_admin(p_admin)` senão `ORG_ACESSO`; `p_token_hash ~ '^[0-9a-f]{64}$'` senão `ORG_CONVITE`; limite `consume_rate_limit('org-invite:admin-day', <sha256 do admin>, 30, 86400)` senão `ORG_LIMITE`; `convite` → `expires_at = now() + 7 days`, `label` (até 80, `btrim`, vazio vira nulo), `request_id` opcional (pedido do site vira `convidada`, `handled_by/at`); `redefinir_senha` → `p_target_user_id` precisa ser organizador `ativo`, `expires_at = now() + 24 hours`, revoga outros links de senha ativos do mesmo alvo. Histórico `convite_gerado` ou `link_senha_gerado` (`details`: `{"kind": ...}`).
- `start_invite_email_code(p_token_hash, p_email, p_code)`: convite inválido → `invalido`; `p_code !~ '^[0-9]{6}$'` ou e-mail fora de `^[^@\s]{1,64}@[^@\s]{1,189}\.[^@\s]{2,}$` → `invalido`; `email_code_sends >= 3` → `limite`; já existe `auth.users` com `lower(email) = lower(p_email)` → `email_indisponivel`; senão grava sal novo, `email_code_hash = encode(sha256(convert_to(sal || ':' || p_code, 'UTF8')), 'hex')`, `email_code_email = lower(btrim(p_email))`, `email_code_expires_at = now() + 15 minutes`, `email_code_attempts = 0`, `email_code_sends + 1`, `email_verified_at = null` → `ok`.
- `verify_invite_email_code(p_token_hash, p_code)`: convite inválido → `convite_invalido`; sem código ou vencido → `expirado`; `attempts >= 5` → `bloqueado`; hash diferente → soma tentativa (5ª invalida o código) → `invalido`/`bloqueado`; certo → `email_verified_at = now()`, apaga `email_code_salt/hash` → `ok`.
- `invite_verified_email(p_token_hash)`: e-mail confirmado de convite válido; senão `null`.
- `accept_organizer_invite`: código completo abaixo.
- `use_password_reset_invite(p_token_hash)`: `kind='redefinir_senha'`, válido; alvo `ativo`; marca usado; `delete from verified_sessions where user_id = alvo`; `update trusted_devices set revoked_at = now() where user_id = alvo and revoked_at is null`; histórico `senha_redefinida_link`; devolve o alvo. Senão `ORG_CONVITE`.

```sql
create function public.accept_organizer_invite(
  p_token_hash text,
  p_user_id uuid,
  p_full_name text,
  p_public_name text,
  p_phone text,
  p_pix_key_type text,
  p_pix_key text,
  p_pix_holder_name text,
  p_pix_holder_document text,
  p_terms_version text
)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_invite public.organizer_invites%rowtype;
  v_email text;
begin
  select * into v_invite
  from public.organizer_invites i
  where i.token_hash = p_token_hash and i.kind = 'convite'
  for update;

  if not found or v_invite.used_at is not null or v_invite.revoked_at is not null
     or v_invite.expires_at <= now() or not public.organizer_area_enabled() then
    raise exception 'ORG_CONVITE: Convite inválido.';
  end if;
  if v_invite.email_verified_at is null or v_invite.email_code_email is null then
    raise exception 'ORG_EMAIL: E-mail não confirmado.';
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = p_user_id;
  if v_email is null or v_email <> v_invite.email_code_email then
    raise exception 'ORG_EMAIL: E-mail da conta diferente do confirmado.';
  end if;

  if p_terms_version is null or char_length(p_terms_version) not between 8 and 20
     or not public.valid_tax_document(p_pix_holder_document)
     or (p_pix_key_type in ('cpf', 'cnpj') and p_pix_key <> p_pix_holder_document) then
    raise exception 'ORG_DADOS: Dados inválidos.';
  end if;

  insert into public.organizer_profiles (
    user_id, full_name, public_name, phone, pix_key_type, pix_key, pix_holder_name,
    pix_holder_document, terms_version, terms_accepted_at, invite_id
  ) values (
    p_user_id, btrim(p_full_name), btrim(p_public_name), p_phone, p_pix_key_type, btrim(p_pix_key),
    btrim(p_pix_holder_name), p_pix_holder_document, p_terms_version, now(), v_invite.id
  );

  update public.organizer_invites i
  set used_at = now(), used_by = p_user_id,
      email_code_salt = null, email_code_hash = null, email_code_expires_at = null
  where i.id = v_invite.id;

  perform public.log_audit(p_user_id, 'convite_usado', null, null, p_user_id, jsonb_build_object('invite_id', v_invite.id));
  perform public.log_audit(p_user_id, 'conta_criada', null, null, p_user_id, '{}'::jsonb);
end;
$$;
```

Pedido público, contas e aparelhos:

- `submit_signup_request`: área ligada senão `ORG_DESLIGADO`; `consume_rate_limit('org-request:all-day', 'site', 30, 86400)` senão `ORG_LIMITE`; tamanhos do spec 5.1 (o `check` da tabela é a última defesa; violação vira `ORG_DADOS`); devolve o id.
- `list_signup_requests(p_admin, p_status)`: Admin; `p_status` em `nova|convidada|arquivada`; mais novos primeiro, até 200.
- `archive_signup_request`: Admin; `nova`/`convidada` → `arquivada`.
- `list_organizers(p_admin)`: Admin; `email` de `auth.users`; `pix_key_masked` = tipo `email` → `•••@•••` + domínio sem usuário; demais → `•••• ` + 4 últimos caracteres; `pix_holder_document_masked` = CPF `•••.456.789-••` (dígitos 4–9) / CNPJ `••.•••.789/0001-••`; nunca a chave completa nesta fase.
- `set_organizer_status`: Admin; `p_status` em `ativo|suspenso|encerrado`; motivo 5–500 obrigatório para `suspenso`/`encerrado`; ao sair de `ativo`: `delete from verified_sessions where user_id = p_user_id`; histórico `conta_suspensa`/`conta_reativada`/`conta_encerrada`.
- `list_my_devices(p_current_token)`: só `auth.uid()` e só com `session_is_verified()`; `is_current` = hash do token (formato da fase 1) igual ao `token_hash`.
- `forget_my_device(p_device_id)`: só aparelho do `auth.uid()` com sessão verificada; `revoked_at = now()`.
- `admin_forget_devices(p_admin, p_user_id)`: Admin; revoga todos os aparelhos do alvo e apaga as sessões verificadas dele; histórico `aparelhos_esquecidos` (`organizer_id` só se o alvo for organizador).
- `staff_security_overview(p_admin)`: Admin; contas da equipe com nome, papel, desenvolvedor, aparelhos ativos e último uso.

- [ ] **Step 7: Escrever a migration — evento de organizador e aprovação**

`organizer_change_violations` (chamada por `save_event_with_sessions` **depois** de `save_event_ticket_types`, para `type_index` apontar para a lista nova, e **antes** de `save_event_sessions`):

```sql
create function public.organizer_change_violations(
  p_event_id uuid, p_name text, p_venue text, p_sessions jsonb
)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare
  v_event public.events%rowtype;
  v_out text[] := '{}';
  v_item jsonb;
  v_price jsonb;
  v_session public.event_sessions%rowtype;
  v_type_ids uuid[];
  v_type_id uuid;
  v_old public.session_ticket_types%rowtype;
  v_new_int integer;
begin
  select * into v_event from public.events e where e.id = p_event_id;
  if btrim(coalesce(p_name, '')) is distinct from v_event.name then v_out := array_append(v_out, 'nome'); end if;
  if btrim(coalesce(p_venue, '')) is distinct from v_event.venue then v_out := array_append(v_out, 'local'); end if;

  select coalesce(array_agg(tt.id order by tt.sort_order, tt.id), '{}') into v_type_ids
  from public.ticket_types tt
  where tt.event_id = p_event_id and tt.archived_at is null and tt.kind <> 'cortesia';

  for v_item in select e.item from jsonb_array_elements(p_sessions) as e(item) loop
    if jsonb_typeof(v_item -> 'id') <> 'string' then continue; end if;
    select * into v_session from public.event_sessions s
    where s.id = (v_item ->> 'id')::uuid and s.event_id = p_event_id;
    if not found or not public.session_has_live_orders(v_session.id) then continue; end if;

    if (v_item ->> 'starts_at')::timestamptz is distinct from v_session.starts_at
       or nullif(v_item ->> 'ends_at', '')::timestamptz is distinct from v_session.ends_at then
      v_out := array_append(v_out, 'horario');
    end if;
    if (v_item ->> 'capacity')::integer < v_session.capacity then
      v_out := array_append(v_out, 'lotacao');
    end if;
    v_new_int := nullif(v_item ->> 'inteira_quota', '')::integer;
    if (v_session.inteira_quota is null and v_new_int is not null) or v_new_int < v_session.inteira_quota then
      v_out := array_append(v_out, 'lotacao');
    end if;
    v_new_int := nullif(v_item ->> 'meia_quota', '')::integer;
    if (v_session.meia_quota is null and v_new_int is not null) or v_new_int < v_session.meia_quota then
      v_out := array_append(v_out, 'lotacao');
    end if;

    for v_price in select p.item from jsonb_array_elements(coalesce(v_item -> 'prices', '[]'::jsonb)) as p(item) loop
      v_type_id := v_type_ids[(v_price ->> 'type_index')::integer + 1];
      select * into v_old from public.session_ticket_types stt
      where stt.session_id = v_session.id and stt.ticket_type_id = v_type_id;
      if not found or not v_old.on_sale then continue; end if;
      if not coalesce((v_price ->> 'on_sale')::boolean, false)
         or (v_price ->> 'price_cents')::integer is distinct from v_old.price_cents then
        v_out := array_append(v_out, 'preco');
      end if;
      v_new_int := nullif(v_price ->> 'max_units', '')::integer;
      if (v_old.max_units is null and v_new_int is not null) or v_new_int < v_old.max_units then
        v_out := array_append(v_out, 'lotacao');
      end if;
    end loop;
  end loop;

  return array(select distinct x from unnest(v_out) x order by x);
end;
$$;
```

A linha do `local` fica (decisão 2A, fechada em 2026-10-14).

Trocas em funções existentes (mesma assinatura, `create or replace`; copiar o corpo atual da migration `20261011120000_session_editor.sql` e mudar **só** o indicado):

- `save_event_sessions`: a checagem `p_staff_user_id ... staff_profiles` vira `public.actor_event_access(p_staff_user_id, p_event_id) is null → raise 'SESSAO_EQUIPE: Acesso negado.'` (mesmo prefixo que o código atual já traduz).
- `save_event_with_sessions`: mesma troca; depois de travar o evento, quando o acesso é `dono`:
  ```sql
  select * into v_event from public.events e where e.id = p_event_id;
  if v_event.approval_status = 'em_analise' then
    raise exception 'ORG_ESTADO:em_analise';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_sessions) as e(item)
    where (e.item ->> 'capacity')::integer > public.organizer_max_capacity()
  ) then
    raise exception 'ORG_LOTACAO:%', public.organizer_max_capacity();
  end if;
  ```
  e, depois de `save_event_ticket_types` e antes de `save_event_sessions`, se `aprovado`:
  ```sql
  v_violations := public.organizer_change_violations(p_event_id, p_name, p_venue, p_sessions);
  if cardinality(v_violations) > 0 then
    raise exception 'ORG_ESTADO:mudanca:%', array_to_string(v_violations, ',');
  end if;
  ```
  Ao final, se dono e `aprovado` e descrição/capa/sessões mudaram: `log_audit(p_staff_user_id, 'evento_alterado_pos_aprovacao', p_event_id, null, p_staff_user_id, jsonb_build_object('campos', <lista com 'descricao', 'capa', 'sessoes' conforme o que mudou>))`. A função continua `security invoker` (roda como `service_role`, que não lê `organizer_settings`): por isso o limite vem do helper novo `organizer_max_capacity() returns integer` (`security definer`, `stable`, `select max_session_capacity from public.organizer_settings where id = 1`).
- `set_session_sales_open`: troca para `actor_event_access`; dono só com `approval_status = 'aprovado'` (`ORG_ESTADO:nao_aprovado`) e sem pedido de exclusão pendente (`ORG_ESTADO:exclusao_pendente`); histórico `vendas_abertas`/`vendas_pausadas` quando dono.
- `event_is_past`: acrescentar `and e.deleted_at is null`. `public_past_events` herda.

Novas:

- `create_organizer_event`: `organizer_is_active(p_actor)` senão `ORG_ACESSO`; liga `byla.organizer_flow`; insere em `events` com `organizer_id = p_actor`, `approval_status = 'rascunho'`, `sales_open = false`, `slug = p_slug`, `starts_at`/`capacity` da primeira sessão do JSON (`min(starts_at)`), resto dos campos; chama `save_event_with_sessions(id, ..., p_actor)`; desliga a flag; histórico `evento_criado`; devolve o id.
- `submit_event_for_approval`: dono (`actor_event_access = 'dono'`, senão `ORG_DONO`); estado `rascunho`/`recusado` senão `ORG_ESTADO:estado`; `cover_image_url` não nulo senão `ORG_ESTADO:capa`; pelo menos uma sessão `ativa` com `starts_at > now()` senão `ORG_ESTADO:sem_sessao_futura`; toda sessão ativa com `capacity <= max_session_capacity` senão `ORG_LOTACAO:<max>`; toda sessão ativa com algum tipo `on_sale` com preço senão `ORG_ESTADO:sem_preco`; flag ligada; `approval_status = 'em_analise'`, `submitted_at = now()`, `approval_note = null`; histórico `evento_enviado`.
- `withdraw_event_submission`: dono; `em_analise` → `rascunho`, `submitted_at = null`; histórico `evento_envio_desfeito`.
- `decide_event_approval`: `staff_is_admin(p_admin)` senão `ORG_ACESSO`; trava o evento; `organizer_id` não nulo e `em_analise` senão `ORG_ESTADO:estado`; `p_decision = 'aprovar'` exige organizador `ativo` (senão `ORG_ESTADO:organizador_inativo`) → `aprovado`, `sales_open = coalesce(p_publish, false)`, decisão registrada, `approval_note = null`; `'recusar'` exige nota 5–500 (senão `ORG_DADOS`) → `recusado`, `sales_open = false`; histórico `evento_aprovado` (`details`: `{"publicado": bool}`) ou `evento_recusado`.
- `public_event_producer(p_event_id)`: `select op.public_name from events e join organizer_profiles op on op.user_id = e.organizer_id where e.id = p_event_id and e.deleted_at is null and (e.sales_open or public.event_is_past(e.id))`.
- `event_producer_names(p_event_ids uuid[])`: até 200 ids; `event_id, public_name`.
- `purge_organizer_records()`: apaga convites com `expires_at`/`used_at`/`revoked_at` há mais de 30 dias e pedidos do site `convidada`/`arquivada` com `handled_at` há mais de 180 dias; devolve o total.

Políticas (`alter policy`, mantendo o resto igual ao que está no ar):

```sql
alter policy events_public_read on public.events
  using (
    (deleted_at is null and (sales_open = true or public.event_is_past(id)))
    or public.is_staff()
    or public.owns_event(id)
  );

alter policy event_images_public_read on public.event_images
  using (
    exists (
      select 1 from public.events e
      where e.id = event_id and e.deleted_at is null and (e.sales_open = true or public.event_is_past(e.id))
    )
    or public.is_staff()
    or public.owns_event(event_id)
  );

alter policy event_sessions_public_read on public.event_sessions
  using (
    (
      archived_at is null
      and exists (
        select 1 from public.events e
        where e.id = event_id and e.deleted_at is null and (e.sales_open = true or public.event_is_past(e.id))
      )
    )
    or public.is_staff()
    or public.owns_event(event_id)
  );

alter policy ticket_types_public_read on public.ticket_types
  using (
    (
      kind <> 'cortesia' and archived_at is null and active
      and exists (select 1 from public.events e where e.id = event_id and e.sales_open = true and e.deleted_at is null)
    )
    or public.is_staff()
    or public.owns_event(event_id)
  );

alter policy session_ticket_types_public_read on public.session_ticket_types
  using (
    (
      on_sale and exists (
        select 1
        from public.event_sessions s
        join public.events e on e.id = s.event_id
        join public.ticket_types tt on tt.id = session_ticket_types.ticket_type_id
        where s.id = session_ticket_types.session_id and s.archived_at is null
          and e.sales_open = true and e.deleted_at is null
          and tt.archived_at is null and tt.kind <> 'cortesia'
      )
    )
    or public.is_staff()
    or exists (
      select 1 from public.event_sessions s
      where s.id = session_ticket_types.session_id and public.owns_event(s.event_id)
    )
  );
```

`orders`, `order_items`, `tickets`, `order_refunds` e tabelas de sessão: **sem mudança** (o organizador não ganha leitura direta).

Permissões ao fim do arquivo: `revoke all on function ... from public, anon, authenticated` para **todas** as funções novas e trocadas; `grant execute ... to anon, authenticated` só em `organizer_area_enabled`, `is_organizer`, `owns_event`, `public_event_producer`; `to authenticated` em `my_account_kind`, `list_my_devices`, `forget_my_device`; o resto `to service_role` — inclusive os auxiliares chamados de dentro de funções `security invoker` que rodam como `service_role` (`organizer_change_violations`, `organizer_max_capacity`, `log_audit`). Sem `grant` (só chamados de dentro de funções `security definer` ou por gatilho): `organizer_is_active`, `staff_is_admin`, `forbid_staff_and_organizer`, `events_guard_organizer`.

`create_organizer_event` segue a mesma sequência do `createEvent` da equipe (inserir o evento, depois `save_event_with_sessions`), para os gatilhos de sessão de `session_editor` se comportarem igual.

- [ ] **Step 8: Rodar o teste estático e ver passar**

Run: `npx vitest run tests/db/organizer-migrations.test.ts`
Expected: PASS (8 testes).

- [ ] **Step 9: Commit**

```powershell
git add supabase/migrations/20261018100000_organizer_accounts.sql tests/db/organizer-migrations.test.ts
git commit -m "feat(db): contas de organizador, convites, cadastro e aprovacao (migration nao aplicada)"
```

### Task 2: Migration B — pedidos à equipe, compradores, exclusão e portaria

**Files:**
- Create: `supabase/migrations/20261018110000_organizer_operations.sql`
- Modify: `tests/db/organizer-migrations.test.ts`

**Interfaces (banco):**

| Função | Quem | Devolve / erros |
| --- | --- | --- |
| `organizer_event_orders(p_actor uuid, p_event_id uuid, p_session_id uuid default null)` | `service_role` | `order_id, created_at, session_id, session_name, session_starts_at, buyer_name, buyer_email, status text, is_courtesy boolean, items jsonb [{name, quantity}], tickets_subtotal_cents, tickets_total, tickets_checked_in, refund_request_status, refund_request_reason`; só pedidos `pago`, `aguardando_decisao`, `estornado`; `ORG_DONO` |
| `request_order_refund(p_actor uuid, p_order_id uuid, p_reason text)` | `service_role` | `uuid`; evento lido **do pedido**; `ORG_DONO`, `ORG_ESTADO:<motivo>` |
| `request_event_change(p_actor uuid, p_event_id uuid, p_what text, p_reason text)` | `service_role` | `uuid`; só `aprovado`; `details = {"o_que": p_what}` (5–500) |
| `request_event_deletion(p_actor uuid, p_event_id uuid, p_reason text)` | `service_role` | `uuid`; pausa vendas do evento (flag) |
| `cancel_ops_request(p_actor uuid, p_request_id uuid)` | `service_role` | `boolean`; dono cancela o próprio pendente |
| `decline_ops_request(p_staff uuid, p_request_id uuid, p_note text)` | `service_role` | `void`; estorno: qualquer equipe; mudança/exclusão: Admin |
| `finish_event_change(p_admin uuid, p_request_id uuid)` | `service_role` | `void` |
| `finish_event_deletion(p_admin uuid, p_request_id uuid)` | `service_role` | `void`; só com todas as sessões canceladas ou arquivadas; `ORG_ESTADO:sessoes_ativas` |
| `delete_own_event(p_actor uuid, p_event_id uuid, p_confirm_name text)` | `service_role` | `'apagado'` \| `'excluido'`; `ORG_ESTADO:com_vendas`, `ORG_DADOS` |
| `set_event_sales_open(p_actor uuid, p_event_id uuid, p_open boolean)` | `service_role` | `boolean`; dono, `aprovado`, sem exclusão pendente |
| `list_ops_requests(p_staff uuid, p_status text, p_event_id uuid default null)` | `service_role` | `id, kind, event_id, event_name, organizer_public_name, order_id, details, reason, status, decision_note, created_at, decided_at`; secretaria recebe só `estorno` |
| `organizer_event_requests(p_actor uuid, p_event_id uuid)` | `service_role` | pedidos do evento (dono) |
| `organizer_event_history(p_actor uuid, p_event_id uuid)` | `service_role` | `action, created_at, actor_kind` das ações de aprovação/pedidos do evento (dono ou equipe) |
| `team_pending_counts(p_staff uuid)` | `service_role` | `approvals, changes, deletions, refunds, signup_requests` (Admin vê tudo; secretaria só `refunds`) |
| `check_in_ticket(uuid, uuid, text, uuid)` (troca) | `service_role` | igual, com dono e sem nome de outro evento para organizador |

- [ ] **Step 1: Acrescentar ao teste estático (falha)**

```ts
const operations = migration("20261018110000_organizer_operations.sql");

describe("migration organizer_operations", () => {
  it("não cria tabela nem política nova", () => {
    expect(operations).not.toMatch(/create table/i);
    expect(operations).not.toMatch(/create policy/i);
  });

  it("toda função fixa search_path vazio e só service_role executa", () => {
    for (const fn of functionBodies(operations)) {
      expect(fn.text, fn.name).toContain("set search_path = ''");
      expect(operations, fn.name).not.toMatch(
        new RegExp(`grant execute on function public\\.${fn.name}\\([^)]*\\) to [^;]*(anon|authenticated)`),
      );
    }
  });

  it("portaria usa actor_event_access e remove a assinatura antiga", () => {
    expect(operations).toMatch(/drop function if exists public\.check_in_ticket\(uuid, text, uuid\);/);
    const checkIn = functionBodies(operations).find((fn) => fn.name === "check_in_ticket");
    expect(checkIn?.text).toContain("public.actor_event_access(p_staff_user_id, p_event_id)");
  });

  it("lista de compradores nunca devolve telefone, link do pedido, código do ingresso ou IDs do pagamento", () => {
    const list = functionBodies(operations).find((fn) => fn.name === "organizer_event_orders");
    for (const column of ["buyer_phone", "public_token", "provider_order_id", "provider_payment_id", "payment_external_id", ".code"]) {
      expect(list?.text, column).not.toContain(column);
    }
  });

  it("pedido de estorno lê o evento do próprio pedido", () => {
    const fn = functionBodies(operations).find((f) => f.name === "request_order_refund");
    expect(fn?.text).toMatch(/select \* into v_order from public\.orders o where o\.id = p_order_id/);
  });

  it("gatilho fecha o pedido de estorno quando o pedido vira estornado", () => {
    expect(operations).toMatch(/create trigger orders_close_refund_request\s+after update of status on public\.orders/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/db/organizer-migrations.test.ts`
Expected: FAIL com `ENOENT ... 20261018110000_organizer_operations.sql`.

- [ ] **Step 3: Escrever a migration**

Regras (todas as que agem como dono começam com `if public.actor_event_access(p_actor, v_event_id) is distinct from 'dono' then raise exception 'ORG_DONO: Evento não encontrado.'; end if;`; as que escrevem em `events` ligam e desligam `byla.organizer_flow`; todas gravam histórico com `log_audit`):

- `organizer_event_orders`: acesso `equipe` ou `dono`; colunas da tabela acima e nada além; `is_courtesy = exists (ticket kind 'cortesia')`; `items` agregado de `order_items (name, quantity)`; contagens de `tickets` (total e `status = 'check_in'`); pedido de estorno mais recente do pedido; ordem `created_at desc`; filtro opcional por sessão do evento (sessão de outro evento → lista vazia).
- `request_order_refund`:
  ```sql
  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'ORG_DONO: Pedido não encontrado.'; end if;
  if public.actor_event_access(p_actor, v_order.event_id) is distinct from 'dono' then
    raise exception 'ORG_DONO: Pedido não encontrado.';
  end if;
  ```
  depois: `status = 'pago'` senão `ORG_ESTADO:nao_pago`; não cortesia senão `ORG_ESTADO:cortesia`; nenhum ingresso `check_in` senão `ORG_ESTADO:check_in`; motivo 5–500 senão `ORG_DADOS`; limite `consume_rate_limit('org-ops:user', <sha256 do ator>, 30, 3600)` senão `ORG_LIMITE`; insere (`unique_violation` → `ORG_ESTADO:ja_pedido`); histórico `pedido_estorno_criado`.
- `orders_close_refund_request` (gatilho `after update of status on public.orders`, função `security definer`, porque quem atualiza `orders` é a `service_role` sem acesso à tabela nova): quando `new.status = 'estornado' and old.status <> 'estornado'`, pedidos de estorno `pendente` daquele pedido viram `atendido` com `decided_at = now()`; histórico `pedido_atendido` (ator `null` = sistema).
- `request_event_change`: dono, `aprovado`, `p_what` 5–500 e motivo 5–500, limite `org-ops:user`; histórico `pedido_mudanca_criado`.
- `request_event_deletion`: dono; se o evento **não** tem pedido pago/estornado/aguardando decisão nem reserva ativa → `ORG_ESTADO:sem_vendas` (a tela usa "Excluir evento"); cria `exclusao` pendente (`unique_violation` → `ORG_ESTADO:ja_pedido`); `sales_open = false`; histórico `pedido_exclusao_criado` e `vendas_pausadas`.
- `cancel_ops_request`: dono do evento do pedido, só `pendente` → `cancelado`; histórico `pedido_cancelado`.
- `decline_ops_request`: equipe; `mudanca`/`exclusao` exigem `staff_is_admin`; `pendente` → `recusado` com nota 5–500; histórico `pedido_recusado`.
- `finish_event_change`: Admin; `mudanca` pendente → `atendido`; histórico `pedido_atendido`.
- `finish_event_deletion`: Admin; `exclusao` pendente; nenhuma sessão `ativa` não arquivada (senão `ORG_ESTADO:sessoes_ativas`); `deleted_at = now()`, `deleted_by = p_admin`, `sales_open = false`; pedido `atendido`; histórico `evento_excluido` e `pedido_atendido`.
- `delete_own_event`: dono; `lower(btrim(p_confirm_name)) = lower(btrim(name))` senão `ORG_DADOS`; algum pedido `pago`/`estornado`/`aguardando_decisao` ou `pendente` com `expires_at > now()` → `ORG_ESTADO:com_vendas`; sem nenhum pedido → `delete from public.events where id = ...` → `'apagado'` (se cair em `foreign_key_violation`, segue para o lógico); senão → `deleted_at`, `deleted_by`, `sales_open = false` → `'excluido'`; histórico `evento_excluido` (`details`: `{"modo": ...}`).
- `set_event_sales_open`: dono, `aprovado`, sem `exclusao` pendente (`ORG_ESTADO:exclusao_pendente`); atualiza `events.sales_open`; histórico `vendas_abertas`/`vendas_pausadas`.
- `check_in_ticket` (v3, mesma assinatura de 4 parâmetros; copiar o corpo de `20261011110000_check_in_sessions.sql` e mudar **só**):
  ```sql
  v_access := public.actor_event_access(p_staff_user_id, p_event_id);
  if v_access is null then
    raise exception 'CHECKIN_EQUIPE: Acesso restrito à equipe.';
  end if;
  ```
  e no ramo `evento_errado`: `other_event_name` só quando `v_access = 'equipe'` (para o dono volta `null`: "Ingresso de outro evento"). Continua `security invoker` (`actor_event_access` já é `security definer`). Depois: `drop function if exists public.check_in_ticket(uuid, text, uuid);` (ainda existe em produção, conferido em 2026-10-14) e `revoke`/`grant ... to service_role` da v3.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/db/organizer-migrations.test.ts`
Expected: PASS (14 testes).

- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/20261018110000_organizer_operations.sql tests/db/organizer-migrations.test.ts
git commit -m "feat(db): pedidos do organizador, compradores, exclusao e portaria so dos proprios eventos (nao aplicada)"
```

### Task 3: Ensaio do banco (local e em produção, sem aplicar)

**Files:**
- Create: `scripts/db-tests/organizer-accounts.mjs`
- Create: `supabase/tests/organizer_accounts_check.sql`

- [ ] **Step 1: Escrever a matriz local**

`scripts/db-tests/organizer-accounts.mjs`: mesmo preparo de `scripts/db-tests/service-fee.mjs` (Postgres temporário de `BYLA_PG_TOOLS`, papéis `anon`/`authenticated`/`service_role`, schemas `auth`/`storage`/`extensions`/`vault`, todas as migrations em ordem), com três acréscimos ao esqueleto do `auth`: coluna `email text` em `auth.users`; tabela `auth.sessions (id uuid primary key, user_id uuid)`; `auth.jwt()` = `coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb` e `auth.uid()` = `(auth.jwt() ->> 'sub')::uuid`. Contas fictícias: Admin, Admin desenvolvedor, secretaria, organizador A, organizador B, organizador suspenso, anônimo; uma sessão verificada para cada (linha em `verified_sessions`) e uma sessão **não** verificada do organizador A. Liga `organizer_settings.enabled` no começo.

Casos (cada um um `check(...)` ou `rejects(...)` com a mensagem esperada):

1. Gatilho: secretaria (`authenticated`, sessão verificada) faz `update events set approval_status = 'aprovado'` num rascunho → `ORG_ESTADO`; `insert` com `organizer_id` → `ORG_ESTADO`; `update ... set sales_open = true` em rascunho (pela `service_role`) → `ORG_ESTADO`; `update ... set organizer_id` → `ORG_DONO`.
2. Equipe e organizador: inserir em `organizer_profiles` uma conta da equipe → `ORG_ACESSO`; inserir em `staff_profiles` um organizador → `ORG_ACESSO`.
3. RLS: organizador A verificado lê o próprio rascunho, sessões, tipos e fotos; **não** lê o rascunho de B; com a sessão não verificada não lê nem o próprio; anônimo não lê rascunho; ninguém do organizador lê `orders`, `tickets`, `order_items`, `order_refunds`; `organizer_profiles`: A lê só a própria linha; com a área desligada A não lê nada.
4. Convite: hash fora do formato → `ORG_CONVITE`; secretaria gerando convite → `ORG_ACESSO`; convite vencido, revogado e usado → `check_organizer_invite = 'invalido'`; código errado 5 vezes → `bloqueado`; 4º envio → `limite`; e-mail já existente → `email_indisponivel`; `accept_organizer_invite` sem e-mail confirmado → `ORG_EMAIL`; com e-mail da conta diferente → `ORG_EMAIL`; CPF inválido (`52998224724`) → `ORG_DADOS`; chave tipo `cpf` diferente do documento → `ORG_DADOS`; aceite certo com CPF `52998224725` e com CNPJ `11222333000181` → perfil criado, convite usado, campos do código apagados; segundo aceite com o mesmo token → `ORG_CONVITE`.
5. Senha por link: alvo que não é organizador → `ORG_ACESSO`; uso → apaga `verified_sessions` e revoga `trusted_devices` do alvo; segundo uso → `ORG_CONVITE`.
6. Evento: A cria rascunho com sessão de 101 lugares → `ORG_LOTACAO:100`; A envia sem capa → `ORG_ESTADO:capa`; envia certo → `em_analise`; A salva em análise → `ORG_ESTADO:em_analise`; secretaria decide → `ORG_ACESSO`; Admin recusa sem nota → `ORG_DADOS`; Admin aprova e publica → `aprovado`, `sales_open`, `published_at` preenchido; com um pedido pago fictício na sessão, A muda nome → `ORG_ESTADO:mudanca:nome`; muda local → `...:local`; horário → `...:horario`; preço → `...:preco`; reduz lugares → `...:lotacao`; muda descrição e cria sessão nova → aceito e histórico `evento_alterado_pos_aprovacao`; B tenta salvar o evento de A → `SESSAO_EQUIPE`.
7. Operações: B pede estorno de pedido de A → `ORG_DONO`; A pede estorno de cortesia → `ORG_ESTADO:cortesia`; com check-in → `ORG_ESTADO:check_in`; duas vezes → `ORG_ESTADO:ja_pedido`; pedido vira `estornado` → pedido de estorno `atendido`; `organizer_event_orders` de A não tem colunas de telefone/token/código; secretaria recusa mudança → `ORG_ACESSO`; A exclui evento com venda → `ORG_ESTADO:com_vendas`; A pede exclusão → vendas fechadas; Admin conclui com sessão ativa → `ORG_ESTADO:sessoes_ativas`; A exclui rascunho sem pedidos → `'apagado'`.
8. Portaria: A faz check-in de ingresso do próprio evento → `ok` e `checked_in_by = A`; de evento do Espaço → `CHECKIN_EQUIPE`; ingresso de outro evento lido na sessão do evento de A → `evento_errado` com `other_event_name` nulo; equipe na mesma situação → nome do outro evento; assinatura de 3 parâmetros não existe.
9. Área desligada: login de A → `login_code_eligible` falso; `create_organizer_event` → `ORG_ACESSO`; `submit_signup_request` → `ORG_DESLIGADO`; `create_organizer_invite` pelo Admin continua funcionando.
10. Imutabilidade: `update`/`delete` em `audit_log`, mesmo como `service_role` → `TAXA_IMUTAVEL`.

- [ ] **Step 2: Rodar a matriz local**

Run: `$env:BYLA_PG_TOOLS = "<pasta das ferramentas>"; node scripts/db-tests/organizer-accounts.mjs`
Expected: todas as linhas `ok`, saída `0 falhas`, código de saída 0. Corrigir as migrations até passar.

- [ ] **Step 3: Escrever o ensaio de produção**

`supabase/tests/organizer_accounts_check.sql` no formato de `supabase/tests/staff_email_code_check.sql`: comentário de uso (MCP `user-supabase-eventos`, uma única chamada, colar as duas migrations no lugar marcado); bloco `do $test$` que usa as 2 contas reais da equipe **só como atores** (sem imprimir e-mail), cria um usuário fictício em `auth.users` para o organizador (`organizador-ensaio@exemplo.com`), roda os casos 1, 3, 4, 6 e 8 em versão curta e termina com `raise exception 'ENSAIO %', r;` (o texto `r` traz só `nome_do_caso=ok|falhou`).

- [ ] **Step 4: Rodar o ensaio em produção (não aplica nada)**

Declarar no chat: "MCP `user-supabase-eventos`, projeto Espaço Byla Eventos". Conferir o fingerprint (só leitura). Rodar o arquivo com as migrations coladas numa única chamada `execute_sql`.
Expected: erro `ENSAIO ...` com todos os casos `ok`. Depois, consulta só de leitura: `select to_regclass('public.organizer_profiles'), to_regprocedure('public.check_in_ticket(uuid,text,uuid)') is not null` → `null`, `true` (nada ficou; a assinatura antiga continua lá).

- [ ] **Step 5: Commit**

```powershell
git add scripts/db-tests/organizer-accounts.mjs supabase/tests/organizer_accounts_check.sql
git commit -m "test(db): matriz de permissoes e ensaio das contas de organizador"
```

### Task 4: Regras puras do organizador

**Files:**
- Create: `src/lib/organizer/documents.ts`, `src/lib/organizer/invite-token.ts`, `src/lib/organizer/validation.ts`, `src/lib/organizer/post-approval.ts`, `src/lib/organizer/errors.ts`
- Test: `tests/organizer/documents.test.ts`, `tests/organizer/invite-token.test.ts`, `tests/organizer/validation.test.ts`, `tests/organizer/post-approval.test.ts`, `tests/organizer/errors.test.ts`

**Interfaces:**
- Produces:
  - `isValidCpf(digits: string): boolean`, `isValidCnpj(digits: string): boolean`, `onlyDigits(value: string): string`, `maskTaxDocument(digits: string): string`
  - `newInviteToken(): string` (43 caracteres base64url), `isInviteTokenFormat(value: unknown): value is string`, `hashInviteToken(token: string): string` (64 hex), `inviteTokenFromHash(hash: string): string | null` (lê o `#` da URL), `INVITE_PATH = "/convite"`, `PASSWORD_RESET_PATH = "/redefinir-senha"`, `inviteLink(appUrl: string, token: string, kind: "convite" | "redefinir_senha"): string`, `whatsappInviteUrl(link: string): string`
  - `type FieldResult<T> = { ok: true; value: T } | { ok: false; error: string }`; `parseSignupRequest(input: unknown): FieldResult<SignupRequestInput>`; `parseOrganizerProfile(input: unknown): FieldResult<OrganizerProfileInput>`; `parsePassword(value: unknown): FieldResult<string>`; `parseReason(value: unknown): FieldResult<string>`; `parseEmail(value: unknown): FieldResult<string>`
  - `type LockedField = "nome" | "local" | "horario" | "preco" | "lotacao"`; `lockedFieldsFor(approvalStatus: string, sessionHasSales: boolean): LockedField[]`
  - `organizerErrorMessage(dbMessage: string): string | null`

- [ ] **Step 1: Escrever os testes (falham)**

```ts
// tests/organizer/documents.test.ts
import { describe, expect, it } from "vitest";
import { isValidCnpj, isValidCpf, maskTaxDocument, onlyDigits } from "@/lib/organizer/documents";

describe("CPF e CNPJ", () => {
  it("aceita dígitos verificadores certos", () => {
    expect(isValidCpf("52998224725")).toBe(true);
    expect(isValidCnpj("11222333000181")).toBe(true);
  });
  it("recusa dígito errado, repetidos e tamanho errado", () => {
    expect(isValidCpf("52998224724")).toBe(false);
    expect(isValidCpf("11111111111")).toBe(false);
    expect(isValidCnpj("11222333000180")).toBe(false);
    expect(isValidCnpj("00000000000000")).toBe(false);
    expect(isValidCpf("5299822472")).toBe(false);
  });
  it("tira pontuação e mascara", () => {
    expect(onlyDigits("529.982.247-25")).toBe("52998224725");
    expect(maskTaxDocument("52998224725")).toBe("•••.982.247-••");
    expect(maskTaxDocument("11222333000181")).toBe("••.•••.333/0001-••");
  });
});
```

```ts
// tests/organizer/invite-token.test.ts
import { describe, expect, it } from "vitest";
import {
  hashInviteToken, inviteLink, inviteTokenFromHash, isInviteTokenFormat, newInviteToken, whatsappInviteUrl,
} from "@/lib/organizer/invite-token";

describe("token do convite", () => {
  it("gera 32 bytes em base64url e hash hex de 64", () => {
    const token = newInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashInviteToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(newInviteToken()).not.toBe(token);
  });
  it("só aceita o formato certo", () => {
    expect(isInviteTokenFormat("a".repeat(43))).toBe(true);
    expect(isInviteTokenFormat("a".repeat(42))).toBe(false);
    expect(isInviteTokenFormat("a b".padEnd(43, "x"))).toBe(false);
    expect(isInviteTokenFormat(123)).toBe(false);
  });
  it("lê o token do # e monta o link sem o token na parte enviada ao servidor", () => {
    expect(inviteTokenFromHash(`#${"b".repeat(43)}`)).toBe("b".repeat(43));
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
});
```

```ts
// tests/organizer/validation.test.ts
import { describe, expect, it } from "vitest";
import { parseOrganizerProfile, parsePassword, parseReason, parseSignupRequest } from "@/lib/organizer/validation";

const profile = {
  fullName: "Fulana de Tal",
  publicName: "Coletivo Exemplo",
  phone: "(71) 90000-0003",
  pixKeyType: "cpf",
  pixKey: "529.982.247-25",
  pixHolderName: "Fulana de Tal",
  pixHolderDocument: "529.982.247-25",
};

describe("validação", () => {
  it("pedido público: tamanhos do spec", () => {
    expect(parseSignupRequest({ name: "Fu", contact: "71900000003", idea: "Peça de teatro infantil", approxDate: "", privacyAccepted: true }).ok).toBe(true);
    expect(parseSignupRequest({ name: "F", contact: "71900000003", idea: "Peça de teatro", privacyAccepted: true }).ok).toBe(false);
    expect(parseSignupRequest({ name: "Fulana", contact: "71900000003", idea: "curta", privacyAccepted: true }).ok).toBe(false);
    expect(parseSignupRequest({ name: "Fulana", contact: "71900000003", idea: "Peça de teatro", privacyAccepted: false }).ok).toBe(false);
  });
  it("perfil: normaliza telefone e documento, exige chave CPF igual ao titular", () => {
    const ok = parseOrganizerProfile(profile);
    expect(ok).toEqual({ ok: true, value: expect.objectContaining({ phone: "71900000003", pixKey: "52998224725", pixHolderDocument: "52998224725" }) });
    expect(parseOrganizerProfile({ ...profile, pixKey: "111.444.777-35" }).ok).toBe(false);
    expect(parseOrganizerProfile({ ...profile, pixHolderDocument: "529.982.247-24" }).ok).toBe(false);
    expect(parseOrganizerProfile({ ...profile, pixKeyType: "email", pixKey: "fulana@exemplo.com" }).ok).toBe(true);
    expect(parseOrganizerProfile({ ...profile, pixKeyType: "aleatoria", pixKey: "nao-e-uuid" }).ok).toBe(false);
    expect(parseOrganizerProfile({ ...profile, publicName: "x".repeat(81) }).ok).toBe(false);
  });
  it("senha: mínimo 12, máximo 72", () => {
    expect(parsePassword("curta").ok).toBe(false);
    expect(parsePassword("uma frase longa ok").ok).toBe(true);
    expect(parsePassword("x".repeat(73)).ok).toBe(false);
  });
  it("motivo: 5 a 500", () => {
    expect(parseReason("ok").ok).toBe(false);
    expect(parseReason("  motivo certo  ")).toEqual({ ok: true, value: "motivo certo" });
  });
});
```

```ts
// tests/organizer/post-approval.test.ts
import { describe, expect, it } from "vitest";
import { lockedFieldsFor } from "@/lib/organizer/post-approval";

describe("campos travados depois da aprovação", () => {
  it("rascunho e recusado: nada travado", () => {
    expect(lockedFieldsFor("rascunho", true)).toEqual([]);
    expect(lockedFieldsFor("recusado", true)).toEqual([]);
  });
  it("aprovado: nome e local sempre; horário, preço e lugares só em sessão com venda", () => {
    expect(lockedFieldsFor("aprovado", false)).toEqual(["nome", "local"]);
    expect(lockedFieldsFor("aprovado", true)).toEqual(["nome", "local", "horario", "preco", "lotacao"]);
  });
});
```

```ts
// tests/organizer/errors.test.ts
import { describe, expect, it } from "vitest";
import { organizerErrorMessage } from "@/lib/organizer/errors";

describe("mensagens dos erros do banco", () => {
  it("traduz cada prefixo", () => {
    expect(organizerErrorMessage("ORG_LOTACAO:100")).toBe("Cada sessão pode ter no máximo 100 lugares.");
    expect(organizerErrorMessage("ORG_ESTADO:mudanca:nome,horario")).toBe(
      "Depois da aprovação, mudar nome do evento e horário precisa ser pedido ao Espaço Byla (botão “Pedir mudança”).",
    );
    expect(organizerErrorMessage("ORG_ESTADO:capa")).toBe("Adicione uma capa antes de enviar para aprovação.");
    expect(organizerErrorMessage("ORG_CONVITE: x")).toBe("Este convite não vale mais. Peça um novo ao Espaço Byla.");
    expect(organizerErrorMessage("ORG_DONO: x")).toBe("Evento não encontrado.");
    expect(organizerErrorMessage("outra coisa")).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/organizer`
Expected: FAIL (módulos não existem).

- [ ] **Step 3: Implementar**

```ts
// src/lib/organizer/documents.ts
export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function allSame(digits: string): boolean {
  return /^(\d)\1*$/.test(digits);
}

export function isValidCpf(digits: string): boolean {
  if (!/^\d{11}$/.test(digits) || allSame(digits)) return false;
  const d = [...digits].map(Number);
  const check = (length: number) => {
    const sum = d.slice(0, length).reduce((total, digit, index) => total + digit * (length + 1 - index), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return check(9) === d[9] && check(10) === d[10];
}

const CNPJ_W1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_W2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

export function isValidCnpj(digits: string): boolean {
  if (!/^\d{14}$/.test(digits) || allSame(digits)) return false;
  const d = [...digits].map(Number);
  const check = (weights: number[]) => {
    const rest = weights.reduce((total, weight, index) => total + d[index] * weight, 0) % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return check(CNPJ_W1) === d[12] && check(CNPJ_W2) === d[13];
}

export function isValidTaxDocument(digits: string): boolean {
  return digits.length === 11 ? isValidCpf(digits) : isValidCnpj(digits);
}

/** Nas telas: nunca o documento inteiro. */
export function maskTaxDocument(digits: string): string {
  if (digits.length === 11) return `•••.${digits.slice(3, 6)}.${digits.slice(6, 9)}-••`;
  if (digits.length === 14) return `••.•••.${digits.slice(5, 8)}/${digits.slice(8, 12)}-••`;
  return "•••";
}
```

```ts
// src/lib/organizer/invite-token.ts
import { createHash, randomBytes } from "node:crypto";

export const INVITE_PATH = "/convite";
export const PASSWORD_RESET_PATH = "/redefinir-senha";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** 32 bytes aleatórios. O banco guarda só o hash; o link aparece uma vez para o Admin. */
export function newInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isInviteTokenFormat(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function inviteTokenFromHash(hash: string): string | null {
  const token = hash.startsWith("#") ? hash.slice(1) : hash;
  return isInviteTokenFormat(token) ? token : null;
}

export function inviteLink(appUrl: string, token: string, kind: "convite" | "redefinir_senha"): string {
  const base = appUrl.replace(/\/$/, "");
  return `${base}${kind === "convite" ? INVITE_PATH : PASSWORD_RESET_PATH}#${token}`;
}

export function whatsappInviteUrl(link: string): string {
  const text =
    "Olá! Este é o seu convite para criar eventos no site do Espaço Byla. " +
    `O link vale por 7 dias e só pode ser usado uma vez: ${link}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
```

`inviteTokenFromHash` é usado no navegador, então `invite-token.ts` não pode importar `node:crypto` no topo se for importado por componente cliente: separar `inviteTokenFromHash` e `isInviteTokenFormat` em `src/lib/organizer/invite-token-format.ts` (sem `node:crypto`) e reexportar em `invite-token.ts`. O teste continua importando de `invite-token.ts`.

```ts
// src/lib/organizer/post-approval.ts
export type LockedField = "nome" | "local" | "horario" | "preco" | "lotacao";

/** Espelho da regra de organizer_change_violations, só para travar a tela. Quem decide é o banco. */
export function lockedFieldsFor(approvalStatus: string, sessionHasSales: boolean): LockedField[] {
  if (approvalStatus !== "aprovado") return [];
  return sessionHasSales ? ["nome", "local", "horario", "preco", "lotacao"] : ["nome", "local"];
}

export const LOCKED_FIELD_LABELS: Record<LockedField, string> = {
  nome: "nome do evento",
  local: "local",
  horario: "horário",
  preco: "preço",
  lotacao: "lugares",
};
```

```ts
// src/lib/organizer/errors.ts
import { LOCKED_FIELD_LABELS, type LockedField } from "@/lib/organizer/post-approval";

const STATE_MESSAGES: Record<string, string> = {
  em_analise: "O evento está em análise. Toque em “Voltar para rascunho” para editar.",
  capa: "Adicione uma capa antes de enviar para aprovação.",
  sem_sessao_futura: "Cadastre pelo menos uma sessão com data futura.",
  sem_preco: "Cada sessão precisa de pelo menos um tipo de ingresso à venda.",
  nao_aprovado: "As vendas abrem depois que o Espaço Byla aprovar o evento.",
  exclusao_pendente: "Há um pedido de exclusão em análise. As vendas ficam pausadas até a resposta.",
  com_vendas: "Este evento já teve vendas. Use “Pedir exclusão”.",
  sem_vendas: "Este evento não tem vendas. Use “Excluir evento”.",
  ja_pedido: "Já existe um pedido igual em análise.",
  nao_pago: "Só pedidos pagos podem ter estorno pedido.",
  cortesia: "Cortesia não tem estorno. Fale com a equipe do Espaço Byla.",
  check_in: "Este pedido já tem ingresso usado na entrada.",
  sessoes_ativas: "Cancele todas as sessões ativas antes de concluir a exclusão.",
  organizador_inativo: "A conta deste organizador não está ativa.",
  estado: "Esta ação não está disponível agora. Recarregue a página.",
};

function joinLabels(fields: string[]): string {
  const labels = fields.map((field) => LOCKED_FIELD_LABELS[field as LockedField] ?? field);
  return labels.length <= 1 ? (labels[0] ?? "") : `${labels.slice(0, -1).join(", ")} e ${labels.at(-1)}`;
}

export function organizerErrorMessage(dbMessage: string): string | null {
  const lotacao = dbMessage.match(/ORG_LOTACAO:(\d+)/);
  if (lotacao) return `Cada sessão pode ter no máximo ${lotacao[1]} lugares.`;
  const mudanca = dbMessage.match(/ORG_ESTADO:mudanca:([a-z,]+)/);
  if (mudanca) {
    return `Depois da aprovação, mudar ${joinLabels(mudanca[1].split(","))} precisa ser pedido ao Espaço Byla (botão “Pedir mudança”).`;
  }
  const estado = dbMessage.match(/ORG_ESTADO:([a-z_]+)/);
  if (estado) return STATE_MESSAGES[estado[1]] ?? STATE_MESSAGES.estado;
  if (dbMessage.includes("ORG_CONVITE")) return "Este convite não vale mais. Peça um novo ao Espaço Byla.";
  if (dbMessage.includes("ORG_DONO")) return "Evento não encontrado.";
  if (dbMessage.includes("ORG_DESLIGADO")) return "Esta área está indisponível no momento.";
  if (dbMessage.includes("ORG_LIMITE")) return "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.";
  if (dbMessage.includes("ORG_ACESSO")) return "Acesso não permitido.";
  if (dbMessage.includes("ORG_DADOS")) return "Confira os dados e tente de novo.";
  if (dbMessage.includes("ORG_EMAIL")) return "Confirme o e-mail com o código antes de continuar.";
  return null;
}
```

Com a decisão 2A, o teste espera `"nome do evento e horário"`; o mapeamento acima já produz esse texto.

`src/lib/organizer/validation.ts`: implementar as funções da interface usando `onlyDigits`/`isValidTaxDocument`; telefone = 10 a 13 dígitos depois de `onlyDigits`; chave PIX por tipo: `cpf`/`cnpj` = documento válido **igual** ao do titular (mensagem "Para chave CPF/CNPJ, use o documento do titular informado."), `email` = `parseEmail` (até 77), `telefone` = 10 a 13 dígitos guardados como `+55` + dígitos quando não começar com 55, `aleatoria` = UUID (`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`, guardado em minúsculas); textos com `btrim` e limites do spec 5.1 e 7.2; senha 12–72 caracteres sem outra regra. Mensagens em português simples, uma por campo.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/organizer`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/organizer tests/organizer
git commit -m "feat(organizador): regras puras de documento, convite, validacao e mensagens"
```

### Task 5: Login por área (equipe e organizador)

**Files:**
- Create: `src/lib/auth/area.ts`, `src/app/organizador/verificar/actions.ts`
- Modify: `src/lib/auth/staff-gate.ts`, `src/lib/auth/login-code.ts`, `src/lib/auth/login-verification.ts`, `src/proxy.ts`, `src/app/equipe/layout.tsx`, `src/lib/email/login-code-template.ts`, `src/lib/email/send-login-code.ts`, `src/types/database.ts`
- Test: `tests/auth/area.test.ts` (novo), `tests/proxy-staff-gate.test.ts`, `tests/auth/login-verification.test.ts`, `tests/email/login-code-email.test.ts`

**Interfaces:**
- Consumes: `login_session_state()`, `my_account_kind()`, `verify_session_with_device`, `verify_login_code`, `issue_login_code` (fase 1 + Task 1).
- Produces:
  - `type LoginArea = "equipe" | "organizador"`; `AREAS: Record<LoginArea, { login: string; verify: string; home: string; deviceCookie: string; cookiePath: string }>`; `areaForPath(pathname: string): LoginArea | null`; `areaRedirectFor(area: LoginArea, pathname: string, status: StaffLoginStatus): string | null`; `toAreaStatus(status: unknown, kind: unknown, area: LoginArea): StaffLoginStatus`
  - `readLoginState(supabase, area?: LoginArea)` — com `area`, devolve `fora` se `my_account_kind()` não for o da área
  - `startLoginVerification(area?: LoginArea)`, `resendLoginCode(area?)`, `submitLoginCode({ code, remember, area? })`, `endLoginVerification()` — `area` padrão `"equipe"` (chamadas atuais não mudam)
  - `buildLoginCodeEmail({ code, purpose }: { code: string; purpose: "equipe" | "organizador" | "cadastro" })`; `sendLoginCodeEmail({ to, code, purpose })`
  - `src/app/organizador/verificar/actions.ts` (`"use server"`): `startOrganizerLoginAction(): Promise<ActionResult<{ next: string }>>`, `resendOrganizerLoginCodeAction(): Promise<ActionResult<{ verified: boolean }>>`, `submitOrganizerLoginCodeAction(code: string, remember: boolean): Promise<ActionResult<{ next: string }>>`, `signOutOrganizerAction(): Promise<void>` — cópias das da equipe com `area: "organizador"` (usadas pelo cadastro na Task 9 e pelas telas na Task 10)

- [ ] **Step 1: Testes (falham)**

`tests/auth/area.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AREAS, areaForPath, areaRedirectFor, toAreaStatus } from "@/lib/auth/area";

describe("áreas com login", () => {
  it("reconhece só os prefixos certos", () => {
    expect(areaForPath("/equipe")).toBe("equipe");
    expect(areaForPath("/equipe/eventos/x")).toBe("equipe");
    expect(areaForPath("/organizador")).toBe("organizador");
    expect(areaForPath("/organizador/eventos/x")).toBe("organizador");
    expect(areaForPath("/organizadores")).toBeNull();
    expect(areaForPath("/convite")).toBeNull();
    expect(areaForPath("/quero-fazer-meu-evento")).toBeNull();
  });
  it.each([
    ["/organizador", "fora", "/organizador/entrar"],
    ["/organizador", "pendente", "/organizador/verificar"],
    ["/organizador", "verificado", null],
    ["/organizador/entrar", "verificado", "/organizador"],
    ["/organizador/verificar", "fora", "/organizador/entrar"],
  ] as const)("organizador %s com %s → %s", (path, status, target) => {
    expect(areaRedirectFor("organizador", path, status)).toBe(target);
  });
  it("conta do tipo errado conta como fora", () => {
    expect(toAreaStatus("verificado", "organizador", "equipe")).toBe("fora");
    expect(toAreaStatus("verificado", "equipe", "organizador")).toBe("fora");
    expect(toAreaStatus("pendente", "organizador", "organizador")).toBe("pendente");
    expect(toAreaStatus("verificado", null, "equipe")).toBe("fora");
  });
  it("cookies separados por área", () => {
    expect(AREAS.equipe).toMatchObject({ deviceCookie: "byla_equipe_aparelho", cookiePath: "/equipe" });
    expect(AREAS.organizador).toMatchObject({ deviceCookie: "byla_org_aparelho", cookiePath: "/organizador" });
  });
});
```

Acrescentar a `tests/proxy-staff-gate.test.ts`: organizador verificado abrindo `/equipe` → redireciona para `/equipe/login`; equipe verificada abrindo `/organizador` → `/organizador/entrar`; o proxy chama `login_session_state` e `my_account_kind` (em paralelo) só em `/equipe*` e `/organizador*`; página pública não chama nada. Em `tests/auth/login-verification.test.ts`: `startLoginVerification("organizador")` → `/organizador` ou `/organizador/verificar`, lê o cookie `byla_org_aparelho`; `submitLoginCode({ ..., area: "organizador" })` grava o cookie com `path=/organizador`; conta de equipe em `area: "organizador"` → `ActionError` com "Não foi possível entrar.". Em `tests/email/login-code-email.test.ts`: `purpose: "organizador"` diz "área do organizador"; `purpose: "cadastro"` diz "Confirme seu e-mail" e "15 minutos"; nenhum cita fornecedor; assunto sem o código.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/auth tests/proxy-staff-gate.test.ts tests/email/login-code-email.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
// src/lib/auth/area.ts
import type { StaffLoginStatus } from "@/lib/auth/staff-gate";

export type LoginArea = "equipe" | "organizador";

export const AREAS = {
  equipe: {
    login: "/equipe/login",
    verify: "/equipe/verificar",
    home: "/equipe",
    deviceCookie: "byla_equipe_aparelho",
    cookiePath: "/equipe",
  },
  organizador: {
    login: "/organizador/entrar",
    verify: "/organizador/verificar",
    home: "/organizador",
    deviceCookie: "byla_org_aparelho",
    cookiePath: "/organizador",
  },
} as const satisfies Record<LoginArea, { login: string; verify: string; home: string; deviceCookie: string; cookiePath: string }>;

export function areaForPath(pathname: string): LoginArea | null {
  for (const area of ["equipe", "organizador"] as const) {
    const home = AREAS[area].home;
    if (pathname === home || pathname.startsWith(`${home}/`)) return area;
  }
  return null;
}

export function toAreaStatus(status: unknown, kind: unknown, area: LoginArea): StaffLoginStatus {
  if (kind !== area) return "fora";
  return status === "pendente" || status === "verificado" ? status : "fora";
}

export function areaRedirectFor(area: LoginArea, pathname: string, status: StaffLoginStatus): string | null {
  const { login, verify, home } = AREAS[area];
  if (pathname === login) {
    if (status === "verificado") return home;
    if (status === "pendente") return verify;
    return null;
  }
  if (pathname === verify) {
    if (status === "verificado") return home;
    if (status === "fora") return login;
    return null;
  }
  if (status === "fora") return login;
  if (status === "pendente") return verify;
  return null;
}
```

`staff-gate.ts`: manter `StaffLoginStatus`, `STAFF_*`, `toStaffLoginStatus`; `staffRedirectFor(pathname, status)` passa a `return areaRedirectFor("equipe", pathname, status)`.

`proxy.ts`: `const area = areaForPath(request.nextUrl.pathname)`; com área, `protectArea(request, requestHeaders, area)` (o atual `protectStaffArea` generalizado): com usuário, `Promise.all([supabase.rpc("login_session_state"), supabase.rpc("my_account_kind")])`; qualquer erro → `fora`; `status = toAreaStatus(state[0]?.status, kind, area)`; `areaRedirectFor(area, pathname, status)`. O comentário sobre prefetch e o `matcher` não mudam.

`login-verification.ts`: trocar as constantes fixas por `AREAS[area]`; `readLoginState(supabase, area?)` chama também `my_account_kind` quando há `area` e devolve `OUT` se o tipo não bater; o cookie do aparelho usa `AREAS[area].deviceCookie` e `cookiePath`. `sendNewCode` passa `purpose: area`.

`src/app/equipe/layout.tsx`: `readLoginState(await createServerClient(), "equipe")`.

`login-code-template.ts`: frase de uso por finalidade (`equipe`: "Use este código para entrar no painel da equipe:"; `organizador`: "Use este código para entrar na área do organizador:"; `cadastro`: título "Confirme seu e-mail", "Use este código para confirmar o seu e-mail no cadastro de organizador:", validade "15 minutos"). Assunto continua "Seu código de acesso - Espaço Byla Eventos" (cadastro: "Seu código do Espaço Byla Eventos").

`src/types/database.ts`: `my_account_kind: { Args: Record<string, never>; Returns: string | null }` e as demais funções da Task 1/2 (Args/Returns exatamente como nas tabelas de interface).

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/auth tests/proxy-staff-gate.test.ts tests/email/login-code-email.test.ts`
Expected: PASS, inclusive os testes antigos da equipe.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/auth/area.ts src/app/organizador/verificar/actions.ts src/lib/auth/staff-gate.ts src/lib/auth/login-code.ts src/lib/auth/login-verification.ts src/proxy.ts src/app/equipe/layout.tsx src/lib/email/login-code-template.ts src/lib/email/send-login-code.ts src/types/database.ts tests/auth/area.test.ts tests/proxy-staff-gate.test.ts tests/auth/login-verification.test.ts tests/email/login-code-email.test.ts
git commit -m "feat(auth): login com codigo por area (equipe e organizador) e tipo de conta no proxy"
```

### Task 6: Helper de acesso, inventário de ações, mídia compartilhada e formulário de evento

**Files:**
- Create: `src/lib/auth/actor.ts`, `src/lib/events/event-input.ts`, `tests/security/action-inventory.test.ts`, `tests/auth/actor.test.ts`
- Modify: `src/app/equipe/eventos/actions.ts` (passa a importar de `event-input.ts`), `src/app/equipe/eventos/media-actions.ts`, `tests/equipe/media-actions.test.ts`

**Interfaces:**
- Produces:
  - `type Actor = { kind: "equipe"; userId: string; isAdmin: boolean; isDeveloper: boolean } | { kind: "organizador"; userId: string }`
  - `getActor(): Promise<Actor | null>`, `requireActor(): Promise<Actor>`, `requireOrganizer(): Promise<{ userId: string }>`, `requireTeamAdmin(): Promise<{ userId: string; isDeveloper: boolean }>`, `requireEventAccess(eventId: unknown): Promise<{ actor: Actor; access: "equipe" | "dono" }>`
  - `ACCESS_DENIED_MESSAGE = "Acesso não permitido."`, `EVENT_NOT_FOUND_MESSAGE = "Evento não encontrado."`
  - `src/lib/events/event-input.ts`: `type EventInput`, `type NormalizedEventInput`, `normalizeEventInput(input: EventInput): NormalizedEventInput`, `saveErrorMessage(message: string, labels: string[], removed?: Map<string, string>): string`, `sessionLabels(sessions)`, `isHttpsUrl(value: string)`, `UUID_PATTERN` (movidos sem mudar comportamento; `saveErrorMessage` passa a tentar `organizerErrorMessage` antes do texto genérico)

- [ ] **Step 1: Testes (falham)**

`tests/auth/actor.test.ts` (Supabase simulado, no estilo de `tests/equipe/staff-actions.test.ts`): sem login → `getActor()` nulo e `requireActor()` lança "Acesso não permitido."; `is_staff` verdadeiro + `staff_finance_role = "admin_dev"` → `{ kind: "equipe", isAdmin: true, isDeveloper: true }`; `is_staff` falso + `is_organizer` verdadeiro → `{ kind: "organizador" }`; erro em qualquer RPC → nulo (falha fechada); `requireEventAccess("x")` lança "Evento não encontrado." **sem** chamar o banco; `actor_event_access` nulo ou com erro → "Evento não encontrado."; `requireTeamAdmin` recusa secretaria e organizador; `requireOrganizer` recusa equipe.

`tests/security/action-inventory.test.ts`:

```ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../src/app");
const AREAS = ["equipe", "organizador", "convite", "quero-fazer-meu-evento", "redefinir-senha"];
const AUTH_GUARDS = [
  "requireOrganizer", "requireEventAccess", "requireTeamAdmin", "requireActor",
  "requireStaffUser", "assertStaff", "requireFinanceAdmin", "getFinanceAccess",
  // login com código: agem só sobre a própria sessão, conferida pelo banco
  "startLoginVerification", "resendLoginCode", "submitLoginCode", "endLoginVerification",
];
const PUBLIC_GUARDS = ["isBotRequest", "consumeRateLimit", "tryConsumeRateLimit"];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function actionFiles(): string[] {
  return AREAS.flatMap((area) => {
    const dir = path.join(ROOT, area);
    try {
      return walk(dir).filter((file) => /(actions\.ts|-actions\.ts|route\.ts)$/.test(file));
    } catch {
      return [];
    }
  }).concat(path.join(ROOT, "api", "check-in", "route.ts"));
}

/** Corpo de cada função do arquivo (exportada ou não), pelo nome. */
function functionBodies(source: string): Map<string, string> {
  const map = new Map<string, string>();
  const starts = [...source.matchAll(/(?:export )?async function (\w+)\(/g)];
  starts.forEach((match, index) => {
    const end = index + 1 < starts.length ? starts[index + 1].index : source.length;
    map.set(match[1], source.slice(match.index, end));
  });
  return map;
}

function reachesGuard(name: string, bodies: Map<string, string>, guards: string[], seen = new Set<string>()): boolean {
  if (seen.has(name)) return false;
  seen.add(name);
  const body = bodies.get(name) ?? "";
  if (guards.some((guard) => new RegExp(`\\b${guard}\\(`).test(body))) return true;
  return [...body.matchAll(/\b(\w+)\(/g)].some(([, called]) => called !== name && bodies.has(called) && reachesGuard(called, bodies, guards, seen));
}

describe("inventário: toda ação e rota confere acesso dentro dela", () => {
  const files = actionFiles();

  it("encontrou os arquivos de ação", () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it.each(files.map((file) => [path.relative(ROOT, file), file]))("%s", (_label, file) => {
    const source = readFileSync(file, "utf8");
    const bodies = functionBodies(source);
    const exported = [...source.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
    const isPublic = /[\\/](convite|quero-fazer-meu-evento|redefinir-senha)[\\/]/.test(file);
    const guards = isPublic ? PUBLIC_GUARDS : AUTH_GUARDS.concat(file.includes("check-in") ? ["readLoginState"] : []);
    for (const name of exported) {
      expect(reachesGuard(name, bodies, guards), `${name} não chama ${guards.join(" / ")}`).toBe(true);
    }
  });

  it("área do organizador não tem ação de cortesia", () => {
    for (const file of files.filter((f) => f.includes(`${path.sep}organizador${path.sep}`))) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/issue_courtesy_ticket|cancel_courtesy_ticket|issueCourtesy|cancelTicket/);
    }
  });
});
```

`tests/equipe/media-actions.test.ts`: organizador consegue pedir envio de **capa** (`requireActor`); galeria de evento de outro dono → "Evento não encontrado."; anônimo → "Acesso não permitido.".

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/auth/actor.test.ts tests/security/action-inventory.test.ts tests/equipe/media-actions.test.ts`
Expected: FAIL (`actor.ts` não existe; mídia ainda usa `assertStaff`).

- [ ] **Step 3: Implementar**

```ts
// src/lib/auth/actor.ts
import "server-only";

import { ActionError } from "@/lib/action-result";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

export type Actor =
  | { kind: "equipe"; userId: string; isAdmin: boolean; isDeveloper: boolean }
  | { kind: "organizador"; userId: string };

export const ACCESS_DENIED_MESSAGE = "Acesso não permitido.";
export const EVENT_NOT_FOUND_MESSAGE = "Evento não encontrado.";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Quem está agindo, conferido com a sessão do usuário (is_staff/is_organizer exigem
 * o código do e-mail). Qualquer falha = null (falha fechada).
 */
export async function getActor(): Promise<Actor | null> {
  const supabase = await createServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return null;

  const [staff, organizer] = await Promise.all([supabase.rpc("is_staff"), supabase.rpc("is_organizer")]);
  if (!staff.error && staff.data === true) {
    const { data: role, error } = await createAdminClient().rpc("staff_finance_role", {
      p_staff_user_id: user.id,
    });
    if (error) {
      console.error("[acesso] Falha ao conferir o papel da conta.", error.code);
      return null;
    }
    return {
      kind: "equipe",
      userId: user.id,
      isAdmin: role === "admin" || role === "admin_dev",
      isDeveloper: role === "admin_dev",
    };
  }
  if (!organizer.error && organizer.data === true) return { kind: "organizador", userId: user.id };
  return null;
}

export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new ActionError(ACCESS_DENIED_MESSAGE);
  return actor;
}

export async function requireOrganizer(): Promise<{ userId: string }> {
  const actor = await requireActor();
  if (actor.kind !== "organizador") throw new ActionError(ACCESS_DENIED_MESSAGE);
  return { userId: actor.userId };
}

export async function requireTeamAdmin(): Promise<{ userId: string; isDeveloper: boolean }> {
  const actor = await requireActor();
  if (actor.kind !== "equipe" || !actor.isAdmin) throw new ActionError(ACCESS_DENIED_MESSAGE);
  return { userId: actor.userId, isDeveloper: actor.isDeveloper };
}

export async function requireEventAccess(
  eventId: unknown,
): Promise<{ actor: Actor; access: "equipe" | "dono" }> {
  if (typeof eventId !== "string" || !UUID_PATTERN.test(eventId)) {
    throw new ActionError(EVENT_NOT_FOUND_MESSAGE);
  }
  const actor = await requireActor();
  const { data, error } = await createAdminClient().rpc("actor_event_access", {
    p_actor_user_id: actor.userId,
    p_event_id: eventId,
  });
  if (error) {
    console.error("[acesso] Falha ao conferir o evento.", error.code);
    throw new ActionError(EVENT_NOT_FOUND_MESSAGE);
  }
  if (data !== "equipe" && data !== "dono") throw new ActionError(EVENT_NOT_FOUND_MESSAGE);
  return { actor, access: data };
}
```

`media-actions.ts`: capa → `const actor = await requireActor()`; se organizador, `consumeRateLimit(admin, RATE_LIMITS.organizerUploadPerUser, actor.userId)` (60/h) senão `RATE_LIMIT_MESSAGE`; galeria (pedir envio, adicionar, remover) → `await requireEventAccess(eventId)` no lugar de `assertStaff()`. Revalidar também `/organizador/eventos/${eventId}`.

`event-input.ts`: mover `EventInput`, `normalizeInput` (renomeado `normalizeEventInput`), `sessionTypeInfos`, `isHttpsUrl`, `sessionLabels`, `saveErrorMessage` e `UUID_PATTERN` de `src/app/equipe/eventos/actions.ts`; o arquivo de ações reexporta o tipo `EventInput` (o `EventForm` importa de lá) e chama as funções movidas. Os testes atuais da equipe (`tests/equipe/staff-actions.test.ts`, `ticket-types-actions.test.ts`, `event-cover.test.ts`) passam sem mudança.

Regras novas em `RATE_LIMITS` (`src/lib/security/rate-limit.ts`):

```ts
organizerRequestPerIp: { bucket: "org-request:ip", limit: 3, windowSeconds: 3600 },
inviteCheckPerIp: { bucket: "invite-check:ip", limit: 20, windowSeconds: 3600 },
inviteCodePerIp: { bucket: "invite-code:ip", limit: 10, windowSeconds: 3600 },
inviteCompletePerIp: { bucket: "invite-complete:ip", limit: 10, windowSeconds: 3600 },
passwordResetPerIp: { bucket: "password-reset:ip", limit: 10, windowSeconds: 3600 },
organizerSavePerUser: { bucket: "org-save:user", limit: 120, windowSeconds: 3600 },
organizerUploadPerUser: { bucket: "org-upload:user", limit: 60, windowSeconds: 3600 },
```

- [ ] **Step 4: Rodar a suíte inteira**

Run: `npx vitest run`
Expected: PASS (o inventário cobre só os arquivos que já existem; cada tarefa seguinte entra nele automaticamente).

- [ ] **Step 5: Commit**

```powershell
git add src/lib/auth/actor.ts src/lib/events/event-input.ts src/app/equipe/eventos/actions.ts src/app/equipe/eventos/media-actions.ts src/lib/security/rate-limit.ts tests/auth/actor.test.ts tests/security/action-inventory.test.ts tests/equipe/media-actions.test.ts
git commit -m "feat(acesso): helper de quem age, inventario de acoes e midia para organizador"
```

### Task 7: E-mails da área do organizador

**Files:**
- Create: `src/lib/email/organizer-notice-template.ts`, `src/lib/email/send-organizer-notice.ts`, `src/lib/organizer/notify.ts`
- Test: `tests/email/organizer-notice-template.test.ts`, `tests/organizer/notify.test.ts`

**Interfaces:**
- Produces:
  - `type OrganizerNoticeKind = "equipe_pedido_site" | "equipe_evento_enviado" | "equipe_pedido_organizador" | "org_evento_aprovado" | "org_evento_recusado" | "org_pedido_respondido" | "org_conta_suspensa"`
  - `buildOrganizerNotice(kind: OrganizerNoticeKind, data: { eventName?: string; note?: string; requestKind?: "estorno" | "exclusao" | "mudanca"; outcome?: "atendido" | "recusado"; count?: number; link: string }): { subject: string; html: string; text: string }`
  - `sendOrganizerNotice(to: string, content): Promise<"sent" | "capped" | "skipped" | "failed">` — consome `email-org:day` (10/dia, chave `site`) antes de enviar; `capped` não envia
  - `notifyTeam(kind, data)`, `notifyOrganizer(userId: string, kind, data)` — nunca lançam; e-mail do organizador lido por `createAdminClient().auth.admin.getUserById(userId)`; equipe = `ALERT_EMAIL`
  - `notifyTeamSignupRequest(admin)` — no máximo 1 a cada 6 h (`consume_rate_limit('org-notice:signup', 'site', 1, 21600)`), com a contagem de pedidos `nova`

- [ ] **Step 1: Testes (falham)**

Template: assuntos do spec 14 ("Novo pedido para fazer evento", "Evento para aprovar: <nome>", "Pedido do organizador: Estorno — <evento>", "Seu evento foi aprovado", "Seu evento precisa de ajustes", "Resposta ao seu pedido", "Sua conta foi suspensa"); HTML escapa `<`, `&`, `"` do nome do evento e da nota; nenhum texto cita fornecedor (lista proibida: "Mercado Pago", "Supabase", "Resend", "Google", "Cloudflare"); nunca inclui e-mail ou nome de comprador (o tipo de dados nem aceita). Envio: com o limite estourado devolve `capped` sem chamar `fetch`; sem configuração devolve `skipped`; erro HTTP → `failed`; log nunca contém o endereço.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/email/organizer-notice-template.test.ts tests/organizer/notify.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar** no padrão de `src/lib/email/send-session-notice.ts` (tempo máximo, log sem dados, mesmo remetente `RESEND_FROM_EMAIL`), links para `${NEXT_PUBLIC_APP_URL}/equipe/aprovacoes`, `/equipe/organizadores` ou `/organizador/eventos/<id>`.

- [ ] **Step 4: Rodar e ver passar** — mesmo comando, PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/email/organizer-notice-template.ts src/lib/email/send-organizer-notice.ts src/lib/organizer/notify.ts tests/email/organizer-notice-template.test.ts tests/organizer/notify.test.ts
git commit -m "feat(organizador): avisos por e-mail com teto proprio de 10 por dia"
```

### Task 8: "Quero fazer meu evento" (público)

**Files:**
- Create: `src/lib/organizer/settings.ts`, `src/app/quero-fazer-meu-evento/page.tsx`, `src/app/quero-fazer-meu-evento/actions.ts`, `src/components/public/OrganizerRequestForm.tsx`
- Modify: `src/lib/security/human-check.ts`, `src/components/brand/SiteFooter.tsx`, `src/app/page.tsx`
- Test: `tests/public/organizer-request.test.ts`, `tests/public/site-footer.test.ts`

**Interfaces:**
- Produces: `organizerAreaEnabled(): Promise<boolean>` (`server-only`; RPC `organizer_area_enabled` com o cliente anônimo; erro = `false`); `submitOrganizerRequest(input: { name: string; contact: string; idea: string; approxDate: string; privacyAccepted: boolean; humanToken: string }): Promise<ActionResult>`; `HumanCheckAction` ganha `"org_request"` e `"org_invite"`.

- [ ] **Step 1: Testes (falham)**

`submitOrganizerRequest`: área desligada → erro genérico "Esta área está indisponível no momento." sem chamar anti-robô; anti-robô recusa → `BOT_BLOCKED_MESSAGE`; limite por IP → `RATE_LIMIT_MESSAGE`; dados inválidos → mensagem do campo; banco `ORG_LIMITE` → `RATE_LIMIT_MESSAGE`; sucesso grava com `PRIVACY_POLICY_VERSION`, chama `notifyTeamSignupRequest` e **nenhum** e-mail para quem pediu; ordem: área → validação → anti-robô → limite → banco. Página: com a área desligada `notFound()`; ligada mostra o texto do spec 5.1, campos com `maxLength`, caixa "Li a Política de Privacidade" com link, link "Veja como funciona para organizadores" → `/termos-organizador`, tela de sucesso "Recebemos! A equipe do Espaço Byla vai falar com você pelo contato informado.". Rodapé: link "Quero fazer meu evento" só com a área ligada.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/public/organizer-request.test.ts tests/public/site-footer.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar.** `SiteFooter` vira componente assíncrono de servidor que chama `organizerAreaEnabled()`. Página inicial: bloco discreto no fim "Realize seu evento no Espaço Byla → Fale com a gente" só com a área ligada. Formulário usa `useHumanCheck("org_request")` e o padrão visual do checkout (celular primeiro).

- [ ] **Step 4: Rodar e ver passar** — PASS; `npx vitest run` inteiro também.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/organizer/settings.ts src/app/quero-fazer-meu-evento src/components/public/OrganizerRequestForm.tsx src/lib/security/human-check.ts src/components/brand/SiteFooter.tsx src/app/page.tsx tests/public/organizer-request.test.ts tests/public/site-footer.test.ts
git commit -m "feat(publico): pagina Quero fazer meu evento com anti-robo e limites"
```

### Task 9: Convite, cadastro e link de nova senha

**Files:**
- Create: `src/app/convite/page.tsx`, `src/app/convite/actions.ts`, `src/components/organizer/SignupWizard.tsx`, `src/app/redefinir-senha/page.tsx`, `src/app/redefinir-senha/actions.ts`
- Test: `tests/organizer/signup-actions.test.ts`, `tests/organizer/password-reset-action.test.ts`, `tests/organizer/signup-wizard.test.ts`

**Interfaces:**
- Consumes: `check_organizer_invite`, `start_invite_email_code`, `verify_invite_email_code`, `invite_verified_email`, `accept_organizer_invite`, `use_password_reset_invite` (Task 1); `hashInviteToken`, `isInviteTokenFormat`, `parseOrganizerProfile`, `parsePassword`, `parseEmail` (Task 4); `ORGANIZER_TERMS_VERSION` (Task 16; até lá a constante já existe em `src/lib/legal/organizer-terms.ts` criada aqui com o valor da data de publicação).
- Produces (Server Actions, todas `ActionResult`):
  - `checkInvite(token: string): Promise<ActionResult<{ valid: true }>>`
  - `sendInviteEmailCode(token: string, email: string, humanToken: string): Promise<ActionResult>`
  - `verifyInviteEmailCode(token: string, code: string): Promise<ActionResult>`
  - `completeOrganizerSignup(token: string, input: { profile: unknown; password: string; termsAccepted: boolean }): Promise<ActionResult<{ email: string }>>`
  - `resetPasswordWithLink(token: string, password: string): Promise<ActionResult>`

- [ ] **Step 1: Testes (falham)** — Supabase e Auth Admin simulados:

- `checkInvite`: token fora do formato → "Este convite não vale mais. Peça um novo ao Espaço Byla." **sem** chamar o banco; limite por IP → `RATE_LIMIT_MESSAGE`; `invalido` → mesma mensagem genérica; `valido` → ok. O banco recebe **só** o hash (o teste confere que o token em claro nunca aparece nos argumentos).
- `sendInviteEmailCode`: anti-robô `org_invite`; limite por IP; e-mail inválido; `limite` → "Você já pediu 3 códigos para este convite. Peça um novo convite ao Espaço Byla."; `email_indisponivel` → "Este e-mail não pode ser usado. Use outro e-mail ou fale com o Espaço Byla."; `ok` → envia `purpose: "cadastro"` ao e-mail digitado; falha no envio → "Não conseguimos enviar o código agora. Tente de novo em alguns minutos.".
- `verifyInviteEmailCode`: código normalizado (`normalizeLoginCode`); cada status traduzido.
- `completeOrganizerSignup`: termos não aceitos → erro; perfil/senha inválidos → mensagem do campo; `invite_verified_email` nulo → "Confirme o e-mail com o código antes de continuar."; `createUser` recebe o e-mail **do banco** (não do navegador), `email_confirm: true` e nunca `user_metadata` com dados pessoais; `accept_organizer_invite` falha → `deleteUser(id)` é chamado e a mensagem é genérica "Não foi possível criar a conta. Fale com o Espaço Byla."; `createUser` falha → genérica, sem `accept`; sucesso devolve o e-mail (para o navegador entrar em seguida).
- `resetPasswordWithLink`: formato, limite por IP, senha fraca, `ORG_CONVITE` genérico; sucesso chama `auth.admin.updateUserById(id, { password })` **depois** de `use_password_reset_invite`.
- `SignupWizard`: lê o token de `window.location.hash` e chama `history.replaceState` para tirar o `#` da barra; passos com barra de progresso (Convite → Seus dados → E-mail → Senha → Recebimento → Termos → Pronto); campo do código com `inputMode="numeric"` e `autoComplete="one-time-code"`; "Reenviar código" no máximo 2 vezes; textos do spec 5.3 (ex.: "O repasse vai para esta chave. O titular precisa ser você ou a sua empresa. Confira com cuidado."); ao concluir, `signInWithPassword` no navegador e `startOrganizerLoginAction()` (Task 5) → vai para `/organizador/verificar` com "A cada acesso em um aparelho novo, enviaremos um código para o seu e-mail.".

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/organizer/signup-actions.test.ts tests/organizer/password-reset-action.test.ts tests/organizer/signup-wizard.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar.** As duas páginas respondem 404 com a área desligada (`organizerAreaEnabled()`), têm `export const metadata = { robots: { index: false } }` e cabeçalho `Referrer-Policy: no-referrer` (via `headers` no `next.config` só para `/convite` e `/redefinir-senha`, conferindo a forma certa no guia do Next 16). Senha: "Mínimo de 12 caracteres. Não use a mesma senha de outro site." Nenhum `console.*` com e-mail, token ou código.

- [ ] **Step 4: Rodar e ver passar** — PASS; `npx vitest run` inteiro (o inventário passa a incluir `convite` e `redefinir-senha`).

- [ ] **Step 5: Commit**

```powershell
git add src/app/convite src/app/redefinir-senha src/components/organizer/SignupWizard.tsx src/lib/legal/organizer-terms.ts next.config.ts tests/organizer/signup-actions.test.ts tests/organizer/password-reset-action.test.ts tests/organizer/signup-wizard.test.ts
git commit -m "feat(organizador): convite de uso unico, cadastro com codigo no e-mail e link de nova senha"
```

### Task 10: Área do organizador — entrar, código, menu, Meus eventos e Minha conta

**Files:**
- Create: `src/app/organizador/layout.tsx`, `src/app/organizador/page.tsx`, `src/app/organizador/entrar/page.tsx`, `src/app/organizador/verificar/page.tsx`, `src/app/organizador/conta/page.tsx`, `src/app/organizador/conta/actions.ts`, `src/components/auth/DevicesList.tsx`, `src/components/organizer/OrganizerEventCard.tsx`
- Modify: `src/components/equipe/LoginCodeForm.tsx` (recebe as ações por prop)
- Test: `tests/organizer/area-pages.test.ts`, `tests/organizer/devices-actions.test.ts`

**Interfaces:**
- Consumes: as quatro ações de `src/app/organizador/verificar/actions.ts` (Task 5).
- Produces: `forgetMyDeviceAction(deviceId: string): Promise<ActionResult>` em `src/app/organizador/conta/actions.ts` (chama `requireOrganizer()` e `forget_my_device` com a sessão do usuário); `<DevicesList devices onForget />` (componente cliente que recebe a ação por prop, reaproveitado pela equipe na Task 15).

- [ ] **Step 1: Testes (falham)**

Layout: em `/organizador/entrar` e `/organizador/verificar` renderiza só a página; nos demais, `readLoginState(..., "organizador")` → `pendente` redireciona para verificar, `fora` para entrar. Menu: "Meus eventos" · "Minha conta" · "Sair". Entrar: área desligada mostra "A área do organizador ainda não está disponível." e não mostra o formulário; senha errada ou conta da equipe → "Não foi possível entrar" (mensagem única). Meus eventos: cards com capa, datas, selo (Rascunho · Em análise · Recusado · À venda · Vendas pausadas · Encerrado), "38 de 100 vendidos", botão "+ Criar evento", lembrete "Precisa de cortesias? Peça à equipe do Espaço Byla pelo WhatsApp."; lista vem de `events` pela RLS (só os próprios, `deleted_at is null`). Minha conta: nome, nome público, telefone, e-mail mascarado, chave PIX e CPF/CNPJ do titular **mascarados** (a página lê a própria linha pela RLS e mascara no servidor antes de mandar ao navegador), "Para trocar a chave PIX, fale com o Espaço Byla" (decisão **1A**; sem botão de troca nesta fase), Termos aceitos (versão e data), "Meus aparelhos" com "Esquecer". `forgetMyDeviceAction`: UUID inválido → erro; organizador sem sessão verificada → "Acesso não permitido.".

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/organizer/area-pages.test.ts tests/organizer/devices-actions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar** reaproveitando `LoginCodeForm` (passa a receber `actions` e textos por prop; a equipe continua passando as dela) e o visual de `/equipe/login`. Título da tela de entrar: "Área do organizador".

- [ ] **Step 4: Rodar e ver passar** — PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/app/organizador/layout.tsx src/app/organizador/page.tsx src/app/organizador/entrar src/app/organizador/verificar/page.tsx src/app/organizador/conta src/components/auth/DevicesList.tsx src/components/organizer/OrganizerEventCard.tsx src/components/equipe/LoginCodeForm.tsx tests/organizer/area-pages.test.ts tests/organizer/devices-actions.test.ts
git commit -m "feat(organizador): entrar com codigo, meus eventos e minha conta"
```

### Task 11: Eventos do organizador — criar, editar, enviar, vendas e "Pedir mudança"

**Files:**
- Create: `src/app/organizador/eventos/actions.ts`, `src/app/organizador/eventos/novo/page.tsx`, `src/app/organizador/eventos/[id]/page.tsx`, `src/components/organizer/ApprovalBanner.tsx`, `src/components/organizer/RequestChangeDialog.tsx`, `src/components/organizer/OrganizerSalesPanel.tsx`
- Modify: `src/components/equipe/EventForm.tsx`
- Test: `tests/organizer/event-actions.test.ts`, `tests/organizer/event-form-locks.test.ts`

**Interfaces:**
- Consumes: `normalizeEventInput`, `saveErrorMessage` (Task 6), `requireOrganizer`, `requireEventAccess`, `organizerErrorMessage`, `lockedFieldsFor`.
- Produces (Server Actions):
  - `createOrganizerEvent(input: EventInput): Promise<ActionResult<{ id: string }>>`
  - `updateOrganizerEvent(id: string, input: EventInput): Promise<ActionResult>`
  - `submitEventForApproval(id: string): Promise<ActionResult>`
  - `withdrawEventSubmission(id: string): Promise<ActionResult>`
  - `setOrganizerEventSales(id: string, open: boolean): Promise<ActionResult>`
  - `setOrganizerSessionSales(sessionId: string, open: boolean): Promise<ActionResult>` (lê o evento da sessão no banco e chama `requireEventAccess` com ele)
  - `requestEventChange(id: string, input: { what: string; reason: string }): Promise<ActionResult>`
  - `EventForm` ganha `area?: "equipe" | "organizador"` (padrão `"equipe"`) e `lockedFields?: LockedField[]`

- [ ] **Step 1: Testes (falham)**

Ações: cada uma recusa anônimo, equipe (é área do organizador: `requireOrganizer`) e evento de outro dono ("Evento não encontrado."); `createOrganizerEvent` limita `org-save:user`, gera o slug com o cliente `service_role` (o organizador não enxerga eventos alheios pela RLS, então a busca de slugs pelo cliente do usuário daria colisão), confere capa enviada (`assertCoverUploaded`), chama `create_organizer_event` com `p_actor = userId` e nunca manda `sales_open`; erros `ORG_*` viram as mensagens da Task 4; `submitEventForApproval` chama `notifyTeam("equipe_evento_enviado", ...)` só no sucesso; `requestEventChange` valida `what`/`reason` (5–500) e avisa a equipe; revalidam `/organizador`, `/organizador/eventos/<id>`, `/equipe/aprovacoes` e, para vendas, `/` e `/eventos/<slug>`.

`EventForm` com `area="organizador"`: sem interruptor de vendas da equipe; com `lockedFields` mostra os campos travados como só leitura e o botão "Pedir mudança" ao lado; em "Em análise" o formulário inteiro fica só leitura com "Voltar para rascunho".

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/organizer/event-actions.test.ts tests/organizer/event-form-locks.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar.** Página do evento: abas no celular (Evento · Vendas · Pedidos · Portaria · Pedidos à equipe), colunas no computador; faixa de estado do spec 12.2 ("Em análise: o Espaço Byla vai conferir e responder em breve." / "Recusado: <motivo>. Ajuste e envie de novo." / "Aprovado e à venda."); botão "Enviar para aprovação" com a lista do que falta (capa, sessão futura, preços) antes de chamar; Vendas por sessão (vendidos, disponíveis, "Pausar vendas"/"Reabrir vendas"), lidas por `event_sessions_summary` com o cliente `service_role` **depois** de `requireEventAccess`. `lockedFields` por sessão = `lockedFieldsFor(status, sessão tem venda)`, com "tem venda" vindo do mesmo resumo.

- [ ] **Step 4: Rodar e ver passar** — PASS; `npx vitest run` inteiro.

- [ ] **Step 5: Commit**

```powershell
git add src/app/organizador/eventos/actions.ts src/app/organizador/eventos/novo "src/app/organizador/eventos/[id]/page.tsx" src/components/organizer/ApprovalBanner.tsx src/components/organizer/RequestChangeDialog.tsx src/components/organizer/OrganizerSalesPanel.tsx src/components/equipe/EventForm.tsx tests/organizer/event-actions.test.ts tests/organizer/event-form-locks.test.ts
git commit -m "feat(organizador): criar e editar evento, enviar para aprovacao, vendas e pedir mudanca"
```

### Task 12: Painel da equipe — Organizadores (pedidos do site, convites, contas)

**Files:**
- Create: `src/app/equipe/organizadores/page.tsx`, `src/app/equipe/organizadores/actions.ts`, `src/components/equipe/InviteCreatedDialog.tsx`
- Modify: `src/app/equipe/layout.tsx`
- Test: `tests/equipe/organizer-admin-actions.test.ts`

**Interfaces:**
- Produces: `createInvite(input: { label: string; requestId?: string | null }): Promise<ActionResult<{ link: string; whatsappUrl: string; expiresAt: string }>>`; `revokeInvite(inviteId: string)`; `archiveSignupRequest(requestId: string)`; `setOrganizerStatus(userId: string, status: "ativo" | "suspenso" | "encerrado", reason: string)`; `forgetAccountDevices(userId: string)`; `createPasswordResetLink(userId: string): Promise<ActionResult<{ link: string; whatsappUrl: string; expiresAt: string }>>` — todas com `requireTeamAdmin()` dentro.

- [ ] **Step 1: Testes (falham)**

Secretaria e organizador recusados em todas; `createInvite` gera o token no servidor (`newInviteToken`), manda **só o hash** ao banco, devolve o link com `NEXT_PUBLIC_APP_URL` uma única vez (o teste confere que nenhum `console.*` recebe o token); apelido até 80; `ORG_LIMITE` → `RATE_LIMIT_MESSAGE`; `setOrganizerStatus("suspenso")` sem motivo → erro; ao suspender, chama `notifyOrganizer(userId, "org_conta_suspensa", ...)`; IDs inválidos recusados sem chamar o banco.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/equipe/organizer-admin-actions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar.** Página com abas "Pedidos do site" (Nova/Convidada/Arquivada; "Gerar convite" ligado ao pedido; "Arquivar"), "Convites" ("Gerar convite" com apelido e o aviso "Não coloque dados pessoais no apelido."; diálogo com o link, "Copiar link" e "Enviar pelo WhatsApp", e o aviso "Este link aparece só agora. Se perder, revogue e gere outro."; lista "Ativo até dd/mm", "Usado em dd/mm por <nome público>", "Vencido", "Revogado" com "Revogar") e "Contas" (status, eventos, "Suspender"/"Reativar" com motivo, "Esquecer aparelhos lembrados", "Link para nova senha", chave PIX e documento só mascarados). Faixa no topo quando a área está desligada: "A área do organizador está desligada: convites gerados agora só funcionam depois que ela for ligada." Menu do Admin: Eventos · Aprovações (n) · Organizadores · Taxa de serviço · Segurança; secretaria: Eventos · Segurança. Números do menu por `team_pending_counts` (falha = sem número).

- [ ] **Step 4: Rodar e ver passar** — PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/app/equipe/organizadores src/components/equipe/InviteCreatedDialog.tsx src/app/equipe/layout.tsx tests/equipe/organizer-admin-actions.test.ts
git commit -m "feat(equipe): organizadores - pedidos do site, convites e contas"
```

### Task 13: Painel da equipe — Aprovações e selos nos eventos

**Files:**
- Create: `src/app/equipe/aprovacoes/page.tsx`, `src/app/equipe/aprovacoes/actions.ts`, `src/components/equipe/ApprovalCard.tsx`, `src/components/equipe/OpsRequestCard.tsx`
- Modify: `src/app/equipe/page.tsx`, `src/app/equipe/eventos/[id]/page.tsx`, `src/components/equipe/TicketList.tsx`
- Test: `tests/equipe/approval-actions.test.ts`, `tests/equipe/event-producer-badges.test.ts`

**Interfaces:**
- Produces: `decideEventApproval(eventId: string, input: { decision: "aprovar" | "recusar"; publish: boolean; note: string }): Promise<ActionResult>` (Admin); `finishEventChange(requestId: string)` (Admin); `finishEventDeletion(requestId: string)` (Admin); `declineOpsRequest(requestId: string, note: string)` (equipe; o banco exige Admin para mudança/exclusão).

- [ ] **Step 1: Testes (falham)**

`decideEventApproval`: secretaria → "Acesso não permitido."; recusar sem nota (5–500) → erro; sucesso avisa o organizador (`org_evento_aprovado`/`org_evento_recusado` com a nota) e revalida `/`, `/eventos/<slug>`, `/equipe/aprovacoes`, `/organizador/eventos/<id>`. `declineOpsRequest`: secretaria pode recusar estorno; banco `ORG_ACESSO` em mudança → "Acesso não permitido."; avisa o organizador (`org_pedido_respondido`). Selos: a lista da equipe mostra "Organizador: <nome público>" e o estado (Rascunho/Em análise/Recusado) nos eventos de organizador e esconde excluídos (`deleted_at`); a página do evento mostra a faixa "1 pedido de estorno solicitado pelo organizador" e, no pedido, "Estorno pedido pelo organizador: <motivo>".

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/equipe/approval-actions.test.ts tests/equipe/event-producer-badges.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar.** Abas "Eventos" (cards com capa, nome, local, sessões e horários, lotação, preços por tipo — inteira e meia lado a lado para conferir "metade da inteira" —, descrição, nome público que vai aparecer como "Produção", lista de conferência do spec 5.4 com caixas de marcar só visuais, botões "Aprovar e publicar" / "Aprovar sem publicar" / "Recusar" com motivo obrigatório), "Mudanças" (o que o organizador pediu, motivo, link "Abrir evento" para aplicar pelo editor normal, "Marcar como feito", "Recusar") e "Exclusões" (motivo, quantos pedidos pagos, link para o painel de sessões do evento onde está "Cancelar sessão" e "Estornar todos", "Concluir exclusão" habilitado só quando todas as sessões estão canceladas, "Recusar"). Nomes de organizador por `event_producer_names` com o cliente `service_role` depois de `requireStaffUser`.

- [ ] **Step 4: Rodar e ver passar** — PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/app/equipe/aprovacoes src/components/equipe/ApprovalCard.tsx src/components/equipe/OpsRequestCard.tsx src/app/equipe/page.tsx "src/app/equipe/eventos/[id]/page.tsx" src/components/equipe/TicketList.tsx tests/equipe/approval-actions.test.ts tests/equipe/event-producer-badges.test.ts
git commit -m "feat(equipe): aprovacoes de eventos, mudancas e exclusoes de organizadores"
```

### Task 14: Pedidos do organizador, pedir estorno, exclusão e portaria

**Files:**
- Create: `src/app/organizador/eventos/order-actions.ts`, `src/app/organizador/eventos/[id]/portaria/page.tsx`, `src/components/organizer/OrganizerOrderList.tsx`, `src/components/organizer/RequestRefundDialog.tsx`, `src/components/organizer/DeleteEventSection.tsx`, `src/components/organizer/OpsRequestList.tsx`
- Modify: `src/app/organizador/eventos/actions.ts` (exclusão), `src/app/api/check-in/route.ts`, `src/app/equipe/eventos/order-actions.ts` (aviso ao organizador quando a equipe estorna um pedido com estorno pedido)
- Test: `tests/organizer/order-actions.test.ts`, `tests/organizer/delete-event-actions.test.ts`, `tests/api/check-in-route.test.ts`, `tests/equipe/order-actions.test.ts`

**Interfaces:**
- Produces: `requestOrderRefund(orderId: string, reason: string): Promise<ActionResult>` (`requireOrganizer` + banco confere o dono pelo pedido); `cancelOpsRequest(requestId: string)`; `deleteOwnEvent(eventId: string, confirmName: string): Promise<ActionResult<{ mode: "apagado" | "excluido" }>>`; `requestEventDeletion(eventId: string, reason: string)`.

- [ ] **Step 1: Testes (falham)**

`requestOrderRefund`: anônimo e equipe recusados; ID inválido; motivo 5–500; `ORG_DONO` → "Evento não encontrado."; `ORG_ESTADO:check_in` → mensagem da Task 4; sucesso avisa a equipe. `deleteOwnEvent`: `requireEventAccess` como dono (equipe recusada nesta ação), lê capa e caminhos da galeria **antes** e, só em `apagado`, remove os arquivos com `removeMediaObjects`; `com_vendas` → "Este evento já teve vendas. Use “Pedir exclusão”."; sucesso redireciona para `/organizador`. `requestEventDeletion`: avisa a equipe. Lista de pedidos: renderiza Nº (`orderNumber`), nome, e-mail, sessão, itens, situação ("Pago", "Estornado", "Pago sem vaga — a equipe vai decidir", "Cortesia"), "2 de 3 já entraram", "Pedir estorno" (não aparece em cortesia, estornado ou com entrada), aviso "Use estes dados só para a operação deste evento (Termos do organizador, item 9)."; **nunca** recebe telefone, link do pedido ou código do ingresso (o tipo das props nem tem esses campos). `/api/check-in`: organizador verificado no próprio evento → 200 com `ok`; banco devolvendo `evento_errado` sem nome → "Ingresso de outro evento"; organizador em evento alheio (`CHECKIN_EQUIPE`) → 403. `refundOrder` da equipe (spec 5.5, item 5): depois de um estorno concluído, se havia pedido de estorno do organizador para aquele pedido (o gatilho já o fechou como `atendido`), chama `notifyOrganizer(<dono>, "org_pedido_respondido", { outcome: "atendido", requestKind: "estorno", ... })`; o aviso nunca impede nem desfaz o estorno (falha só no log).

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/organizer/order-actions.test.ts tests/organizer/delete-event-actions.test.ts tests/api/check-in-route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar.** A rota de check-in não muda de regra (já exige sessão verificada; o banco decide equipe/dono); só confere que a mensagem de `evento_errado` sem nome já sai como "Ingresso de outro evento" em `checkInMessage` (ajustar se precisar). Portaria do organizador = mesma tela da equipe (`CheckInScanner`) com escolha de sessão, protegida por `requireEventAccess` na página. "Excluir evento" pede para digitar o nome; "Pedir exclusão" explica "As vendas pausam na hora e o Espaço Byla decide.".

- [ ] **Step 4: Rodar e ver passar** — PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/app/organizador/eventos/order-actions.ts src/app/organizador/eventos/actions.ts "src/app/organizador/eventos/[id]/portaria" src/components/organizer/OrganizerOrderList.tsx src/components/organizer/RequestRefundDialog.tsx src/components/organizer/DeleteEventSection.tsx src/components/organizer/OpsRequestList.tsx src/app/api/check-in/route.ts src/lib/domain/check-in.ts src/app/equipe/eventos/order-actions.ts tests/organizer/order-actions.test.ts tests/organizer/delete-event-actions.test.ts tests/api/check-in-route.test.ts tests/equipe/order-actions.test.ts
git commit -m "feat(organizador): compradores, pedir estorno, excluir evento e portaria dos proprios eventos"
```

### Task 15: "Produção: <nome>" e Segurança da equipe

**Files:**
- Modify: `src/app/eventos/[slug]/page.tsx`, `src/lib/payments/confirm-order.ts`, `src/lib/email/send-tickets.ts`, `src/lib/email/tickets-template.ts`, `src/app/api/cron/keep-alive/route.ts`
- Create: `src/app/equipe/seguranca/page.tsx`, `src/app/equipe/seguranca/actions.ts`
- Test: `tests/email/tickets-template.test.ts`, `tests/payments/confirm-order.test.ts`, `tests/public/event-producer.test.ts`, `tests/equipe/security-actions.test.ts`, `tests/api/keep-alive-route.test.ts`

**Interfaces:**
- Produces: `TicketsEmailData.producerName?: string | null`; em `src/app/equipe/seguranca/actions.ts`: `forgetMyStaffDeviceAction(deviceId: string): Promise<ActionResult>` (`requireStaffUser` + `forget_my_device` com a sessão do usuário) e `forgetStaffDevices(userId: string): Promise<ActionResult>` (`requireTeamAdmin` + `admin_forget_devices`). A tela usa o mesmo `<DevicesList />` da Task 10.

- [ ] **Step 1: Testes (falham)**

E-mail do ingresso com `producerName: "Coletivo Exemplo"` traz "Produção: Coletivo Exemplo" no HTML (escapado) e no texto; sem `producerName`, nenhuma linha "Produção". `confirmOrderPaid` busca o nome com `event_producer_names([eventId])` e falha nessa busca **não** impede o e-mail (vai sem a linha). Página do evento: com `public_event_producer` devolvendo nome, mostra "Produção: <nome>" abaixo do local; nulo, nada. Segurança: secretaria vê só "Meus aparelhos"; Admin vê também as contas da equipe com "Esquecer aparelhos" (não para a própria conta, que usa "Meus aparelhos"). Keep-alive chama `purge_organizer_records` e falha dela não derruba a resposta.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/email/tickets-template.test.ts tests/payments/confirm-order.test.ts tests/public/event-producer.test.ts tests/equipe/security-actions.test.ts tests/api/keep-alive-route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar** (texto da página de segurança: "Aparelhos lembrados não pedem código por 30 dias. Esqueça os que você não usa mais.").

- [ ] **Step 4: Rodar e ver passar** — PASS.

- [ ] **Step 5: Commit**

```powershell
git add "src/app/eventos/[slug]/page.tsx" src/lib/payments/confirm-order.ts src/lib/email/send-tickets.ts src/lib/email/tickets-template.ts src/app/api/cron/keep-alive/route.ts src/app/equipe/seguranca tests/email/tickets-template.test.ts tests/payments/confirm-order.test.ts tests/public/event-producer.test.ts tests/equipe/security-actions.test.ts tests/api/keep-alive-route.test.ts
git commit -m "feat: Producao no evento e no e-mail do ingresso, seguranca da equipe e limpeza diaria"
```

### Task 16: Termos do organizador

**Files:**
- Modify: `src/lib/legal/organizer-terms.ts` (criado na Task 9 só com a versão)
- Create: `src/app/termos-organizador/page.tsx`, `src/components/legal/OrganizerTermsText.tsx`
- Test: `tests/legal/organizer-terms-page.test.ts`

**Interfaces:**
- Produces: `ORGANIZER_TERMS_VERSION` (data da publicação, `AAAA-MM-DD`), `ORGANIZER_TERMS_UPDATED_LABEL`, `ORGANIZER_TERMS_PATH = "/termos-organizador"`, `<OrganizerTermsText />` (usado na página e no passo "Termos" do cadastro, com rolagem).

- [ ] **Step 1: Teste (falha)** — a página renderiza os 16 itens da seção 13 do spec, com `COMPANY` (razão social, CNPJ, endereço) e `PRIVACY_CONTACT_EMAIL` vindos das constantes/ambiente; percentual e mínimo da taxa vêm de `TERMS_SERVICE_FEE`; item 3 inclui "local" na lista de mudanças que dependem do Espaço (decisão **2A**); item 2 descreve o código por e-mail (decisão 9 revista), sem aplicativo; nenhum fornecedor citado (mesma lista proibida da Task 7); com a área desligada, `notFound()`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/legal/organizer-terms-page.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar** copiando o texto do spec 13 (rascunho completo) com os valores entre `{}` das constantes, no mesmo componente `LegalSection` de `/privacidade`.

- [ ] **Step 4: Rodar e ver passar** — PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/legal/organizer-terms.ts src/app/termos-organizador src/components/legal/OrganizerTermsText.tsx tests/legal/organizer-terms-page.test.ts
git commit -m "feat(legal): Termos do organizador"
```

### Task 17: Nova Política de Privacidade e novos Termos de compra

**Files:**
- Modify: `src/lib/legal/privacy.ts`, `src/app/privacidade/page.tsx`, `src/lib/legal/terms.ts`, `src/app/termos/page.tsx`
- Test: `tests/legal/privacy-page.test.ts` (novo), `tests/legal/terms-page.test.ts`

- [ ] **Step 1: Testes (falham)** — Política: versão nova (`PRIVACY_POLICY_VERSION` = data da publicação) e os 5 trechos do spec 15.1 (introdução, "No pedido para fazer um evento", "Na conta de organizador", "o organizador do evento" em "Com quem compartilhamos" dizendo que telefone, CPF e dados de pagamento nunca vão ao organizador, prazo de 6 meses dos pedidos e {5} anos da conta, segurança "sempre com verificação em duas etapas"). Termos de compra: versão nova e o parágrafo de "Quem vende" do spec 15.2. Nenhum fornecedor citado.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/legal`
Expected: FAIL.

- [ ] **Step 3: Implementar** os textos do spec 15. Pedidos novos passam a gravar as versões novas sozinhos (o checkout já envia as constantes).

- [ ] **Step 4: Rodar e ver passar** — PASS.

- [ ] **Step 5: Commit (vai ao ar junto com o resto da fase 2, Publicação passo 2; decisão 3B)**

```powershell
git add src/lib/legal/privacy.ts src/app/privacidade/page.tsx src/lib/legal/terms.ts src/app/termos/page.tsx tests/legal/privacy-page.test.ts tests/legal/terms-page.test.ts
git commit -m "feat(legal): Politica de Privacidade e Termos de compra com organizadores parceiros"
```

### Task 18: Verificação final

- [ ] **Step 1: Suíte completa e build**

```powershell
npx vitest run
npx tsc --noEmit
npx eslint
npm run build
```

Expected: tudo verde; `npm run build` sem avisos novos.

- [ ] **Step 2: Matriz do banco de novo** — `node scripts/db-tests/organizer-accounts.mjs` → 0 falhas.

- [ ] **Step 3: Conferência do spec** — percorrer as seções 4.2, 5.1–5.6, 6, 8.1–8.6 (só o que é fase 2), 12.1–12.3, 13, 14 (avisos da fase 2) e 16.3 e anotar no PR/commit qualquer item não coberto.

- [ ] **Step 4: Segredos e dados pessoais** — `git diff origin/main --stat` e busca por `@` e números com 11/14 dígitos nos arquivos novos: só `exemplo.com` e os documentos de teste públicos (`52998224725`, `11222333000181`).

Sem push, sem deploy, sem migration aplicada: tudo isso espera a Publicação.

---

## Publicação (cada passo precisa do "pode" do dono)

0. **Em paralelo:** o dono pede ao advogado/contador a leitura de 21.1 do spec (Termos do organizador, item 9 de LGPD, cláusula de devolução, documento fiscal). Não bloqueia nenhum passo desta publicação (decisão 3B); bloqueia só a aprovação do primeiro evento real de organizador (depois da fase 3). Ajustes pedidos viram nova versão dos textos.
1. **Migrations** `20261018100000_organizer_accounts.sql` e `20261018110000_organizer_operations.sql`, nessa ordem (MCP `user-supabase-eventos`, projeto Espaço Byla Eventos, fingerprint conferido e declarado no chat). A área nasce desligada; equipe e compradores não percebem nada. Logo depois, só leitura: `get_advisors` (segurança) sem alertas novos e `select enabled from public.organizer_settings` = `false`.
2. **Push** de todos os commits da fase 2 (Tarefas 1–18, inclusive os textos legais da Tarefa 17) para `origin/main` (avanço rápido) e **deploy** no Cloud Run: `gcloud builds submit --config=infra/cloudrun/cloudbuild.yaml` com as substituições `NEXT_PUBLIC_*` de sempre (gcloud em `%LOCALAPPDATA%\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd`). Nenhuma variável de ambiente nova.
3. **Conferências só de leitura** (HTTP e banco, sem o navegador compartilhado): `/quero-fazer-meu-evento`, `/convite`, `/termos-organizador` respondem 404; `/organizador/entrar` mostra "ainda não está disponível"; home e página de evento iguais a antes; `/privacidade` e `/termos` com as versões novas (data da publicação) e sem nome de fornecedor; um pedido criado depois disso grava as versões novas (`orders.privacy_policy_version`/versão dos Termos, consulta só de leitura); `/equipe` pede login como antes; `/api/check-in` sem login → 401.
4. **Teste do dono com a área ligada só para ele** (spec 17.6): "pode" → `update public.organizer_settings set enabled = true where id = 1;`. O dono, logado como Admin, gera um convite para um e-mail próprio (não da equipe), faz o cadastro no celular, entra com o código, cria um evento de teste, envia; o Admin aprova **sem publicar**; o dono confere a área, pede uma mudança, o Admin recusa; o dono exclui o evento (sem vendas → apagado). Depois, desligar de novo (`enabled = false`) até o passo 5.
5. **Ligar de vez:** "pode" → `enabled = true`. Avisar o dono da **regra de ordem**: nenhum evento real de organizador é aprovado antes da fase 3 no ar **e** da leitura do advogado/contador (passo 0).

**Voltar atrás:** `update public.organizer_settings set enabled = false where id = 1;` desliga tudo do organizador na hora (login, cadastro, pedido público, ações). As migrations não precisam ser desfeitas: com a área desligada e sem eventos de organizador, o site funciona como antes.

## Riscos

- **Mudar `save_event_with_sessions`, `save_event_sessions`, `set_session_sales_open` e `check_in_ticket` no ar:** as funções da equipe passam a usar `actor_event_access`. Mitigação: mesma assinatura, mesmo prefixo de erro para a equipe, matriz local (casos de equipe) e ensaio em produção antes de aplicar.
- **Gatilho novo em `events`:** se recusar algo que a equipe faz hoje, o painel quebra. Mitigação: a matriz cobre criar, editar, abrir/fechar vendas e esconder dos passados pela equipe; o gatilho só recusa colunas novas e `sales_open` de evento de organizador.
- **E-mail como canal do código e dos avisos:** 10 avisos/dia e o limite gratuito; o painel continua sendo o canal principal (números no menu).
- **Conta criada e perfil não gravado** (falha entre `createUser` e `accept_organizer_invite`): compensação apaga a conta; se a própria compensação falhar, fica uma conta sem perfil, que não entra em lugar nenhum (`login_code_eligible` falso). Registrar no log só o ID para o dono apagar no painel.
- **Leitura de `organizer_profiles` pelo próprio organizador** inclui o CPF/CNPJ completo (é dele); as telas mostram mascarado.
- **O primeiro evento real antes da fase 3** deixaria o organizador sem painel de dinheiro: bloqueado pela regra de ordem, não por código.
