# Código por e-mail para a equipe (fase 1 das contas de organizador) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Depois de e-mail e senha, a equipe digita um código de 6 dígitos recebido por e-mail (vale 10 minutos) para entrar no painel; o aparelho pode ser lembrado por 30 dias. Compradores não mudam. Custo zero.

**Architecture:** A verificação fica presa à **sessão** do Supabase (`session_id` do token). Três tabelas sem nenhuma política RLS (`login_email_codes`, `verified_sessions`, `trusted_devices`) só são tocadas por funções `security definer`. `is_staff()` e `is_admin()` passam a exigir `session_is_verified()`, então **toda** política RLS e todo helper do servidor que já usa `is_staff()` passa a exigir o código sem mudar uma linha. O `proxy` só redireciona (conforto); a segurança é o banco.

**Tech Stack:** Next.js 16.3.8 (App Router, Server Actions, `cookies()`), Supabase Postgres + RLS, serviço de e-mail já usado (Resend), Vitest.

Spec: `docs/superpowers/specs/2026-10-13-contas-organizador-design.md`, decisão 9 (revista em 2026-10-14) e seção 11.

## Global Constraints

- Banco: **somente** MCP `user-supabase-eventos`, projeto **Espaço Byla Eventos** (`rlzyjlrcasqbjztgbgit`). Conferir `events`, `tickets`, `orders`, `ticket_types`, `staff_profiles` e ausência de `alunos`/`transacoes`/`fluxo_*` antes de qualquer SQL.
- Nesta entrega o agente **não aplica** migration, **não faz push** e **não publica**. Ensaios no banco só em uma única chamada que termina com exceção (desfaz tudo), conferindo depois que nada ficou.
- Tabelas novas: RLS ligada, `revoke all` de `public, anon, authenticated, service_role`, nenhuma política. Funções: `set search_path = ''`, `revoke all ... from public, anon, authenticated`, `grant execute` mínimo.
- Só hashes no banco: código = `sha256(sal || ':' || código)` com sal aleatório por linha; aparelho = `sha256(token)` (token de 32 bytes).
- Erros ao usuário genéricos; logs sem código, token ou e-mail.
- Sem dependência nova (`node:crypto` para código e token).
- Commits com `git add <arquivos>` explícitos.

## Decisões de desenho (e por quê)

1. **Verificação por sessão, não por usuário.** O token do Supabase traz `session_id`; `verified_sessions` guarda essa sessão. Outra sessão (outro aparelho, outro login) nunca herda a verificação. A função ainda confere que a sessão existe em `auth.sessions` (sair, trocar a senha ou o dono derrubar sessões no painel invalida na hora).
2. **Duas migrations em vez de uma** (melhoria sobre a sugestão inicial). `20261017100000_staff_email_code.sql` só cria tabelas e funções (o site no ar não percebe); `20261017110000_staff_email_code_enforce.sql` troca `is_staff()`/`is_admin()`. Ordem: migration 1 → deploy → migration 2. Com uma migration só, haveria minutos em que o código antigo (sem tela de código) rodaria com o banco exigindo verificação, trancando a equipe; ou o código novo chamaria funções que ainda não existem.
3. **Comparação do código dentro do banco** (em vez de comparar no Node com `timingSafeEqual`). O banco compara dois hashes SHA-256 com sal secreto por linha (o sal nunca sai do banco); diferença de tempo na comparação não revela nada sobre o código, porque quem tenta não consegue calcular o hash do palpite. Ganho: tentativa, contagem e invalidação na mesma transação com `for update` (duas tentativas ao mesmo tempo não passam do limite de 5). Sem segredo novo de ambiente (um "pepper" em variável de ambiente seria mais um passo de deploy e, se faltasse, trancaria a equipe).
4. **Quem chama o quê.**
   - `issue_login_code` (gera a linha do código) é **só `service_role`**: se fosse chamável com a sessão do usuário, quem tem só a senha poderia escolher o próprio código. O servidor gera o código (`crypto.randomInt`), pega `user_id` e `session_id` de `login_session_state()` (lidos do token **conferido pelo banco**) e só então chama com a `service_role`.
   - `verify_login_code`, `verify_session_with_device`, `login_session_state`, `end_login_verification` são chamadas **com a sessão do usuário**: o banco tira usuário e sessão do token, nunca de parâmetros.
