# Sessões dentro do evento — design

Data: 2026-10-03 · Status: **RASCUNHO v2 — decisões do dono registradas (seção 2); falta a decisão 9 e as novas dúvidas (seção 16)** · Base: código em `origin/feat/mvp` (`91efe7a`), que já inclui o check-in pela função do banco `check_in_ticket`, a equipe só lendo `tickets`/`orders` e o lembrete de compra não finalizada. Migrations até `20261010110000_abandoned_reminders_schedule.sql`.

Legenda: **[V]** verificado em código ou na central de ajuda oficial · **[S]** suposição, a confirmar · **[R]** recomendação desta spec.

Ponto de partida (dono, 2026-10-03): um evento pode ter **mais de uma sessão** (ex.: 19h e 20h30), modeladas **dentro do evento**. A maioria dos eventos continua com sessão única, e cada sessão vende no máximo cerca de 100 ingressos.

---

## 1. Objetivo

1. A equipe cria um evento com uma ou várias sessões (data, horário, nome opcional), cada uma com lotação, cotas e **preços próprios**, e controla a venda de cada sessão.
2. O comprador escolhe a sessão antes dos ingressos, de forma muito clara, e vê essa escolha repetida no resumo, no pagamento, no ingresso e no e-mail. Evento de sessão única continua parecido com o de hoje.
3. Cada ingresso pertence a uma sessão: lotação, check-in, e-mail, PDF e página do pedido mostram a sessão certa.
4. A venda de cada sessão fecha sozinha 5 minutos depois do início.
5. Mudou o horário de uma sessão com vendas: a equipe avisa todos os compradores por e-mail com um botão.
6. Os eventos atuais viram eventos de 1 sessão, com os preços atuais, sem perder nenhum dado.

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
| 9 | Remover sessão com vendas | **PENDENTE** — o dono vai receber nova explicação. Opções A e C descritas na seção 9.4. |
| 10 | Mudar horário com vendas | **A + novo:** aviso na tela **e** botão para **enviar automaticamente** um e-mail de alteração de horário a todos os compradores pagos daquela sessão (seção 10). |
| 11 | Home | Um card por evento, com as **sessões destacadas no card** (chips com data e horário, "Esgotada" riscada, "+2" quando forem muitas). Seção 12. |
| 12 | Nome da sessão | **B** — nome opcional (ex.: "Sessão infantil"), mostrado junto do horário. |

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
| `archived_at` | `timestamptz` | sessão escondida da venda e da página; continua no histórico |
| `cancelled_at`, `cancelled_by`, `cancel_reason` | | só se a decisão 9 for **C** (seção 9.4) |
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
- **`orders.decision_reason`:** o check ganha `sessao_encerrada` (seção 7.3).
- **`order_items`:** sem mudança. O preço já é copiado no momento da compra.
- **`events.capacity`, `inteira_quota`, `meia_quota`:** param de ser usados; espelham a sessão única na janela de deploy e saem na limpeza.
- **`events.starts_at`:** resumo mantido pelas funções = início da primeira sessão ativa. Usado só para ordenar e pelo código antigo na janela de deploy.

### 6.4 Funções do banco

Todas com `set search_path = ''`, `revoke … from public, anon, authenticated` e `grant execute … to service_role`. As que agem em nome da equipe recebem `p_staff_user_id` e conferem `staff_profiles`, no padrão de `check_in_ticket`.

- **Contagens por sessão** (mesma regra de hoje: pago, check-in, reserva ativa, estorno `solicitado`):
  - `session_occupied_count(p_session_id, p_exclude_order_id default null)`;
  - `session_kind_occupied_count(p_session_id, p_kind, p_exclude_order_id default null)`;
  - `session_type_units_taken(p_session_id, p_ticket_type_id, p_exclude_order_id default null)`.
