# Estorno, tipos de ingresso, limite, carrinho e lembrete — design

Data: 2026-10-01 · Status: **APROVADA pelo dono em 2026-10-01** (decisões registradas nas seções 2, 5.3 e 14) · Base: levantamento técnico de 2026-10-01 (código em `main`, banco Espaço Byla Eventos `rlzyjlrcasqbjztgbgit`, 4 migrations aplicadas).

Legenda: **[V]** verificado em código ou documentação oficial · **[S]** a confirmar em teste.

---

## 1. Objetivo

Deixar a venda de ingressos mais segura e completa para a equipe e mais simples para o comprador:

1. **Pagamento confirmado bem visível** para o comprador e destacado para a equipe.
2. **Estorno do pedido inteiro pelo painel**, com registro de quem, quando e por quê, e e-mail ao comprador.
3. **Pagamento que chega sem vaga** vira um estado claro no painel, com decisão da equipe.
4. **Tipos de ingresso configuráveis** por evento (casadinha, família…), com limite próprio opcional.
5. **Quantidade nunca acima do disponível**; máximo de 10 pessoas por compra.
6. **Carrinho que não se perde**: voltar, alterar e retomar.
7. **Um lembrete por e-mail** cerca de 1 hora depois de uma compra não finalizada.
8. **Reserva de 15 minutos** (hoje são 30).

### Fora de escopo

- Cota legal de meia-entrada (40%): pendência; por ora o limite por tipo permite restringir manualmente.
- Estorno parcial, papéis diferentes na equipe, aviso por e-mail à equipe a cada venda.
- Descrição de tipo, lotes/períodos de venda, botão de pausar tipo.
- Contestação no cartão (chargeback).
- Visual final mobile-first: é da outra frente (ver `2026-10-01-prompt-frente-layout-mobile.md`). Aqui entra só a interface mínima funcional, usando os tokens de tema existentes (`text-foreground`, `bg-byla-surface`, `text-byla-muted`, `border-byla-border` etc.).

## 2. Decisões

| Tema | Decisão |
| --- | --- |
| Destaque de pagamento | Tela de sucesso para o comprador (inclusive quando vira pago pelo polling) e destaque na lista da equipe. Sem e-mail por venda. |
| Estorno | Só pelo painel do site, sempre o pedido inteiro, 100%, a qualquer momento. Bloqueado se algum ingresso já fez check-in. Qualquer pessoa da equipe pode estornar, com registro de quem, quando e motivo. E-mail ao comprador. |
| Pago sem vaga | Não estorna sozinho: o pedido vai para "Pago sem vaga — decidir", com as ações "Aceitar mesmo assim" ou "Estornar". Alerta à equipe por e-mail (já existe). |
| Validade do PIX | O Mercado Pago exige **no mínimo 30 min** [V]. Por isso a reserva acompanha o PIX, e não o contrário (seção 5.3). |
| Tipos de ingresso | Nome, preço, pessoas por unidade e limite próprio opcional. Um QR por pessoa. Inteira, meia e cortesia continuam existindo. |
| Remover tipo com vendas | Nunca apagar: o tipo é arquivado (some da venda, continua no histórico). |
| Limite | Nunca acima do restante (contando reservas ativas) nem do limite do tipo. Máximo de 10 **pessoas** por compra. |
| Carrinho | Fica no navegador e no pedido pendente. "Alterar seleção" cancela o pedido na hora e volta com tudo preenchido. |
| Lembrete | Um e-mail cerca de 1 h depois, com botão para voltar e link "não quero mais receber". Agendamento por Supabase `pg_cron` + `pg_net`. |
| Reserva | 15 minutos. Ao gerar o PIX, a reserva é estendida até o vencimento do PIX (mínimo de 30 min do Mercado Pago) + folga; cartão segue com 15 min (seção 5.3). **Decidido pelo dono em 2026-10-01.** |
| "Cancelar" da equipe | Passa a valer **só para cortesia**. Ingresso pago se resolve por "Estornar pedido" (fase 3). **Decidido pelo dono em 2026-10-01.** |

## 3. Glossário de status

Os status abaixo são **novos ou mudam de uso**.

**Pedido (`order_status`)**

| Valor | O que significa | Texto na tela |
| --- | --- | --- |
| `pendente` | Aguardando pagamento | "Aguardando pagamento" |
| `pago` | Pago; ingressos válidos | "Pago" |
| `cancelado` | Cancelado (ex.: comprador alterou a seleção) | "Cancelado" |
| `expirado` | Reserva venceu sem pagamento. Hoje existe no enum mas não é usado; passa a ser usado. | "Expirado" |
| `estornado` (novo) | Dinheiro devolvido (ou em devolução); ingressos sem valor | "Estornado" |
| `aguardando_decisao` (novo) | Dinheiro recebido, mas sem vaga ou depois de o pedido ter sido cancelado | "Pago sem vaga — decidir" ou "Pago após cancelamento — decidir" (conforme `decision_reason`) |

**Ingresso (`ticket_status`):** novo valor `estornado`.

**Estorno (`refund_status`, enum novo):** `solicitado`, `concluido`, `falhou`.

**Categoria do tipo (`ticket_kind`):** ~~novo valor `outro`~~ — **sem mudança** (decisão do dono em 2026-10-03: pacotes e tipos novos são da categoria Inteira; ver seção 6).

---

## 4. Item A — Pagamento confirmado bem visível

### Comprador
- **Página do pedido pago** (`/pedidos/[publicToken]`), no topo:
  - bloco de sucesso com ícone de confirmação e o título "Pagamento confirmado!";
  - a frase "Enviamos seus ingressos para j\*\*\*@gmail.com" (e-mail mascarado no servidor);
  - quantidade de ingressos e a orientação "Mostre o QR Code na entrada".
- **Acessibilidade:** o bloco usa `role="status"` e o foco vai para o título.
- **Quando vira pago pelo polling:** `OrderPayment` troca `router.refresh()` por `router.replace("/pedidos/<token>?confirmado=1")`.
  - Com `confirmado=1`, o bloco entra com animação curta.
  - A animação é desligada quando o sistema pede menos movimento (`prefers-reduced-motion`).
  - O parâmetro serve só para a animação; o status vem sempre do banco.
- **Ao confirmar:** o carrinho salvo no navegador para aquele evento é apagado (seção 8).
- **Bug de tema:** em `TicketQr.tsx`, o "Código para digitação manual" usa `text-zinc-100` sobre `bg-byla-overlay` e fica invisível no tema claro [V].
  - Trocar por `text-foreground`.
  - A etiqueta de status (`text-emerald-300`, `bg-white/10 text-zinc-200`) passa a ter variantes claro/escuro (ex.: `text-emerald-700 dark:text-emerald-300`), com contraste AA nos dois temas.

### Equipe
- **Etiquetas coloridas por status** na lista: Pago (verde), Não pago (neutro), Estornado (cinza riscado), Pago sem vaga — decidir (âmbar), Cancelado (neutro).
- **Selo "Novo"** em pedidos pagos nas últimas 24 h (por `paid_at`).
- **Seção "Precisa de decisão"** no topo do painel do evento, quando houver pedidos `aguardando_decisao`.
- **Atualização automática:** a página do evento na equipe faz `router.refresh()` a cada 30 s, só com a aba visível (`visibilitychange`), para o destaque aparecer sem recarregar. O estado dos formulários de cliente é preservado. Sem Realtime e sem dependência nova.

### Testes
- **Componente:** o bloco de sucesso aparece para pedido pago; e-mail mascarado; `confirmado=1` não muda o status mostrado.
- **Navegador:** ver no tema claro e no escuro, a 360 px.

---

## 5. Item B — Estorno do pedido inteiro e "Pago sem vaga"

### 5.1 Comportamento

**Equipe**
- **Botão "Estornar pedido".** No painel do evento, cada pedido pago pelo Mercado Pago (e cada pedido `aguardando_decisao`) tem o botão. A janela de confirmação mostra:
  - comprador e valor total ("Será devolvido R$ X — 100%");
  - a lista de ingressos que serão invalidados;
  - o campo **motivo**, obrigatório, de 5 a 500 caracteres.