5. **Limites dentro do banco** (`issue_login_code` chama `consume_rate_limit`): espera de 60 s entre códigos da mesma conta; 5 códigos por hora e 10 por dia por conta; 40 por dia somando o site inteiro. Cada código: 5 tentativas, depois invalida.
6. **Validade da sessão verificada:** 30 dias com "Lembrar este aparelho" (no máximo até o aparelho vencer); 12 horas sem (computador compartilhado). Aparelho lembrado: 30 dias fixos a partir do código, até 10 aparelhos ativos por conta (o mais antigo é esquecido).
7. **Cookie do aparelho:** `byla_equipe_aparelho`, `httpOnly`, `Secure` em produção, `SameSite=Lax`, `path=/equipe`, 30 dias, valor = token aleatório de 32 bytes (base64url). Um cookie por navegador; se outra conta da equipe usar o mesmo navegador, ela recebe código e, ao marcar "lembrar", passa a ser a conta lembrada ali.
8. **E-mail do código fura o teto dos avisos, não o dos ingressos.** Avisos de sessão param em 80/dia para sobrar espaço aos ingressos; o código de acesso é raro (2 contas, quase sempre aparelho lembrado), limitado a 40/dia no site, e sem ele ninguém entra. Então ele **sempre tenta enviar** e registra no log quando o uso do dia passa de 90. Se o serviço recusar por limite diário, a tela diz que não deu para enviar agora; quem tem aparelho lembrado continua entrando.
9. **Sem tela "Meus aparelhos" nesta fase** (vem com a área do organizador). Esquecer aparelhos: SQL do dono (abaixo).
10. **Reaproveitável para organizador:** tabelas e funções são por usuário; quem pode usar o código é decidido em `login_code_eligible(user_id)` (hoje: está em `staff_profiles`; fase 2: ou organizador ativo).

## Inventário do que passa a exigir o código

**Banco (conferido em produção, só leitura, 2026-10-14):** `is_staff()` (`search_path=public`, executável por `anon`/`authenticated`, usada em políticas) e `is_admin()` são as **únicas** funções que usam `auth.uid()`; nenhuma usa `auth.jwt()`. Políticas que usam `is_staff()`: `events_public_read`, `events_staff_write`, `event_images_public_read`, `event_sessions_public_read`, `session_ticket_types_public_read`, `ticket_types_public_read`, `staff_profiles_self` (também `user_id = auth.uid()`, a pessoa continua lendo a própria linha), `orders_staff_read`, `order_items_staff_read`, `tickets_staff_read`, `order_refunds_staff_read`, `session_audit_log_staff_read`, `session_notices_staff_read`, `session_notice_deliveries_staff_read`, `session_refund_batches_staff_read`, `session_refund_batch_items_staff_read`, `session_schedule_changes_staff_read`. Nenhuma política do Storage usa `is_staff()`. As funções `service_role` (`check_in_ticket`, `save_event_with_sessions`, `begin_order_refund`, `staff_finance_role`, `assert_finance_admin`…) recebem `p_staff_user_id` e conferem `staff_profiles`: não enxergam a sessão, por isso o servidor chama `is_staff()` com a sessão do usuário antes delas (já é assim em `requireStaffUser`, `assertStaff`, `getFinanceAccess`). Chamadas com `service_role` não têm token: `is_staff()` dá falso, mas a `service_role` ignora RLS e nenhuma função `service_role` chama `is_staff()`, então nada quebra.

**Servidor:** `requireStaffUser`, `assertStaff`, `getFinanceAccess`/`requireFinanceAdmin` e `/equipe/eventos/[id]` já usam `is_staff()`. **Brecha encontrada:** `/api/check-in` (fora do `proxy`) conferia só a linha em `staff_profiles`; passa a usar `is_staff()`. `src/proxy.ts`, `src/app/equipe/layout.tsx` e a tela de login liam `staff_profiles` direto; passam a usar `login_session_state()`. `/pedidos/[publicToken]` usava `staff_profiles` só para o link "Voltar ao gerenciamento"; passa a usar `is_staff()`.

## File Structure

