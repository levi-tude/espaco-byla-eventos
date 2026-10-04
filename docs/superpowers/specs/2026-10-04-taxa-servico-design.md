# Taxa de serviço — design

Data: 2026-10-04 · Status: **RASCUNHO para aprovação do dono** (decisões 1–10 já aprovadas; perguntas abertas na seção 17) · Base: produção `origin/main` (`c54b7e8`), migrations até `20261012100000_session_notices_cancel.sql`.

Legenda: **[V]** verificado no código · **[S]** suposição, a confirmar · **[R]** recomendação desta spec.

Ponto de partida (dono, 2026-10-04): o desenvolvedor do site presta serviço ao Espaço Byla e recebe uma **taxa de serviço cobrada do comprador**. O dinheiro continua caindo 100% na conta do Espaço no banco de pagamento (sem divisão automática); o site calcula e separa a taxa, e o Espaço paga o desenvolvedor por PIX manual depois de cada evento.

## Resumo executivo

- **Comprador:** vê "R$ 50,00 + R$ 2,50 de taxa" desde a escolha do ingresso, e o total já com a taxa, em todas as telas e e-mails.
- **Cálculo:** 5% do preço de cada ingresso comprado (cada Casadinha, cada Inteira…), mínimo R$ 1,00 por ingresso, arredondado ao centavo. Cortesia não paga.
- **Gravado na compra:** percentual e valor ficam no pedido; mudar o percentual depois não muda pedidos antigos. Pedidos de antes da taxa = taxa 0.
- **Pagamento:** o banco recebe o total com a taxa; a regra "só confirma se o valor pago for igual ao total do pedido" continua igual.
- **Estorno:** devolve 100%, com a taxa. A taxa estornada sai do valor a repassar.
- **Equipe (só Admin):** quadro "Financeiro do evento" na página do evento e página nova "Taxa de serviço" com totais, situação por evento, "Marcar como pago" e planilha.
- **Segurança:** hoje **não existe papel Admin x secretaria** no sistema [V]. A spec cria o papel e a marca da conta do desenvolvedor, conferidos no servidor e no banco. A conta do desenvolvedor vê, mas **não** marca como pago.
- **Contestação de cartão:** hoje o site **não detecta** [V]. Proposta: registro manual pelo Admin (simples e confiável) e, se o banco avisar, detecção automática depois.
- **Ligar sem susto:** tudo entra **desligado**; a cobrança começa só quando o dono der o "pode" (chave no banco).

---

## 1. Objetivo

1. Cobrar do comprador uma taxa de serviço clara, calculada só no servidor/banco e gravada no pedido.
2. Mostrar ao comprador preço, taxa e total antes da compra (exigência de informação clara do preço total).
3. Dar ao Admin do Espaço a conta de cada evento: quanto é do Espaço, quanto é taxa a repassar e se já foi pago.
4. Registrar cada repasse de forma imutável (quem, quando, valor, data do PIX, nota).
5. Estornos e contestações reduzirem a taxa a repassar automaticamente, inclusive depois de pago (desconto no próximo repasse).

### Fora de escopo

- Divisão automática do pagamento (split) ou pagamento automático ao desenvolvedor.
- Emissão de nota fiscal (a planilha serve de base para o contador).
- Estorno parcial (não existe hoje; continua não existindo).
- Taxa diferente por evento ou por tipo (há um só percentual vigente; ver seção 17).
- Descontar a tarifa do banco de pagamento da taxa (decisão 4: fica com o Espaço).

---

## 2. Decisões do dono (2026-10-04)

| # | Tema | Decisão |
| --- | --- | --- |
| 1 | Valor | 5% do preço de **cada ingresso comprado** (cada unidade do carrinho), mínimo R$ 1,00 por unidade. Cortesia não paga. |
| 2 | Transparência | Comprador vê a taxa desde a escolha: "R$ 50,00 + R$ 2,50 de taxa" e total com taxa. Texto "taxa de serviço", sem citar fornecedores. Pedido, ingresso/e-mail e página do pedido mostram ingressos + taxa + total. |
| 3 | Gravação | Percentual e centavos gravados na compra. Pedidos antigos = 0. Só servidor/banco calculam. O banco de pagamento recebe o total com taxa; `confirmOrderPaid` continua exigindo pago == `total_cents`. |
| 4 | Tarifa do banco | A tarifa do banco de pagamento sobre a taxa fica com o Espaço; o desenvolvedor recebe a taxa cheia. |
| 5 | Estorno | Todo estorno (individual, "Estornar todos", sessão cancelada) devolve 100% com a taxa e reduz o valor a repassar daquele evento. |
| 6 | Telas da equipe | Quadro "Financeiro do evento" + página "Taxa de serviço" com totais, lista de eventos e "Baixar planilha" (CSV). |
| 7 | Quem vê | **Somente Admin.** Secretaria não vê. Garantido no servidor e no banco. |
| 8 | Quem marca pago | **Somente Admin do Espaço**, nunca a conta do desenvolvedor. Registro imutável; correção = novo lançamento de ajuste. |
| 9 | Situação | "Aguardando fim do evento" → "A pagar" no dia seguinte ao fim da última sessão (America/Sao_Paulo) → "Pago em dd/mm por Fulano". |
| 10 | Contestação | Contestação depois do repasse: a taxa daquele pedido é descontada do próximo repasse, visível com o motivo. Mecanismo a confirmar (seção 9). |