- **`session_is_selling(p_session_id) returns boolean`:** evento com `sales_open`, sessão com `sales_open`, não arquivada nem cancelada, e `now() < starts_at + 5 min`.
- **`session_availability(p_session_id) returns jsonb`:** formato atual de `event_availability` (`capacity`, `sold`, `held`, `remaining`, `categories`, `types`), com o preço e o "à venda" de cada tipo naquela sessão.
- **`event_sessions_summary(p_event_id) returns jsonb`:** sessões ativas com `id`, `name`, `starts_at`, `ends_at`, `selling`, `sold_out`, `remaining`, `min_price_cents` (menor preço à venda e não esgotado) e o `min_price_cents` do evento (menor entre as sessões vendendo). Uma chamada para home, página do evento e painel.
- **`create_checkout_order` v4:** ganha `p_session_id`.
  - Trava a **sessão** (`for update`), não o evento: compras em sessões diferentes não se esperam; na mesma sessão continuam em fila.
  - Exige `session_is_selling`. Preço, "à venda" e limite vêm de `session_ticket_types`; lotação e cotas, da sessão.
  - Erros novos: `SESSAO_INDISPONIVEL` (inexistente, arquivada, cancelada ou de outro evento) e `SESSAO_ENCERRADA` (venda encerrada pela equipe ou pelo horário). Os atuais (`ESGOTADO_EVENTO`, `ESGOTADO_CATEGORIA`, `ESGOTADO_TIPO`, `LIMITE_PESSOAS`, `TIPO_INDISPONIVEL`) passam a valer para a sessão.
  - Janela de deploy: `p_session_id` nulo + evento com exatamente 1 sessão → usa essa sessão. Com mais de uma → `SESSAO_INDISPONIVEL`.
- **`extend_order_hold_for_pix`:** passa a recusar quando a sessão do pedido não está mais vendendo (seção 7.2).
- **`mark_order_paid_by_external` v4:** rechecagem pela sessão do pedido; novo caso `sessao_encerrada` (seção 7.3). Trava pedido e depois sessão.
- **`accept_paid_order`:** o aviso "A lotação passará de X para Y" usa a sessão.
- **`issue_courtesy_ticket` v3:** ganha `p_session_id`; ocupa lugar da sessão; permitida mesmo com venda encerrada (é a equipe que emite).
- **`save_event_sessions(p_event_id, p_sessions jsonb, p_staff_user_id)`**, chamada na mesma transação que salva evento e tipos (`update_event_with_capacity` v4 e criação):
  - item: `{ id | null, name | null, starts_at, ends_at | null, capacity, inteira_quota | null, meia_quota | null, prices: [{ ticket_type_ref, price_cents, max_units | null, on_sale }] }`;
  - recusa: lotação, cota ou limite abaixo do já ocupado (`SESSAO_LOTACAO_MENOR`, `SESSAO_COTA_MENOR`, `SESSAO_LIMITE_MENOR`, com sessão e número); remover sessão com ingressos válidos (`SESSAO_COM_VENDAS`, seção 9.4); horário repetido; tipo à venda sem preço; sessão sem nenhum tipo à venda; de 1 a 20 sessões;
  - mudou `starts_at` ou `ends_at` de sessão com pedidos pagos → registra a alteração em `session_schedule_changes` (seção 10);
  - atualiza o resumo `events.starts_at`.
- **`set_session_sales_open(p_session_id, p_open, p_staff_user_id)`:** botão por sessão. Reabrir depois do horário não faz voltar a vender (o horário manda).
- **`check_in_ticket` v2:** nova assinatura `(p_event_id, p_session_id, p_code, p_staff_user_id)`, evoluindo a função atual (mesma trava do ingresso, mesmo registro de `checked_in_by`). Novo resultado **`sessao_errada`**, que devolve só `other_session_name` e `other_session_starts_at` (nada do comprador), como `evento_errado` devolve só o nome do outro evento. A assinatura antiga continua na janela de deploy e **recusa com `sessao_errada` qualquer ingresso de evento com mais de uma sessão** (falha fechada); sai na limpeza.
- **`claim_abandoned_order_reminders` v2:** o critério de evento vira critério da **sessão do pedido** (`session_is_selling` e `session_occupied_count < capacity`), e devolve também nome e início da sessão. A regra "1 lembrete por e-mail e evento" continua por evento.
- Funções do aviso de horário (seção 10) e, se a decisão 9 for C, do cancelamento de sessão (seção 9.4).
- **Saem de uso** (removidas na limpeza): `event_occupied_count`, `event_kind_occupied_count`, `event_availability`, `ticket_type_units_taken`, a assinatura antiga de `check_in_ticket`.

### 6.5 Segurança e RLS

