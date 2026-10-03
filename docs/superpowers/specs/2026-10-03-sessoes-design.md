# Sessões dentro do evento — design

Data: 2026-10-03 · Status: **PRONTA PARA APROVAÇÃO (v4) — ainda não aprovada.** Todas as decisões do dono estão na seção 2; nenhuma dúvida bloqueia a implementação (a decisão 14 foi adiada de propósito, seção 17) · Base: código em `origin/feat/mvp` (`91efe7a`), que já inclui o check-in pela função do banco `check_in_ticket`, a equipe só lendo `tickets`/`orders` e o lembrete de compra não finalizada. Migrations até `20261010110000_abandoned_reminders_schedule.sql`.

Legenda: **[V]** verificado em código ou na central de ajuda oficial · **[S]** suposição, a confirmar · **[R]** recomendação desta spec.

Ponto de partida (dono, 2026-10-03): um evento pode ter **mais de uma sessão** (ex.: 19h e 20h30), modeladas **dentro do evento**. A maioria dos eventos continua com sessão única, e cada sessão vende no máximo cerca de 100 ingressos.

## Resumo executivo

- **O que muda:** um evento pode ter várias sessões (ex.: 19h e 20h30). Cada sessão tem a sua lotação, as suas cotas e os seus preços. Os eventos de hoje viram eventos de 1 sessão, sem perder nada.
- **Comprador:** escolhe a sessão primeiro e vê essa escolha em todos os passos (checkout, pagamento, ingresso, e-mail). Uma sessão por compra. Na home, cada evento mostra as sessões em botõezinhos.
- **Portaria:** ingresso de outra sessão é recusado, e ingresso de sessão cancelada também.
- **Venda:** fecha sozinha 5 minutos depois do início de cada sessão; a equipe pode fechar antes.
- **Mudou o horário:** a equipe avisa todos os compradores por e-mail com um botão.
- **Cancelar sessão:** não apaga nada e não devolve dinheiro sozinho. A equipe estorna um por um ou "todos de uma vez", com confirmação forte, e cada comprador recebe e-mail.
- **E-mails:** respeitam o limite grátis de 100 por dia; se acabar, o resto sai sozinho quando o limite renova (21h), com botão de reserva.
- **Ingresso:** mostra evento, sessão (nome, se houver), data e horário da sessão, local, titular, tipo, QR, código, número do pedido e status — na página, no PDF, no e-mail e na portaria (seção 8.4).
- **Prazo:** 14 a 21 dias de trabalho no total. Para vender um evento de 2 sessões bastam as fases 1 a 4 (8,5 a 12,5 dias). A ordem considera o redesign mobile-first (seção 16).

---

## 1. Objetivo

1. A equipe cria um evento com uma ou várias sessões (data, horário, nome opcional), cada uma com lotação, cotas e **preços próprios**, e controla a venda de cada sessão.
2. O comprador escolhe a sessão antes dos ingressos, de forma muito clara, e vê essa escolha repetida no resumo, no pagamento, no ingresso e no e-mail. Evento de sessão única continua parecido com o de hoje.
3. Cada ingresso pertence a uma sessão: lotação, check-in, e-mail, PDF e página do pedido mostram a sessão certa.
4. A venda de cada sessão fecha sozinha 5 minutos depois do início.
5. Mudou o horário de uma sessão com vendas: a equipe avisa todos os compradores por e-mail com um botão.
6. A equipe pode cancelar uma sessão com vendas (sem apagar nada) e depois estornar os pedidos um a um ou todos de uma vez, com segurança e e-mail para cada comprador.
7. Os eventos atuais viram eventos de 1 sessão, com os preços atuais, sem perder nenhum dado.

### Fora de escopo

- **Passe para várias sessões** (um ingresso que entra em mais de uma sessão) e pacotes entre sessões.
- **Sessões recorrentes automáticas** (ex.: "toda sexta às 20h por 2 meses"). A equipe adiciona as sessões; cada nova sessão copia a anterior.
- **Duplicar o evento inteiro.**
- **Várias sessões no mesmo pedido** (decisão 5).
- Visual final: é da frente mobile-first. Esta spec define comportamento, estrutura das telas e textos; a interface usa os componentes e tokens existentes.

---

## 2. Decisões do dono (2026-10-03)

| # | Tema | Decisão |
| --- | --- | --- |
| 1 | Lotação | **A** — cada sessão tem a sua própria lotação. |
| 2 | Tipos e preços | **B** — **cada sessão pode ter preços diferentes** (mudança em relação à recomendação do rascunho). Modelo na seção 5. |
| 3 | Cotas inteira/meia | **A** — por sessão, copiadas da sessão anterior. |
| 4 | Limite de cada tipo | **A** — vale por sessão. |
| 5 | Sessões por compra | **A** — uma sessão por compra. Motivo: não confundir o cliente, para ele não comprar sem querer numa sessão que não queria. A sessão escolhida aparece de forma clara e repetida no resumo, checkout, pagamento, ingresso e e-mail. |
| 6 | Fim da venda | A venda da sessão **fecha automaticamente 5 minutos depois do horário de início**. A equipe também pode encerrar antes (botão por sessão). Vale para todo evento, inclusive de sessão única (todo evento tem pelo menos 1 sessão). Regras para reservas e PIX em andamento na seção 7. |
| 7 | Portaria | **A** — ingresso de outra sessão é recusado, como já acontece com ingresso de outro evento, com mensagem dizendo qual é a sessão certa. |
| 8 | Término | **A** — horário de término opcional. |
| 9 | Sessão com vendas | **D** (2026-10-03 20:09, mistura de A e C): a equipe pode **cancelar a sessão**, mas o cancelamento **não devolve o dinheiro sozinho**. Depois, a equipe estorna **um por um** ou **todos de uma vez** por um botão. No um por um, cada comprador recebe um e-mail automático ao ser estornado; no "todos de uma vez", cada comprador recebe o seu. Exige muita atenção: é como apagar e mexe com dinheiro. Seção 9.4. |
| 10 | Mudar horário com vendas | **A + novo:** aviso na tela **e** botão para **enviar automaticamente** um e-mail de alteração de horário a todos os compradores pagos daquela sessão (seção 10). |
| 11 | Home | Um card por evento, com as **sessões destacadas no card** (chips com data e horário, "Esgotada" riscada, "+2" quando forem muitas). Seção 12. |
| 12 | Nome da sessão | **B** — nome opcional (ex.: "Sessão infantil"), mostrado junto do horário. |
| 13 | E-mail na hora do cancelamento | **Sim** (2026-10-03 20:15): caixa "Avisar os compradores por e-mail agora" **já marcada**; a equipe pode desmarcar. Texto: a sessão foi cancelada e o valor será devolvido. Mesmo controle do limite diário (sai depois se estourar). Seção 9.4.5. |
| 14 | Reembolso para quem não pode ir no novo horário | **Adiada** (2026-10-03 20:15: "ainda não pode ser confirmado"). O e-mail de mudança de horário **não promete reembolso**: texto neutro, com "Em caso de dúvidas, responda este e-mail". A equipe continua podendo estornar caso a caso pelo botão que já existe. Não bloqueia a implementação; será decidida junto com os **Termos de compra** (pendentes). Seções 10.5 e 17. |
| 15 | Envio que para no limite diário | **Sim** (2026-10-03 20:15): continua **sozinho** quando o limite renova, com botão **"Continuar envio"** de reserva. Depende do agendador (`pg_cron` + `pg_net`) estar ligado: item do plano de ativação (seção 16.4). Vale para aviso de horário, aviso de cancelamento e e-mails de estorno. |
| 16 | Conteúdo do ingresso | (2026-10-03 20:18) "No ingresso deve informar a sessão e o horário, além de todas as outras informações." Vale para página do pedido, PDF, e-mail de ingressos e "Pode entrar" da portaria. Lista completa na seção 8.4. |

---

## 3. Benchmark verificado (Sympla, Shotgun e limites do e-mail)

Fontes: centrais de ajuda e páginas oficiais. O que não encontrei está marcado como "não encontrado".

### Sympla