---

## 3. Como é hoje (o que muda) [V]

- **Preço e total:** `create_checkout_order` (migration `20261011100000_event_sessions.sql`) soma `qty × session_ticket_types.price_cents` em `orders.total_cents`, grava `order_items` (`unit_price_cents`, `line_total_cents = unit × qty`) e rateia o preço da linha entre os ingressos (`tickets.price_cents`, uma linha por pessoa).
- **Pagamento:** `createPayment` envia `total_amount = orders.total_cents` à API de Orders; `confirmOrderPaid` (`src/lib/payments/confirm-order.ts`) recusa e alerta se o valor pago ≠ `total_cents`.
- **Estorno:** `begin_order_refund` / `sync_order_refunded` gravam `order_refunds.amount_cents = orders.total_cents` (100%). Logo, com a taxa dentro do total, **todo estorno já devolve a taxa** sem mudança de lógica.
- **Cortesia:** `issue_courtesy_ticket` cria pedido próprio com total 0; o checkout recusa tipos `cortesia`. **Não existe pedido misto** (pago + cortesia).
- **Papéis:** `staff_profiles` tem só `user_id`, `display_name`, `created_at`. `is_staff()` é o único controle; **toda conta da equipe pode tudo** (inclusive estornar). Não há Admin x secretaria.
- **Leitura da equipe:** `orders`, `order_items`, `tickets` e `order_refunds` são legíveis por qualquer conta da equipe (RLS `is_staff()`), inclusive pela chave pública + login no navegador.
- **Dinheiro na tela da equipe:** "Total vendido" (soma de `tickets.price_cents` válidos) aparece para qualquer conta; o painel da sessão mostra `paid_cents`/`refunded_cents` (somas de `total_cents`).
- **Contestação:** `classifyMercadoPagoOrder` (`src/lib/payments/order-status.ts`) só reconhece `processed` (pago), estorno, `failed` e PIX pendente. Uma order `charged_back` cai em `"other"` e o webhook **ignora**. `charged_back` só aparece na lista de estados "fechados" usada para cancelar cobranças.
- **Telas do comprador:** página do evento e home mostram "A partir de R$ X"; checkout mostra preço por tipo e total calculados no navegador; página do pedido mostra "Total"; o e-mail de ingressos **não mostra valores**; o e-mail de estorno mostra "Valor devolvido: R$ X (100% do pedido)".

---

## 4. Regras de cálculo

### 4.1 Fórmula [R]

Por **unidade** de cada tipo comprado (1 Inteira, 1 Meia, 1 Casadinha, 1 Pacote família):

```
taxa_unidade = max(mínimo, arredonda_meio_para_cima(preço_unidade × percentual))
taxa_linha   = taxa_unidade × quantidade
taxa_pedido  = soma das taxa_linha
total        = soma dos preços + taxa_pedido
```

- Percentual em pontos-base (`500` = 5%) e mínimo em centavos (`100`), para conta inteira sem ponto flutuante.
- Arredondamento meio-para-cima ao centavo: `(preço_centavos × 500 + 5000) / 10000` em divisão inteira.
- Taxa calculada **por unidade** (não sobre o total do pedido), para o mínimo valer por ingresso e o valor ser igual no checkout, no pedido e no estorno.
- Cortesia: taxa 0 (pedido de cortesia tem total 0).
- Pedido criado com a taxa desligada: taxa 0, percentual 0.

### 4.2 Exemplos

| Item | Preço | 5% exato | Taxa | Total da unidade |
| --- | --- | --- | --- | --- |
| Meia-entrada | R$ 25,00 | R$ 1,25 | **R$ 1,25** | R$ 26,25 |
| Inteira | R$ 50,00 | R$ 2,50 | **R$ 2,50** | R$ 52,50 |
| Casadinha (2 inteiras) | R$ 90,00 | R$ 4,50 | **R$ 4,50** | R$ 94,50 |
| Ingresso barato | R$ 10,00 | R$ 0,50 | **R$ 1,00** (mínimo) | R$ 11,00 |
| Preço quebrado | R$ 24,90 | R$ 1,245 | **R$ 1,25** (arredonda para cima) | R$ 26,15 |
| Preço quebrado | R$ 33,30 | R$ 1,665 | **R$ 1,67** | R$ 34,97 |
| Cortesia | R$ 0,00 | — | **R$ 0,00** | R$ 0,00 |

Pedido exemplo: 2 Inteiras + 1 Meia = R$ 125,00 em ingressos + (2 × R$ 2,50 + R$ 1,25) = **R$ 6,25 de taxa** → **R$ 131,25**.

Ponto de atenção: com o mínimo de R$ 1,00, abaixo de R$ 20,00 a taxa passa de 5% (R$ 10,00 → 10%). Ver pergunta sobre meia-entrada (seção 17).