- **Pedido com check-in.** Se algum ingresso já entrou, o botão fica desativado com o texto "Não é possível estornar: há ingresso com entrada registrada".
- **Resultado:**
  - sucesso: "Pedido estornado. As vagas voltaram para a venda.";
  - resposta incerta do Mercado Pago: "Estorno em processamento. Confira em alguns minutos." (fica `solicitado`; seção 5.5);
  - recusa do Mercado Pago: mensagem genérica com motivo simples quando conhecido (ex.: saldo insuficiente); detalhe só no log.
- **Histórico no pedido:** "Estornado por <nome> em <data> — motivo: …".
- **"Pago sem vaga — decidir"** tem duas ações:
  - **Aceitar mesmo assim:** a confirmação avisa "A lotação passará de X para Y". O pedido vira `pago`, os ingressos valem e o e-mail com os QRs é enviado.
  - **Estornar:** o mesmo fluxo de estorno.
- **"Cancelar" ingresso** (função atual) passa a valer **só para cortesia**. Ingresso pago se resolve com "Estornar pedido", porque cancelar um ingresso pago sem devolver o dinheiro deixaria o pedido inconsistente.

**Comprador**
- **E-mail "Seu pedido foi estornado":**
  - evento, valor devolvido e ingressos cancelados;
  - prazo por meio de pagamento: cartão — "aparece na fatura, em até 2 faturas, conforme o banco"; PIX — "volta para a conta de origem".
  - Se o e-mail falhar, a equipe recebe alerta.
- **Página do pedido estornado:** "Pedido estornado em <data>. O valor de R$ X foi devolvido para o meio de pagamento usado. Os ingressos deste pedido não são mais válidos." Os QRs não aparecem.

**Portaria (check-in):** ingresso estornado mostra "Estornado — não liberar entrada".

### 5.2 Regras de negócio
- **Quando pode estornar:** só pedidos com `payment_provider = 'mercadopago'` e status `pago` ou `aguardando_decisao`.
- **Pedidos fora disso:**
  - cortesia (`cortesia_interna`, total 0) usa "Cancelar";
  - pedidos do provedor antigo (`pagbank`, 2 pedidos pagos hoje) mostram "Estorno pelo site indisponível para este pedido".
- **Valor:** sempre `orders.total_cents`, decidido no banco.
- **Check-in:** qualquer ingresso `check_in` bloqueia o estorno. A checagem é feita com os ingressos travados (seção 5.5).
- **Prazo de 180 dias:** o Mercado Pago só estorna até 180 dias após a aprovação [V]. Depois disso o botão mostra "Prazo do Mercado Pago encerrado (180 dias). Devolva por outro meio." (pendência na seção 13).
- **Vagas:** voltam para a venda quando o estorno fica `concluido`. Enquanto está `solicitado`, os lugares continuam ocupados (seção 5.4, `event_occupied_count`).
- **Um estorno ativo por pedido:** só um registro `solicitado` ou `concluido` por vez; um `falhou` permite nova tentativa com chave nova.

### 5.3 Pagamento sem vaga e validade do PIX
- **Por que acontece [V]:** a reserva conta a partir da criação do pedido, mas o PIX vale 30 min a partir de quando é gerado (`PIX_EXPIRATION = "PT30M"`). Um PIX gerado perto do fim da reserva pode ser pago depois que ela venceu. Se a lotação acabou nesse meio-tempo, hoje a RPC cancela o pedido com o dinheiro já recebido (`cancelled_capacity`).
- **Limite do Mercado Pago [V]:** na API de Orders, `expiration_time` do PIX deve ter **mínimo de 30 minutos** e máximo de 30 dias ([doc PIX — Checkout API Orders](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/websites/pix.md)). Com reserva de 15 min, **não dá para encurtar o PIX até o fim da reserva**.
- **Desenho proposto (alinhar ao contrário):**
  - quando o PIX é gerado dentro da reserva, a reserva do pedido é **estendida até o vencimento do PIX + 2 min** de folga (para o aviso de pagamento chegar);
  - teto: 33 min depois da geração do PIX;
  - assim o lugar fica garantido enquanto o PIX pode ser pago.
- **Efeito na reserva:**
  - quem escolhe cartão tem 15 min;
  - quem gera PIX nesse prazo tem até cerca de 48 min no total (no máximo 15 + 33);
  - a extensão acontece uma vez só: se o PIX vence, a reserva vence junto e não dá para gerar outro.
- **O "pago sem vaga" quase desaparece.** Ainda pode ocorrer com cartão "em análise" aprovado tarde, ou aviso muito atrasado. Nesses casos o pedido vai para `aguardando_decisao` com `decision_reason = 'sem_vaga'`, mais o alerta por e-mail à equipe (`alertTeam`, novo tipo `pago_sem_vaga`).
- **Alternativa descartada:** reserva estrita de 15 min com um job cancelando o PIX no Mercado Pago. Com o job a cada ~10 min, o PIX ainda poderia ser pago até uns 25 min, e o problema continuaria.
- ✅ **Decidido pelo dono em 2026-10-01:** reserva de 15 min; ao gerar o PIX, a reserva é estendida até o vencimento do PIX + folga (desenho acima); cartão segue com 15 min.
- **Tela de pagamento:** mostra "Reserva válida até HH:MM" (horário de São Paulo), atualizado quando o PIX estende a reserva.

### 5.4 Banco (migrations)

**Migration `20261002100000_payment_states_enums.sql`** (só enums)
- `alter type order_status add value 'estornado'` e `add value 'aguardando_decisao'`.
- `alter type ticket_status add value 'estornado'`.
- `create type refund_status as enum ('solicitado','concluido','falhou')`.
- Fica separada porque o Postgres não deixa usar um valor novo de enum na mesma transação em que ele foi criado.

**Migration `20261002110000_payment_states.sql`**
- **Colunas novas em `orders`:**
  - `provider_order_id text` (ORD… do Mercado Pago) e `provider_payment_id text` (PAY…), com índice único parcial em `(payment_provider, provider_order_id)` quando não nulo;
  - `cancel_reason text` com check em (`alterado_pelo_comprador`, `equipe`, `capacidade_legado`);
  - `decision_reason text` com check em (`sem_vaga`, `pago_apos_cancelamento`);
  - `decided_by uuid references auth.users`, `decided_at timestamptz`;
  - `hold_extended_at timestamptz`.
- **Reserva de 15 min:** `create or replace` de `create_checkout_order` (mesma assinatura atual, com aceite da política), trocando `interval '30 minutes'` por `interval '15 minutes'`.
- **`extend_order_hold_for_pix(p_order_id uuid, p_pix_expires_at timestamptz) returns timestamptz`.**
  - Trava o pedido.
  - Só age se estiver `pendente`, com `expires_at > now()` e sem extensão anterior.
  - Novo `expires_at = least(p_pix_expires_at + 2 min, now() + 33 min)`; preenche `hold_extended_at`.
  - Não precisa rechecar a lotação: o lugar já estava reservado.
- **`mark_order_paid_by_external` v2.** Ganha os parâmetros `p_provider_order_id text default null` e `p_provider_payment_id text default null`.
  - `pendente` ou `expirado`: recheca a lotação (como hoje). Se couber → `pago`. Se não couber → `aguardando_decisao` com `decision_reason = 'sem_vaga'`, `paid_at = now()` e ingressos `nao_pago` (não contam vaga). Devolve `needs_decision_capacity` (antes: cancelava).
  - `cancelado`: → `aguardando_decisao` com `decision_reason = 'pago_apos_cancelamento'`. Devolve `needs_decision_cancelled`. Hoje esse caso devolve `noop` em silêncio [V].
  - `pago`: conserta ingressos `nao_pago` (como hoje). `estornado` e `aguardando_decisao`: `noop`.
  - Sempre grava `provider_order_id` e `provider_payment_id` quando vierem e estiverem vazios.