- **Produto padrão (presencial):** não encontrei recurso de "sessões". Para várias datas ou horários, a orientação é **agrupar os tipos de ingresso** ("Dia 1", "Dia 2", turnos); o comprador vê os grupos na página do evento; depois da primeira venda o grupo não pode ser renomeado nem excluído. [V] [Agrupamento de ingressos](https://ajuda.produtor.sympla.com.br/hc/pt-br/articles/43163984100877-Como-funciona-o-agrupamento-de-ingressos) · [Grupos de ingressos](https://produtores.sympla.com.br/funcionalidades/grupos-de-ingressos/)
  - Na prática, cada "sessão" é um conjunto próprio de tipos, com preço e quantidade próprios.
- **Portaria:** o app do organizador tem "Limitar check-in"; o ingresso de outro tipo aparece como "Entrada limitada". Recomendado para "múltiplos dias de programação". [V] [App Sympla Organizador — Android](https://ajuda.produtor.sympla.com.br/hc/pt-br/articles/15445887306509-Como-utilizar-o-aplicativo-Sympla-Organizador-Android)
- **Mudança de data:** a Sympla orienta editar a data, avisar os participantes pelo menu "Participantes → Enviar e-mail" e oferecer reembolso: "Este tipo de modificação dá direito aos seus compradores de pedir o reembolso". [V] [Meu evento foi adiado](https://ajuda.produtor.sympla.com.br/hc/pt-br/articles/15446175027853-Meu-evento-foi-adiado-O-que-devo-fazer)
- **Sympla Bileto (produto à parte, com contrato):** "Apresentações" (data e horário) dentro do evento, "Grades" de preço importáveis de outra grade (com setores e cotas), bloqueios por apresentação e pacotes entre apresentações. [V] [O que é Sympla Bileto](https://ajuda.produtor.sympla.com.br/hc/pt-br/articles/15444829742349-O-Que-%C3%A9-Sympla-Bileto-e-Como-Funciona) · [Apresentações](https://suporte-bileto-sympla.zendesk.com/hc/pt-br/articles/360047059612-7-APRESENTA%C3%87%C3%95ES) · [Grades](https://suporte-bileto-sympla.zendesk.com/hc/pt-br/articles/360047488531-5-GRADES) · [Pacotes](https://suporte-bileto-sympla.zendesk.com/hc/pt-br/articles/4406749097997-Como-criar-e-publicar-pacotes-no-meu-Evento)
  - A "grade importável" é a mesma ideia do nosso "copiar preços da sessão anterior".
- **Sympla Streaming (online):** "+ Adicionar sessão" com início e término; até 10 sessões; 2 h entre sessões no mesmo dia. [V] [Sessões no Streaming](https://ajuda.produtor.sympla.com.br/hc/pt-br/articles/15454822007949-Como-configurar-uma-ou-mais-sess%C3%B5es-em-seu-evento-Sympla-Streaming)

### Shotgun

- **Várias datas = vários eventos** reunidos numa "Event Series" (uma página, um link). Cada data mantém página, bilheteria e configurações próprias. Na página da série, o layout "Tour" mostra cada data com cidade e dia; o layout "Event Series" mostra cada evento com capa e nome. [V] [Event Series](https://support-pro.shotgun.live/hc/en-us/articles/38333436256402-Announce-multiple-dates-at-once-with-Event-Series-tour-or-season)
- **Listagem pública:** um card por data, com "dia, data | hora", preço e o selo "Sold out" no lugar do preço quando esgota (ex.: "Sun, Jul 19 | 8:00 PM · Sold out"). [V] [Upcoming Events](https://shotgun.live/en/events) · widget com opção "Display Sold Out badge" [V] [Widget](https://support-pro.shotgun.live/hc/en-us/articles/360018503879-Embed-Shotgun-ticketing-on-your-website-with-the-widget)
  - **Não encontrado:** um card único que mostre várias datas em chips. O nosso card (seção 12) adapta a lista de datas da página "Tour" para dentro do card.
- **Dias/horários no mesmo evento:** uma categoria de ingresso por dia, com capacidade própria e janela de validade; leitura fora da janela é recusada; o app mostra mensagem própria quando "o ingresso não corresponde ao dia ou horário". [V] [Vários dias](https://support-pro.shotgun.live/hc/en-us/articles/18210281225746-Ticketing-structure-for-multi-day-events-and-special-tickets) · [Validade do acesso](https://support-pro.shotgun.live/hc/en-us/articles/360018504099-Limit-ticket-access-validity) · [Shotgun Scan](https://support-pro.shotgun.live/hc/en-us/articles/6986376133138-Shotgun-Scan-user-guide)

### Serviço de e-mail (plano grátis em uso)

- 100 e-mails por dia e 3.000 por mês, somando enviados e recebidos; 10 requisições por segundo. [V] [Cotas e limites](https://resend.com/docs/knowledge-base/account-quotas-and-limits)
- O dia é o **dia UTC** (zera à 00:00 UTC = **21h00 em Brasília**). Ao estourar, a resposta é `429` com `daily_quota_exceeded`. Toda resposta traz o cabeçalho `x-resend-daily-quota` com o uso do dia. [V] [Limites de uso](https://resend.com/docs/api-reference/rate-limit) · [Erros](https://www.resend.com/docs/api-reference/errors)
  - [S] A página de "Retrieve Usage" fala em janela móvel de 24 h; a de limites diz dia UTC. A spec segue a de limites e trata os dois casos (para de enviar ao receber `daily_quota_exceeded`).
- Hoje o lembrete usa até 30 por 24 h (`REMINDER_DAILY_CAP`), deixando o resto para ingressos e alertas. [V]

### Não encontrado nas duas plataformas

Como o e-mail mostra a data de um grupo/categoria; se a venda fecha sozinha no início; e-mail automático de mudança de horário (a Sympla manda o organizador escrever o e-mail).

---

## 4. Como é hoje (o que muda) [V]

- `events` guarda data (`starts_at`), lotação (`capacity`), cotas (`inteira_quota`, `meia_quota`) e venda aberta (`sales_open`). Sem término.
- `ticket_types` pertence ao evento e guarda **nome, categoria, pessoas por unidade, preço e limite**.
- `orders`, `order_items` e `tickets` apontam para o evento.
- Contagens por evento: `event_occupied_count`, `event_kind_occupied_count`, `ticket_type_units_taken`, `event_availability`. O checkout (`create_checkout_order`) trava a linha do evento.
- **A venda não fecha sozinha:** nada recusa venda depois de `starts_at`; só o botão "Fechar vendas".
- **Check-in:** `api/check-in` chama `check_in_ticket(p_event_id, p_code, p_staff_user_id)`, que trava o ingresso, devolve `evento_errado` com o nome do outro evento e grava `checked_in_by`. A equipe logada só **lê** `tickets` e `orders`; toda escrita passa por funções do banco com `service_role`.
- **Lembrete:** `claim_abandoned_order_reminders` filtra por `events.sales_open`, `events.starts_at > now()` e `events.capacity > event_occupied_count`; o e-mail mostra `events.starts_at`. Agendamento por `pg_cron` + `pg_net`, desligado até o dono ativar.
- Home, página do evento, checkout, pedido, e-mails de ingressos/estorno/lembrete e PDF mostram `events.starts_at`.
- Carrinho no navegador: chave `byla:cart:v2:<slug>`.

---

## 5. Preços por sessão: modelo escolhido

### 5.1 Opções comparadas

| | **Opção 1 — catálogo no evento + preços por sessão** | Opção 2 — tipos inteiros por sessão |
| --- | --- | --- |
| O que fica no evento | Os **tipos** (nome, tipo pronto, categoria inteira/meia, pessoas por unidade, ordem). | Nada; cada sessão tem a sua lista completa de tipos. |
| O que fica na sessão | **Preço, "à venda nesta sessão" e limite** de cada tipo. | Tudo: nome, pessoas, preço, limite. |
| Evento de sessão única | Igual a hoje (a tela junta tipo e preço numa linha só). | Igual a hoje. |
| Evento com 3 sessões | Os tipos são definidos uma vez; cada sessão mostra uma tabelinha de preços já preenchida (copiada da anterior). | Os mesmos tipos repetidos 3 vezes; renomear "Casadinha" exige editar 3 lugares. |
| Relatórios, portaria, e-mail | Mesmo tipo em todas as sessões: "Casadinha — Inteira" é sempre o mesmo. | Tipos homônimos em sessões diferentes; agrupar exige comparar nomes. |
| Regras atuais dos tipos (tipos prontos fixos, nomes reservados, cortesia única, arquivar) | Continuam como estão. | Precisam passar de "por evento" para "por sessão" (índices, cortesia por sessão). |
| Migração | Cada tipo atual ganha 1 linha de preço na sessão criada. | Cada tipo atual ganha `session_id`. |
| Esforço | Um nível a mais no editor. | Editor atual repetido por sessão; mais regras no banco. |

**Recomendação: Opção 1.** É o mesmo princípio da "grade importável" do Sympla Bileto [V]: o que o comprador compra (o tipo) é estável e o que varia por sessão (preço, disponibilidade, limite) fica na sessão. Mantém as regras dos tipos que acabaram de ser aprovadas e evita repetir tipos (o problema do Sympla padrão).

### 5.2 Como fica para a equipe

- **Seção "Tipos de ingresso" (evento):** marcar os tipos prontos e criar tipos novos (nome, pessoas por unidade), como hoje, **sem preço**.
- **Cada sessão** tem "Preços desta sessão": uma linha por tipo marcado, com **"À venda nesta sessão"** (ligado por padrão), **preço** (obrigatório se à venda) e **limite opcional**.
- **"+ Adicionar sessão"** copia da última sessão: lotação, cotas, e todos os preços, limites e "à venda". A equipe só escolhe o horário (e o nome, se quiser).
- **"Aplicar estes preços a todas as sessões"**: atalho no rodapé da tabela de uma sessão, com confirmação ("Os preços das outras 2 sessões serão trocados por estes").
- **Evento de sessão única:** a tela não mostra a separação: cada tipo aparece com o preço e o limite na mesma linha, como hoje.
- Exemplo: tipo "Pacote família" à venda só na "Sessão infantil" (desligado nas outras).

---

## 6. Modelo de dados

### 6.1 Tabela nova `public.event_sessions`

| Coluna | Tipo | Regra |
| --- | --- | --- |
| `id` | `uuid` pk | `gen_random_uuid()` |
| `event_id` | `uuid not null` → `events(id)` | sem `on delete cascade` |
| `name` | `text` | opcional; 1 a 60 caracteres sem espaços nas pontas (decisão 12) |
| `starts_at` | `timestamptz not null` | início |
| `ends_at` | `timestamptz` | opcional (decisão 8); `ends_at > starts_at` |
| `capacity` | `int not null` | `between 1 and 100000` |
| `inteira_quota`, `meia_quota` | `int` | regras de hoje (`1..capacity`, soma `≤ capacity`), na sessão (decisão 3) |
| `sales_open` | `boolean not null default true` | botão "Encerrar vendas desta sessão" (decisão 6) |
| `status` | `text not null default 'ativa'` | `check (status in ('ativa', 'cancelada'))` (decisão 9) |
| `cancelled_at`, `cancelled_by` (→ `auth.users`), `cancelled_by_name`, `cancel_reason` | | preenchidos juntos quando `cancelada` (check de consistência); motivo de 5 a 500 caracteres |
| `cancel_notice_sent_at` | `timestamptz` | e-mail de cancelamento pedido (decisão 13) |
| `archived_at` | `timestamptz` | sessão sem vendas removida pela equipe: some da venda e da página; continua no histórico |
| `created_at`, `updated_at` | `timestamptz` | |

- Índices: `(event_id, starts_at)`; único parcial `(event_id, starts_at) where archived_at is null`.
- Até 20 sessões ativas por evento (conferido na função).
- **Venda pelo horário:** a sessão vende enquanto `now() < starts_at + interval '5 minutes'` (constante única no banco, `session_sales_close_offset`, e espelhada em `src/lib/domain/sessions.ts`).
- **Evento de sessão única = 1 linha nesta tabela**, criada junto com o evento. Não existe evento sem sessão.

### 6.2 Tabela nova `public.session_ticket_types` (preço por sessão)

| Coluna | Tipo | Regra |
| --- | --- | --- |
| `id` | `uuid` pk | |
| `session_id` | `uuid not null` → `event_sessions(id)` | |
| `ticket_type_id` | `uuid not null` → `ticket_types(id)` | tipo do mesmo evento (conferido na função) |
| `price_cents` | `int not null` | `between 1 and 10000000` |
| `max_units` | `int` | limite opcional **desta sessão** (decisão 4) |
| `on_sale` | `boolean not null default true` | "À venda nesta sessão" |
| `created_at`, `updated_at` | `timestamptz` | |

- Único `(session_id, ticket_type_id)`.
- Cortesia não tem linha aqui (nunca é vendida).
- Tipo arquivado no evento sai da venda em todas as sessões; a linha de preço fica para histórico.

### 6.3 Mudanças nas tabelas existentes

- **`ticket_types`:** vira o catálogo do evento (nome, `preset`, `kind`, `people_per_unit`, `sort_order`, `archived_at`). `price_cents` e `max_units` **deixam de ser usados**: ficam durante a janela de deploy (espelhando a sessão única) e saem na fase de limpeza.
- **`orders.session_id uuid not null`** → `event_sessions(id)`. Um pedido é de uma sessão (decisão 5).
- **`tickets.session_id uuid not null`**, copiado do pedido. Integridade: `unique (id, session_id)` em `orders` e chave estrangeira composta `tickets (order_id, session_id) → orders (id, session_id)`.
- Índices: `orders (session_id, expires_at) where status = 'pendente'`; `tickets (session_id, status)`; `orders (session_id, status)`.
- **`orders.decision_reason`:** o check ganha `sessao_encerrada` (seção 7.3) e `sessao_cancelada` (seção 9.4).
- **`orders.cancel_reason`:** o check ganha `sessao_cancelada`.
- **`orders.session_id` e `tickets.session_id` imutáveis:** gatilho recusa `update` dessas colunas depois da criação (garante que um estorno de sessão nunca alcance pedido de outra).
- **`order_items`:** sem mudança. O preço já é copiado no momento da compra.
- **`events.capacity`, `inteira_quota`, `meia_quota`:** param de ser usados; espelham a sessão única na janela de deploy e saem na limpeza.
- **`events.starts_at`:** resumo mantido pelas funções = início da primeira sessão ativa. Usado só para ordenar e pelo código antigo na janela de deploy.

### 6.4 Tabelas novas de comunicação, auditoria e estorno em lote

- **`session_audit_log`** (registro do que a equipe fez em cada sessão; nunca apagado): `id`, `session_id`, `action` (`cancelada`, `reativada`, `removida`, `aviso_horario_pedido`, `aviso_cancelamento_pedido`, `lote_estorno_iniciado`, `lote_estorno_retomado`, `lote_estorno_concluido`), `staff_user_id`, `staff_name`, `reason`, `details jsonb` (só contagens e valores, **sem dados pessoais**), `created_at`.
- **`session_notices`** (um comunicado por e-mail): `id`, `session_id`, `kind` (`alteracao_horario`, `cancelamento`, `estorno_cancelamento`), `payload jsonb` (ex.: horário anterior e novo), `requested_by`, `requested_at`.
- **`session_notice_deliveries`** (uma linha por comunicado e pedido): `notice_id`, `order_id`, `status` (`pendente`, `enviado`, `falhou`), `attempts`, `claimed_at`, `sent_at`, `error_code`; **único `(notice_id, order_id)`** — o mesmo comunicado nunca vai duas vezes ao mesmo pedido. Usada pelo aviso de horário (seção 10) e pelos e-mails do cancelamento (seção 9.4).
- **`session_refund_batches`** ("Estornar todos"): `id`, `session_id`, `requested_by`, `requested_by_name`, `reason`, `status` (`em_andamento`, `pausado`, `concluido`, `concluido_com_falhas`), `expected_count`, `expected_total_cents` (calculados no banco ao criar), `runner_token`, `runner_until` (uma tela rodando por vez, seção 9.4.4), `consecutive_errors`, `created_at`, `finished_at`. **Único parcial `(session_id) where status in ('em_andamento', 'pausado')`**: só um lote aberto por sessão.
- **`session_refund_batch_items`**: `batch_id`, `order_id`, `status` (`pendente`, `processando`, `estornado`, `em_processamento`, `falhou`, `pulado`), `refund_id` (→ `order_refunds`), `skip_reason` / `error_code`, `attempts`, `updated_at`; **único `(batch_id, order_id)`**. Os itens são a foto dos pedidos elegíveis no momento da criação, tirada pelo banco só da sessão do lote.

### 6.5 Funções do banco

Todas com `set search_path = ''`, `revoke … from public, anon, authenticated` e `grant execute … to service_role`. As que agem em nome da equipe recebem `p_staff_user_id` e conferem `staff_profiles`, no padrão de `check_in_ticket`.

- **Contagens por sessão** (mesma regra de hoje: pago, check-in, reserva ativa, estorno `solicitado`):
  - `session_occupied_count(p_session_id, p_exclude_order_id default null)`;
  - `session_kind_occupied_count(p_session_id, p_kind, p_exclude_order_id default null)`;
  - `session_type_units_taken(p_session_id, p_ticket_type_id, p_exclude_order_id default null)`.
- **`session_is_selling(p_session_id) returns boolean`:** evento com `sales_open`, sessão com `sales_open`, `status = 'ativa'`, não arquivada, e `now() < starts_at + 5 min`.
- **`session_availability(p_session_id) returns jsonb`:** formato atual de `event_availability` (`capacity`, `sold`, `held`, `remaining`, `categories`, `types`), com o preço e o "à venda" de cada tipo naquela sessão.
- **`event_sessions_summary(p_event_id) returns jsonb`:** sessões ativas com `id`, `name`, `starts_at`, `ends_at`, `selling`, `sold_out`, `remaining`, `min_price_cents` (menor preço à venda e não esgotado) e o `min_price_cents` do evento (menor entre as sessões vendendo). Uma chamada para home, página do evento e painel.
- **`create_checkout_order` v4:** ganha `p_session_id`.
  - Trava a **sessão** (`for update`), não o evento: compras em sessões diferentes não se esperam; na mesma sessão continuam em fila.
  - Exige `session_is_selling`. Preço, "à venda" e limite vêm de `session_ticket_types`; lotação e cotas, da sessão.
  - Erros novos: `SESSAO_INDISPONIVEL` (inexistente, arquivada, cancelada ou de outro evento) e `SESSAO_ENCERRADA` (venda encerrada pela equipe ou pelo horário). Os atuais (`ESGOTADO_EVENTO`, `ESGOTADO_CATEGORIA`, `ESGOTADO_TIPO`, `LIMITE_PESSOAS`, `TIPO_INDISPONIVEL`) passam a valer para a sessão.
  - Janela de deploy: `p_session_id` nulo + evento com exatamente 1 sessão → usa essa sessão. Com mais de uma → `SESSAO_INDISPONIVEL`.
- **`extend_order_hold_for_pix`:** passa a recusar quando a sessão do pedido não está mais vendendo (seção 7.2).
- **`mark_order_paid_by_external` v4:** rechecagem pela sessão do pedido; novos casos `sessao_encerrada` (seção 7.3) e `sessao_cancelada` (seção 9.4: **pagamento de sessão cancelada nunca vira pago sozinho**). Trava pedido e depois sessão.
- **`accept_paid_order`:** o aviso "A lotação passará de X para Y" usa a sessão; **recusa pedido de sessão cancelada** (só resta "Estornar").
- **`issue_courtesy_ticket` v3:** ganha `p_session_id`; ocupa lugar da sessão; permitida mesmo com venda encerrada (é a equipe que emite).
- **`save_event_sessions(p_event_id, p_sessions jsonb, p_staff_user_id)`**, chamada na mesma transação que salva evento e tipos (`update_event_with_capacity` v4 e criação):
  - item: `{ id | null, name | null, starts_at, ends_at | null, capacity, inteira_quota | null, meia_quota | null, prices: [{ ticket_type_ref, price_cents, max_units | null, on_sale }] }`;
  - recusa: lotação, cota ou limite abaixo do já ocupado (`SESSAO_LOTACAO_MENOR`, `SESSAO_COTA_MENOR`, `SESSAO_LIMITE_MENOR`, com sessão e número); remover sessão com pedido pago ou reservado (`SESSAO_COM_VENDAS`: o caminho é cancelar, seção 9.4); editar sessão cancelada; horário repetido; tipo à venda sem preço; sessão sem nenhum tipo à venda; de 1 a 20 sessões;
  - sessão omitida sem nenhum pedido em toda a história → **apagada de verdade**; com pedidos só vencidos/cancelados → arquivada (seção 9.4);
  - mudou `starts_at` ou `ends_at` de sessão com pedidos pagos → registra a alteração em `session_schedule_changes` (seção 10);
  - atualiza o resumo `events.starts_at`.
- **`set_session_sales_open(p_session_id, p_open, p_staff_user_id)`:** botão por sessão. Reabrir depois do horário não faz voltar a vender (o horário manda).
- **`check_in_ticket` v2:** nova assinatura `(p_event_id, p_session_id, p_code, p_staff_user_id)`, evoluindo a função atual (mesma trava do ingresso, mesmo registro de `checked_in_by`). Novos resultados:
  - **`sessao_cancelada`**: ingresso de sessão cancelada, qualquer que seja a sessão escolhida na portaria;
  - **`sessao_errada`**: devolve só `other_session_name` e `other_session_starts_at` (nada do comprador), como `evento_errado` devolve só o nome do outro evento.
  - no resultado `ok`, devolve também `session_name`, `session_starts_at` e `event_name` para o "Pode entrar" (seção 8.4); continua sem e-mail, telefone ou token do comprador;
  - A assinatura antiga continua na janela de deploy e **recusa qualquer ingresso de evento com mais de uma sessão ou de sessão cancelada** (falha fechada); sai na limpeza.
- **`cancel_event_session(p_session_id, p_staff_user_id, p_reason, p_confirmation, p_notify)`** (seção 9.4): trava a sessão e, numa transação só, marca `cancelada`, fecha a venda, cancela pedidos pendentes e devolve a lista de cobranças PIX abertas para o servidor cancelar no Mercado Pago. Grava auditoria.
- **`reactivate_event_session(p_session_id, p_staff_user_id, p_reason)`**: só sem nenhum estorno iniciado na sessão. Grava auditoria.
- **`start_session_refund_batch(p_session_id, p_staff_user_id, p_reason, p_confirmation)`**, **`claim_session_refund_item(p_batch_id, p_staff_user_id)`**, **`finish_session_refund_item(p_item_id, p_status, p_refund_id, p_code)`**, **`pause_session_refund_batch`** / **`resume_session_refund_batch`** (seção 9.4.4).
- **`queue_session_notice(...)`**, **`claim_session_notice_deliveries(p_limit)`**, **`mark_session_notice_sent`** / **`release_session_notice_delivery`**: fila de e-mails por sessão (seções 9.4 e 10), no padrão das funções do lembrete.
- **`claim_abandoned_order_reminders` v2:** o critério de evento vira critério da **sessão do pedido** (`session_is_selling` e `session_occupied_count < capacity`), e devolve também nome e início da sessão. A regra "1 lembrete por e-mail e evento" continua por evento.
- **Saem de uso** (removidas na limpeza): `event_occupied_count`, `event_kind_occupied_count`, `event_availability`, `ticket_type_units_taken`, a assinatura antiga de `check_in_ticket`.

### 6.6 Segurança e RLS

- `event_sessions` e `session_ticket_types`: RLS ligada; leitura pública só do que está à venda e visível (sessão não arquivada de evento com `sales_open`; preço `on_sale` de tipo não arquivado); a equipe lê tudo (`is_staff()`); **sem política de escrita** (só funções com `service_role`, como `ticket_types`, `order_items`, `tickets` e `orders` hoje).
- `session_audit_log`, `session_schedule_changes`, `session_notices`, `session_notice_deliveries`, `session_refund_batches` e `session_refund_batch_items`: RLS ligada; só a equipe lê; **sem política de escrita** (só funções com `service_role`). Guardam `order_id`, nunca e-mail copiado. Auditoria nunca é apagada nem editada (sem `update`/`delete` concedidos).
- Cancelar, reativar, estornar e "Estornar todos": Server Actions com `requireStaffUser()` no primeiro passo; as funções recebem `p_staff_user_id` e conferem `staff_profiles`; **valores e lista de pedidos sempre calculados no banco**; o texto de confirmação digitado é conferido no servidor contra o valor calculado no banco (nunca contra o que a tela mostrou). Hoje toda a equipe tem o mesmo acesso (papéis diferentes estão fora de escopo, como no estorno atual).
- Toda Server Action nova começa com `requireStaffUser()` e devolve `ActionResult` via `runAction`/`ActionError`.
- O checkout valida `sessionId` como UUID no servidor; a função confere que a sessão é do evento e está vendendo. `?sessao=` na URL só pré-seleciona a tela.
- `?retomar=<token>`: a sessão vem do pedido, nunca da URL.
- Concorrência: a trava passa do evento para a sessão. Nenhuma regra cruza sessões (lotação, cotas, preços e limites são por sessão), então travar a sessão basta.
- Mensagens ao comprador genéricas; detalhe só no log; falha ao consultar a sessão = não vender.

---

## 7. Fim da venda da sessão (decisão 6)

### 7.1 Quando fecha

- **Sozinha:** 5 minutos depois do horário de início (`starts_at + 5 min`), em todo evento, inclusive de sessão única. A regra fica no banco (`session_is_selling`) e a tela só a reflete. Não precisa de agendamento: a função compara com a hora atual.
- **Antes, pela equipe:** botão "Encerrar vendas desta sessão" (e "Reabrir vendas", que só funciona antes do horário-limite).
- O botão geral do evento ("Fechar vendas") continua: fecha todas as sessões de uma vez.
- **Mudança para os eventos atuais:** hoje a venda nunca fecha sozinha. Depois da fase 1, eventos já iniciados há mais de 5 min param de vender na hora.

### 7.2 Quem já estava comprando no momento do fechamento

| Situação no momento do fechamento | O que acontece |
| --- | --- |
| Pessoa escolhendo ingressos (sem pedido) | "Continuar" é recusado: "As vendas desta sessão foram encerradas." Se houver outra sessão vendendo, botão "Escolher outra sessão". |
| Pedido pendente, dentro da reserva (até 15 min) | **Pode terminar de pagar com cartão** até o fim da reserva: o lugar já estava garantido. |
| Pedido pendente, PIX **ainda não gerado** | **Não pode mais gerar PIX** (gerar PIX estenderia a reserva por até 33 min depois do fechamento). Mensagem: "As vendas desta sessão foram encerradas. Se quiser, pague com cartão até HH:MM." |
| PIX já gerado antes do fechamento | Vale até o vencimento (a reserva já tinha sido estendida); pago dentro do prazo → pedido pago, ingressos enviados. |
| Pagamento que chega **depois** de a reserva vencer e com a sessão encerrada | Vai para **"Pago após o fim das vendas — decidir"** (`aguardando_decisao`, `decision_reason = 'sessao_encerrada'`), com alerta à equipe; ações "Aceitar mesmo assim" ou "Estornar", como "Pago sem vaga". |
| Pagamento atrasado com a sessão **ainda vendendo** | Regra atual: se couber, vira pago; se não couber, "Pago sem vaga — decidir". |
| "Alterar seleção" depois do fechamento | Cancela o pedido (regra atual) e volta à escolha de sessão; a sessão encerrada aparece como "Vendas encerradas". |
| Cortesia | A equipe continua podendo emitir (até a lotação). |
| **Sessão cancelada** (seção 9.4) | Pedidos pendentes são cancelados na hora e os PIX abertos cancelados no Mercado Pago; qualquer pagamento que chegue depois vai para "Pago em sessão cancelada — estornar" (nunca vira pago sozinho); cartão dentro da reserva não pode mais ser pago; cortesia não pode ser emitida. |

- O mesmo vale quando a equipe encerra antes do horário (exceto a linha da sessão cancelada, que só vale para cancelamento).
- Pedidos pendentes não são cancelados no fechamento: vencem sozinhos (regra atual de `expirado`).

### 7.3 Texto do novo motivo de decisão

- Etiqueta na equipe: "Pago após o fim das vendas — decidir".
- Detalhe: "O pagamento chegou depois que as vendas da sessão de sáb, 10/10 às 19h00 foram encerradas."
- Alerta à equipe: novo tipo `pago_apos_encerramento`, com a mesma deduplicação de hoje.

---

## 8. Comprador (mobile-first)

A regra de ouro (decisão 5): **a sessão escolhida aparece em todos os passos**, sempre no mesmo formato: `[Nome · ] dia da semana, dd/mm · HHhMM[ – HHhMM]` (ex.: "Sessão infantil · sáb, 10/10 · 16h00 – 17h30").

### 8.1 Página do evento

- **Sessão única:** igual a hoje; a data vem da sessão; o nome da sessão aparece se existir.
- **Várias sessões:** seção **"Escolha a sessão"**, logo abaixo do título:
  - sessões por horário, agrupadas por dia ("Sábado, 10 de outubro");
  - cada sessão num botão de largura total, mínimo 56 px de altura: horário em destaque, nome abaixo (se houver), e à direita "a partir de R$ X" **quando os preços variam entre sessões**;
  - estados: "Últimos N" (20 ou menos); "Esgotada" (desativado, texto riscado); "Vendas encerradas" (desativado); sessões já terminadas somem (término passou ou, sem término, 4 h depois do início);
  - com uma só sessão vendendo, ela já vem marcada; `?sessao=<id>` (vindo do chip da home) pré-marca;
  - ao marcar, a lista de preços abaixo passa a mostrar **os preços daquela sessão** e a barra fixa mostra "sáb 10/10 · 19h00" + **"Comprar ingresso"** → `/eventos/<slug>/checkout?sessao=<id>`;
  - sem sessão marcada: a lista de tipos aparece com "Escolha a sessão para ver os preços" e o botão da barra vira "Escolher sessão" (rola até a lista).
- **"A partir de R$ X"** (barra fixa e topo): menor preço à venda, não esgotado, **entre todas as sessões vendendo**; depois de marcar a sessão, o menor daquela sessão.
- Topo da página: sessão única → data; várias → "3 sessões · próxima: sáb, 10/10 · 19h00".
- Todas esgotadas → "Esgotado"; todas encerradas → "Vendas encerradas".

### 8.2 Checkout

- **Cartão da sessão no topo**, em destaque (borda na cor da marca): "Você está comprando para" + sessão no formato padrão + link **"Trocar sessão"**.
- `?sessao=` ausente ou inválido em evento de várias sessões → volta à página do evento para escolher. Sessão única → usa a única.
- Preços, limites, cotas e restantes são da sessão. Recusa por concorrência: "Restam apenas N lugares nesta sessão. Ajustamos sua seleção."
- **Barra fixa de total** (já existe): ganha a linha da sessão ("sáb 10/10 · 19h00") acima do total.
- Botão "Continuar" com a frase logo acima: "Ingressos para **sáb, 10/10 às 19h00**".
- Sessão encerrou ou esgotou entre a escolha e o "Continuar": "Esta sessão não está mais disponível. Escolha outra sessão."
- **Carrinho:** chave `byla:cart:v3:<slug>`, com `sessionId`. Trocar de sessão mantém tipos e quantidades, reajusta ao máximo e **recalcula com os preços da nova sessão** (aviso: "Os preços foram atualizados para esta sessão."). Carrinho `v2` é migrado sem sessão (pede a escolha).
- Pedido pendente de outra sessão do mesmo evento: o aviso existente mostra também a sessão.

### 8.3 Pagamento, pedido, ingressos, e-mail e PDF

- **Página de pagamento:** cabeçalho com evento + sessão no formato padrão; resumo repete a sessão.
- **Página do pedido pago, bloco de sucesso, `TicketQr`, `DownloadTicketPdf`, e-mail de ingressos e "Pode entrar" da portaria:** conteúdo completo na seção 8.4 (decisão 16).
- **E-mail de ingressos:** assunto "Seus ingressos — <Evento> · sáb 10/10 às 19h00".
- **E-mail de estorno e lembrete:** mostram a sessão.

### 8.4 Conteúdo do ingresso (decisão 16) — vale para todos os lugares

Pedido do dono (2026-10-03 20:18): "No ingresso deve informar a sessão e o horário, além de todas as outras informações." Esta seção é a lista única do que o ingresso mostra. Vale para: **página do pedido/ingresso** (`TicketQr`), **PDF** (`DownloadTicketPdf`), **e-mail de ingressos** (`tickets-template.ts`) e **resultado "Pode entrar" da portaria** (`CheckInScanner` + `api/check-in`).

#### 8.4.1 O que o ingresso mostra hoje [V] (código em `origin/feat/mvp`)

| Informação | Página (`TicketQr`) | PDF | E-mail | "Pode entrar" |
| --- | --- | --- | --- | --- |
| "Espaço Byla Eventos" | sim | sim | "Espaço Byla" no topo | — |
| Nome do evento | sim | sim | sim | — (a portaria já está no evento) |
| Data e horário | só no cabeçalho da página, não no cartão; formato "10 de outubro de 2026 às 19:00" | sim ("Quando") | sim ("Quando", data completa) | — |
| Local | só no cabeçalho da página | sim | sim ("Onde") | — |
| Nome do titular | sim | sim ("Participante") | sim | sim |
| Tipo ("Casadinha — Inteira") | sim | sim | sim | sim |
| QR Code | sim | sim | sim (imagem anexada) | — |
| Código manual | sim | sim | sim | — |
| Status | "Pago" / "Check-in" | sim | — | — |
| Número do pedido | **não** | **não** | **não** | — |
| Sessão | **não existe ainda** | | | |
| Orientação de meia-entrada (documento) | **não existe** em nenhum lugar | | | |

Ingressos estornados ou cancelados não aparecem hoje: a página do pedido mostra só a tela "Pedido estornado" / "Pedido cancelado".

#### 8.4.2 Lista final do conteúdo do ingresso

| # | Informação | Como aparece | Página | PDF | E-mail | "Pode entrar" |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Marca | "Espaço Byla Eventos" (continua) | sim | sim | sim | — |
| 2 | Nome do evento | continua | sim | sim | sim | sim (linha pequena) |
| 3 | **Nome da sessão** (novo) | só se a sessão tiver nome (ex.: "Sessão infantil") | sim | sim | sim | sim |
| 4 | **Data e horário de início da sessão** (novo: da sessão, não do evento) | formato longo, sempre em `America/Sao_Paulo`: **"Sábado, 10 de outubro de 2026 · 19h00"** | sim, **no cartão**, acima do QR | sim | sim, em cada ingresso | sim (formato curto: "sáb, 10/10 · 19h00") |
| 5 | **Término** (novo, se houver) | "Sábado, 10 de outubro de 2026 · 19h00 – 21h30"; término no dia seguinte: "… · 23h00 – 01h00 (domingo)" | sim | sim | sim | — |
| 6 | Local | continua; passa para dentro do cartão | sim | sim | sim | — |
| 7 | Nome do titular | continua | sim | sim | sim | sim |
| 8 | Tipo do ingresso | continua: "Casadinha — Inteira", "Meia-entrada", "Cortesia" | sim | sim | sim | sim |
| 9 | QR Code | continua | sim | sim | sim | — |
| 10 | Código manual | continua | sim | sim | sim | — |
| 11 | **Número do pedido** (novo) | "Pedido nº A1B2C3D4" = 8 primeiros caracteres do `orders.id` em maiúsculas. **Nunca** o `public_token` (ele é a chave de acesso à página do pedido) | sim | sim | sim (uma vez, no topo) | — |
| 12 | Status | ver 8.4.3 | sim | sim | — (o e-mail só sai quando o pedido é pago) | o próprio resultado |
| 13 | Ingresso X de Y | "Ingresso 2 de 4" quando o pedido tem mais de um (o e-mail já faz; entra na página e no PDF) | sim | sim | sim | — |

- **Destaque:** no cartão da página e no PDF, nome da sessão + data + horário ficam num bloco destacado logo abaixo do nome do evento e **acima do QR**: é o que a portaria confere.
- **Evento de sessão única:** mostra data e horário do mesmo jeito (como hoje), no formato novo; o nome da sessão aparece só se existir. Nenhuma palavra "Sessão" sobra sozinha.
- **Uma função para todos:** `formatSessionWhen(startsAt, endsAt)` (formato longo) e `formatSessionShort(startsAt)` (formato curto) em `src/lib/datetime.ts`, usando `America/Sao_Paulo` e o "h" brasileiro ("19h00", não "19:00"). Página, PDF, e-mail e portaria usam as mesmas funções, para nunca haver duas versões do horário.
- **Nada além disso:** sem e-mail, telefone ou CPF do comprador em nenhum ingresso; na portaria, só o que já aparece hoje mais a sessão.
- **Orientação de meia-entrada:** **não existe hoje**, então não entra nesta spec. Sugestão registrada para decidir com os Termos de compra (seção 17): frase "Meia-entrada: apresente na entrada o documento que comprova o direito" no ingresso de tipo meia.

#### 8.4.3 Status no ingresso

| Situação | Etiqueta | QR, código e PDF |
| --- | --- | --- |
| Pago | "Pago" (verde) | aparecem |
| Entrada registrada | "Check-in" (neutra) + "Entrou em 10/10 às 19h12" | aparecem (a portaria recusa "Já usado") |
| Estornado | "Estornado — não vale para entrada" (vermelha) | **não aparecem** |
| Cancelado | "Cancelado — não vale para entrada" (vermelha) | **não aparecem** |
| Sessão cancelada (seção 9.4) | **"Sessão cancelada — não vale para entrada"** (vermelha), mesmo com o ingresso ainda "pago" à espera do estorno | **não aparecem** |

- Nas telas "Pedido estornado", "Pedido cancelado" e "Sessão cancelada", a página passa a listar abaixo os ingressos do pedido em cartões simples (evento, sessão, data e horário, titular, tipo, número do pedido e a etiqueta vermelha), **sem QR, sem código e sem PDF**. Assim o comprador vê o que foi cancelado sem ter nada que pareça válido.
- "Pode entrar" na portaria só aparece para ingresso válido da sessão escolhida; os outros casos são as recusas da seção 11.

#### 8.4.4 Exemplo (cartão no celular)

```
ESPAÇO BYLA EVENTOS
NOME DO EVENTO
┌──────────────────────────────┐
│ Sessão infantil              │
│ Sábado, 10 de outubro de 2026│
│ 16h00 – 17h30                │
└──────────────────────────────┘
Casadinha — Inteira · Ingresso 1 de 2
[ QR CODE ]
Maria Exemplo
Código para digitação manual: ……
[ Pago ]
Local: Espaço Byla · Pedido nº A1B2C3D4
[ Baixar ingresso (PDF) ]
```

Portaria: **"Pode entrar"** — "Maria Exemplo · Casadinha — Inteira" e, abaixo, "Sessão infantil · sáb, 10/10 · 16h00 · <Evento>".

#### 8.4.5 Critérios de aceite e testes

- **Unidade (`datetime`):** `2026-10-10T22:00:00Z` → "Sábado, 10 de outubro de 2026 · 19h00"; com término `2026-10-11T00:30:00Z` → "· 19h00 – 21h30"; término depois da meia-noite → "(domingo)"; formato curto "sáb, 10/10 · 19h00"; mesmo resultado rodando com o fuso do servidor em UTC.
- **Unidade (e-mail):** HTML e texto têm, em cada ingresso, evento, nome da sessão (se houver), data e horário de início (e término), local, titular, tipo, código e número do pedido; sessão sem nome não gera rótulo vazio.
- **Unidade (PDF):** extrair as linhas do PDF para uma função pura (`ticketPdfLines`) e testar que tem todos os itens da lista 8.4.2; acentos ("Sábado", "Espaço") saem certos no PDF gerado.
- **Rota de check-in:** resposta `ok` traz nome da sessão e horário; nunca e-mail, telefone ou `public_token`.
- **Página:** pedido pago mostra QR com todos os itens; estornado, cancelado e sessão cancelada mostram os cartões sem QR, sem código e sem botão de PDF; o `public_token` não aparece como texto em lugar nenhum.
- **Navegador (360 px e computador, tema claro e escuro):** evento de sessão única sem nome; evento com 2 sessões, uma com nome; pedido com 2 ingressos ("Ingresso 1 de 2"); cortesia; PDF baixado e aberto no celular; e-mail de teste recebido; "Pode entrar" com a sessão na portaria.
- **Aceite do dono:** comparar um ingresso de teste com esta lista, item por item.

---

## 9. Equipe

### 9.1 Formulário do evento

- **Tipos de ingresso** (evento): como hoje, sem preço (seção 5.2). Em evento de sessão única, preço e limite aparecem na mesma linha.
- **Sessões:** um cartão por sessão:
  - "Nome (opcional)", "Início", "Término (opcional)", "Total de ingressos", "Quantidade de inteiras/meias (opcional)" com o resumo atual ("Total 100 · Inteiras 60 · Meias 40");
  - "Preços desta sessão": por tipo, "À venda", preço, limite; resumo dos limites como hoje ("Limites dos tipos: 6 de 10 ingressos…"), agora por sessão;
  - "+ Adicionar sessão" (copia a última); "Aplicar estes preços a todas as sessões";
  - sessão com vendas: mostra "N vendidos"; lotação, cotas e limites não podem ficar abaixo do ocupado.
- **Mudou o horário de uma sessão com vendas:** ao salvar, confirmação "A sessão das 19h00 tem N pedidos pagos. Depois de salvar, você poderá avisar os compradores por e-mail." Após salvar, o painel mostra o aviso da seção 10.
- Validação no servidor em `src/lib/domain/sessions.ts` (puro, testado) + `type-limits.ts`/`quotas.ts` aplicados por sessão; o banco é a última palavra.

### 9.2 Painel do evento

- Seletor de sessão no topo (abas roláveis no celular; "Todas" para o total). Sessão única: sem seletor.
- Por sessão: Lotação, Vendidos, Reservados agora, Restantes, vendidos/cota por categoria, vendidos/limite por tipo, **preços daquela sessão**; botão "Encerrar vendas desta sessão" (com o horário automático: "Encerra sozinha às 19h05"); atalho "Check-in desta sessão"; cartão do aviso de horário (seção 10); "Cancelar sessão" (seção 9.4). Sessão cancelada: faixa vermelha "Cancelada em 03/10 por <nome> — <motivo>", contadores "Estornados N de M · R$ X devolvidos", botões "Estornar todos" / "Continuar estornos", relatório do último lote e "Reativar sessão" (quando permitido).
- Participantes, "Precisa de decisão", estorno e cortesia mostram e filtram a sessão. "Emitir cortesia" pede a sessão (em sessão única, não pergunta).
- Lista `/equipe`: sessão única mostra a data; várias, "3 sessões · próxima: 10/10 19h00". "Passado" = todas as sessões já começaram.

### 9.3 Cortesia

Emitida para uma sessão; ocupa lugar dela; o e-mail mostra a sessão.

### 9.4 Cancelar sessão e estornar (decisão 9 — opção D)

Resumo: **cancelar a sessão não devolve dinheiro e não apaga nada.** Ela para de vender, a portaria passa a recusar os ingressos dela e o dinheiro continua parado até a equipe estornar: **um por um** (botão que já existe) ou **"Estornar todos"**. Cada estorno manda 1 e-mail ao comprador. É tratado como ação de alto risco: mexe com dinheiro e, na prática, não tem volta depois do primeiro estorno.

#### 9.4.1 Remover × arquivar × cancelar

| Situação da sessão | Ação disponível | O que acontece |
| --- | --- | --- |
| Nunca teve nenhum pedido (de nenhum status) e não é a única sessão do evento | "Remover sessão" | **Apagada de verdade** (não há histórico a preservar) |
| Teve só pedidos vencidos ou cancelados | "Remover sessão" | **Arquivada** (`archived_at`): some do site e do painel, fica no histórico |
| Tem pedido pago, reservado, aguardando decisão ou cortesia válida | "Cancelar sessão" | **Cancelamento** (abaixo); "Remover" fica bloqueado: "Esta sessão tem vendas. Use Cancelar sessão." |

A última sessão de um evento nunca é apagada nem arquivada (o evento precisa de pelo menos uma); pode ser cancelada.

#### 9.4.2 Cancelar sessão

**Tela de confirmação** (botão vermelho "Cancelar sessão" no painel da sessão; abre uma tela própria, não um aviso pequeno):
- Cabeçalho com a sessão em letras grandes (formato padrão) e o texto: "Cancelar a sessão **não devolve o dinheiro automaticamente**. Depois de cancelar, você poderá estornar os pedidos um por um ou todos de uma vez."
- **Impacto**, calculado no banco na hora de abrir a tela: "N pedidos pagos · R$ X recebidos", "N pedidos aguardando decisão · R$ Y", "N pedidos pendentes (serão cancelados)", "M cortesias", e, se houver, "N pedidos com entrada já registrada (não poderão ser estornados pelo site)".
- **Motivo** obrigatório (5 a 500 caracteres; ex.: "Chuva forte, espaço alagado").
- Caixa "Avisar os compradores por e-mail agora", **já marcada** (decisão 13); a equipe pode desmarcar (ex.: cancelou por engano e vai reativar logo).
- Campo **"Digite CANCELAR para confirmar"** (maiúsculas ou minúsculas). Botão só habilita com o texto e o motivo preenchidos.
- O servidor confere de novo o texto, o motivo e se a sessão ainda está ativa; números diferentes dos mostrados não bloqueiam (cancelar não mexe em dinheiro), mas a tela de resultado mostra os números finais.

**O que `cancel_event_session` faz, numa transação só** (trava a sessão primeiro):
1. `status = 'cancelada'`, `sales_open = false`, grava `cancelled_at`, `cancelled_by`, `cancelled_by_name` e `cancel_reason`.
2. Pedidos **pendentes** da sessão → `cancelado` com `cancel_reason = 'sessao_cancelada'`; ingressos `nao_pago` → `cancelado`. A reserva é liberada na hora.
3. Pedidos **pagos**, **aguardando decisão** e **cortesias** **não mudam de status** (o dinheiro e o histórico ficam intactos). A portaria os recusa porque a sessão está cancelada (seção 11).
4. Grava `session_audit_log` (`cancelada`, contagens e valores, sem dados pessoais).
5. Devolve as cobranças PIX ainda abertas no Mercado Pago dos pedidos cancelados.

**Depois da transação** (no servidor, sem segurar a trava):
- Para cada PIX aberto: pede o cancelamento ao Mercado Pago, como "Alterar seleção" já faz. Se o Mercado Pago disser que já foi pago, segue a confirmação normal, que leva o pedido para a fila de decisão (abaixo). Falha nesse passo não desfaz o cancelamento: o PIX vence sozinho e, se for pago, cai na fila.
- Se a caixa de aviso estiver marcada: cria o comunicado `cancelamento` (seção 9.4.5).

**Pagamento que chega depois do cancelamento** (PIX pago no último segundo, cartão em análise): **nunca vira pago sozinho.** `mark_order_paid_by_external` manda para **"Pago em sessão cancelada — estornar"** (`aguardando_decisao`, `decision_reason = 'sessao_cancelada'`), com alerta à equipe. Para esse motivo, "Aceitar mesmo assim" não aparece (e o banco recusa); só "Estornar". Entra também no "Estornar todos".

**Comprador:**
- Página do evento: a sessão aparece como **"Cancelada"** (texto riscado + a palavra escrita, desativada) [R]: quem chegou por um link antigo entende o que houve. Na home, sessões canceladas **não aparecem**; evento com todas as sessões canceladas sai da home e a página mostra "Evento cancelado".
- Checkout com `?sessao=` de sessão cancelada: "Esta sessão foi cancelada. Escolha outra sessão."
- Página de um pedido pago dessa sessão: **esconde os QRs e o PDF** e mostra "Esta sessão foi cancelada. Seus ingressos não valem mais para entrada. A devolução do valor será feita pela equipe do Espaço Byla e você receberá um e-mail quando ela for feita." Depois do estorno, mostra o estado "Estornado" que já existe.
- Pedido pendente cancelado: "Pedido cancelado: a sessão foi cancelada."

**Reativar sessão** [R]: botão "Reativar sessão", **permitido só enquanto nenhum estorno da sessão foi iniciado** (nenhum `order_refunds` `solicitado` ou `concluido` em pedido dela, nenhum lote aberto) e antes do horário de início. Motivo obrigatório; auditoria `reativada`.
- A sessão volta a `ativa` com as **vendas fechadas** (a equipe reabre quando quiser); ingressos pagos e cortesias voltam a valer na portaria sozinhos, porque nunca mudaram de status.
- Pedidos pendentes cancelados **não voltam** (os compradores refazem a compra).
- Se o aviso de cancelamento já foi enviado, a confirmação alerta: "Os compradores já receberam o e-mail de cancelamento. Avise-os de que a sessão voltou." (e-mail de reativação fica fora de escopo).
- Motivo da recomendação: corrige um clique errado ou uma decisão revista sem nenhum risco financeiro; depois do primeiro estorno o dinheiro já saiu, então não há volta.

#### 9.4.3 Estornar um por um

- O botão "Estornar pedido" que já existe, sem mudança de regra: pedido inteiro, 100%, bloqueado se tiver entrada registrada ou mais de 180 dias, registro em `order_refunds` com quem, quando e motivo.
- Em sessão cancelada, o motivo já vem preenchido: "Sessão cancelada: <motivo do cancelamento>" (editável).
- **E-mail:** a variante "Sessão cancelada — valor devolvido" (seção 9.4.5), 1 por pedido, enviada logo após o estorno. Se o limite diário de e-mails estiver no fim, fica na fila e sai depois; **o estorno nunca espera o e-mail** e não falha por causa dele.
- Pedidos em `aguardando_decisao` dessa sessão aparecem no topo da lista da sessão com "Estornar".

#### 9.4.4 "Estornar todos"

Só aparece em **sessão cancelada** com pelo menos 1 pedido estornável. Toda a lógica de quem entra e de quanto é decidida no banco.

**Confirmação forte (diferente da do cancelamento, para não virar hábito):**
- Tela própria: "Você vai devolver **R$ 1.250,00** para **30 pedidos** da sessão <sessão>. Isto não pode ser desfeito."
- Lista do que fica de fora e por quê: "2 pedidos com entrada registrada", "1 pedido com mais de 180 dias", "4 cortesias (sem valor)".
- Aviso: "O saldo da conta de recebimentos precisa cobrir o valor total."
- Motivo (vem preenchido com o do cancelamento, editável).
- Campo **"Digite o valor total para confirmar"** → a pessoa digita `1.250,00` (aceita também `1250,00` e `1250`).
- No servidor, `start_session_refund_batch` recalcula os pedidos e o total **no banco** e compara com o valor digitado. Se mudou (ex.: alguém estornou um pedido um por um nesse meio-tempo), recusa: "Os números mudaram. Confira de novo." e a tela recarrega.

**Quem entra no lote** (foto tirada pelo banco ao criar o lote, em `session_refund_batch_items`):
- pedidos com `session_id` = a sessão do lote, status `pago` ou `aguardando_decisao`, provedor Mercado Pago e valor maior que zero;
- já entram como `pulado` (com motivo): com entrada registrada (`com_entrada`), mais de 180 dias (`prazo_180_dias`);
- pedido que já tem estorno `solicitado` (feito um por um e ainda sem resposta) entra normalmente: o estorno atual reaproveita a mesma chave, sem duplicar;
- **`orders.session_id` não muda depois de criado** (gatilho recusa `update` dessa coluna), então um pedido de outra sessão nunca entra; mesmo assim, cada item é conferido de novo antes de estornar.

**Como roda (um pedido por vez, retomável):**
1. A tela chama a ação "estornar o próximo" em sequência, **um pedido por chamada**, com cerca de 1 s de pausa entre chamadas, e mostra **"Estornando 12 de 30…"** com a lista se preenchendo (estornado / falhou / pulado).
2. Cada chamada: `requireStaffUser()` → `claim_session_refund_item` → estorno atual (`refundPaidOrder`: `begin_order_refund` → Mercado Pago com a chave de idempotência gravada no banco → `complete_order_refund`) → `finish_session_refund_item`.
3. `claim_session_refund_item` pega o próximo item `pendente` com `for update skip locked`, confere de novo sessão e status do pedido (se mudou: `pulado` com `status_mudou`) e marca `processando`. Item `processando` há mais de 2 minutos (aba fechada ou queda no meio) volta a ser pego, com `attempts + 1`.
4. **Uma tela por vez:** o lote guarda quem está rodando (`runner_token` da aba + `runner_until` de 30 s, renovado a cada chamada). Outra aba ou outra pessoa vê "Fulano está estornando esta sessão agora" e só acompanha o progresso. Se a aba dele fechar, depois de 30 s outra pessoa pode clicar em "Continuar estornos".
5. **Sem estorno automático em segundo plano** [R]: fechou a página, o lote para no ponto em que estava. Ao voltar, o painel mostra "Estorno em andamento: 12 de 30 feitos — Continuar estornos". Mexer com dinheiro exige alguém olhando.

**Resultado de cada pedido:**

| Resposta | Item fica | Na tela |
| --- | --- | --- |
| Estorno aprovado | `estornado` | "Estornado" |
| Mercado Pago aceitou, ainda processando | `em_processamento` | "Aguardando confirmação do banco" (o webhook ou a consulta conclui depois, como hoje) |
| Recusado (ex.: saldo insuficiente) | `falhou` + código | "Falhou — saldo insuficiente" |
| Entrada registrada no meio do caminho | `pulado` (`com_entrada`) | "Pulado — já entrou" |
| Erro temporário (fora do ar, tempo esgotado) | volta a `pendente` (a mesma chave é usada na próxima tentativa) | "Tentando de novo…" |

- **Falha não para o lote:** passa para o próximo.
- **3 erros temporários seguidos** → lote `pausado`: "O banco responsável pelo pagamento não está respondendo. Tente continuar em alguns minutos." + alerta à equipe.
- **Ritmo:** no máximo 1 pedido por segundo por lote, conferido também no servidor (`consume_rate_limit`), bem abaixo do limite do Mercado Pago.
- **Relatório final** (fica salvo no painel da sessão): "28 estornados · 1 falhou · 2 pulados · R$ 1.180,00 devolvidos", com a lista por pedido e o motivo; botão **"Tentar de novo os que falharam"** (volta só os `falhou` para `pendente`, com nova confirmação simples).
- Lote termina como `concluido` ou `concluido_com_falhas`; auditoria `lote_estorno_iniciado` / `retomado` / `concluido` com quem e quando. Cada pedido também fica em `order_refunds` com quem pediu.
- **Alertas:** cada falha já gera `estorno_falhou` (existente); ao terminar com falhas, um resumo `lote_estorno_com_falhas`; ao pausar, `lote_estorno_pausado`. Mesma deduplicação de hoje.

**Por que não estorna duas vezes:**
- um lote aberto por sessão (índice único parcial);
- um item por pedido no lote (`unique (batch_id, order_id)`) e um item por vez (`skip locked`);
- um estorno ativo por pedido (índice que já existe em `order_refunds`) e **a mesma chave de idempotência** em toda nova tentativa, então o Mercado Pago devolve o mesmo estorno em vez de criar outro;
- clique duplo, duas abas ou queda no meio caem em um desses quatro.

#### 9.4.5 E-mails do cancelamento

Todos usam a fila `session_notices` / `session_notice_deliveries` (seção 6.4), com **chave única (comunicado, pedido)**: o mesmo e-mail nunca vai duas vezes ao mesmo pedido, e todos respeitam o limite diário (seção 10.4).

- **Aviso de cancelamento** (caixa marcada por padrão; decisão 13): 1 por pedido pago, aguardando decisão ou cortesia. Assunto "Sessão cancelada — <Evento>". Texto: "A sessão de <sessão> foi cancelada. Motivo: <motivo>. Seus ingressos não valem mais para entrada. O valor pago será devolvido integralmente e você receberá outro e-mail quando a devolução for feita." (cortesia: sem a frase do valor).
- **Estorno de sessão cancelada:** 1 por pedido estornado, um por um ou em lote. Assunto "Sessão cancelada — valor devolvido — <Evento>". Texto: sessão cancelada, valor devolvido e prazo por meio de pagamento (o mesmo texto do e-mail de estorno atual). Sai **quando o estorno é confirmado** (na hora, ou quando o banco confirmar um "em processamento").
- No lote, cada e-mail é tentado logo depois do estorno do pedido; se o uso do dia passou de 80, fica `pendente` e segue a mesma continuação do aviso de horário (decisão 15, seção 10.4). O painel mostra "E-mails: 25 de 28 enviados; 3 serão enviados depois das 21h".
- Textos para o comprador **sem nome de fornecedor** ("banco responsável pelo pagamento").

---

## 10. Aviso de alteração de horário (decisão 10)

### 10.1 Quando aparece

- Ao salvar uma mudança de **início ou término** de uma sessão que tem pedidos pagos, o banco registra a alteração (`session_schedule_changes`: sessão, horário anterior, horário novo, quem alterou, quando).
- O painel da sessão mostra o cartão:
  - "Horário alterado de sáb 10/10 19h00 para sáb 10/10 20h00. N compradores ainda não foram avisados."
  - Botão **"Enviar e-mail de alteração para N compradores"**, com confirmação ("Cada pedido pago recebe 1 e-mail com o novo horário.").
- Várias alterações seguidas antes de enviar: o e-mail usa o horário atual como "novo" e, como "antes", o horário que o comprador conhecia (o do último aviso enviado ou, sem aviso, o da compra).

### 10.2 Quem recebe

- **1 e-mail por pedido**, para o e-mail do comprador.
- Entram: pedidos da sessão com status `pago` e pelo menos um ingresso válido (`pago` ou `check_in`), **inclusive cortesias**.
- Ficam de fora: pedidos estornados, cancelados, pendentes, aguardando decisão (se forem aceitos depois, o e-mail de ingressos já sai com o horário novo) e pedidos feitos **depois** da alteração (já compraram vendo o horário novo).
- É e-mail **transacional**: não depende do descadastro de lembretes e não tem link de descadastro.

### 10.3 Não enviar duas vezes (idempotência)

- O botão cria um comunicado `alteracao_horario` em `session_notices` (ligado à alteração em `session_schedule_changes`) e uma linha por pedido em `session_notice_deliveries`, com **chave única** `(notice_id, order_id)`, status (`pendente`, `enviado`, `falhou`), tentativas, horário de envio. A mesma fila serve aos e-mails do cancelamento (seção 9.4.5).
- O botão cria as linhas uma vez só (clicar de novo não cria outras) e grava **quem pediu e quando**.
- Envio reivindica linhas com `for update skip locked` (o mesmo padrão do lembrete): duas abas ou dois cliques não mandam o mesmo e-mail.
- Cada envio leva a chave de idempotência `aviso/<notice_id>/<order_id>` no cabeçalho do serviço de e-mail [S] (confirmar suporte na implementação; a chave única no banco já garante o essencial).
- Falha temporária: volta para `pendente` (até 3 tentativas); depois, `falhou`, listado na tela com "Tentar de novo".

### 10.4 Limite do e-mail grátis (100 por dia)

- Uma sessão tem no máximo ~100 ingressos, então no máximo ~100 pedidos, e na prática bem menos (pedidos têm vários ingressos).
- **Reserva para ingressos:** o envio para quando o uso do dia (cabeçalho `x-resend-daily-quota` da última resposta) chega a **80**, deixando 20 para ingressos e alertas. Constante em `src/lib/notices/rules.ts`.
- Também para ao receber `daily_quota_exceeded`.
- O que sobrar fica `pendente` com a mensagem: "Enviados 63 de 80. Os 17 restantes serão enviados depois das 21h (quando o limite diário de e-mails renova)."
- **Continuação** (decisão 15): **automática** pelo mesmo agendador do lembrete (job a cada 15 min que também processa os comunicados pendentes, com prioridade acima do lembrete), e um botão **"Continuar envio"** na tela como reserva.
  - O agendador (`pg_cron` + `pg_net`) hoje está **desligado** até o dono ativar. Enquanto estiver desligado, só o botão funciona, e a tela diz: "Os restantes serão enviados quando alguém clicar em Continuar envio depois das 21h." Ligar o agendador está no plano de ativação (seção 16.4).
  - O job só envia comunicados (aviso de horário, aviso de cancelamento, e-mail de estorno); **nunca faz estornos** (seção 9.4.4).
- **Progresso na tela:** enquanto a página está aberta, o envio roda em lotes de até 10 por chamada (com a pausa de 600 ms entre e-mails já usada no lembrete) e a barra mostra "Enviando… 30 de 57". Fechar a página não perde nada: o restante continua pelo agendador ou pelo botão.
- Histórico no cartão: "Aviso enviado por <nome> em 03/10 às 19h52 — 57 de 57 entregues."

### 10.5 Conteúdo do e-mail

- Assunto: "Mudança de horário — <Evento>".
- Corpo:
  - "O horário da sua sessão mudou."
  - **Novo horário** em destaque (sessão no formato padrão) e "Antes: sáb, 10/10 às 19h00" riscado;
  - local do evento;
  - "Seus ingressos continuam valendo. Não precisa fazer nada.";
  - botão **"Ver meus ingressos"** (página do pedido);
  - texto neutro, **sem prometer reembolso** (decisão 14, adiada): "Em caso de dúvidas, responda este e-mail."
- As respostas vão para o e-mail de contato do Espaço: os e-mails de sessão saem com `reply_to` = variável de ambiente `PRIVACY_CONTACT_EMAIL` (a mesma da Política de Privacidade; nada fixo no código). Sem a variável, a frase "responda este e-mail" não aparece.
- A equipe continua podendo estornar caso a caso pelo botão "Estornar pedido". Quando a decisão 14 for tomada (junto com os Termos de compra), só a frase do e-mail muda.
- Sem QR no e-mail (evita reenvio de ingressos e e-mail pesado); os QRs estão na página do pedido e no e-mail original, que continuam válidos.

---

## 11. Portaria (decisão 7)

- A tela de check-in ganha a escolha da sessão (`/equipe/eventos/[id]/check-in?sessao=<id>`). Sessão única: não pergunta.
- Sessão sugerida ao abrir: a que está acontecendo (de 2 h antes do início até o término, ou 4 h depois do início sem término); senão, a próxima. A portaria troca quando quiser; a sessão fica fixa no topo da câmera, em letras grandes.
- **QR de outra sessão do mesmo evento:** recusa em vermelho, sem marcar entrada: **"Sessão errada — este ingresso é da sessão das 20h30 (sáb, 10/10)"** (com o nome, se houver). Se a portaria é que está na sessão errada, troca e lê de novo.
- QR de outro evento: continua "Evento errado — <nome do evento>".
- **QR de sessão cancelada:** recusa em vermelho, sem marcar entrada: **"Sessão cancelada — não liberar entrada"**. Vale para pago, aguardando decisão e cortesia, e é conferido antes da "Sessão errada". A sessão cancelada não aparece na escolha de sessão da portaria.
- A regra fica no banco (`check_in_ticket` v2, seção 6.5); a rota `api/check-in` passa a exigir `sessionId` (UUID) e só repassa.
- Contador "Entraram N de M" por sessão.

---

## 12. Home e listagem (decisão 11)

### 12.1 Card do evento (mobile-first)

```
┌──────────────────────────────┐
│ [capa 16:9]                  │
│ NOME DO EVENTO               │
│ 📍 Local                     │
│ ┌────────────┐┌────────────┐ │
│ │sáb 10/10   ││sáb 10/10   │ │
│ │19h00       ││20h30       │ │
│ └────────────┘└────────────┘ │
│ ┌────────────┐┌────┐         │
│ │dom 11/10   ││ +2 │         │
│ │~~16h00~~   │└────┘         │
│ │Esgotada    │               │
│ └────────────┘               │
│ A partir de R$ 30   Ver →    │
└──────────────────────────────┘
```

- **Um card por evento.** Capa, nome e local como hoje.
- **Sessão única:** linha de data como hoje (com o nome da sessão, se houver); sem chips.
- **Várias sessões:** chips das sessões futuras em ordem de horário:
  - chip com dia ("sáb 10/10") e horário ("19h00"); com nome, o nome curto aparece numa terceira linha (corta em ~18 caracteres);
  - **esgotada:** horário riscado + "Esgotada" escrito (o risco não é a única pista, por acessibilidade);
  - vendas encerradas, **canceladas** e sessões passadas não aparecem;
  - no máximo **3 chips** no celular (5 no computador) + chip **"+N"** que leva à página do evento;
  - cada chip é um link para `/eventos/<slug>?sessao=<id>` (sessão já marcada), com área de toque mínima de 44 × 44 px. Para não haver link dentro de link, o card deixa de ser um link único: capa e nome levam à página do evento, os chips são links próprios.
- **"A partir de R$ X":** menor preço à venda e não esgotado entre as sessões vendendo; tudo esgotado → "Esgotado".
- Ordenação pela **próxima sessão** de cada evento.
- O evento aparece enquanto tiver pelo menos uma sessão que ainda não começou (vendendo ou esgotada).
- `HomeSingleEvent` (só um evento na home): mesma regra, com os chips em tamanho maior.

### 12.2 Referência

Inspirado na listagem da Shotgun (dia + hora + preço, "Sold out" no lugar do preço) e na página "Tour" da série (lista de datas) [V]. Não encontrei a Shotgun mostrando várias datas em chips dentro de um card só; a adaptação é nossa.

---

## 13. Estorno, decisão, lembrete e alertas

- **Estorno:** regras atuais (pedido inteiro, bloqueado com check-in); as vagas voltam para a sessão do pedido; a confirmação e o e-mail mostram a sessão.
- **"Pago sem vaga" e "Pago após o fim das vendas":** decididos por sessão (seção 7).
- **Lembrete:** só envia se a sessão do pedido está vendendo e tem lugar; "Continuar compra" reabre o checkout na mesma sessão; se ela encerrou, o checkout pede outra sessão. O e-mail mostra a sessão.
- **Sessão cancelada:** estorno um por um ou em lote, e-mails próprios e "Pago em sessão cancelada — estornar" (seção 9.4). Lembrete nunca vai para sessão cancelada (ela não está vendendo).
- **Alertas à equipe:** incluem a sessão; novos tipos `pago_apos_encerramento`, `pago_sessao_cancelada`, `lote_estorno_com_falhas` e `lote_estorno_pausado`.

---

## 14. Migração dos dados existentes

Migration de dados depois da de estrutura, no projeto **Espaço Byla Eventos** (`rlzyjlrcasqbjztgbgit`), com aprovação do dono e conferência do fingerprint (`events`, `tickets`, `orders`, `ticket_types`, `staff_profiles`).

1. Para cada evento: 1 sessão com `starts_at = events.starts_at`, `capacity`, `inteira_quota`, `meia_quota` do evento, nome nulo, término nulo, `sales_open = true` (o botão do evento continua valendo).
2. Para cada tipo vendável não arquivado: 1 linha em `session_ticket_types` com o **preço atual** (`price_cents`), o limite atual (`max_units`) e `on_sale = true`. Cortesia não ganha linha.
3. `orders.session_id` e `tickets.session_id` = a sessão do seu evento; depois `set not null` e a chave composta.
4. Conferência antes e depois, só com contagens (sem dados pessoais): pedidos e ingressos por status; ocupados por evento antes = ocupados pela sessão depois; preços por tipo antes = preços na sessão depois.
5. Nada é apagado.

---

## 15. Fases, estimativas e riscos

### 15.1 Fases

Cada fase vai para produção sozinha. Fases com banco exigem aprovação de cada migration. **Nenhum evento de várias sessões pode ser criado antes da portaria por sessão (fase 2) estar no ar**: o botão "+ Adicionar sessão" só aparece a partir da fase 3.

| Fase | Conteúdo | Banco | Depende de | Esforço |
| --- | --- | --- | --- | --- |
| **1. Base, preços na sessão e fim automático** | `event_sessions` e `session_ticket_types`; `session_id` em pedidos e ingressos; migração (1 sessão por evento, preços atuais); contagens e disponibilidade por sessão; checkout v4, pagamento v4, extensão do PIX, cortesia v3, lembrete v2; **venda fecha 5 min após o início**; "Pago após o fim das vendas — decidir"; o formulário atual grava na sessão única. Comprador e equipe não veem diferença, exceto o fechamento automático | Sim (estrutura + dados) | — | M-G (2–3 dias) |
| **2. Sessão na portaria e nos ingressos** | `check_in_ticket` v2 ("Sessão errada"); rota de check-in com sessão; **conteúdo do ingresso da seção 8.4** (sessão, data e horário no formato novo, número do pedido, "Ingresso X de Y", status com cartões sem QR) na página, PDF, e-mail de ingressos e "Pode entrar"; sessão no pagamento e nos e-mails de estorno e lembrete; alertas | Sim (`check_in_ticket` v2) | 1 | M (1,5–2,5 dias) |
| **3. Equipe cria sessões e preços por sessão** | Editor de sessões (nome, início, término, lotação, cotas, preços/à venda/limite por sessão, copiar, aplicar a todas); painel por sessão; "Encerrar vendas desta sessão"; cortesia com sessão; `/equipe`; "Remover sessão" só sem vendas (apagar/arquivar, seção 9.4.1); com vendas, bloqueado até a fase 6 | Sim (`save_event_sessions`, `set_session_sales_open`) | 2 | G (3–4 dias) |
| **4. Comprador escolhe a sessão** | Escolha de sessão na página do evento; sessão repetida no checkout, barra e pagamento; carrinho `v3` com troca de preços; `?retomar=` com sessão; card da home com chips e "A partir de" | Não | 3; layout mobile-first estável nessas telas | M-G (2–3 dias) |
| **5. Aviso de alteração de horário** | Registro das alterações; fila de comunicados (`session_notices` + entregas idempotentes); botão de envio; limite diário e continuação; progresso e histórico; e-mail | Sim (3 tabelas + funções; job do agendador se aprovado) | 3 | M (1–2 dias) |
| **6. Cancelar sessão e estornos** (decisão 9, opção D) | **6a.** Cancelar com confirmação forte, auditoria, pendentes e PIX cancelados, portaria "Sessão cancelada", páginas do comprador, "Pago em sessão cancelada", reativar (~2 dias). **6b.** Estorno um por um com a variante de e-mail; "Estornar todos" com lote retomável, uma tela por vez, relatório, alertas e e-mails na fila (~2–3 dias). **6c.** Testes de dinheiro (seção 15.2) e ensaio completo com as credenciais de teste do Mercado Pago (~1 dia) | Sim (colunas de status, 3 tabelas, 8 funções, `check_in_ticket` e `mark_order_paid_by_external` ajustados) | 2, 3, 5 | G (4–6 dias) |
| **7. Limpeza** | Remover `events.capacity`/cotas, `ticket_types.price_cents`/`max_units`, funções antigas e a assinatura antiga de `check_in_ticket` | Sim | 1–5 em produção | P (0,5 dia) |

- Estimativas de trabalho do agente, sem a espera por aprovações e testes do dono.
- **Para vender um evento de 2 sessões:** fases 1 a 4 (cerca de 8,5 a 12,5 dias). Com o aviso de horário: + fase 5 (9,5 a 14,5 dias). Com cancelar sessão e estornos: + fase 6 (**13,5 a 20,5 dias**). Limpeza: + 0,5 dia (**total de 14 a 21 dias**).
- A fase 6 pode ir ao ar depois das vendas de várias sessões começarem: até lá, sessão com vendas simplesmente não pode ser removida, e um cancelamento de emergência é feito encerrando as vendas e estornando um por um pelo botão que já existe.
- **A fase 6 só vai para produção depois** do ensaio completo com as credenciais de teste do Mercado Pago (vendedor de teste `APP_USR-`, cartões de teste) e da aprovação do dono; o primeiro "Estornar todos" real deve ser acompanhado (sugestão: lote pequeno).

### 15.2 Testes

- **Unidade:** `sessions.ts` (validação do editor, "vendendo agora", sessão sugerida na portaria, formato padrão da sessão); "A partir de" entre sessões; chips da home (+N, esgotada); carrinho `v3` e troca de preços; regras do aviso (destinatários, limite de 80, retomada).
- **Ações:** quem não é equipe é recusado antes do banco; sessão de outro evento recusada; `sessionId` inválido recusado; botão de aviso sem alteração pendente recusado.
- **SQL** (ramo de teste ou local, nunca produção sem aprovação):
  - duas compras simultâneas na mesma sessão não passam da lotação; em sessões diferentes, não se bloqueiam;
  - preço e limite lidos da sessão; tipo desligado na sessão recusado;
  - checkout recusado às `starts_at + 5 min`; pedido criado antes paga com cartão dentro da reserva; PIX novo recusado depois do fechamento; pagamento tardio com sessão encerrada → `sessao_encerrada`;
  - compatibilidade: `p_session_id` nulo com 1 sessão funciona; com 2, recusa; `check_in_ticket` antigo recusa evento com 2 sessões;
  - `check_in_ticket` v2: sessão certa entra; sessão errada recusa sem marcar e devolve só o horário/nome da sessão;
  - aviso: botão duas vezes cria as entregas uma vez; duas execuções em paralelo não enviam o mesmo pedido;
  - migração: contagens e preços iguais antes e depois.
- **Dinheiro — cancelar e estornar (obrigatórios antes da fase 6 ir ao ar):**
  - cancelar: pendentes viram `cancelado` e a vaga volta; pagos, aguardando decisão e cortesias não mudam; auditoria gravada; texto de confirmação errado ou motivo curto recusados no servidor; cancelar duas vezes não faz nada na segunda;
  - corrida check-in × cancelamento: o que travar primeiro vence; depois do cancelamento, a portaria sempre recusa com `sessao_cancelada`;
  - pagamento tardio (PIX e cartão) em sessão cancelada → `aguardando_decisao` / `sessao_cancelada`; "Aceitar mesmo assim" recusado pelo banco;
  - reativar: permitido sem estorno; recusado depois de qualquer estorno `solicitado` ou `concluido` ou com lote aberto;
  - **concorrência:** dois "Estornar todos" ao mesmo tempo → só um lote; duas abas no mesmo lote → só uma roda, a outra só acompanha; dois `claim` em paralelo nunca pegam o mesmo item;
  - **execução dupla:** clique duplo, reenvio da mesma chamada e "Tentar de novo" nunca criam segundo estorno (mesma chave; o simulador do Mercado Pago conta as chamadas e confere a chave);
  - **queda no meio:** interromper depois de `begin_order_refund` e antes da resposta → o item é pego de novo depois de 2 min e usa a mesma chave; interromper depois da resposta e antes de `finish` → idem, sem duplicar;
  - **provedor fora do ar:** 5xx e tempo esgotado voltam o item para `pendente`; 3 seguidos pausam o lote e alertam; recusa (saldo) vira `falhou` e o lote segue;
  - webhook `order.refunded` chegando no meio do lote não duplica nem quebra o item;
  - pedido de outra sessão nunca entra no lote; tentar mudar `orders.session_id` é recusado pelo gatilho;
  - total digitado diferente do calculado no banco → recusado; total que mudou entre a tela e o clique → recusado;
  - e-mails: cada pedido estornado gera 1 entrega só; com o uso do dia em 80, o estorno conclui e o e-mail fica `pendente`; falha no e-mail nunca muda o resultado do estorno;
  - quem não é equipe é recusado em todas as ações antes de chegar ao banco.
- **Ensaio com o Mercado Pago de teste:** sessão de teste com ~5 pedidos pagos com cartão de teste → cancelar → estornar 1 um por um → "Estornar todos" → fechar a aba no meio → continuar → conferir no painel de teste do Mercado Pago que cada pagamento tem **um** estorno só e que os e-mails chegaram uma vez.
- **Navegador (360 px, tema claro e escuro):** evento de sessão única parecido com hoje; evento com 3 sessões com preços diferentes (uma esgotada, uma encerrada); chips na home; trocar sessão no checkout (preços mudam); pagamento de teste; ingresso, PDF, e-mail e "Pode entrar" conferidos item por item com a seção 8.4.5; check-in com QR de outra sessão; mudar horário e enviar aviso para pedidos de teste.

### 15.3 Riscos e conflitos

- **Fechamento automático em eventos atuais:** depois da fase 1, eventos já começados param de vender na hora. Avisar o dono antes do deploy.
- **Check-in:** a fase 2 troca a assinatura de `check_in_ticket` (que acabou de entrar). Manter a antiga na janela de deploy, com falha fechada para eventos de várias sessões.
- **Lembrete:** `claim_abandoned_order_reminders` lê `events.capacity`/`starts_at`; precisa da v2 já na fase 1, senão usa números desatualizados.
- **Limite de e-mails:** aviso de horário, lembrete (até 30/dia) e ingressos dividem 100/dia. O aviso para em 80; num dia de muitas vendas + aviso grande, parte do aviso vai depois das 21h. Se o volume crescer, considerar plano pago do serviço de e-mail.
- **Layout mobile-first:** mexe nas mesmas telas das fases 2–4 (evento, checkout, home, painel, check-in). Regra: lógica aqui, visual lá; ordem detalhada na seção 16.
- **Editor maior na equipe:** preços por sessão aumentam o formulário; mitigado por "copiar da anterior", "aplicar a todas" e pela tela de sessão única igual à de hoje.
- **Deploy em duas etapas:** migration antes do código (compatibilidade na seção 6.5).
- **Fuso:** horários sempre em `America/Sao_Paulo` na tela (`src/lib/datetime.ts`); comparações no banco com `timestamptz`. O limite do e-mail renova às 21h de Brasília.
- **Cancelar e estornar (opção D) — mexe com dinheiro:**
  - **saldo:** o saldo da conta de recebimentos precisa cobrir o lote; se não cobrir, os pedidos falham um a um (o lote segue, alerta à equipe, "Tentar de novo" depois);
  - **180 dias:** pedidos mais antigos não estornam pelo site (ficam como `pulado` e a equipe resolve por fora);
  - **com entrada registrada:** não estornam pelo site (regra atual); a tela de impacto avisa antes de cancelar;
  - **sem volta:** depois do primeiro estorno, a sessão não pode ser reativada;
  - **limite de e-mails:** um lote grande no mesmo dia de vendas pode deixar e-mails para depois das 21h; o estorno não espera;
  - **reativar depois do aviso de cancelamento** pode confundir compradores; a tela alerta, e o e-mail de reativação ficou fora de escopo.

---

## 16. Dependências e ordem de execução

### 16.1 Onde as sessões e o redesign mobile-first se cruzam

O plano visual mobile-first (`docs/superpowers/specs/2026-10-03-redesign-mobile-first-plano.md`, seção 6) ainda vai mexer em telas que as sessões também mudam. Regra geral: **lógica aqui, visual lá**, e **nunca as duas frentes no mesmo arquivo ao mesmo tempo**.

| Tela | Passo do mobile-first | Fase das sessões que mexe nela | Quem vai primeiro [R] |
| --- | --- | --- | --- |
| Componentes `ui/` e cores | 1 | Todas usam (seletor, chips, faixa da sessão) | Mobile-first |
| Home e card do evento | 3 | 4 (chips das sessões, "A partir de") | Mobile-first |
| Página do evento | 4 | 4 (escolha da sessão, preços por sessão) | Mobile-first |
| Check-in | 7 | 2 (escolha da sessão, "Sessão errada", "Sessão cancelada") | Mobile-first |
| **Painel do evento** | **8** | 3 (seletor de sessão, números por sessão, editor), 5 (cartão do aviso), 6 (cancelar, estornos) | **Mobile-first** (a fase 3 encaixa as sessões na nova ordem do painel aprovada pelo dono) |
| Formulário do evento | (4.10 do plano) | 3 (cartões de sessão e preços por sessão) | Mobile-first, se estiver no mesmo ciclo; senão as sessões, com os componentes `ui/` |
| **Checkout** | **9** | 1 (só a função do banco, sem tela), 4 (cartão da sessão, carrinho `v3`) | **Mobile-first** |
| Pedido e pagamento | 10 | 2 (sessão acima do QR), 6 (sessão cancelada esconde QRs) | Mobile-first |

Motivo de o visual ir primeiro: as sessões **acrescentam** conteúdo a essas telas; montar em cima do layout novo evita refazer o visual duas vezes. A fase 1 das sessões não muda nenhuma tela (exceto o fechamento automático da venda) e pode correr em paralelo.

### 16.2 Ordem recomendada

1. **Aprovação desta spec** pelo dono → plano de implementação (tarefas pequenas, um commit por passo).
2. **Sessões, fase 1** (banco e servidor) **em paralelo** com os passos 1–7 e 11 do mobile-first. Antes do deploy: aprovação da migration e aviso ao dono de que a venda passa a fechar 5 min após o início.
3. **Mobile-first, passos 7–10** (check-in, painel, checkout, pedido).
4. **Sessões, fase 2** (portaria, pedido, ingresso, e-mails) — depois dos passos 7 e 10.
5. **Sessões, fase 3** (equipe cria sessões) — depois do passo 8 e do formulário.
6. **Sessões, fase 4** (comprador escolhe a sessão) — depois dos passos 3, 4 e 9. A partir daqui dá para vender um evento de 2 sessões.
7. **Sessões, fase 5** (aviso de horário).
8. **Sessões, fase 6** (cancelar e estornos) — só depois do ensaio com o Mercado Pago de teste (seção 15.1).
9. **Sessões, fase 7** (limpeza) — com as fases 1–6 em produção e estáveis.

Se o mobile-first atrasar, as fases 2 e 3 podem ir antes, desde que a outra frente faça rebase em cima delas; a fase 4 (checkout e página do evento) espera de qualquer jeito.

### 16.3 Regras de coordenação

- Cada fase em uma branch nova a partir do `feat/mvp` atualizado; antes de começar, conferir o histórico dos arquivos que a fase vai tocar.
- Componentes novos das sessões (seletor de sessão, chips, faixa "Você está comprando para", faixa "Sessão cancelada") usam os componentes e cores do passo 1 do mobile-first, sem estilo próprio.
- Conflito no mesmo arquivo: para e combina com a outra frente antes de seguir (sem resolver "no escuro").
- Mudanças de banco seguem a regra do projeto: só no **Espaço Byla Eventos**, com conferência do fingerprint e aprovação de cada migration.

### 16.4 Plano de ativação (fora do código, com aprovação do dono)

| Quando | O quê | Por quê |
| --- | --- | --- |
| Antes do deploy da fase 1 | Aprovar as migrations de estrutura e de dados; avisar que a venda fecha 5 min após o início | Mudança de banco e de comportamento em produção |
| Antes da fase 5 ir ao ar | **Ligar o agendador** (`pg_cron` + `pg_net`, job a cada 15 min, rota protegida por segredo) que hoje está desligado | Decisão 15: continuar envios sozinho quando o limite renova. Sem ele, só o botão "Continuar envio" funciona |
| Antes da fase 5 ir ao ar | Conferir a variável `PRIVACY_CONTACT_EMAIL` na Vercel | `reply_to` dos e-mails de sessão (decisão 14) |
| Antes da fase 6 ir ao ar | Ensaio completo com as credenciais de teste do Mercado Pago; aprovação do dono | Mexe com dinheiro (seção 15.2) |
| Primeiro uso real da fase 6 | Acompanhar o primeiro "Estornar todos" (de preferência um lote pequeno) | Conferir estornos e e-mails na vida real |

---

## 17. Decisões adiadas e pendências

**Nenhuma pendência bloqueia a implementação.** Falta só a aprovação desta spec.

- **Decisão 14 — reembolso para quem não pode ir no novo horário: adiada.** Enquanto isso: o e-mail de mudança de horário é neutro ("Em caso de dúvidas, responda este e-mail"), sem prometer reembolso; a equipe decide caso a caso e estorna pelo botão "Estornar pedido". Deve ser decidida junto com os **Termos de compra** (página ainda pendente no projeto, com as regras de reembolso e cancelamento). Quando decidida, muda só a frase do e-mail e o texto dos Termos.
- **Termos de compra (pendente do projeto, fora desta spec):** devem incluir também o que acontece quando uma sessão é cancelada (devolução integral) e quando o horário muda (decisão 14).
- **Orientação de meia-entrada no ingresso** (não existe hoje; seção 8.4.2): sugestão de frase "apresente na entrada o documento que comprova o direito" no ingresso de tipo meia, a decidir com os Termos de compra. Não bloqueia.
- **E-mail de reativação de sessão:** fora de escopo (seção 9.4.2); a tela alerta a equipe para avisar por fora.