- `event_sessions` e `session_ticket_types`: RLS ligada; leitura pública só do que está à venda e visível (sessão não arquivada de evento com `sales_open`; preço `on_sale` de tipo não arquivado); a equipe lê tudo (`is_staff()`); **sem política de escrita** (só funções com `service_role`, como `ticket_types`, `order_items`, `tickets` e `orders` hoje).
- `session_schedule_changes` e `session_change_deliveries`: RLS ligada; só a equipe lê; escrita só pelas funções. Guardam `order_id`, nunca e-mail copiado.
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

- O mesmo vale quando a equipe encerra antes do horário.
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
- **Página do pedido pago, bloco de sucesso, `TicketQr`, `DownloadTicketPdf`:** sessão em destaque acima do QR ("Sessão das 19h00 · sáb, 10/10"); é o que a portaria confere.
- **E-mail de ingressos:** assunto "Seus ingressos — <Evento> · sáb 10/10 às 19h00"; corpo com a sessão no topo, antes dos QRs.
- **E-mail de estorno e lembrete:** mostram a sessão.

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
- Por sessão: Lotação, Vendidos, Reservados agora, Restantes, vendidos/cota por categoria, vendidos/limite por tipo, **preços daquela sessão**; botão "Encerrar vendas desta sessão" (com o horário automático: "Encerra sozinha às 19h05"); atalho "Check-in desta sessão"; cartão do aviso de horário (seção 10) e, se C, "Cancelar sessão".
- Participantes, "Precisa de decisão", estorno e cortesia mostram e filtram a sessão. "Emitir cortesia" pede a sessão (em sessão única, não pergunta).
- Lista `/equipe`: sessão única mostra a data; várias, "3 sessões · próxima: 10/10 19h00". "Passado" = todas as sessões já começaram.

### 9.3 Cortesia

Emitida para uma sessão; ocupa lugar dela; o e-mail mostra a sessão.

### 9.4 Remover sessão com vendas — PENDENTE (decisão 9)

Em qualquer opção: **sessão sem nenhum pedido pago ou reservado** pode ser removida direto (some do site; se nunca teve pedido, é apagada; se teve só pedidos vencidos/cancelados, é arquivada para não quebrar o histórico).

**Opção A — remover só depois de estornar um a um**
- O botão "Remover sessão" fica bloqueado: "Esta sessão tem N pedidos pagos. Encerre as vendas e estorne os pedidos antes de remover."
- A equipe estorna cada pedido pelo botão "Estornar pedido" que já existe; quando não sobrar nenhum, a sessão pode ser removida.
- Sem código novo além do bloqueio. Para avisar os compradores, a equipe usa o próprio e-mail de estorno (já existe) ou escreve por fora.

**Opção C — botão "Cancelar sessão" (estorna tudo de uma vez)**
- Botão "Cancelar sessão" no painel da sessão. Confirmação forte: mostra "N pedidos pagos · R$ X serão devolvidos · M cortesias serão canceladas", campo motivo (5 a 500 caracteres) e exige digitar **CANCELAR**.
- Bloqueado se algum ingresso da sessão já tem entrada registrada.
- Ao confirmar:
  1. encerra as vendas da sessão e marca `cancelled_at`, `cancelled_by`, `cancel_reason`;
  2. cancela os pedidos pendentes (e os PIX abertos no Mercado Pago, como "Alterar seleção" já faz);
  3. cancela as cortesias;
  4. estorna os pedidos pagos **um por um**, reaproveitando o estorno atual (`begin_order_refund` → Mercado Pago → `complete_order_refund`), cada um com sua chave e seu registro de quem pediu;
  5. envia a cada comprador o e-mail **"Sessão cancelada"** (evento, sessão, valor devolvido e prazo por meio de pagamento), no lugar do e-mail de estorno comum;
  6. quando todos os pedidos estiverem resolvidos, a sessão some do site.
- Tela de progresso: "Estornados 12 de 30 · 1 falhou (saldo insuficiente no Mercado Pago) — Tentar de novo". Falhas ficam listadas; a sessão só some quando todas forem resolvidas.
- E-mails seguem o mesmo controle de limite diário do aviso de horário (seção 10.4).
- Riscos: o saldo no Mercado Pago precisa cobrir todos os estornos; pedidos com mais de 180 dias não estornam pelo site.
- Esforço: G (3–4 dias).

**Recomendação [R]:** A agora (zero esforço, e cancelar sessão deve ser raro num espaço de ~100 lugares); C numa fase futura, se acontecer na prática.

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