### 4.3 Onde a fórmula vive

- **Fonte da verdade:** função SQL `service_fee_for_price(price_cents, rate_bps, min_cents)` usada por `create_checkout_order`.
- **Só para exibir:** `src/lib/domain/service-fee.ts` (função pura igual), com o percentual e mínimo vigentes vindos do servidor. Teste de paridade com a mesma tabela de exemplos nos dois lados.
- O navegador **nunca** envia taxa ou total; o servidor recalcula tudo.

---

## 5. Fluxo do comprador

Regra geral: em toda tela onde aparece preço, a taxa aparece junto, e todo total já inclui a taxa. Texto sempre "taxa de serviço" (ou "de taxa" na linha curta). Nada de nomes de fornecedor.

| Tela | Hoje | Com a taxa (textos sugeridos) |
| --- | --- | --- |
| Home (card do evento) | "A partir de R$ 25,00" | "A partir de R$ 25,00 **+ R$ 1,25 de taxa**" |
| Página do evento (tipos) | "Inteira · R$ 50,00" | "Inteira · R$ 50,00 **+ R$ 2,50 de taxa**" |
| Página do evento (rodapé) | "A partir de R$ 25,00" | idem home |
| Checkout — cada tipo | "R$ 50,00" | "R$ 50,00 + R$ 2,50 de taxa" |
| Checkout — resumo | "Total · 3 ingressos R$ 125,00" | "Ingressos R$ 125,00" / "Taxa de serviço R$ 6,25" / "**Total · 3 ingressos R$ 131,25**" |
| Checkout — barra fixa (celular) | "Total R$ 125,00" | "Total R$ 131,25" + linha pequena "inclui R$ 6,25 de taxa de serviço" |
| Página do pedido — pagamento | "Total R$ 125,00" | mesmo resumo de 3 linhas (vindo do banco), antes do formulário de pagamento |
| Pedido pago / ingressos | sem valores | bloco "Resumo do pedido": itens, taxa de serviço, total pago |
| "Pagamento recebido" (decidir) | "Seu pagamento de R$ X" | sem mudança (X já inclui a taxa) |
| Pedido estornado | "R$ X devolvidos" | "R$ X devolvidos (100% do pedido, incluindo a taxa de serviço)" |
| E-mail de ingressos | sem valores | bloco "Resumo do pedido" (HTML e texto) com ingressos, taxa e total |
| E-mail de estorno | "Valor devolvido: R$ X (100% do pedido)" | "… (100% do pedido, incluindo a taxa de serviço)" |
| Aviso de sessão cancelada | "O valor pago será devolvido integralmente" | "O valor pago, incluindo a taxa de serviço, será devolvido integralmente" |
| PDF do ingresso | sem valores | sem mudança (o ingresso é por pessoa; o resumo fica no pedido e no e-mail) |
| Lembrete de compra não finalizada | sem valores | sem mudança |

Pedido antigo (taxa 0): o resumo mostra só "Total"; não aparece "Taxa de serviço R$ 0,00".

Ajuda curta ao lado de "Taxa de serviço" (ícone "?" ou texto pequeno): "Valor cobrado por ingresso para manter a venda on-line. É devolvido junto em qualquer estorno."

**Mudou o percentual entre abrir o checkout e confirmar** [R]: a ação envia o percentual que mostrou; se o banco estiver com outro, recusa com `TAXA_MUDOU` e o formulário recarrega com o aviso "Os valores foram atualizados. Confira o total antes de continuar." De qualquer forma, a página de pagamento mostra os valores do banco antes de pagar.

---

## 6. Modelo de dados (migrations aditivas)

Tudo compatível com o código no ar: colunas novas com padrão, nada renomeado ou apagado, funções existentes mantêm os parâmetros atuais (só ganham parâmetros opcionais).

### 6.1 Configuração vigente

```sql
create table public.service_fee_settings (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default false,       -- entra DESLIGADA
  rate_bps integer not null default 500 check (rate_bps between 0 and 2000),
  min_cents integer not null default 100 check (min_cents between 0 and 1000),
  updated_at timestamptz not null default now()
);
```

- RLS ligada, sem políticas; `revoke all ... from public, anon, authenticated`; `grant select to service_role`.
- Mudança só pelo dono no painel do banco (SQL), nunca por tela. Gatilho grava `updated_at`.
- Função `service_fee_policy()` → `(enabled, rate_bps, min_cents)` para o servidor exibir.

### 6.2 Papéis da equipe

```sql
alter table public.staff_profiles
  add column role text not null default 'secretaria'
    check (role in ('admin', 'secretaria')),
  add column is_developer boolean not null default false;
```

- **Todas as contas atuais viram `secretaria`** (nada do que já existe depende de papel); o dono marca quem é `admin` e qual conta é do desenvolvedor no painel do banco, na publicação.
- Defesa extra: `revoke insert, update, delete on staff_profiles from anon, authenticated` (hoje já não há política de escrita [V]).
- `is_admin()` (SECURITY DEFINER, `search_path = ''`, igual a `is_staff()`): conta da equipe com `role = 'admin'`.
- A conta do desenvolvedor pode ser `admin` (para **ver** o financeiro) com `is_developer = true` (para **não** marcar pago, registrar contestação nem lançar ajuste).