- **`accept_paid_order(p_order_id uuid, p_staff_user_id uuid) returns text`.**
  - Trava o evento e o pedido. Exige `aguardando_decisao`.
  - Pedido → `pago`; ingressos `nao_pago`/`cancelado` → `pago`; grava `decided_by` e `decided_at`.
  - Ignora a lotação de propósito: a equipe confirmou na tela.
- **`cancel_pending_order(p_order_id uuid, p_reason text) returns text`** (substitui o uso de `cancel_order_by_external`, que hoje não é chamada).
  - Trava o pedido. Só cancela `pendente`.
  - Ingressos `nao_pago` → `cancelado`; grava `cancel_reason`.
- **Dados existentes:** pedidos `pendente` com `expires_at < now()` → `expirado` (15 hoje; seção 11).
- **Permissões:** todas as funções com `set search_path = ''` e nomes qualificados; `revoke all … from public, anon, authenticated`; `grant execute … to service_role`.

**Migration `20261003100000_order_refunds.sql`**
- **Tabela `public.order_refunds`:**
  - `id uuid pk default gen_random_uuid()`;
  - `order_id uuid not null references orders(id)`;
  - `amount_cents int not null check (amount_cents > 0)`;
  - `status refund_status not null default 'solicitado'`;
  - `idempotency_key text not null unique` (= `id::text`, gerado no banco);
  - `previous_order_status order_status not null`;
  - `requested_by uuid references auth.users` (nulo só para estorno feito fora do site: check `requested_by is not null or reason = 'Estornado fora do site'`);
  - `reason text not null check (char_length(btrim(reason)) between 5 and 500)`;
  - `provider_refund_id text`, `error_code text` (até 100 caracteres);
  - `created_at timestamptz not null default now()`, `completed_at timestamptz`.
- **Índices:**
  - único parcial `(order_id) where status in ('solicitado','concluido')` — um estorno ativo por pedido;
  - `(order_id, created_at)`.
- **RLS:** ligada; `select` só para `public.is_staff()`; sem política de escrita (escrita só pelas RPCs com `service_role`).
- **`begin_order_refund(p_order_id uuid, p_staff_user_id uuid, p_reason text)`** — devolve `refund_id`, `idempotency_key`, `amount_cents`, `provider_order_id`, `already_requested boolean`.
  1. Trava o pedido (`for update`) e os ingressos do pedido (`for update`).
  2. Valida: `mercadopago`; status `pago`/`aguardando_decisao`; nenhum ingresso `check_in`; `paid_at` há no máximo 180 dias; motivo válido.
  3. Se já existe estorno `solicitado`, devolve o mesmo, para tentar de novo com a **mesma chave**.
  4. Senão, insere o estorno com `amount_cents = total_cents`, guarda o status anterior e muda pedido e ingressos (`pago`/`nao_pago`/`cancelado`) para `estornado`.
  
  O congelamento imediato fecha a corrida com o check-in: a rota de check-in só atualiza `status = 'pago'` [V].
- **`complete_order_refund(p_refund_id uuid, p_provider_refund_id text)`:** estorno → `concluido` com `completed_at`. Idempotente.
- **`fail_order_refund(p_refund_id uuid, p_error_code text)`:** estorno → `falhou`. Pedido volta ao status anterior e os ingressos voltam (pago → `pago`; aguardando → `nao_pago`).
- **`sync_order_refunded(p_provider text, p_external_id text, p_provider_order_id text)`** — para o aviso ou consulta de estorno:
  - estorno `solicitado` → conclui;
  - pedido `pago` sem estorno (feito fora do site) → cria um registro `concluido` com `requested_by` nulo e `reason = 'Estornado fora do site'`, e marca `estornado`;
  - devolve `external` para o código alertar a equipe.
- **`event_occupied_count` v2:** também conta ingressos `estornado` cujo pedido tem estorno `solicitado`, para não revender um lugar cujo dinheiro ainda não voltou.
- **Permissões:** mesmo padrão de `search_path`, `revoke` e `grant service_role`.

### 5.5 Código e integração com o Mercado Pago
- **Classificação da order** (novo `src/lib/payments/order-status.ts`): uma função que classifica a order do Mercado Pago em `paid`, `refunded`, `pending_pix`, `failed` ou `other`.
  - `refunded` se `status === "refunded"` **ou** `status_detail` em (`refunded`, `partially_refunded`), **ou** se houver `transactions.refunds` com algum item `processed`.
  - `paid` só se `status === "processed"` e não for `refunded`.
  - Corrige o problema atual: `processed` é tratado como pago em `createPayment`, `findOrderPayment` e `parseWebhook` [V].
  - [S] A documentação mostra as duas formas (`processed/refunded` na resposta do estorno; `refunded/refunded` nos exemplos de aviso). Por isso as duas são aceitas e um teste real com credenciais de teste é obrigatório (seção 12).
- **Guardar os IDs do Mercado Pago:**
  - `createPayment` e `findOrderPayment` passam a devolver `providerOrderId` e `providerPaymentId` (`transactions.payments[0].id`);
  - `confirmOrderPaid` repassa os dois à RPC;
  - pedidos pagos antigos (6) não têm os IDs: no estorno, se faltar `provider_order_id`, o servidor busca por `external_reference` (busca já existente), escolhe a order `processed` e grava.
- **`confirmOrderPaid`:** antes de comparar valores, lê o status do pedido.
  - A comparação "valor pago = total" só vale quando o pedido está `pendente`, `expirado` ou `cancelado`, isto é, quando o pagamento vai mudar o estado.
  - Para `pago`, `estornado` e `aguardando_decisao`, não há comparação nem alerta de valor divergente. Isso evita o falso alerta depois de um estorno.
  - Resultados `needs_decision_*` geram o alerta adequado e **não** enviam ingressos.
- **Aviso do Mercado Pago (webhook):** `parseWebhook` devolve também `{ kind: "refunded", externalId, providerOrderId }`. A rota chama `sync_order_refunded`; se o resultado for `external`, alerta `estorno_externo`. A assinatura continua validada como hoje.
- **Estornar** (novo `src/lib/payments/refund.ts` + método `refundOrder` no `PaymentProvider`):
  - chamada `POST /v1/orders/{provider_order_id}/refund`, **corpo vazio** (estorno total) e cabeçalho `X-Idempotency-Key: <idempotency_key do banco>` [V] ([referência](https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-api/refund-order/post));
  - 201 e classificação `refunded` (ou resposta com `transactions.refunds[].status = processed`) → `complete_order_refund`;
  - 4xx definitivo (ex.: `refund_amount_exceeds`, saldo insuficiente) → `fail_order_refund` com o código;
  - tempo esgotado ou 5xx → mantém `solicitado`; uma nova tentativa reusa a mesma chave, e a consulta ou o aviso resolvem.
- **Server Action** (novo arquivo `src/app/equipe/eventos/order-actions.ts`): `refundOrder(orderId, reason)` e `acceptPaidOrder(orderId)`.
  - Padrão `runAction`/`ActionError`.
  - Primeiro passo: `requireStaffUser()` (novo `src/lib/auth/staff-user.ts`: `auth.getUser()` + RPC `is_staff`; devolve `{ userId }`). É arquivo novo para não colidir com `src/lib/auth/staff.ts` da outra frente.
  - Valida UUID e motivo; revalida as telas.
- **Check-in:** `evaluateCheckIn` passa a usar **lista de permitidos**: só `pago` entra. `estornado` → "Estornado"; `check_in` → "Já utilizado"; outros → recusa genérica (falhar fechado). Atualizar `CheckInScanner` e `status.ts`.
- **Alertas** (`team-alert.ts`, novos tipos): `pago_sem_vaga`, `pago_apos_cancelamento`, `estorno_falhou`, `estorno_externo`, `email_estorno_nao_enviado`. Mantém a deduplicação de 1 por pedido e tipo a cada 24 h.
- **E-mail ao comprador:** `src/lib/email/refund-template.ts` e `send-refund.ts`, no mesmo padrão de `send-tickets.ts` (Resend via `fetch`, sem dependência nova). Enviado uma vez, quando o estorno fica `concluido`.