| Arquivo | Responsabilidade |
| --- | --- |
| `supabase/migrations/20261017100000_staff_email_code.sql` (novo) | Tabelas, funções de código/aparelho/estado/limpeza |
| `supabase/migrations/20261017110000_staff_email_code_enforce.sql` (novo) | `is_staff()`/`is_admin()` exigem sessão verificada |
| `supabase/tests/staff_email_code_check.sql` (novo) | Ensaio em transação desfeita |
| `src/types/database.ts` | Tipos das funções novas |
| `src/lib/auth/login-code.ts` (novo) | Regras puras: gerar código, normalizar entrada, mascarar e-mail, nome do aparelho, constantes, mensagens |
| `src/lib/email/login-code-template.ts` (novo) | Texto do e-mail |
| `src/lib/email/send-login-code.ts` (novo) | Envio (limite diário, tempo máximo, log sem dados) |
| `src/lib/auth/login-verification.ts` (novo, `server-only`) | Ler estado, enviar código, conferir código, aparelho lembrado, sair |
| `src/app/equipe/verificar/actions.ts` (novo) | Server Actions: começar, reenviar, conferir, sair |
| `src/app/equipe/verificar/page.tsx` + `src/components/equipe/LoginCodeForm.tsx` (novos) | Tela do código |
| `src/app/equipe/login/page.tsx` | Depois da senha chama `startLoginVerification` |
| `src/app/equipe/layout.tsx` | Sem menu em `/equipe/verificar`; exige sessão verificada; "Sair" apaga a verificação |
| `src/proxy.ts` | Redireciona para `/equipe/verificar` |
| `src/app/api/check-in/route.ts` | `is_staff()` |
| `src/app/pedidos/[publicToken]/page.tsx` | `is_staff()` para o link de volta |
| `src/app/api/cron/keep-alive/route.ts` | Limpeza diária (`purge_login_verification`), sem derrubar o keep-alive se falhar |

---

### Task 1: Migrations e ensaio

**Files:** as duas migrations, `supabase/tests/staff_email_code_check.sql`, `tests/db/staff-email-code-migration.test.ts`.

**Interfaces (banco):**
- `login_session_state() returns table(status text, user_id uuid, session_id uuid, code_expires_at timestamptz, resend_at timestamptz)` — `authenticated`. `status`: `fora` | `pendente` | `verificado`.
- `issue_login_code(p_user_id uuid, p_session_id uuid, p_code text) returns text` — `service_role`. `ok` | `aguarde` | `limite` | `verificado` | `recusado`.
- `verify_login_code(p_code text, p_device_token text default null, p_device_label text default null) returns text` — `authenticated`. `ok` | `invalido` | `expirado` | `bloqueado` | `verificado` | `fora`.
- `verify_session_with_device(p_device_token text) returns boolean` — `authenticated`.
- `end_login_verification() returns void` — `authenticated`.
- `purge_login_verification() returns integer` — `service_role`.
- `session_is_verified() returns boolean` — `authenticated`, `service_role`.

- [ ] Teste estático (Vitest) que lê as migrations: RLS ligada nas 3 tabelas, `revoke all` das tabelas, nenhuma `create policy`, `search_path = ''` em toda função, `issue_login_code`/`purge_login_verification` só `service_role`, enforce troca `is_staff` e `is_admin` chamando `session_is_verified()`. Rodar e ver falhar.
- [ ] Escrever as migrations; rodar o teste e ver passar.
- [ ] Ensaio no banco (uma chamada `execute_sql`, termina em `raise exception`): aplicar as duas migrations; com claims simuladas de uma conta da equipe e uma sessão real dela, conferir `is_staff()` falso antes e verdadeiro depois de `issue_login_code` + `verify_login_code`; código errado 5 vezes bloqueia; aparelho lembrado verifica outra sessão; `anon` não lê as tabelas; `service_role` continua funcionando. Depois, consulta só de leitura confirmando que tabelas e funções novas **não** existem.

### Task 2: Regras puras (`src/lib/auth/login-code.ts`)

- [ ] Testes (`tests/auth/login-code.test.ts`): `generateLoginCode()` sempre 6 dígitos (zeros à esquerda); `normalizeLoginCode(" 12 34-56 ")` → `"123456"`, rejeita letras/5 ou 7 dígitos; `maskEmail("levi@gmail.com")` → `"le***@gm***.com"` (e casos curtos/sem ponto); `deviceLabel(userAgent)` → `"Chrome no Android"`, `"Safari no iPhone"`, `"Navegador"` quando desconhecido, máximo 60; `newDeviceToken()` com 43 caracteres base64url. Ver falhar → implementar → passar.

### Task 3: E-mail do código

- [ ] Testes (`tests/email/login-code-email.test.ts`): assunto **sem** o código; corpo com o código, "10 minutos", "se não foi você, troque sua senha"; sem nomes de fornecedores; envio devolve `quota` em 429 de limite diário, `failed` em erro, `skipped` sem configuração; log nunca contém código nem e-mail.
- [ ] Implementar `login-code-template.ts` e `send-login-code.ts` (mesmo padrão de `send-session-notice.ts`).

### Task 4: Serviço de verificação (`src/lib/auth/login-verification.ts`)

