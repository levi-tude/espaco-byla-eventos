# Sessões dentro do evento — design (rascunho)

Data: 2026-10-03 · Status: **RASCUNHO — aguardando decisões do dono (seção 15)** · Base: código em `origin/feat/mvp` (`ba1f92f`), migrations até `20261005100000_ticket_types_v2.sql`, e as frentes abertas `feat/check-in-banco` e `feat/lembrete-abandono`.

Legenda: **[V]** verificado em código ou na central de ajuda oficial · **[S]** suposição, a confirmar · **[R]** recomendação (vale só depois da resposta do dono).

Decisão de partida (dono, 2026-10-03): um evento pode ter **mais de uma sessão** (ex.: 19h e 20h30), modeladas **dentro do evento**. A maioria dos eventos continua com sessão única, e cada sessão vende no máximo cerca de 100 ingressos.

---

## 1. Objetivo

1. A equipe cria um evento com uma ou várias sessões (data e horário) e controla a venda de cada sessão.
2. O comprador escolhe a sessão antes dos ingressos, no celular, sem confusão. Evento de sessão única continua igual ao de hoje.
3. Cada ingresso pertence a uma sessão: lotação, check-in, e-mail, PDF e página do pedido mostram a sessão certa.
4. Os eventos atuais viram eventos de 1 sessão, sem perder nenhum dado.

### Fora de escopo

- **Passe para várias sessões** (um ingresso que entra em mais de uma sessão) e pacotes entre sessões.
- **Sessões recorrentes automáticas** (ex.: "toda sexta às 20h por 2 meses"). A equipe adiciona as sessões uma a uma, ou copia a anterior.
- **Duplicar o evento inteiro.**
- **Preço diferente por sessão** (fica como opção futura; ver seção 4 e pergunta 2).
- **Cancelar uma sessão com estorno automático de todos os pedidos** (ver pergunta 9).
- **E-mail automático aos compradores quando o horário muda** (ver pergunta 10).
- Visual final: é da frente mobile-first. Esta spec define comportamento e textos; a interface usa os componentes e tokens existentes.

---

## 2. Benchmark verificado (Sympla e Shotgun)

Fontes: só as centrais de ajuda e páginas oficiais. O que não encontrei está marcado como "não encontrado".

### Sympla