### 5.6 Casos de borda
- **Dois cliques em "Estornar":** a trava do pedido e o índice único fazem o segundo cair no mesmo estorno `solicitado`, com a mesma chave. O Mercado Pago não devolve duas vezes.
- **Check-in ao mesmo tempo que o estorno:** quem travar os ingressos primeiro vence.
  - Se o check-in vem antes, o estorno é recusado.
  - Se o estorno vem antes, o check-in recebe "Estornado".
- **Estorno feito no painel do Mercado Pago:** é sincronizado pelo aviso e alerta a equipe.
- **Aviso de pagamento depois do estorno:** a classificação não trata como pago, e a RPC devolve `noop` para pedido `estornado`.
- **Saldo insuficiente no Mercado Pago:** `falhou`; a equipe pode tentar de novo depois (nova chave).

### 5.7 Testes
- **Unidade, classificação:** `processed/accredited` → paid; `processed/refunded` → refunded; `refunded/refunded` → refunded; `processed` com refunds `processed` → refunded.
- **Unidade, `refundOrder`:** corpo vazio, chave do banco no cabeçalho, mapeamento de 201, 400 e 5xx.
- **Unidade, `confirmOrderPaid`:** sem alerta de valor para `estornado`/`pago`; `needs_decision_*` alerta e não envia e-mail.
- **Server Actions:** quem não é equipe é recusado antes de tocar no banco; motivo inválido; pedido com check-in.
- **Check-in:** `estornado` recusado com o texto certo; status desconhecido recusado.
- **SQL** (rodar no ramo de teste do Supabase ou localmente, nunca em produção sem aprovação):
  - dois `begin_order_refund` seguidos devolvem o mesmo estorno;
  - `fail` restaura os status;
  - capacidade com estorno `solicitado`.
- **Manual com credenciais de teste:** pagar por cartão de teste → estornar pelo painel → conferir o status real devolvido pelo Mercado Pago, o aviso `order.refunded` e o e-mail.

---

## 6. Item C — Tipos de ingresso configuráveis

### 6.1 Comportamento

> **Decisões do dono em 2026-10-03** (substituem a versão anterior desta seção):
> - Todo evento tem **tipos prontos** com número de pessoas **fixo**: **Inteira** (1 pessoa), **Meia-entrada** (1), **Casadinha** (2 pessoas = 2 ingressos inteira) e **Pacote família** (4 pessoas = 4 ingressos inteira). A **Cortesia** continua só da equipe, nunca vendida.
> - O preço **nunca** vem pronto: a equipe sempre informa. O limite por tipo é opcional.
> - Em cada evento a equipe **marca** quais tipos prontos vende e define o preço. Tipo desmarcado não aparece ao comprador; tipo marcado exige preço válido.
> - **"Criar novo tipo"**: nome, pessoas (1 a 10), preço e limite opcional.
> - Casadinha e Pacote família geram ingressos da categoria **Inteira**. Rótulo na lista da equipe, portaria, e-mail, PDF e página do pedido: "Casadinha — Inteira".
> - Eventos que já existem mantêm Inteira, Meia e Cortesia com os preços atuais; Casadinha e Pacote família começam **desmarcadas**.
>
> - **Quantidade de inteiras e de meias** (pedido do dono em 2026-10-03; regra padrão adotada pela coordenação, ajustável pelo dono): junto do **total de ingressos** (lotação, em pessoas), o formulário tem "Quantidade de inteiras" e "Quantidade de meias", ambos opcionais (vazio = sem quantidade separada; a categoria divide o total).
>   - As cotas contam **ingressos (pessoas) por categoria**: a de inteiras inclui Inteira avulsa e cada pessoa de Casadinha, Pacote família e tipos novos; a de meias conta os ingressos meia. A **cortesia** conta só no total, como antes.
>   - Regras (servidor e banco): cada cota de 1 até o total; inteiras + meias ≤ total; baixar a cota abaixo do já vendido/reservado é recusado com o número ("não pode ser menor que N"), no mesmo padrão da lotação.
>   - O formulário mostra "Total 100 · Inteiras 60 · Meias 40" e "Faltam X para distribuir".
>   - No checkout, um tipo para no menor entre: cota da categoria, limite próprio do tipo, total do evento e 10 pessoas por compra. Reservas pendentes contam como na lotação; a checagem roda sob a mesma trava do evento. O comprador vê "Esgotado"/"Resta N" coerentes; a equipe vê vendidos/cota por categoria na página do evento.
>   - Eventos existentes ficam sem cotas (nada muda).
>
> Escolhas de implementação (opção mais segura, reportadas ao dono):
> - Tipo criado pela equipe é sempre da categoria **Inteira** (meia só pelo tipo pronto "Meia-entrada"); por isso o enum `outro` foi descartado e `ticket_kind` não muda.
> - Os nomes dos tipos prontos e "Cortesia" são reservados: tipo novo não pode usá-los.
> - Remarcar um tipo pronto reativa o mesmo registro (as vendas antigas continuam contando no limite dele).
> - Ordem: tipos prontos na ordem fixa, depois os criados pela equipe (estes podem subir/descer entre si).

**Equipe:** no formulário do evento, os campos "Preço inteira/meia" viram a seção **"Tipos de ingresso"**:
- **Tipos prontos:** caixa "Vender Casadinha" (etc.), o que cada unidade gera ("2 pessoas · gera 2 ingressos inteira"), preço e limite opcional.
- **Tipos novos ("+ Criar novo tipo"):** nome (1 a 60 caracteres), pessoas por unidade (1 a 10), preço e limite de unidades (opcional; vazio = sem limite próprio); botões "Subir", "Descer" e "Remover".
- **Evento novo:** começa com Inteira e Meia-entrada marcadas, sem preço.
- **Desmarcar ou remover um tipo:**
  - sem vendas: sai da venda;
  - com vendas: confirmação "Este tipo já tem vendas. Ele sai da venda, mas continua no histórico e os ingressos vendidos seguem válidos."
- **Tipo com vendas:**
  - nome (só nos tipos novos) e preço podem mudar; o histórico mantém o nome e o preço da época da compra;
  - "pessoas por unidade" de tipo novo não pode mudar ("Crie um tipo novo se precisar"), porque isso quebraria a contagem.

**Comprador:**
- **Página do evento e checkout:** listam os tipos à venda na ordem definida, com o preço e, quando a unidade tem mais de uma pessoa, o conteúdo ("2 ingressos inteira").
- **Pacote:** comprar 1 casadinha gera **2 ingressos, cada um com seu QR**. Cada QR ocupa 1 vaga.
- **Nomes dos titulares:** cada ingresso continua com o nome do comprador (como hoje). Pedir o nome de cada pessoa não está no escopo.

**Portaria, lista, e-mail e PDF:** o rótulo do ingresso passa a ser "nome do tipo — categoria" (ex.: "Casadinha — Inteira"; quando o nome é a própria categoria, só "Inteira"). A lista da equipe mostra os ingressos válidos agrupados por tipo.

### 6.2 Regras
- **Preço, total, pessoas e estoque:** sempre calculados na RPC.
- **Limite do tipo:** conta **unidades** de pedidos que ocupam lugar (`pago`, reserva ativa, estorno `solicitado`).
- **Lotação do evento:** conta **pessoas** (ingressos), como hoje.
- **Por compra:** de 1 a 10 pessoas no total (soma de quantidade × pessoas por unidade).
- **Cortesia:** um tipo `cortesia` por evento, criado automaticamente, nunca vendido no site e escondido pela RLS pública (como hoje).
- **Por que arquivar em vez de apagar** (requisito técnico mínimo): `tickets.ticket_type_id` e `order_items.ticket_type_id` apontam para o tipo. Ele sustenta o rótulo no check-in, o histórico, os relatórios e o estorno. Apagar quebraria esses vínculos ou apagaria histórico. Por isso o tipo é **sempre arquivado** (`archived_at`), mesmo sem vendas: uma regra só, sem surpresas.