### 6.3 Pedido e itens

`orders`:

| Coluna | Tipo | Regra |
| --- | --- | --- |
| `tickets_subtotal_cents` | integer not null | soma dos preços; antigos = `total_cents` (preenchido na migration) |
| `service_fee_cents` | integer not null default 0 | taxa do pedido |
| `service_fee_rate_bps` | integer not null default 0 | percentual vigente na compra |
| `service_fee_min_cents` | integer not null default 0 | mínimo vigente na compra |

- Constraint `total_cents = tickets_subtotal_cents + service_fee_cents` (criada `not valid` e validada depois do preenchimento).
- Gatilho `before insert` preenche `tickets_subtotal_cents = total_cents - service_fee_cents` quando vier nulo: funções antigas (ex.: `issue_courtesy_ticket`) continuam funcionando sem mudança.

`order_items`: `service_fee_unit_cents` e `service_fee_total_cents` (integer not null default 0), constraint `service_fee_total_cents = service_fee_unit_cents × quantity`.

`tickets`: **sem mudança**. `tickets.price_cents` continua sendo o preço do ingresso (sem taxa), então "Total vendido" e a lista de ingressos não mudam de sentido.

### 6.4 Contestações

```sql
create table public.order_chargebacks (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  kind text not null check (kind in ('contestacao', 'reversao')),
  amount_cents integer not null,       -- total do pedido no momento
  fee_cents integer not null,          -- taxa do pedido no momento
  source text not null check (source in ('manual', 'automatico')),
  reason text not null check (char_length(btrim(reason)) between 5 and 500),
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now()
);
```

- `reversao` = o Espaço ganhou a disputa; a taxa volta a ser devida. Um pedido está "contestado" quando o último registro é `contestacao`.

### 6.5 Repasses

```sql
create table public.service_fee_payouts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('repasse', 'ajuste')),
  amount_cents integer not null,         -- repasse: > 0 (valor do PIX); ajuste: <> 0
  pix_date date,                         -- obrigatório no repasse
  note text check (note is null or char_length(note) <= 140),   -- ex.: código do PIX
  reason text,                           -- obrigatório no ajuste (5–500)
  created_by uuid not null references auth.users (id),
  created_by_name text not null,         -- nome guardado no momento
  created_at timestamptz not null default now()
);

create table public.service_fee_payout_items (
  payout_id uuid not null references public.service_fee_payouts (id),
  event_id uuid not null references public.events (id),
  amount_cents integer not null check (amount_cents <> 0),
  primary key (payout_id, event_id)
);
```

- Soma dos itens = `amount_cents` do repasse (conferido na função).
- **Imutáveis:** gatilho `before update or delete or truncate` que sempre recusa; `grant select, insert` só para `service_role`.
- As três tabelas novas: RLS ligada, **sem políticas** para `authenticated`; `revoke all from public, anon, authenticated`. Leitura só por funções.

### 6.6 Contas por evento (definições)

- **Pedido que conta:** status `pago` com `service_fee_cents > 0`.
- **Taxa devida do evento:** soma de `service_fee_cents` dos pedidos que contam e **não** estão contestados.
- **Já repassado:** soma de `service_fee_payout_items.amount_cents` do evento.
- **Saldo:** devida − repassado. Positivo = a pagar; zero = quitado; negativo = desconto a abater no próximo repasse.
- Estorno muda o pedido para `estornado` → sai da taxa devida sozinho. Pedido em `aguardando_decisao` não conta até ser aceito.

### 6.7 Funções (todas `set search_path = ''`, `revoke all ... from public, anon, authenticated`, `grant execute ... to service_role`)

| Função | O que faz |
| --- | --- |
| `service_fee_for_price(int, int, int)` | fórmula da seção 4 (imutável, só cálculo) |
| `service_fee_policy()` | configuração vigente |
| `is_admin()` | SECURITY DEFINER; para uso também em RLS futura |
| `staff_finance_role(p_staff_user_id)` | devolve `admin`, `admin_dev` ou nulo; base das checagens abaixo |
| `event_fee_due_date(p_event_id)` | dia seguinte (São Paulo) ao fim da última sessão (seção 8) |
| `event_finance_summary(p_event_id, p_staff_user_id)` | números do quadro; recusa se não for admin |
| `service_fee_overview(p_staff_user_id, p_from, p_to)` | lista de eventos + totais; recusa se não for admin |
| `record_service_fee_payout(p_event_id, p_staff_user_id, p_expected_amount_cents, p_pix_date, p_note)` | marca como pago (seção 8.3) |
| `record_service_fee_adjustment(p_event_id, p_staff_user_id, p_amount_cents, p_reason)` | correção de lançamento errado |
| `register_order_chargeback(p_order_id, p_staff_user_id, p_kind, p_reason, p_source)` | contestação/reversão (seção 9) |
| `create_checkout_order(..., p_expected_fee_rate_bps default null)` | v5 com a taxa (seção 7.1) |