- Tabela `session_change_deliveries`: uma linha por (alteração, pedido), com **chave única** `(change_id, order_id)`, status (`pendente`, `enviado`, `falhou`), tentativas, horário de envio.
- O botão cria as linhas uma vez só (clicar de novo não cria outras) e grava **quem pediu e quando**.
- Envio reivindica linhas com `for update skip locked` (o mesmo padrão do lembrete): duas abas ou dois cliques não mandam o mesmo e-mail.
- Cada envio leva a chave de idempotência `aviso-horario/<change_id>/<order_id>` no cabeçalho do serviço de e-mail [S] (confirmar suporte na implementação; a chave única no banco já garante o essencial).
- Falha temporária: volta para `pendente` (até 3 tentativas); depois, `falhou`, listado na tela com "Tentar de novo".

### 10.4 Limite do e-mail grátis (100 por dia)

- Uma sessão tem no máximo ~100 ingressos, então no máximo ~100 pedidos, e na prática bem menos (pedidos têm vários ingressos).
- **Reserva para ingressos:** o envio para quando o uso do dia (cabeçalho `x-resend-daily-quota` da última resposta) chega a **80**, deixando 20 para ingressos e alertas. Constante em `src/lib/notices/rules.ts`.
- Também para ao receber `daily_quota_exceeded`.
- O que sobrar fica `pendente` com a mensagem: "Enviados 63 de 80. Os 17 restantes serão enviados depois das 21h (quando o limite diário de e-mails renova)."
- **Continuação [R]** (nova dúvida 2, seção 16): automática pelo mesmo agendador do lembrete (job a cada 15 min que também processa avisos pendentes, prioridade acima do lembrete), e um botão "Continuar envio" na tela como reserva.
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
  - frase sobre quem não puder ir no novo horário (depende da nova dúvida 1).
- Sem QR no e-mail (evita reenvio de ingressos e e-mail pesado); os QRs estão na página do pedido e no e-mail original, que continuam válidos.

---

## 11. Portaria (decisão 7)

- A tela de check-in ganha a escolha da sessão (`/equipe/eventos/[id]/check-in?sessao=<id>`). Sessão única: não pergunta.
- Sessão sugerida ao abrir: a que está acontecendo (de 2 h antes do início até o término, ou 4 h depois do início sem término); senão, a próxima. A portaria troca quando quiser; a sessão fica fixa no topo da câmera, em letras grandes.
- **QR de outra sessão do mesmo evento:** recusa em vermelho, sem marcar entrada: **"Sessão errada — este ingresso é da sessão das 20h30 (sáb, 10/10)"** (com o nome, se houver). Se a portaria é que está na sessão errada, troca e lê de novo.
- QR de outro evento: continua "Evento errado — <nome do evento>".
- A regra fica no banco (`check_in_ticket` v2, seção 6.4); a rota `api/check-in` passa a exigir `sessionId` (UUID) e só repassa.
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
  - vendas encerradas e sessões passadas não aparecem;
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
- **Alertas à equipe:** incluem a sessão; novo tipo `pago_apos_encerramento`.

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
| **2. Sessão na portaria e nos ingressos** | `check_in_ticket` v2 ("Sessão errada"); rota de check-in com sessão; sessão no pedido, pagamento, `TicketQr`, PDF, e-mails de ingresso, estorno e lembrete; alertas | Sim (`check_in_ticket` v2) | 1 | M (1–2 dias) |
| **3. Equipe cria sessões e preços por sessão** | Editor de sessões (nome, início, término, lotação, cotas, preços/à venda/limite por sessão, copiar, aplicar a todas); painel por sessão; "Encerrar vendas desta sessão"; cortesia com sessão; `/equipe`; remoção conforme decisão 9 (A = só o bloqueio) | Sim (`save_event_sessions`, `set_session_sales_open`) | 2 | G (3–4 dias) |
| **4. Comprador escolhe a sessão** | Escolha de sessão na página do evento; sessão repetida no checkout, barra e pagamento; carrinho `v3` com troca de preços; `?retomar=` com sessão; card da home com chips e "A partir de" | Não | 3; layout mobile-first estável nessas telas | M-G (2–3 dias) |
| **5. Aviso de alteração de horário** | Registro das alterações; botão de envio; entregas idempotentes; limite diário e continuação; progresso e histórico; e-mail | Sim (2 tabelas + funções; job do agendador se aprovado) | 3 | M (1–2 dias) |
| **6. Cancelar sessão** (só se decisão 9 = C) | Seção 9.4, opção C | Sim | 3, 5 | G (3–4 dias) |
| **7. Limpeza** | Remover `events.capacity`/cotas, `ticket_types.price_cents`/`max_units`, funções antigas e a assinatura antiga de `check_in_ticket` | Sim | 1–5 em produção | P (0,5 dia) |