- **Produto padrão (eventos presenciais):** não encontrei um recurso de "sessões" no produto padrão. A orientação oficial para várias datas ou horários é **agrupar os tipos de ingresso** ("Grupo de ingressos": "Dia 1", "Dia 2", turnos). O comprador vê os grupos na página do evento. Depois da primeira venda, o grupo não pode ser renomeado nem excluído. Relatórios mostram "grupo + ingresso". [V] [Como funciona o agrupamento de ingressos](https://ajuda.produtor.sympla.com.br/hc/pt-br/articles/43163984100877-Como-funciona-o-agrupamento-de-ingressos) · [Grupos de ingressos](https://produtores.sympla.com.br/funcionalidades/grupos-de-ingressos/)
  - Consequência: no padrão, cada "sessão" é na prática um conjunto de tipos de ingresso próprio, com preço e quantidade próprios.
- **Check-in no padrão:** o app do organizador tem "Limitar check-in": cada celular da portaria escolhe quais tipos de ingresso aceita. O ingresso de outro tipo aparece como "Entrada limitada" ("o ingresso é válido e pertence ao evento, mas a entrada daquele tipo específico de ingresso foi limitada"). Isso é recomendado para "múltiplos dias de programação". [V] [App Sympla Organizador — Android](https://ajuda.produtor.sympla.com.br/hc/pt-br/articles/15445887306509-Como-utilizar-o-aplicativo-Sympla-Organizador-Android) · [App Sympla Organizador](https://www.sympla.com.br/app-organizador)
- **Sympla Bileto (produto à parte, para teatros e casas com temporada):** tem "Apresentações" (data e horário) dentro do evento, "Grades" de preço que podem ser importadas de outra grade (com setores, distribuição e cotas), bloqueios de lugares por apresentação e "Pacotes" que juntam duas ou mais apresentações. Exige análise prévia e contrato. [V] [O que é Sympla Bileto](https://ajuda.produtor.sympla.com.br/hc/pt-br/articles/15444829742349-O-Que-%C3%A9-Sympla-Bileto-e-Como-Funciona) · [7 — Apresentações](https://suporte-bileto-sympla.zendesk.com/hc/pt-br/articles/360047059612-7-APRESENTA%C3%87%C3%95ES) · [5 — Grades](https://suporte-bileto-sympla.zendesk.com/hc/pt-br/articles/360047488531-5-GRADES) · [7.1 — Bloqueios](https://suporte-bileto-sympla.zendesk.com/hc/pt-br/articles/360052667891-7-1-BLOQUEIOS-DE-LUGARES) · [Pacotes](https://suporte-bileto-sympla.zendesk.com/hc/pt-br/articles/4406749097997-Como-criar-e-publicar-pacotes-no-meu-Evento)
  - No Bileto, o comprador recebe o ingresso por e-mail com QR Code. [V] [1 — Informações básicas](https://suporte-bileto-sympla.zendesk.com/hc/pt-br/articles/360047055472-1-INFORMA%C3%87%C3%95ES-B%C3%81SICAS)
- **Sympla Streaming (online):** "+ Adicionar sessão" com início e término; até 10 sessões por evento; 2 horas de intervalo entre sessões no mesmo dia. [V] [Sessões no Sympla Streaming](https://ajuda.produtor.sympla.com.br/hc/pt-br/articles/15454822007949-Como-configurar-uma-ou-mais-sess%C3%B5es-em-seu-evento-Sympla-Streaming)
- **Não encontrado:** como o e-mail/ingresso do produto padrão mostra a data de um grupo; se a venda de um grupo fecha sozinha no horário; se o comprador pode misturar grupos no mesmo pedido.

### Shotgun

- **Várias datas = vários eventos:** a "Event Series" junta datas de uma turnê ou temporada numa página com um link só, mas **cada data continua um evento separado, com página, bilheteria e configurações próprias**. A série é criada pelo suporte da Shotgun. [V] [Event Series](https://support-pro.shotgun.live/hc/en-us/articles/38333436256402-Announce-multiple-dates-at-once-with-Event-Series-tour-or-season)
- **Dias ou horários dentro do mesmo evento:** a recomendação é **uma categoria de ingresso por dia** (e uma por combinação de dias, no caso de passes). A categoria tem **capacidade própria** ("todos os ingressos da categoria contam nesse limite") e **validade de acesso** própria. [V] [Estrutura para eventos de vários dias](https://support-pro.shotgun.live/hc/en-us/articles/18210281225746-Ticketing-structure-for-multi-day-events-and-special-tickets) · [Set up your ticketing](https://support-pro.shotgun.live/hc/en-us/articles/14551930820882-Set-up-your-ticketing)
- **Check-in:** cada ingresso pode ter uma janela de validade (início e fim); "qualquer leitura fora da janela é recusada automaticamente". O app de leitura mostra uma mensagem própria quando "o ingresso não corresponde ao dia ou horário em que foi lido". Para ler o mesmo ingresso mais de uma vez (passe de vários dias), existem "listas de acesso", criadas pelo suporte. [V] [Validade do acesso](https://support-pro.shotgun.live/hc/en-us/articles/360018504099-Limit-ticket-access-validity) · [Guia do Shotgun Scan](https://support-pro.shotgun.live/hc/en-us/articles/6986376133138-Shotgun-Scan-user-guide) · [Listas de acesso](https://support-pro.shotgun.live/hc/en-us/articles/19116476801938-Creating-tickets-for-multiple-days-events-with-the-Access-Lists)
- **Não encontrado:** um recurso nativo de "sessões" dentro de um evento; como o e-mail mostra a data de uma categoria; se a venda fecha sozinha no início.

### O que levamos disso

| Ponto | Sympla | Shotgun | Proposta para o Espaço Byla |
| --- | --- | --- | --- |
| Onde fica a sessão | Grupo de ingressos (padrão) ou Apresentação (Bileto) | Evento separado (série) ou categoria por dia | Sessão de verdade dentro do evento (mais próximo do Bileto) |
| Estoque | Por ingresso/grupo; cotas por grade no Bileto | Capacidade por categoria | Lotação por sessão [R] |
| Preços | Por ingresso (padrão); grade importável (Bileto) | Por ingresso | Tipos e preços do evento, iguais em todas as sessões [R] |
| Portaria | Celular limitado a certos tipos ("Entrada limitada") | Janela de validade; leitura fora dela é recusada | Portaria escolhe a sessão; QR de outra sessão é recusado com mensagem clara [R] |

As duas plataformas resolvem "várias sessões" sem conceito próprio no produto padrão, o que obriga o organizador a repetir tipos de ingresso por data. Modelar a sessão de verdade evita essa repetição e deixa a portaria mais simples. Esse é o ponto que o dono decidiu.

---

## 3. Como é hoje (o que muda) [V]

- `events` guarda data (`starts_at`), lotação (`capacity`), cotas (`inteira_quota`, `meia_quota`) e venda aberta (`sales_open`). Não há horário de término.
- `ticket_types` pertence ao evento: tipos prontos, tipos da equipe, cortesia e limite por tipo (`max_units`).
- `orders`, `order_items` e `tickets` apontam para o evento (`orders.event_id`, `tickets.event_id`).
- Contagem de lugares por evento: `event_occupied_count`, `event_kind_occupied_count`, `ticket_type_units_taken` e `event_availability`. O checkout (`create_checkout_order`) trava a linha do evento (`for update`) e confere lotação, cotas e limites.
- **A venda não fecha sozinha:** nada recusa venda depois de `starts_at`. A venda só fecha pelo botão "Fechar vendas" da equipe.
- Check-in: a portaria abre `/equipe/eventos/[id]/check-in`; a rota `api/check-in` recusa QR de outro evento ("Evento errado"). A frente `feat/check-in-banco` move isso para a função `check_in_ticket(p_event_id, p_code, p_staff_user_id)`.
- Home: lista eventos com `sales_open`, ordenados por `starts_at`. Página do evento, checkout, pedido, e-mail de ingressos, e-mail de estorno e PDF mostram `events.starts_at`.
- Carrinho no navegador: chave `byla:cart:v2:<slug>`.

---

## 4. Onde fica cada coisa: opções e recomendação

| O quê | Opção A — por sessão | Opção B — por evento (compartilhado) | Recomendação |
| --- | --- | --- | --- |
| Data e horário | Sessão | — | Sessão (obrigatório) |
| Lotação (total de ingressos) | Cada sessão tem a sua | Um total dividido entre todas as sessões | **A**: são públicos diferentes no mesmo espaço; 19h e 20h30 não dividem lugar |
| Quantidade de inteiras e meias | Cada sessão tem as suas | Definidas no evento e repetidas em cada sessão | **A**, com o formulário copiando os números da sessão anterior (dá o mesmo trabalho que B e permite sessões de tamanhos diferentes) |
| Tipos de ingresso e preços | Cada sessão com seus tipos | Os do evento valem para todas | **B**: é o caso comum, evita repetir tipos (o problema do Sympla padrão) e não mexe no editor de tipos recém-entregue |
| Limite de cada tipo | Vale para cada sessão | Soma de todas as sessões | **A**: "até 10 casadinhas" significa 10 por sessão; assim a venda trava só a sessão e não o evento todo |
| Venda aberta | Interruptor por sessão | Só o do evento | **As duas**: o do evento é a chave geral (evento aparece no site); o da sessão fecha só aquela sessão |
| Cortesia | Emitida para uma sessão | — | Por sessão (a cortesia é um ingresso e ocupa lugar daquela sessão) |
| Capa, galeria, descrição, local | — | Evento | Evento |

**Alternativa descartada — sessão como "evento filho" completo** (cada sessão com seus tipos, preços e textos, como a série da Shotgun): resolve casos raros, mas multiplica o trabalho da equipe e reescreve o editor de tipos. Se um dia for preciso preço diferente por sessão, dá para acrescentar uma tabela opcional de preço por sessão sem desfazer este modelo.

---

## 5. Modelo de dados proposto

### 5.1 Tabela nova `public.event_sessions`

| Coluna | Tipo | Regra |
| --- | --- | --- |
| `id` | `uuid` pk | `gen_random_uuid()` |
| `event_id` | `uuid not null` → `events(id)` | sem `on delete cascade` (sessão com vendas nunca some) |
| `starts_at` | `timestamptz not null` | início |
| `ends_at` | `timestamptz` | opcional [R]; check `ends_at is null or ends_at > starts_at` |
| `capacity` | `int not null` | `check (capacity between 1 and 100000)` |
| `inteira_quota`, `meia_quota` | `int` | mesmas regras de hoje (`1..capacity`, soma `≤ capacity`), agora na sessão |
| `sales_open` | `boolean not null default true` | interruptor da sessão |
| `archived_at` | `timestamptz` | sessão removida da venda e da página; continua no histórico |
| `created_at`, `updated_at` | `timestamptz` | |

- Índices: `(event_id, starts_at)`; único parcial `(event_id, starts_at) where archived_at is null` (duas sessões no mesmo horário é erro de digitação).
- Limite: até 20 sessões ativas por evento (conferido na RPC). Sem nome de sessão [R] (pergunta 12): a sessão é identificada pela data e horário.
- **Evento de sessão única = 1 linha nesta tabela**, criada junto com o evento. Não existe evento sem sessão: o banco e as telas têm uma regra só.

### 5.2 Mudanças nas tabelas existentes

- **`orders.session_id uuid not null`** → `event_sessions(id)`. Um pedido é de **uma** sessão [R] (pergunta 5).
- **`tickets.session_id uuid not null`**, copiado do pedido. Integridade: `unique (id, session_id)` em `orders` e chave estrangeira composta `tickets (order_id, session_id) → orders (id, session_id)`, para o ingresso nunca divergir do pedido.
- Índices: `orders (session_id, expires_at) where status = 'pendente'` (reservas ativas) e `tickets (session_id, status)`.
- **`events.capacity`, `inteira_quota`, `meia_quota`:** param de ser usados. Ficam durante a janela de deploy e são removidos na última fase (seção 13), depois de nenhum código lê-los.
- **`events.starts_at`:** passa a ser um resumo mantido pelas RPCs = início da primeira sessão ativa. Serve para ordenar listas e para código antigo na janela de deploy. Tudo que é mostrado ao público lê a sessão.
- **`ticket_types`:** sem mudança de colunas. `max_units` passa a valer **por sessão** [R].
- **`order_items`:** sem mudança (a sessão vem do pedido).

### 5.3 Funções do banco (todas `set search_path = ''`, `revoke … from public, anon, authenticated`, `grant execute … to service_role`)

- **Contagens por sessão** (mesma regra de hoje: pago, check-in, reserva ativa e estorno `solicitado`):
  - `session_occupied_count(p_session_id, p_exclude_order_id default null)`;
  - `session_kind_occupied_count(p_session_id, p_kind, p_exclude_order_id default null)`;
  - `ticket_type_units_taken(p_ticket_type_id, p_session_id, p_exclude_order_id default null)` (nova assinatura).
- **`session_availability(p_session_id) returns jsonb`**: o mesmo formato de `event_availability` hoje (`capacity`, `sold`, `held`, `remaining`, `categories`, `types`), calculado para a sessão.
- **`event_sessions_summary(p_event_id) returns jsonb`**: lista as sessões ativas com `starts_at`, `ends_at`, `sales_open`, `remaining`, `sold_out` e `selling` (pode vender agora). Usada pela página do evento, home e painel, numa chamada só.
- **`create_checkout_order` v4**: ganha `p_session_id uuid`.
  - Trava a **sessão** (`for update`) em vez do evento: compras em sessões diferentes não esperam uma pela outra; duas compras na mesma sessão continuam em fila (sem venda acima da lotação).
  - Valida: sessão do evento, não arquivada, `sales_open` do evento **e** da sessão, ainda vendendo pelo horário (seção 6.4).
  - Confere lotação, cotas e limite de tipo **da sessão**; grava `orders.session_id` e `tickets.session_id`.
  - Erros novos: `SESSAO_INDISPONIVEL` (sessão inexistente, arquivada ou de outro evento), `SESSAO_ENCERRADA` (fechada ou horário passou). Os existentes (`ESGOTADO_EVENTO`, `ESGOTADO_CATEGORIA`, `ESGOTADO_TIPO`, `LIMITE_PESSOAS`) passam a se referir à sessão.
  - **Janela de deploy:** com `p_session_id` nulo e o evento tendo exatamente 1 sessão vendendo, usa essa sessão (o site antigo continua vendendo). Com várias sessões e `p_session_id` nulo, recusa com `SESSAO_INDISPONIVEL`.
- **`mark_order_paid_by_external` v4**: rechecagem de lotação, cotas e limites pela sessão do pedido. Trava pedido e depois sessão (mesma ordem de hoje: pedido, depois evento).
- **`accept_paid_order`**: o aviso "A lotação passará de X para Y" usa a sessão.
- **`issue_courtesy_ticket` v3**: ganha `p_session_id`; lotação da sessão.
- **`save_event_sessions(p_event_id, p_sessions jsonb)`**: chamada por `createEvent` e `update_event_with_capacity` (nova versão, sem `p_capacity`/cotas/`p_starts_at`), na mesma transação dos tipos.
  - Item: `{ id | null, starts_at, ends_at | null, capacity, inteira_quota | null, meia_quota | null }`. Sessões omitidas são arquivadas.
  - Recusa: lotação ou cota abaixo do já ocupado (`SESSAO_LOTACAO_MENOR:<sessão>:<ocupado>`, `SESSAO_COTA_MENOR:<sessão>:<categoria>:<ocupado>`); arquivar sessão com ingressos válidos (`SESSAO_COM_VENDAS:<sessão>`, seção 7.3); horário repetido; de 1 a 20 sessões ativas.
  - Atualiza `events.starts_at` (resumo).
- **`set_session_sales_open(p_session_id, p_open boolean, p_staff_user_id uuid)`**: interruptor por sessão, conferindo que quem pede é da equipe (mesmo padrão de `check_in_ticket`).
- **`check_in_ticket` v2** (depois de `feat/check-in-banco` entrar): ganha `p_session_id`. Novo resultado `sessao_errada`, que devolve só o horário da sessão do ingresso (nada do comprador), como `evento_errado` devolve só o nome do outro evento.
- **Lembrete** (`claim_abandoned_order_reminders`, da frente `feat/lembrete-abandono`): o critério "evento com venda aberta, não começou e com lugares" passa a ser da **sessão do pedido**.
- **Saem de uso** depois da migração do código: `event_occupied_count`, `event_kind_occupied_count`, `event_availability` e a assinatura antiga de `ticket_type_units_taken` (removidas na última fase).

### 5.4 Segurança e RLS

- `event_sessions`: RLS ligada. Leitura pública só de sessões não arquivadas de evento com `sales_open`; a equipe lê tudo (`is_staff()`). **Sem política de escrita**: só as RPCs com `service_role` gravam (mesmo padrão de `ticket_types` e `order_items`).
- Toda Server Action nova (`setSessionSalesOpen`, editor de sessões no `createEvent`/`updateEvent`, cortesia com sessão) começa com `requireStaffUser()` e devolve `ActionResult` via `runAction`/`ActionError`.
- O checkout valida `sessionId` como UUID no servidor e repassa à RPC; a RPC confere que a sessão é do evento. A sessão vinda da URL (`?sessao=`) é só uma sugestão de tela: quem decide é o banco.
- `?retomar=<token>` continua aceitando só pedido daquele evento; a sessão vem do pedido, nunca da URL.
- Mensagens ao comprador genéricas; detalhe no log. Falha em consultar a sessão = não vender (falhar fechado).
- Concorrência: a trava passa do evento para a sessão. Nenhuma regra cruza sessões (lotação, cotas e limites são por sessão), por isso travar a sessão basta. Se o dono escolher limite de tipo **somado no evento** (pergunta 4), a RPC precisa voltar a travar o evento.

---

## 6. Comprador (mobile-first)

### 6.1 Página do evento

- **Sessão única:** igual a hoje. A data vem da sessão; não aparece a palavra "sessão".
- **Várias sessões:** abaixo do título, a seção **"Escolha a sessão"**:
  - sessões em ordem de horário, agrupadas por dia ("Sábado, 10 de outubro"), cada uma num botão de toque (mínimo 48 px de altura) com o horário ("19h00" ou "19h00 – 20h15" quando houver término);
  - estados do botão: normal; "Últimos N" quando restam 20 ou menos; "Esgotada" (desativado); "Vendas encerradas" (desativado, horário passou ou sessão fechada); sessões que já terminaram somem (término passou ou, sem término, 4 h depois do início — a mesma janela da portaria, seção 8);
  - ao tocar numa sessão, ela fica marcada e a barra fixa inferior mostra "19h00 · a partir de R$ X" e o botão **"Comprar ingresso"** → `/eventos/<slug>/checkout?sessao=<id>`;
  - com só uma sessão ainda vendendo, ela já vem marcada;
  - no topo da página, em vez de uma data: "Várias sessões · próxima: sáb, 10 out, 19h00" [R] (pergunta 11).
- Preços por tipo continuam numa lista só (iguais em todas as sessões). "Esgotado" por tipo passa a depender da sessão marcada.
- Todas as sessões esgotadas → "Esgotado"; todas encerradas → "Vendas encerradas".

### 6.2 Checkout

- No topo, um cartão com a sessão: "Sábado, 10 out · 19h00" e o link **"Trocar sessão"** (volta à página do evento com a seleção de ingressos guardada).
- `?sessao=` ausente ou inválido em evento de várias sessões → volta à página do evento para escolher. Sessão única → usa a única.
- Disponibilidade (`remaining`, cotas, limites) é da sessão. Se outra pessoa comprar antes: "Restam apenas N lugares nesta sessão. Ajustamos sua seleção."
- Sessão esgotou ou encerrou entre a escolha e o "Continuar": "Esta sessão não está mais disponível. Escolha outra sessão." com botão para voltar.
- Carrinho: chave `byla:cart:v3:<slug>`, com `sessionId` dentro. Trocar de sessão mantém tipos e quantidades e reajusta ao máximo da nova sessão. O carrinho `v2` é lido e migrado (sem sessão: pede a escolha).
- Pedido pendente de outra sessão do mesmo evento: o aviso existente "Você tem um pedido aguardando pagamento" mostra também a sessão.

### 6.3 Página do pedido, ingressos, e-mail e PDF

- Em todos os lugares onde hoje aparece a data do evento, aparece a **data e horário da sessão** (e o término, se houver): página do pedido, bloco de sucesso, `TicketQr`, `DownloadTicketPdf`, e-mail de ingressos (inclusive o assunto: "Seus ingressos — Nome do evento · 10/10 às 19h00"), e-mail de estorno e lembrete.
- Evento de várias sessões: o ingresso destaca o horário ("Sessão das 19h00"), porque é o que a portaria confere.

### 6.4 Quando a venda da sessão fecha

- [R] A sessão para de vender **no horário de início** (pergunta 6). Regra no banco (`now() < starts_at`) e na tela.
- Vale também para eventos de sessão única: **isso muda o comportamento de hoje**, em que a venda só fecha pelo botão. Precisa de confirmação do dono.
- Reserva em andamento quando a sessão começa: o pedido já criado pode ser pago até o fim da reserva (o lugar já estava garantido); só pedidos novos são recusados.

---

## 7. Equipe

### 7.1 Formulário do evento

- A seção "Data e lotação" vira **"Sessões"**:
  - evento novo começa com 1 sessão: "Data e horário de início", "Término (opcional)", "Total de ingressos", "Quantidade de inteiras/meias (opcional)", com o resumo atual ("Total 100 · Inteiras 60 · Meias 40");
  - botão **"+ Adicionar sessão"**: cria uma linha nova já preenchida com a lotação e as cotas da última sessão; a equipe só escolhe o horário (é o "duplicar sessão");
  - cada sessão com vendas mostra "N vendidos" e não deixa a lotação ficar abaixo disso;
  - **"Remover sessão"**: sem ingressos válidos → sai; com ingressos válidos → bloqueado com o texto da seção 7.3.
- A validação de limites por tipo (`type-limits.ts`) passa a conferir contra **cada sessão** (o limite de um tipo precisa caber no total e nas cotas de todas as sessões, porque vale por sessão).
- A ação do servidor valida tudo de novo (`src/lib/domain/sessions.ts`, puro e testado) e chama a RPC; o banco é a última palavra.

### 7.2 Painel do evento

- Evento de várias sessões: seletor de sessão no topo (abas roláveis no celular), com "Todas" para o total.
- Por sessão: Lotação, Vendidos, Reservados agora, Restantes, vendidos/cota por categoria, vendidos/limite por tipo; interruptor **"Vendas desta sessão: abertas/fechadas"**; atalho de check-in daquela sessão.
- Lista de participantes, "Precisa de decisão", estorno e cortesia filtram e mostram a sessão. "Emitir cortesia" pede a sessão (em sessão única, não pergunta).
- Lista da equipe (`/equipe`): "1 sessão" mostra a data como hoje; várias mostram "3 sessões · próxima: 10/10 19h00". "Passado" = última sessão já começou.

### 7.3 Remover sessão com vendas

- [R] Sessão com ingressos válidos (pagos, com check-in ou reservados) **não pode ser removida**: "Esta sessão tem N ingressos válidos. Feche as vendas ou estorne os pedidos antes de remover." (pergunta 9).
- Depois de estornar tudo, a sessão pode ser removida (arquivada: some da venda e continua no histórico, como os tipos).
- Mudar o horário de sessão com vendas: permitido, com confirmação "Esta sessão tem N ingressos vendidos. Avise os compradores sobre o novo horário." [R] (pergunta 10). Sem e-mail automático nesta fase.

---

## 8. Check-in por sessão

- A tela de check-in ganha a escolha da sessão (`/equipe/eventos/[id]/check-in?sessao=<id>`). Sessão única: não pergunta.
- Sessão sugerida ao abrir: a que está acontecendo (de 2 h antes do início até o término, ou 4 h depois do início se não houver término); senão, a próxima. A portaria pode trocar a qualquer momento; o nome da sessão fica fixo no topo da câmera, em letras grandes.
- QR de **outra sessão do mesmo evento**: recusa, em vermelho, com "Sessão errada — este ingresso é da sessão das 20h30 (sáb, 10/10)". Não marca entrada [R] (pergunta 7). Se for a portaria que está na sessão errada, ela troca a sessão e lê de novo.
- QR de outro evento: continua "Evento errado".
- A checagem fica no banco (`check_in_ticket` v2, com a trava do ingresso). A tela só mostra o resultado.
- Contador "Entraram N de M" por sessão.

---

## 9. Estorno, decisão, lembrete e alertas

- **Estorno:** regras atuais sem mudança (pedido inteiro, bloqueado com check-in). As vagas voltam para a sessão do pedido. A janela de confirmação e o e-mail mostram a sessão.
- **"Pago sem vaga — decidir":** a rechecagem é por sessão; o aviso "A lotação passará de X para Y" mostra a sessão.
- **Lembrete de compra abandonada:** só envia se a **sessão do pedido** está vendendo, não começou e tem lugares; o botão "Voltar e comprar" leva `?retomar=` e o checkout reabre na mesma sessão. Se ela esgotou ou encerrou, o checkout pede outra sessão.
- **Alertas à equipe:** o texto inclui a sessão.

---

## 10. Home e página pública

- A home lista eventos com venda aberta e **pelo menos uma sessão que ainda não começou** (vendendo ou esgotada; esgotada continua visível como "Esgotado").
- Cartão: sessão única → data como hoje; várias → "Várias sessões · próxima: sáb, 10 out, 19h00".
- Ordenação pela próxima sessão (calculada na consulta; com poucos eventos, sem custo).
- Home de um único evento (`HomeSingleEvent`): mesma regra de rótulo.
- Evento cujas sessões já começaram todas some da home (hoje continua aparecendo até a equipe fechar as vendas) [R], conforme a pergunta 6.

---

## 11. Migração dos dados existentes

Migration única de dados, depois da migration de estrutura, no projeto **Espaço Byla Eventos** (`rlzyjlrcasqbjztgbgit`), com aprovação do dono e conferência do "fingerprint" (`events`, `tickets`, `orders`, `ticket_types`, `staff_profiles`).

1. Para cada evento: 1 sessão com `starts_at = events.starts_at`, `capacity`, `inteira_quota`, `meia_quota` do evento, `sales_open = true` (o interruptor do evento continua mandando) e `ends_at` nulo.
2. `orders.session_id` e `tickets.session_id` = a sessão do seu evento; depois `set not null`.
3. Conferência antes e depois, só com contagens (sem dados pessoais): pedidos por status, ingressos por status e por evento, ocupados por evento antes = ocupados pela sessão depois.
4. Nada é apagado; `events.capacity` e cotas ficam até a última fase.

---

## 12. Testes

- **Unidade:** `sessions.ts` (validação do editor, sessão sugerida na portaria, "vendendo agora"); rótulos "Várias sessões · próxima"; carrinho `v3` e migração do `v2`.
- **Ações:** quem não é equipe é recusado antes do banco; sessão de outro evento recusada; `sessionId` inválido recusado.
- **SQL** (ramo de teste ou local, nunca produção sem aprovação):
  - duas compras simultâneas na mesma sessão não passam da lotação; em sessões diferentes, não se bloqueiam;
  - limite de tipo contado por sessão;
  - checkout com sessão arquivada, fechada ou já iniciada → recusado;
  - compatibilidade: `p_session_id` nulo com 1 sessão funciona; com 2, recusa;
  - `save_event_sessions` recusa lotação abaixo do ocupado e remoção de sessão com vendas;
  - `check_in_ticket` v2: sessão certa entra, sessão errada recusa sem marcar;
  - migração: contagens iguais antes e depois.
- **Navegador (360 px, tema claro e escuro):** evento de sessão única igual ao de hoje; evento com 3 sessões (uma esgotada, uma encerrada); trocar sessão no checkout; pagamento de teste; ingresso e e-mail com horário; check-in com QR de outra sessão.

---

## 13. Fases de implementação

Cada fase pode ir para produção sozinha e é testável. Fases com banco exigem aprovação de cada migration.

| Fase | Conteúdo | Banco | Depende de | Esforço |
| --- | --- | --- | --- | --- |
| **0. Pré-requisitos** | `feat/check-in-banco` e `feat/lembrete-abandono` em `feat/mvp`; respostas às perguntas 1–7 | Não | — | — |
| **1. Base invisível** | `event_sessions`; `session_id` em pedidos e ingressos; migração dos dados (1 sessão por evento); contagens e `session_availability`; checkout v4 e pagamento v4 com compatibilidade; código passa `session_id` da sessão única. Nada muda na tela | Sim (estrutura + dados) | 0 | M (1–2 dias) |
| **2. Equipe cria e controla sessões** | Editor de sessões no formulário (adicionar copiando, editar, remover sem vendas); painel por sessão; interruptor por sessão; cortesia com sessão; lista `/equipe` | Sim (`save_event_sessions`, `set_session_sales_open`) | 1 | M-G (2–3 dias) |
| **3. Comprador escolhe a sessão** | Página do evento com escolha; checkout com sessão e "Trocar sessão"; carrinho `v3`; `?retomar=` com sessão; home "Várias sessões" | Não (usa a fase 1) | 2 + layout mobile-first estável nessas telas | M (1–2 dias) |
| **4. Sessão no ingresso e na portaria** | Check-in por sessão (`check_in_ticket` v2, "Sessão errada"); sessão no pedido, e-mails, PDF, estorno, decisão, alertas | Sim (`check_in_ticket` v2) | 1; `feat/check-in-banco` | M (1–2 dias) |
| **5. Fechamento automático e limpeza** | Venda encerra no horário escolhido (pergunta 6); lembrete por sessão; remover `events.capacity`/cotas e funções antigas | Sim | 3, 4; lembrete em produção | P-M (0,5–1 dia) |

Estimativas de trabalho do agente, sem contar a espera por aprovações e testes manuais do dono. Fases 3 e 4 podem rodar em paralelo depois da 2.

**Para o evento de 2 sessões ir ao ar, bastam as fases 1–4.** A fase 5 pode esperar, desde que a equipe feche as vendas de cada sessão pelo interruptor.

---

## 14. Riscos e conflitos com outras frentes

- **`feat/check-in-banco` (em andamento, sem commit):** cria `check_in_ticket` e mexe em `api/check-in/route.ts`, `check-in.ts`, `actions.ts` e `database.ts`. A fase 4 muda a assinatura dessa função → **esperar a frente entrar** e fazer a v2 por cima. Migrations desta frente com data posterior às dela (`20261006…`).
- **`feat/lembrete-abandono` (sem mudanças ainda):** o critério de envio usa `events.sales_open`, `starts_at` e a lotação do evento. Se entrar antes, a fase 5 ajusta para a sessão; se ainda não começou, o ideal é já escrever o critério lendo a sessão (combinar com a coordenação).
- **Layout mobile-first:** mexe na página do evento, checkout, home, painel e check-in, os mesmos arquivos das fases 2–4. Regra das frentes anteriores: lógica aqui, visual lá; a fase 3 começa depois que essas telas estabilizarem.
- **Tipos de ingresso (`type-limits.ts`, `TicketTypesEditor`):** a validação de limites passa a ser por sessão; cuidado para não quebrar as mensagens já aprovadas.
- **Mudança de comportamento para eventos de sessão única:** fechar a venda no horário de início (se aprovado) e sumir da home depois do início. Comunicar ao dono.
- **Deploy em duas etapas:** migration antes do código (compatibilidade da seção 5.3). Se o código novo subir antes da migration, o checkout quebra → seguir a ordem.
- **Fuso:** horários de sessão sempre em `America/Sao_Paulo` (`src/lib/datetime.ts`); a comparação "já começou" é feita no banco com `timestamptz`.
- **Ingressos já emitidos** de eventos atuais não mudam (o QR é o mesmo código); só ganham a sessão na base.

---

## 15. Decisões pendentes (perguntas ao dono, em ordem de importância)

Responder uma por vez. Cada pergunta tem uma recomendação.

1. **Cada sessão tem sua própria lotação?**
   - A) Sim, cada sessão tem o seu total (ex.: 19h com 100 e 20h30 com 100). **← recomendado**
   - B) Não, um total único dividido entre as sessões (ex.: 100 no total, quem chegar primeiro).
2. **Os tipos de ingresso e os preços são iguais em todas as sessões?**
   - A) Sim, iguais: a equipe cadastra uma vez no evento. **← recomendado**
   - B) Cada sessão tem seus tipos e preços.
   - C) Iguais, mas com a opção de mudar o preço numa sessão específica (mais trabalho; fica para depois).
3. **A quantidade de inteiras e de meias é por sessão?**
   - A) Sim, cada sessão tem a sua (o formulário já copia da sessão anterior). **← recomendado**
   - B) Uma regra única do evento, repetida igual em cada sessão.
   - C) Não usar quantidade separada em eventos com várias sessões.