- [ ] Testes (`tests/auth/login-verification.test.ts`, Supabase e e-mail simulados): `startLoginVerification` → `/equipe` se já verificado; usa aparelho lembrado antes de mandar e-mail; manda código e vai para `/equipe/verificar`; não reenviar se já há código válido; `fora` → erro genérico. `resendLoginCode` traduz `aguarde`/`limite`. `submitLoginCode` normaliza, traduz cada status, grava cookie só com "lembrar" e só em `ok`, nunca grava cookie em erro. `signOutTeam` chama `end_login_verification` antes de sair.
- [ ] Implementar.

### Task 5: Telas, proxy, layout, check-in, limpeza

- [ ] Testes: `tests/proxy-staff-gate.test.ts` (rotas × estados `fora`/`pendente`/`verificado`); `tests/api/check-in-route.test.ts` passa a esperar `is_staff` (sessão não verificada → 403); keep-alive chama `purge_login_verification` e falha dela não derruba a resposta; tela do código renderiza e-mail mascarado, `inputMode="numeric"`, `autoComplete="one-time-code"`, caixa marcada por padrão, "Reenviar código", "Sair".
- [ ] Implementar `/equipe/verificar`, `LoginCodeForm`, mudanças em login, layout, proxy, check-in, pedidos, keep-alive.

### Task 6: Verificação final

```powershell
npx vitest run
npx tsc --noEmit
npx eslint
npm run build
```

Commit local com arquivos explícitos. Sem push, sem deploy, sem migration aplicada.

---

## Publicação (cada passo precisa do "pode" do dono)

0. **Pré-requisito:** as duas contas da equipe (Admin do Espaço e Admin desenvolvedor) usam e-mails que as pessoas abrem de verdade (o dono confere no painel do Supabase → Authentication → Users). Fazer fora de horário de evento.
1. **Migration 1** `staff_email_code` (MCP `user-supabase-eventos`, fingerprint conferido). Nada muda no site.
2. **Push** para `origin/main` e **deploy** no Cloud Run (`gcloud builds submit --config=infra/cloudrun/cloudbuild.yaml`). A partir daqui, entrar no painel pede o código.
3. Cada conta entra e confirma que o código chega e funciona (marcar "Lembrar este aparelho").
4. **Migration 2** `staff_email_code_enforce`: o banco passa a exigir a verificação. Conferir de novo que o painel abre normalmente.
5. Conferências só de leitura: `get_advisors` (segurança) sem alertas novos; `/api/check-in` responde 401/403 sem login.

**Voltar atrás (se algo der errado depois do passo 4):** reaplicar as definições antigas de `is_staff()`/`is_admin()` (estão nas migrations `20260917120000_init.sql` e `20261013100000_service_fee.sql`) — com "pode" do dono.

## Emergência: e-mail não chega e ninguém consegue entrar

Não existe chave de ambiente para desligar a verificação (seria uma porta dos fundos). O dono, logado no painel do Supabase (projeto **Espaço Byla Eventos**):

1. Entra no site com e-mail e senha normalmente (para o site criar a sessão) e para na tela do código.
2. No Supabase → **SQL Editor**, roda (trocando o e-mail):

```sql
insert into public.verified_sessions (session_id, user_id, method, expires_at)
select s.id, s.user_id, 'emergencia', now() + interval '12 hours'
from auth.sessions s
join auth.users u on u.id = s.user_id
where u.email = 'EMAIL_DA_CONTA_AQUI'
order by s.created_at desc
limit 1
on conflict (session_id) do update
  set expires_at = excluded.expires_at, method = excluded.method, verified_at = now();
```

3. Volta ao site e recarrega a página: o painel abre por 12 horas.

**Esquecer todos os aparelhos lembrados de uma conta** (ex.: celular perdido):

```sql
update public.trusted_devices set revoked_at = now()
where revoked_at is null
  and user_id = (select id from auth.users where email = 'EMAIL_DA_CONTA_AQUI');
delete from public.verified_sessions
where user_id = (select id from auth.users where email = 'EMAIL_DA_CONTA_AQUI');
```

## Riscos

- **E-mail fora do ar ou limite diário estourado:** só quem está em aparelho lembrado entra; o resto usa o procedimento de emergência.
- **Código por e-mail é mais fraco que aplicativo:** quem invadir o e-mail e souber a senha entra. Aceito pelo dono pela simplicidade; mitigado por senha forte e aparelho lembrado só em aparelho próprio.
- **Cookie do aparelho roubado** (ex.: vírus no computador) pula o código, mas ainda exige a senha. Mitigação: `httpOnly`, 30 dias, SQL para esquecer.
- **Janela entre deploy e migration 2:** por minutos, o banco ainda aceita sessão não verificada em chamadas diretas às Server Actions (as telas já pedem o código). Por isso a migration 2 vem logo depois.