As funções que escrevem recebem `p_staff_user_id` e **reconferem o papel dentro do banco** (como `begin_order_refund` já faz), recusando com prefixos estáveis: `TAXA_ADMIN` (não é admin), `TAXA_DEV` (conta do desenvolvedor), `TAXA_PRAZO` (antes do dia de pagar), `TAXA_MUDOU` (valor mudou), `TAXA_NADA` (nada a pagar).

---

## 7. Checkout, pagamento e estorno

### 7.1 `create_checkout_order` v5

- Lê `service_fee_settings` uma vez. Desligada → taxa 0, como hoje.
- Por linha: `taxa_unidade = service_fee_for_price(stt.price_cents, rate, min)`, grava em `order_items`; soma em `orders.service_fee_cents`; grava percentual e mínimo usados; `total_cents = subtotal + taxa`.
- `tickets.price_cents` continua rateando só o preço (a taxa não entra no ingresso).
- `p_expected_fee_rate_bps` (opcional): se informado e diferente do vigente → `TAXA_MUDOU`. Código antigo não manda → sem checagem.
- Devolve também `service_fee_cents` (coluna nova no retorno exige recriar a função; código antigo lê só as colunas que conhece).

### 7.2 Pagamento

- Sem mudança de regra: `createPayment` já envia `orders.total_cents`, que passa a incluir a taxa; o formulário de pagamento recebe o mesmo valor do banco.
- `confirmOrderPaid` continua exigindo pago == `total_cents`. Nenhuma mudança no webhook para o caso pago.
- Descrição enviada ao banco de pagamento continua genérica (nome do evento).

### 7.3 Estorno

- Sem mudança de cálculo: `amount_cents = total_cents` já inclui a taxa (individual, "Estornar todos" e sessão cancelada).
- Textos: botão "Estornar pedido" e confirmação do lote dizem "100% do pedido, incluindo a taxa de serviço".
- O efeito no repasse é automático pela definição da seção 6.6 (pedido sai de `pago`).

### 7.4 Pedido "Pago sem vaga — decidir"

- Enquanto `aguardando_decisao`, a taxa **não** conta. Aceito → passa a contar. Estornado → nunca contou.
- O quadro mostra "1 pedido aguardando decisão (R$ X, taxa R$ Y fora da conta)".

---

## 8. Repasse: estados e regras

### 8.1 Data de pagar

`event_fee_due_date` = dia seguinte (calendário de São Paulo) ao **fim da última sessão ativa** do evento, onde fim = `coalesce(ends_at, starts_at)`. Sessões removidas não contam. Sessões canceladas não contam; se **todas** estiverem canceladas, usa a última delas (normalmente a taxa devida será 0 depois dos estornos). "A pagar" começa às 00:00 desse dia.

### 8.2 Situação (calculada, não gravada)

| Situação | Quando |
| --- | --- |
| Aguardando fim do evento | antes da data de pagar |
| A pagar · R$ X | depois da data e saldo > 0 |
| Pago em dd/mm por Fulano | saldo = 0 e há repasse (mostra o último) |
| Sem taxa | saldo = 0 e nenhum repasse (ex.: só cortesias, pedidos antigos, tudo estornado) |
| Desconto pendente · −R$ X | saldo < 0 (estorno ou contestação depois do repasse); "será descontado do próximo repasse" |

### 8.3 "Marcar como pago"

1. Admin (não desenvolvedor) abre "Marcar como pago" num evento "A pagar".
2. A tela mostra o valor sugerido = saldo do evento **menos** todos os descontos pendentes de outros eventos, linha a linha ("Evento Y — contestação: −R$ 2,50"). Esse é o valor do PIX.
3. Campos: data do PIX (padrão hoje; não pode ser futura nem antes do fim do evento), nota opcional (até 140 caracteres, ex.: código do PIX). Confirmação: "Confirmo que o PIX de R$ X foi feito ao desenvolvedor."
4. `record_service_fee_payout` trava o evento, recalcula, confere `p_expected_amount_cents` (diferente → `TAXA_MUDOU`, a tela recarrega), confere papel e data, e grava um repasse com itens: +saldo do evento X e −saldo de cada evento com desconto pendente. Total ≤ 0 → `TAXA_NADA` ("Nada a pagar agora; o desconto de R$ X continua para o próximo evento").
5. Segundo clique/outra aba: o saldo já é 0 → `TAXA_NADA`. Sem pagamento em dobro.
6. Depois de gravar, alerta por e-mail para a equipe (mesmo canal dos alertas atuais): "Repasse de R$ X registrado por Fulano (evento, data do PIX)". Transparência para os dois lados.

### 8.4 Ajuste (correção)

Admin (não desenvolvedor) lança um ajuste com valor (positivo ou negativo) e motivo obrigatório; aparece no histórico do evento como "Ajuste por Fulano: motivo". Nunca apaga ou edita um repasse.

---

## 9. Contestação de cartão (chargeback)

**Hoje [V]:** o webhook só trata order paga e estornada; `charged_back` é ignorado. Não há registro de contestação.