4. **O limite de um tipo (ex.: "até 10 casadinhas") vale por sessão ou no evento todo?**
   - A) Por sessão: 10 casadinhas às 19h e mais 10 às 20h30. **← recomendado**
   - B) No evento todo: 10 casadinhas somando todas as sessões.
5. **O comprador pode comprar ingressos de várias sessões no mesmo pedido?**
   - A) Não: uma sessão por compra; para outra sessão, faz outra compra. **← recomendado** (mais simples para pagar, estornar e entrar)
   - B) Sim, várias sessões no mesmo pedido.
6. **Quando a venda de uma sessão fecha sozinha?**
   - A) No horário de início da sessão. **← recomendado**
   - B) Um tempo antes do início (ex.: 1 hora antes).
   - C) Um tempo depois do início (ex.: até 30 min depois, para quem compra na porta).
   - D) Nunca sozinha: só quando a equipe fecha (como é hoje).
   - Atenção: a resposta vale também para eventos de sessão única e muda o comportamento atual.
7. **Na portaria, o que fazer com ingresso de outra sessão do mesmo evento?**
   - A) Recusar com a mensagem "Sessão errada — este ingresso é da sessão das 20h30". A portaria pode trocar de sessão se precisar. **← recomendado**
   - B) Aceitar qualquer sessão do mesmo dia, com um aviso amarelo.
   - C) Aceitar ingresso de sessão anterior (quem se atrasou), recusar o de sessão posterior.