### 6.3 Banco

~~**Migration `20261005090000_ticket_kind_outro.sql`**~~ — descartada (decisão do dono em 2026-10-03; ver 6.1).

**Migration `20261005100000_ticket_types_v2.sql`** (única da fase)
- **`ticket_types`, colunas novas:**
  - `name text not null` (preenchido nos dados atuais antes do `not null`) com check de 1 a 60 caracteres sem espaços nas pontas;
  - `preset text` (`inteira`, `meia`, `casadinha`, `familia` ou nulo para tipo novo/cortesia). Um check garante que cada tipo pronto tem nome, categoria e pessoas fixos (Casadinha = inteira × 2; Pacote família = inteira × 4); outro check garante que tipo novo é `inteira`; índice único parcial: um tipo pronto ativo de cada por evento;
  - `people_per_unit int not null default 1 check (between 1 and 10)`;
  - `max_units int check (max_units > 0)`;
  - `sort_order int not null default 0`;
  - `archived_at timestamptz`.
- **`ticket_types`, restrições:**
  - remove `unique (event_id, kind)`;
  - cria único parcial `(event_id, lower(name)) where archived_at is null`;
  - cria único parcial `(event_id) where kind = 'cortesia' and archived_at is null`.
- **`ticket_types`, coluna `active`:** continua por compatibilidade e acompanha o arquivamento (`active = archived_at is null`). Não há botão de pausar.
- **Tabela `public.order_items`:**
  - `id uuid pk`;
  - `order_id uuid not null references orders(id) on delete cascade`;
  - `ticket_type_id uuid not null references ticket_types(id)`;
  - cópias do momento da compra: `name text not null`, `kind ticket_kind not null`, `unit_price_cents int not null check (>= 0)`, `people_per_unit int not null`;
  - `quantity int not null check (between 1 and 10)`, `line_total_cents int not null`, `created_at timestamptz default now()`;
  - índice `(order_id)` e `(ticket_type_id)`;
  - **RLS:** ligada; `select` só equipe (`is_staff()`); sem política de escrita.
- **`tickets`:** nova coluna `order_item_id uuid references order_items(id)` com índice. O `price_cents` de cada ingresso é o rateio da linha (divisão inteira; o resto vai no primeiro ingresso), para que a soma dos ingressos seja igual ao total do pedido.
- **RLS pública de `ticket_types`:** a condição passa a ser `kind <> 'cortesia' and archived_at is null and active and exists(evento com venda aberta)`, ou equipe.
- **`create_checkout_order` v3** (substitui a v2; a ação do checkout muda junto):
  - `p_items jsonb` = `[{ "ticket_type_id": uuid, "qty": int }]`;
  - trava o evento (`for update`, como hoje);
  - valida que os tipos são do evento, ativos, não arquivados e não cortesia; quantidades inteiras de 1 a 10; tipos sem repetição;
  - calcula pessoas (de 1 a 10), checa a lotação do evento (pessoas) e o limite de cada tipo (unidades);
  - insere pedido, `order_items` e `qty × people_per_unit` ingressos por linha;
  - reserva de 15 min (já vem da migration de pagamento).
  - Erros com prefixo estável para a ação traduzir: `ESGOTADO_EVENTO:<restantes>`, `ESGOTADO_TIPO:<ticket_type_id>:<restantes>`, `LIMITE_PESSOAS`, `TIPO_INDISPONIVEL`.
- **`save_event_ticket_types(p_event_id uuid, p_types jsonb)`** — chamada por `createEvent` (com o evento recém-criado; se falhar, o evento é desfeito):
  - itens: tipo pronto `{preset, price_cents, max_units}` (nome, categoria e pessoas vêm do banco) ou tipo novo `{id|null, name, people_per_unit, price_cents, max_units}` (categoria `inteira`);
  - insere, atualiza, reativa (tipo pronto remarcado) e arquiva os tipos omitidos;
  - recusa mudar `people_per_unit` de tipo com vendas, limite menor que o já ocupado e nome reservado;
  - garante a cortesia;
  - exige de 1 a 20 tipos vendáveis com preço > 0.
- **`update_event_with_capacity`:** nova versão com `p_ticket_types` no lugar dos preços; salva evento e tipos na mesma transação. A checagem "capacidade não pode ser menor que o ocupado" continua.
- **`events`, cotas:** `inteira_quota` e `meia_quota` (`int`, nulos = sem cota) com checks `1..capacity` e soma `≤ capacity`. Nova `event_kind_occupied_count(evento, categoria)` (mesma regra de `event_occupied_count`, por categoria do ingresso; só `service_role`). `create_checkout_order` recusa com `ESGOTADO_CATEGORIA:<inteira|meia>:<restantes>`; `mark_order_paid_by_external` manda para decisão quando a reserva venceu e a cota acabou; `update_event_with_capacity` ganha `p_inteira_quota`/`p_meia_quota` (obrigatórios) e recusa com `COTA_INVALIDA` ou `COTA_MENOR:<categoria>:<ocupado>`; `event_availability` devolve `categories` (cota, vendidos, ocupados, restantes).
- **Dados atuais:** Inteira → tipo pronto `inteira`, Meia → `meia`, mesmos preços; Cortesia continua; Casadinha e Pacote família não são criados (= desmarcados). Cada pedido antigo ganha uma linha em `order_items` por categoria, e cada ingresso antigo aponta para ela.
- **Compatibilidade na janela do deploy:** `create_checkout_order` ainda aceita o formato antigo `{kind, qty}` (só Inteira/Meia prontas). **Aplicar a migration antes do deploy do código.**
- **`issue_courtesy_ticket`:** busca a cortesia não arquivada e cria um `order_items` de 1 unidade.
- **`event_availability(p_event_id uuid) returns jsonb`** — usada também pelo item D:
  - `capacity`, `sold` (pessoas em `pago`/`check_in`), `held` (pessoas em reservas ativas e estornos `solicitado`), `remaining`;
  - por tipo: `units_taken`, `max_units`, `remaining_units`.
- **Permissões:** mesmo padrão de `search_path`, `revoke` e `grant service_role`.

### 6.4 Código e interface mínima
- **Checkout:**
  - `checkout/page.tsx` busca os tipos e a disponibilidade (via `event_availability`) com o cliente admin;
  - `checkout-form.tsx` trabalha com `ticketTypeId` (sem o tipo fixo `"inteira" | "meia"`);
  - `checkout/actions.ts` valida o formato (UUID, inteiros) e repassa à RPC.
- **Formulário do evento:**
  - `EventForm.tsx` usa um componente novo, `src/components/equipe/TicketTypesEditor.tsx`;
  - `equipe/eventos/actions.ts` (`EventInput` troca `fullPriceCents`/`halfPriceCents` por `ticketTypes[]`) valida e chama `save_event_ticket_types`.
- **Rótulos:**
  - `TicketList`, `CheckInScanner`, `TicketQr`, `DownloadTicketPdf`, e-mail e `api/check-in` usam o nome copiado (`order_items.name` via `order_item_id`; ingressos antigos recebem `order_items` na migração);
  - `ticketKindLabels` fica só como reserva para a categoria.
- **Tipos TypeScript:** `src/types/database.ts` atualizado à mão (regenerar com o MCP do Eventos depois de aplicar a migration).
- **Carrinho `v2`:** quantidades por id do tipo; o carrinho `v1` (inteira/meia) é convertido para os tipos prontos à venda, ou os itens são descartados com o aviso "Alguns itens não estão mais disponíveis".

### 6.5 Testes
- **SQL:**
  - casadinha gera 2 ingressos e 1 linha em `order_items`;
  - limite do tipo e lotação sob duas compras simultâneas (a segunda é recusada);
  - mais de 10 pessoas recusado;
  - tipo arquivado recusado;
  - mudar pessoas por unidade de tipo com vendas é recusado;
  - rateio de preço soma o total.