- Estimativas de trabalho do agente, sem a espera por aprovações e testes do dono.
- **Para vender um evento de 2 sessões:** fases 1 a 4 (cerca de 8 a 12 dias). Com o aviso de horário: + fase 5 (total de 9 a 14 dias). Cancelar sessão (C): + 3 a 4 dias.

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
- **Navegador (360 px, tema claro e escuro):** evento de sessão única parecido com hoje; evento com 3 sessões com preços diferentes (uma esgotada, uma encerrada); chips na home; trocar sessão no checkout (preços mudam); pagamento de teste; ingresso e e-mail com a sessão; check-in com QR de outra sessão; mudar horário e enviar aviso para pedidos de teste.

### 15.3 Riscos e conflitos

- **Fechamento automático em eventos atuais:** depois da fase 1, eventos já começados param de vender na hora. Avisar o dono antes do deploy.
- **Check-in:** a fase 2 troca a assinatura de `check_in_ticket` (que acabou de entrar). Manter a antiga na janela de deploy, com falha fechada para eventos de várias sessões.
- **Lembrete:** `claim_abandoned_order_reminders` lê `events.capacity`/`starts_at`; precisa da v2 já na fase 1, senão usa números desatualizados.
- **Limite de e-mails:** aviso de horário, lembrete (até 30/dia) e ingressos dividem 100/dia. O aviso para em 80; num dia de muitas vendas + aviso grande, parte do aviso vai depois das 21h. Se o volume crescer, considerar plano pago do serviço de e-mail.
- **Layout mobile-first:** mexe nas mesmas telas das fases 2–4 (evento, checkout, home, painel, check-in). Regra: lógica aqui, visual lá; a fase 4 começa quando essas telas estabilizarem.
- **Editor maior na equipe:** preços por sessão aumentam o formulário; mitigado por "copiar da anterior", "aplicar a todas" e pela tela de sessão única igual à de hoje.
- **Deploy em duas etapas:** migration antes do código (compatibilidade na seção 6.4).
- **Fuso:** horários sempre em `America/Sao_Paulo` na tela (`src/lib/datetime.ts`); comparações no banco com `timestamptz`. O limite do e-mail renova às 21h de Brasília.
- **Opção C (se escolhida):** saldo no Mercado Pago precisa cobrir todos os estornos; prazo de 180 dias.

---

## 16. Decisões pendentes (perguntas ao dono)

Responder uma por vez.

**9. Remover uma sessão que já tem ingressos vendidos** (o dono vai receber nova explicação; detalhes na seção 9.4)
- A) A sessão só pode ser removida depois que a equipe estornar os pedidos um a um, pelo botão "Estornar pedido" que já existe. **← recomendado agora** (pronto sem trabalho extra; cancelar sessão deve ser raro)
- C) Um botão "Cancelar sessão" que, com uma confirmação forte (digitar CANCELAR), estorna de uma vez todos os pedidos pagos daquela sessão, cancela os pendentes e as cortesias, manda um e-mail "Sessão cancelada" a cada comprador e esconde a sessão. Mais 3 a 4 dias de trabalho.
- Nas duas, sessão sem vendas pode ser apagada direto.

**Nova 1. Quem não puder ir no novo horário pode pedir o dinheiro de volta?**
- A) Sim: o e-mail de mudança diz "Se não puder ir no novo horário, responda este e-mail que devolvemos 100%", e a equipe estorna pelo botão de sempre. **← recomendado** (a Sympla orienta oferecer reembolso quando a data muda)
- B) Não: o e-mail só informa o novo horário.

**Nova 2. Se o limite diário de e-mails acabar no meio do aviso de horário, o resto vai sozinho depois das 21h?**
- A) Sim, sozinho, usando o mesmo agendador do lembrete (precisa estar ligado), e também com um botão "Continuar envio" na tela. **← recomendado**
- B) Só pelo botão "Continuar envio", que alguém da equipe clica depois das 21h.