8. **A sessão precisa de horário de término?**
   - A) Opcional: a equipe preenche quando quiser mostrar "19h00 – 20h15". **← recomendado**
   - B) Obrigatório.
   - C) Não ter término, só início.
9. **Remover uma sessão que já tem ingressos vendidos:**
   - A) Não pode: primeiro fechar as vendas e estornar os pedidos (um a um, como hoje); depois remover. **← recomendado**
   - B) Ter um botão "Cancelar sessão" que estorna todos os pedidos de uma vez (bem mais trabalho; fase futura).
10. **Mudar o horário de uma sessão que já tem vendas:**
    - A) Pode, com aviso na tela; a equipe avisa os compradores por fora (WhatsApp, e-mail). **← recomendado** para agora
    - B) Pode, e o site manda e-mail automático aos compradores com o novo horário (fase futura).
    - C) Não pode mudar depois da primeira venda.
11. **Como mostrar um evento de várias sessões na home e no topo da página?**
    - A) "Várias sessões · próxima: sáb, 10 out, 19h00". **← recomendado**
    - B) Intervalo de datas: "10 a 12 de outubro".
12. **A sessão precisa de um nome além do horário (ex.: "Sessão infantil")?**
    - A) Não, só data e horário. **← recomendado**
    - B) Nome opcional.