- **Ações:** formato inválido recusado antes do banco; equipe obrigatória em `save_event_ticket_types`.
- **Componente:** editor de tipos (adicionar, remover, ordenar) e seleção respeitando os máximos.

---

## 7. Item D — Limite de quantidade e "Esgotado"

### 7.1 Comportamento
- **No checkout,** o botão "+" de cada tipo para no máximo permitido:
  - limite do tipo menos o que já está ocupado;
  - lugares restantes do evento;
  - 10 pessoas menos as pessoas já escolhidas nos outros tipos;
  - tudo dividido pelas pessoas por unidade.
- **Aviso** "Restam N lugares" quando N ≤ 20; aviso por tipo "Restam N" quando ele tiver limite.
- **Se o servidor recusar** porque outra pessoa comprou antes: a mensagem é "Restam apenas N lugares. Ajustamos sua seleção." A tela recebe a disponibilidade atualizada e reduz as quantidades.
- **Página do evento:**
  - `restante > 0` → "Comprar ingresso";
  - `restante = 0` com reservas ativas → "Ingressos reservados no momento. Se alguém não concluir, novas vagas podem abrir em até 15 minutos." (sem botão de compra);
  - vendidos ≥ lotação → "Esgotado".
- **Painel do evento (equipe):** cards "Lotação", "Vendidos", "Reservados agora", "Restantes", e por tipo "vendidos / limite". A cortesia mostra as "vagas disponíveis" já descontando as reservas.

### 7.2 Regras e técnica
- **Servidor e banco** seguem como fonte da verdade (`for update` no evento + checagens da RPC). A tela só ajuda.
- **Fase 1 (antes do item C):**
  - usa `event_occupied_count` (já existe; só `service_role`) mais a contagem de vendidos para calcular `held` e `remaining`;
  - limita a 10 **pessoas no total** (corrige o 10 por tipo × 10 no total [V]: `MAX_PER_KIND = 10` em `checkout-form.tsx` contra o limite de 10 em `checkout/actions.ts` e na RPC).
  - Para devolver os restantes na recusa já na fase 1 sem migration, a ação recalcula com `event_occupied_count` depois do erro "Capacidade esgotada".
- **Fase 5:** passa a usar `event_availability` (limite por tipo).
- **Novo helper:** `src/lib/domain/availability.ts`, com o cálculo puro do máximo por tipo, testado em unidade.

### 7.3 Testes
- **Unidade:** máximo por tipo nas combinações (casadinha com 9 restantes → máximo 4; restante 0; limite do tipo menor que o restante).
- **Ação:** recusa devolve os restantes atualizados.
- **Navegador:** com 2 restantes, não dá para selecionar 5.

---

## 8. Item E — Carrinho: voltar, alterar e retomar

### 8.1 Onde fica o carrinho (e por quê)
- **No navegador** (`localStorage`, chave `byla:cart:v2:<slug>`; a fase 1 usa `v1`, com tipo fixo, e é descartada ao subir para `v2`). Guarda:
  - seleção (`ticketTypeId` e `qty`);
  - nome, e-mail e telefone;
  - `pendingOrderToken` (token do pedido pendente);
  - `updatedAt`.
  - Validade de 7 dias; apagado quando o pedido é pago.
- **No servidor**, o próprio **pedido pendente** já guarda itens e dados depois de "Continuar" e segura os lugares.
- **Por que os dois:**
  - antes de "Continuar" não existe pedido, então o navegador evita perder o que foi digitado sem criar dado pessoal novo no servidor;
  - depois de "Continuar", o pedido é o carrinho que funciona em qualquer aparelho (pelo link do pedido ou do lembrete) e é o único que reserva lugar.
- **Alternativa descartada:** tabela de carrinho no servidor antes do "Continuar". Guardaria dado pessoal sem pedido, aumentaria a superfície LGPD e não reservaria lugar.

### 8.2 Comportamento
- **Na escolha de ingressos:** a seleção e os dados são salvos a cada mudança. Ao voltar (botão voltar do navegador, link "Voltar ao evento" ou nova visita), tudo volta preenchido. O comprador pode "Limpar seleção".
- **Pedido aguardando pagamento:** se existe um no navegador e ele ainda está `pendente` dentro da reserva, aparece o aviso "Você tem um pedido aguardando pagamento (reserva até HH:MM)", com dois botões: **Continuar pagamento** (vai ao pedido) e **Alterar seleção**.
- **Na tela de pagamento, botão "Alterar seleção":**
  1. O servidor confere no Mercado Pago se o pedido já foi pago. Se foi, confirma e mostra os ingressos.
  2. Se houver cartão "em análise", recusa: "Seu pagamento está em análise. Aguarde a confirmação."
  3. Cancela no Mercado Pago as orders `action_required` (PIX gerado) daquele pedido (`POST /v1/orders/{id}/cancel` [V]).
  4. Cancela o pedido local (`cancel_pending_order`, motivo `alterado_pelo_comprador`) e libera os lugares na hora.
  5. Volta para `/eventos/<slug>/checkout?retomar=<publicToken>`, com itens, nome e e-mail preenchidos.
- **"Tempo esgotado"** (pedido expirado) ganha o botão **"Escolher de novo com os mesmos dados"** → mesmo endereço com `?retomar=`.
- **`?retomar=<token>`:** o servidor só aceita token de pedido **daquele evento**, com status `pendente`, `cancelado` ou `expirado`. Ele carrega itens e dados e os passa como valores iniciais.
  - Tipos arquivados ou esgotados saem, com o aviso "Alguns itens não estão mais disponíveis".
  - Quantidades são reduzidas ao máximo atual.
  - O token já é a "chave" do pedido (a página do pedido mostra o mesmo e-mail hoje [V]); nenhum dado novo é exposto.

### 8.3 Corrida "cancelou mas pagou"
- **PIX pago entre a consulta e o cancelamento:** o cancelamento no Mercado Pago falha porque a order já está `processed`. O servidor reconsulta e confirma o pagamento em vez de cancelar.
- **PIX pago depois do cancelamento local** (ex.: o cancelamento no Mercado Pago falhou por rede): o aviso do Mercado Pago chega e `mark_order_paid_by_external` v2 põe o pedido em `aguardando_decisao`, com `decision_reason = 'pago_apos_cancelamento'`, mais o alerta à equipe. A equipe decide entre "Aceitar mesmo assim" e "Estornar".
- **Sem a migration da fase 2, "Alterar seleção" não é publicado:** é ela que transforma esse caso de silencioso em acionável.

### 8.4 Segurança
- **"Alterar seleção"** (`changeOrderSelection` em `pedidos/[publicToken]/actions.ts`): valida o token (tipo e tamanho, como `loadOrder`); já está sob BotID (`/pedidos/*` POST) [V]; ganha limite de tentativas próprio (`selectionChangePerOrder`, ex.: 5/30 min) e por IP.
- **Mensagens ao comprador:** sempre genéricas; detalhe no log.

### 8.5 Testes
- **Ação:**
  - pedido já pago → confirma, não cancela;
  - cartão em análise → recusa;
  - PIX `action_required` → cancela no Mercado Pago, depois no banco;
  - falha no cancelamento por ter sido pago → confirma.
- **SQL:** `mark_order_paid` em `cancelado` → `aguardando_decisao`.
- **Unidade:** leitura e gravação do carrinho com versão e validade; `retomar` com token de outro evento → ignorado.
- **Navegador:** ir ao pagamento, "Alterar seleção", voltar com tudo preenchido, avançar de novo.

---

## 9. Item F — Lembrete de compra não finalizada