**Proposta [R], em duas camadas:**

1. **Manual (entra nesta entrega):** na página do evento (Admin, não desenvolvedor), em cada pedido pago: "Registrar contestação" com motivo obrigatório. O Espaço recebe o aviso da contestação pelo banco de pagamento e registra aqui. "Desfazer contestação" (reversão) quando o Espaço ganhar a disputa.
2. **Automática (depois, a confirmar):** se a consulta da order no webhook vier com `status = charged_back` (ou pagamento com esse estado), chamar `register_order_chargeback(source = 'automatico')` e alertar a equipe. **[S]** Não está confirmado na documentação se a API de Orders manda aviso nesse caso; testar com o suporte/ambiente de teste antes de depender disso.

Efeito: pedido contestado sai da taxa devida. Se o evento já foi pago, o saldo fica negativo ("Desconto pendente") e é abatido no próximo repasse (seção 8.3), com o motivo visível no quadro e na planilha.

A contestação **não** muda o status do pedido nem invalida ingressos (fora de escopo; normalmente chega depois do evento).

---

## 10. Telas da equipe

### 10.1 Menu

"Eventos" · **"Taxa de serviço"** (só aparece para Admin; a página confere de novo).

### 10.2 Quadro "Financeiro do evento" (página do evento, só Admin)

```
Financeiro do evento                               Situação: A pagar · R$ 18,75
──────────────────────────────────────────────────────────────────────────────
Vendido (ingressos)            R$ 375,00
Taxa de serviço (5%)           R$  18,75
Total pago pelos clientes      R$ 393,75
Estornado (com taxa)          −R$  52,50   (1 pedido)
Contestado                     R$   0,00
Valor do Espaço                R$ 341,25   antes das tarifas do banco de pagamento
Taxa a repassar                R$  18,75   já repassado R$ 0,00
Aguardando decisão             1 pedido · R$ 52,50 (fora da conta)
──────────────────────────────────────────────────────────────────────────────
[Marcar como pago]   Histórico: (vazio)
```

- "Total pago pelos clientes" = pedidos que chegaram a ser pagos (pagos + estornados). "Valor do Espaço" = total pago − estornado − contestado − taxa devida.
- Pedidos antigos sem taxa entram em "Vendido" e "Total", com taxa 0.
- Histórico: "Pago em 06/10 por Ana — R$ 18,75 — PIX 06/10 — nota: E1234…"; descontos e ajustes com motivo.
- Conta do desenvolvedor: vê tudo; botões de escrita não aparecem (e o banco recusa).
- **[R]** O cartão "Total vendido" das estatísticas atuais passa a aparecer só para Admin (ver pergunta 5).

### 10.3 Página "Taxa de serviço" (`/equipe/taxa-servico`, só Admin)

```
Taxa de serviço
┌─────────────────┬─────────────────┬──────────────────────┐
│ A pagar         │ Pago no período │ Descontos pendentes  │
│ R$ 42,50        │ R$ 120,00       │ −R$ 2,50             │
└─────────────────┴─────────────────┴──────────────────────┘
Período: [Este mês ▾]                         [Baixar planilha]

Evento                 Data        Taxa       Situação
Show X                 03/10/2026  R$ 18,75   A pagar · R$ 18,75      [Marcar como pago]
Peça Y (2 sessões)     27/09/2026  R$ 23,75   A pagar · R$ 23,75      [Marcar como pago]
Festa Z                20/09/2026  R$ 120,00  Pago em 22/09 por Ana
Oficina W              12/09/2026  R$ 2,50    Desconto pendente · −R$ 2,50 (contestação)
Evento V               15/10/2026  R$ 7,50    Aguardando fim do evento
```

No celular, cada evento vira um card com as mesmas informações (padrão mobile-first).

### 10.4 Planilha (CSV)

- Rota `GET /equipe/taxa-servico/planilha?de=AAAA-MM&ate=AAAA-MM` (`route.ts`), Admin, mesmo período da tela.
- Uma linha por evento: evento, data da última sessão, vendido, taxa, estornado, contestado, taxa devida, repassado, saldo, situação, data do PIX, marcado por, nota.
- **Sem dados de compradores** (nem nome, nem e-mail). Separador `;`, vírgula decimal, UTF-8 com BOM (abre certo no Excel).
- Proteção contra fórmula: célula que começa com `=`, `+`, `-`, `@` recebe `'` na frente.

---

## 11. Casos de borda