### 9.1 Comportamento
- **Quem recebe:** cerca de **1 hora** depois de criar o pedido (entre 60 e 70 min), um único e-mail "Você não finalizou sua compra", com o evento, data, itens e o botão **"Voltar e comprar"** → `/eventos/<slug>/checkout?retomar=<token>`. A reserva já venceu; o checkout é novo e já vem preenchido.
- **Rodapé de todo lembrete:** "Não quero mais receber estes lembretes" → `/lembretes/cancelar?t=<token assinado>`. A página mostra um botão de confirmação; o registro acontece no POST, porque leitores de e-mail abrem links sozinhos. Também vai o cabeçalho `List-Unsubscribe` + `List-Unsubscribe-Post` (cancelamento com um clique).
- **Não envia se:**
  - o pedido foi pago;
  - existe pedido mais novo do mesmo e-mail para o mesmo evento (pago ou não);
  - o e-mail se descadastrou;
  - o evento fechou a venda, já começou ou está sem lugares;
  - já saiu lembrete para esse e-mail e evento nos últimos 7 dias;
  - o pedido foi feito antes da nova versão da política.

### 9.2 Consentimento (LGPD)
- **Política de privacidade:** `src/app/privacidade/page.tsx` ganha o item "Se você não concluir o pagamento, podemos enviar **um único lembrete** sobre esse pedido, com link para não receber mais".
- **Nova versão:** `PRIVACY_POLICY_VERSION` em `src/lib/legal/privacy.ts`, data do deploy.
- **Quem pode receber:** só pedidos com `privacy_policy_version >= <nova versão>`. A comparação usa as datas no formato `AAAA-MM-DD`; a regra fica numa constante `REMINDER_MIN_POLICY_VERSION`.

### 9.3 Como agendar: comparação e recomendação

| | Supabase `pg_cron` + `pg_net` | Agendamento do Resend (`scheduled_at`) |
| --- | --- | --- |
| Decide na hora do envio | **Sim**: confere pago, compra mais nova e descadastro no momento do envio | **Não**: decide ao criar o pedido; depende de cancelar o envio em cada caminho (pago, nova compra, descadastro) [V: dá para cancelar ou reagendar] |
| Risco de e-mail errado | Baixo | Se um cancelamento falhar, quem já pagou recebe "você não finalizou" |
| Cota de 100/dia [V] | Controlada pelo app (limite por execução e por dia) | Cada pedido agendaria um envio; [S] não confirmei se o agendamento conta na cota |
| Peças novas | 2 extensões (disponíveis, não instaladas [V]), um segredo no Vault (já instalado [V]), 1 rota | Nenhuma extensão; ID do e-mail guardado no pedido e chamadas de cancelamento |
| Bônus | Atividade a cada 10 min **mantém o banco acordado** (contra a pausa do plano grátis) | — |
| Banco pausado | Não envia (aceitável) | Envia mesmo assim (inclusive errado) |

**Recomendação: `pg_cron` + `pg_net`.** A decisão de enviar acontece no momento certo, com os dados atuais, então "não enviar se pagou, se comprou depois ou se descadastrou" fica correto por construção. A cota fica sob controle e o banco ganha atividade constante. O cron diário do Vercel Hobby não serve para "1 hora" (1 vez por dia, ±59 min [V]) e continua só como keep-alive de reserva.

### 9.4 Banco

**Migration `20261006100000_abandoned_reminders.sql`**
- **`orders`, colunas novas:** `reminder_claimed_at timestamptz`, `reminder_sent_at timestamptz`, `reminder_attempts smallint not null default 0`. Índice parcial para busca: `(created_at) where reminder_sent_at is null and status in ('pendente','expirado','cancelado')`.
- **Tabela `public.email_reminder_optouts`:**
  - `email_hash text primary key` (SHA-256 em hex do e-mail em minúsculas, via `extensions.digest`);
  - `created_at timestamptz not null default now()`;
  - **RLS:** ligada, **sem políticas** (só `service_role`); `revoke all` de `anon` e `authenticated`.
- **`expire_stale_orders() returns integer`:** `pendente` com `expires_at < now()` → `expirado`. Os ingressos ficam `nao_pago` e já não contam lugar.
- **`claim_abandoned_order_reminders(p_limit int, p_daily_cap int)`** — devolve até `p_limit` linhas (`order_id`, `public_token`, e-mail, nome, evento, itens) e marca `reminder_claimed_at = now()`, `reminder_attempts += 1`, com `for update skip locked`. Critérios:
  - status `pendente`/`expirado`, ou `cancelado` com `cancel_reason = 'alterado_pelo_comprador'` (desistiu depois de alterar);
  - `created_at` entre `now() - 24h` e `now() - 60 min`;
  - `reminder_sent_at is null`; reivindicação nula ou com mais de 30 min (envio que travou); `reminder_attempts < 3`;
  - `privacy_policy_version >= REMINDER_MIN_POLICY_VERSION` (constante na função);
  - nenhum pedido mais novo com o mesmo e-mail e evento; nenhum lembrete enviado para o mesmo e-mail e evento nos últimos 7 dias; e-mail fora do descadastro;
  - evento com `sales_open`, `starts_at > now()` e lugares restantes;
  - total de `reminder_sent_at` no dia UTC atual menor que `p_daily_cap` (o dia do Resend é UTC [V]).
- **`mark_reminder_sent(p_order_id uuid)`** e **`release_reminder_claim(p_order_id uuid)`**.
- **`register_reminder_optout(p_email text)`**.
- **Permissões:** mesmo padrão de `search_path`, `revoke` e `grant service_role`.

**Migration `20261006110000_reminder_jobs.sql`** — só depois de o dono aprovar a instalação das extensões e o segredo no Vault:
- `create extension if not exists pg_cron;` e `create extension if not exists pg_net with schema extensions;`
- `cron.schedule('expire-stale-orders', '*/5 * * * *', 'select public.expire_stale_orders()')`
- `cron.schedule('abandoned-reminders', '*/10 * * * *', $$ select net.http_post(url := <URL de produção>/api/cron/abandoned-orders, headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'abandoned_cron_secret')), timeout_milliseconds := 10000) $$)`
- O segredo é criado no Vault **pelo dono, no painel**, nunca no Git. A URL é pública (não é segredo).

### 9.5 Rota e e-mail
- **`src/app/api/cron/abandoned-orders/route.ts` (POST):**
  - compara `Authorization` com `ABANDONED_CRON_SECRET` em tempo constante; sem segredo configurado → 401 (falhar fechado);
  - chama `claim_abandoned_order_reminders(20, 50)` (teto diário de **50 lembretes**, deixando 50 envios/dia para ingressos, estornos e alertas; constantes em `src/lib/reminders/rules.ts`);
  - para cada linha, envia pelo Resend → `mark_reminder_sent`; em falha → `release_reminder_claim`;
  - responde em menos de 10 s (no máximo 20 envios, respeitando 10 req/s do Resend [V]).
- **E-mail:** `src/lib/email/reminder-template.ts` e `send-reminder.ts`, no padrão do Resend existente. Sem QR e sem dados de pagamento.
- **Link de descadastro:** `src/lib/reminders/unsubscribe-token.ts`, HMAC-SHA256 do e-mail normalizado com `REMINDER_UNSUBSCRIBE_SECRET` (nova variável no Vercel, preenchida pelo dono).
- **Página `src/app/lembretes/cancelar/`:** valida o token, mostra o botão e chama a Server Action `confirmUnsubscribe`, que revalida o token e chama `register_reminder_optout`.
  - **Sem BotID** nessa ação: o descadastro com um clique é feito pelos servidores de e-mail, que são robôs legítimos.
  - Proteção por limite de tentativas por IP.
  - Também aceita POST direto do `List-Unsubscribe-Post`.

### 9.6 Testes
- **SQL:** critérios de `claim` (pago fora; pedido mais novo fora; descadastrado fora; teto diário; `skip locked`).
- **Rota:** sem ou com segredo errado → 401; falha no envio libera a reivindicação.
- **Unidade:** token de descadastro (válido, adulterado); template sem dados sensíveis.
- **Manual:** pedido de teste abandonado → lembrete em cerca de 1 h → "Voltar e comprar" preenchido → descadastrar → não recebe mais.

---

## 10. Reserva de 15 minutos
- **Banco:** `create_checkout_order` usa `interval '15 minutes'` (migration da fase 2).
- **Textos na tela:** "Reserva válida até HH:MM" na tela de pagamento; "Tempo esgotado" quando vence.
- **PIX:** continua com `PT30M` (o mínimo); a reserva acompanha o PIX (seção 5.3).
- **Teste:** pedido criado com `expires_at` de cerca de 15 min; extensão por PIX respeita o teto.

## 11. Migração dos dados existentes
- **Pedidos pendentes antigos** (15, todos com reserva vencida): → `expirado` na migration da fase 2. Não recebem lembrete (política antiga e mais de 24 h).
- **Pedidos pagos do Mercado Pago** (6): sem `provider_order_id`. É preenchido sob demanda no primeiro estorno (busca por `external_reference`) ou na próxima confirmação.
- **Pedidos do `pagbank`** (2 pagos, 4 pendentes): estorno pelo site indisponível (seção 5.2); os pendentes viram `expirado`.
- **Tipos atuais** (6 linhas; 2 eventos × inteira, meia e cortesia):
  - `name` = "Inteira", "Meia-entrada" ou "Cortesia";
  - `people_per_unit = 1`; `sort_order` = 0, 1, 2; `archived_at` nulo.
- **Ingressos atuais:** um `order_items` por (pedido, tipo), com `quantity` = número de ingressos, `unit_price_cents` = `price_cents`, `people_per_unit = 1` e o nome copiado do tipo. Cada ingresso aponta para sua linha (`order_item_id`).
- **Antes e depois de cada migration de dados:** conferir as contagens por status com `SELECT` agregado, sem dados pessoais.

## 12. Fases de entrega

Cada fase pode ir para produção sozinha. As que mexem no banco exigem aprovação (seção 14).

**Coordenação com a frente de capa e galeria:**
- Ela cria `src/lib/auth/staff.ts`, `src/app/equipe/eventos/media-actions.ts` e a migration `20261001120000_event_media.sql`, e altera `EventForm.tsx`, `equipe/eventos/actions.ts`, `equipe/eventos/[id]/page.tsx`, `novo/page.tsx` e `eventos/[slug]/page.tsx`.
- Nomes desta frente: todas as migrations têm data **posterior** a `20261001120000` (se ao criar já houver arquivo mais novo na pasta, usar o horário atual, sempre maior que o último). Ações novas ficam em arquivos novos (`order-actions.ts`, `staff-user.ts`). `equipe/eventos/actions.ts` e `EventForm.tsx` só são tocados na fase 5, **depois** de capa e galeria estarem em `main`.

**Fases:**

| Fase | Conteúdo | Banco | Depende de | Esforço |
| --- | --- | --- | --- | --- |
| **1. Ajustes rápidos** | Contraste do código manual (`TicketQr`); bloco de sucesso + `?confirmado=1`; etiquetas, selo "Novo" e atualização a cada 30 s na equipe; limite de 10 pessoas e restante na tela (com `event_occupied_count`); "Esgotado" × "reservas em andamento" no evento e na equipe; carrinho no navegador (`v1`) ao voltar e avançar | Não | — | P-M |
| **2. Pagamento mais seguro** | Enums; colunas de IDs e decisão; reserva de 15 min; extensão da reserva pelo PIX; `mark_order_paid` v2 (`aguardando_decisao`, aceita `expirado`); classificação `refunded` ≠ pago; `confirmOrderPaid` sem falso alerta; check-in por lista de permitidos; seção "Precisa de decisão" com **Aceitar mesmo assim** (até a fase 3, o texto orienta: "para devolver, aguarde o botão Estornar"); pendentes antigos → `expirado` | Sim (2 migrations) | 1 (recomendado) | M |
| **3. Estorno** | `order_refunds` e RPCs; chamada `/refund` com idempotência; aviso `order.refunded`; e-mail ao comprador; botão "Estornar pedido" (inclui pedidos aguardando decisão); "Cancelar" só para cortesia; página do pedido "Estornado" | Sim | 2 | M-G |
| **4. Alterar seleção e retomar** | "Alterar seleção" (cancela no Mercado Pago e no banco); `?retomar=`; aviso de pedido pendente no checkout; "Escolher de novo" no tempo esgotado | Não (usa RPC da fase 2) | 2 | M |
| **5. Tipos de ingresso** | Tipos prontos (Inteira, Meia, Casadinha, Pacote família) + tipos novos; `ticket_types` v2; `order_items`; checkout v3; editor de tipos; rótulos; `event_availability` com limite por tipo; carrinho `v2` | Sim (1 migration + dados) | 2; capa e galeria em `main` | G |
| **6. Lembrete** | Nova versão da política; migration dos lembretes; rota, e-mail e descadastro; depois, com aprovação separada, extensões + Vault + jobs | Sim (2 etapas) | 4 (retomar), 2 (`expirado`) | M |

- **Prioridade do dono:** a fase 5 pode subir antes da 3 ou da 4 sem conflito de banco, desde que a 2 já esteja feita.
- **Cada fase:** testes Vitest verdes, `npm run lint`, `npm run build` e verificação no navegador (tema claro e escuro, 360 px) antes de entregar ao dono.

## 13. Riscos e pendências
- **Meia-entrada 40%:** fora de escopo; o dono "vê depois". O limite por tipo permite restringir manualmente.
- **Taxa do Mercado Pago no estorno:** não encontrei na doc se a taxa volta [S]. O dono confere no painel do Mercado Pago depois do primeiro estorno real.
- **Status real do estorno na API de Orders online:** a doc tem exemplos contraditórios [S]. O código aceita as duas formas; teste obrigatório na fase 3 com credenciais de teste.
- **Aviso `order.refunded` no Checkout API online:** confirmado em docs de QR e Point, não na página do Checkout API [S]. Se não vier, a consulta na página do pedido e no painel resolve; não trava a fase.
- **Prazo de 180 dias do Mercado Pago** contra "a qualquer momento": depois disso o site não consegue estornar (mostra orientação).
- **Saldo insuficiente no Mercado Pago:** o estorno falha; a equipe tenta de novo depois.
- **"Aceitar mesmo assim"** ultrapassa a lotação de propósito; fica registrado quem e quando.
- **Cota do Resend:** teto de 50 lembretes/dia; se o volume crescer, revisar o plano.
- **Banco pausado:** os jobs param, o que é aceitável. Com jobs a cada 5 e 10 min, a pausa fica improvável.
- **Conflito de arquivos com o layout mobile-first:** ver o prompt da outra frente; regra de "lógica aqui, visual lá".

## 14. Precisa de aprovação explícita do dono antes de executar
1. ~~**Esta spec.**~~ ✅ Aprovada pelo dono em 2026-10-01.
2. ~~**A extensão da reserva enquanto o PIX vale** (seção 5.3), consequência do mínimo de 30 min do Mercado Pago.~~ ✅ Decidido em 2026-10-01.
3. ~~**"Cancelar" passa a valer só para cortesia** (pago → "Estornar pedido").~~ ✅ Decidido em 2026-10-01 (entra em produção na fase 3).
4. **Cada migration no banco de produção** (MCP `user-supabase-eventos`, projeto Espaço Byla Eventos `rlzyjlrcasqbjztgbgit`, conferindo antes `events`, `tickets`, `orders`, `ticket_types` e `staff_profiles`):
   - `20261002100000_payment_states_enums`;
   - `20261002110000_payment_states`;
   - `20261003100000_order_refunds`;
   - `20261005100000_ticket_types_v2` (com migração de dados; `ticket_kind_outro` descartada em 2026-10-03);
   - `20261006100000_abandoned_reminders`;
   - `20261006110000_reminder_jobs`.
5. **Instalar `pg_cron` e `pg_net`** e criar o segredo `abandoned_cron_secret` no Vault (o dono cria o segredo).
6. **Novas variáveis no Vercel:** `ABANDONED_CRON_SECRET` e `REMINDER_UNSUBSCRIBE_SECRET` (o dono preenche).
7. **Teste de estorno com credenciais de teste** e, depois, o primeiro estorno real.
8. **Cada deploy** (push em `main`).