| Caso | Comportamento |
| --- | --- |
| Pedido com cortesia | Não existe pedido misto hoje [V]; cortesia é pedido próprio com total e taxa 0. |
| Estorno parcial | Não existe. Todo estorno pelo site é 100% com taxa. |
| Estorno parcial feito no painel do banco | Hoje vira estorno total no site [V] (ver riscos). Com a taxa, o pedido inteiro sai da conta; o alerta já pede para conferir no painel. |
| Sessão cancelada | Estornos devolvem a taxa; o evento continua com as outras sessões. Data de pagar usa só sessões ativas (seção 8.1). |
| Evento com várias sessões | Um único repasse por evento, liberado após a última sessão ativa. |
| Pedidos antigos | Taxa 0, subtotal = total. Aparecem em "Vendido" e "Total", nunca em "Taxa". |
| Pago sem vaga / outros "decidir" | Fora da conta até aceito (seção 7.4). Aceito depois do repasse → saldo positivo de novo ("A pagar"). |
| Estorno depois do repasse | Possível em pedido sem check-in. Saldo negativo → desconto no próximo repasse. |
| Contestação depois do repasse | Idem, com motivo "contestação" (seção 9). |
| Saldo negativo sem próximo evento | Fica "Desconto pendente" até o próximo repasse; a página mostra o total pendente no topo. |
| Percentual alterado com venda em andamento | Pedidos já criados mantêm o gravado; checkout aberto recebe `TAXA_MUDOU`. |
| Taxa ligada com evento já à venda | Pedidos novos passam a ter taxa (ver pergunta 6). |
| Ingresso de R$ 0,01 a R$ 19,99 | Paga o mínimo R$ 1,00 (acima de 5%). |
| Reserva "Alterar seleção" | Pedido novo recalculado com a taxa vigente. |
| Valor mínimo do cartão no banco de pagamento | Total com taxa só aumenta o valor; sem impacto negativo. |

---

## 12. Privacidade e Termos de compra

- **`/privacidade`:** a taxa não envolve dado pessoal novo. **Sem mudança** de texto nem de versão (`PRIVACY_POLICY_VERSION` continua `2026-10-03`). O CSV não leva dados de compradores.
- **Termos de compra (página pendente):** precisa de uma seção "Taxa de serviço":
  - o que é, quanto é (5% por ingresso, mínimo R$ 1,00) e que aparece antes da compra;
  - **devolvida integralmente** em todo estorno, inclusive desistência em até 7 dias da compra (art. 49 do CDC) e cancelamento de sessão ou evento;
  - não é cobrada em cortesias.
- **[S]** Aplicação do art. 49 a ingressos e regras de meia-entrada: confirmar com quem cuida da parte jurídica. A decisão do dono (sempre devolver a taxa) já é a mais favorável ao comprador.

---

## 13. Segurança

- **Servidor:** helper `requireAdminUser()` (em `import "server-only"`) usado em **toda** página, Server Action e `route.ts` do financeiro: confere login, `is_staff()` e `is_admin()`; devolve `{ userId, isDeveloper }`. Ações de escrita também recusam `isDeveloper`. Mensagens via `ActionError`/`runAction`; erro genérico ao usuário, detalhe só no log.
- **Banco:** tabelas novas sem acesso de `authenticated`; leitura e escrita só por funções `service_role` que reconferem o papel pelo `p_staff_user_id` (defesa mesmo que o servidor erre). Repasses e contestações imutáveis por gatilho.
- **Conta do desenvolvedor:** marcada por `is_developer` em `staff_profiles`, que **só o dono altera no painel do banco**. Limite honesto: quem tem acesso de administrador ao banco pode burlar qualquer regra; por isso cada repasse dispara e-mail de alerta e fica no histórico imutável.
- **Entradas:** UUIDs validados; valor esperado inteiro positivo; data do PIX `AAAA-MM-DD` dentro do intervalo; nota ≤ 140 caracteres sem quebra de linha; motivo 5–500.
- **Leitura que continua aberta à equipe [V]:** a secretaria ainda consegue ler `orders`/`order_items` (inclusive as colunas de taxa por pedido) com a chave pública. Isso já vale hoje para `total_cents`; o que fica restrito são os **agregados, repasses e contestações**. Fechar por coluna exigiria mudar a política de `orders` (fora desta entrega; ver riscos).
- **Logs:** sem nome, e-mail ou CPF; registrar só IDs de pedido/evento e valores.
- **Sem dependência nova.** CSV gerado à mão.

---

## 14. Plano de testes

1. **Unitário (Vitest):** `service-fee.ts` com a tabela da seção 4.2, meio-para-cima, mínimo, taxa desligada, cortesia; total do resumo do checkout; formatação "R$ 50,00 + R$ 2,50 de taxa"; CSV (separador, BOM, proteção de fórmula, sem PII); situação do repasse por data em São Paulo (virada de dia, horário UTC).
2. **Banco (local / transação com rollback, padrão das migrations anteriores):** paridade SQL × TS; checkout com taxa ligada/desligada; constraint de soma; pedido antigo; `TAXA_MUDOU`; `issue_courtesy_ticket` antigo continua funcionando (gatilho); estorno grava `amount_cents` com taxa; repasse recusado para secretaria, desenvolvedor, antes da data, valor divergente, duplo clique; desconto pendente abatido; ajuste; contestação e reversão; update/delete em repasse recusados até para `service_role`.
3. **Servidor:** cada action/route/página do financeiro recusa anônimo, secretaria e (para escrita) desenvolvedor, inclusive por POST direto.
4. **Tela (local com dados falsos):** checkout no celular com resumo e barra fixa; página do pedido; e-mail de ingressos (HTML e texto); quadro e página da taxa; planilha abrindo no Excel.
5. **Produção (só leitura, depois do deploy):** com a taxa desligada, preços e totais iguais aos de antes; Admin vê o quadro e secretaria não (conferência pelo dono).
6. **Ativação:** uma compra real pequena feita pelo dono (ex.: ingresso de teste R$ 5,00 → R$ 6,00) e estorno dela; conferir valor no banco de pagamento, e-mail e quadro.

---

## 15. Ordem de publicação

1. **Migration A (aditiva):** papéis em `staff_profiles`, `service_fee_settings` (**desligada**), colunas em `orders`/`order_items` + preenchimento + gatilho, tabelas novas, funções, `create_checkout_order` v5. Com a taxa desligada nada muda para o código no ar. Pede o "pode" do dono (projeto Espaço Byla Eventos, fingerprint conferido).
2. **Dono define papéis** no painel: quais contas são `admin` e qual tem `is_developer`.
3. **Deploy do código:** exibição da taxa (só aparece quando ligada), quadro, página, planilha, contestação manual, textos de estorno/e-mail. Push e deploy com "pode".
4. **Conferência** em produção (seção 14, item 5).
5. **Termos de compra** com a seção da taxa publicados (recomendado antes de ligar).
6. **Ligar a taxa** (`enabled = true`) com "pode" do dono; compra de teste (seção 14, item 6).
7. **Depois:** detecção automática de contestação (seção 9, camada 2), se confirmada.

Prazo estimado: 4 a 6 dias de trabalho (banco 1,5; telas do comprador e e-mails 1; financeiro e planilha 1,5–2; testes e publicação 1).

---

## 16. Riscos encontrados no código atual

1. **Sem papel Admin x secretaria** [V]: toda conta da equipe pode estornar, cancelar sessão, ver valores. Esta spec cria o papel só para o financeiro; o resto continua como está (decisão separada, se o dono quiser).
2. **Contestação ignorada** [V]: order `charged_back` cai em "other" e o webhook não faz nada; ninguém é avisado.
3. **Estorno parcial vira total** [V]: `partially_refunded` é tratado como estornado, e `sync_order_refunded` marca o pedido inteiro com `amount_cents = total_cents`. Se alguém devolver só a taxa ou só parte pelo painel do banco, o site registra 100%. **[R]** Tratar `partially_refunded` como alerta sem mudar o pedido (pequena mudança, pode entrar junto).
4. **Valores visíveis à secretaria** [V]: "Total vendido", painel da sessão (`paid_cents`, `refunded_cents`) e leitura direta de `orders` pela chave pública. A spec restringe o financeiro novo, mas não fecha essas leituras antigas.
5. **Checkout sem conferência de preço** [V]: o total mostrado no checkout é calculado no navegador; se o preço mudar no meio, só a página de pagamento mostra o valor novo. A taxa ganha `TAXA_MUDOU`; preços continuam como hoje.
6. **Controle do desenvolvedor sobre o banco** (estrutural): quem administra o banco consegue alterar qualquer registro. Mitigado com histórico imutável + e-mail a cada repasse, não eliminado.

---

## 17. Perguntas em aberto para o dono

1. **Meia-entrada:** cobrar 5% sobre o preço da meia é o que já está decidido, mas o mínimo de R$ 1,00 pode fazer a meia ficar com mais da metade do total da inteira em ingressos baratos (ex.: inteira R$ 16 + R$ 1 = R$ 17; meia R$ 8 + R$ 1 = R$ 9).
   - **A (recomendado):** manter 5% na meia, com mínimo de **R$ 0,50 na meia**, e confirmar com quem cuida da parte jurídica.
   - **B:** manter igual para todos (mínimo R$ 1,00 também na meia).
2. **Conta do desenvolvedor:**
   - **A (recomendado):** marca `is_developer` em `staff_profiles`, alterada só pelo dono no painel do banco.
   - **B:** ID da conta numa variável de ambiente da hospedagem.
3. **Rótulo para o comprador:**
   - **A (recomendado):** "Taxa de serviço" (e "+ R$ 2,50 de taxa" na linha curta).
   - **B:** "Taxa de conveniência".
4. **Contestação:**
   - **A (recomendado):** registro manual pelo Admin agora; automático depois, se o banco de pagamento confirmar o aviso.
   - **B:** esperar a detecção automática antes de publicar.
5. **"Total vendido" e valores que a secretaria vê hoje:**
   - **A (recomendado):** "Total vendido" passa a ser só do Admin; a secretaria continua vendo o valor de cada pedido onde precisa operar (estorno, decidir).
   - **B:** deixar como está.
6. **Eventos que já estão à venda quando a taxa for ligada:**
   - **A (recomendado):** pedidos novos de todos os eventos passam a ter taxa a partir da ativação (o que já foi vendido fica com taxa 0).
   - **B:** só eventos criados depois da ativação.
7. **Quem é Admin:** quais contas atuais viram Admin? (Todas as outras ficam como secretaria.)
   - **A (recomendado):** o dono marca no painel do banco no dia da publicação.
   - **B:** todas as contas atuais viram Admin e o dono rebaixa depois.
