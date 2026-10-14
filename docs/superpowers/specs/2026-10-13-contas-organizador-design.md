# Contas de organizador — design

Data: 2026-10-13 · Status: **aguardando revisão do dono** · Base: `feat/sair-vercel` (`214c866`), migrations até `20261016100000_past_events.sql`.

Legenda: **[V]** verificado no código · **[S]** suposição, a confirmar · **[R]** recomendação desta spec.

Ponto de partida (dono, 2026-10-13): pessoas de fora (produtores, coletivos, professores) poderão fazer eventos no Espaço Byla vendendo ingressos pelo site. O dinheiro continua caindo 100% na conta do Espaço no banco de pagamento; depois do evento, o Espaço paga ao organizador a parte dele por PIX manual. O Espaço não cobra comissão; existe só a taxa de serviço do desenvolvedor (5%, quando ligada), paga pelo comprador.

## Resumo executivo

- **Entrada só por convite:** o Admin gera um link de uso único (vale 7 dias) e manda pelo WhatsApp. A pessoa abre, preenche os dados, a chave PIX, aceita os "Termos do organizador" e liga a verificação em duas etapas. Quem não tem convite usa a página pública **"Quero fazer meu evento"**, e o Admin responde mandando o convite.
- **Cada um no seu quadrado:** o organizador só vê e mexe nos próprios eventos. Não vê eventos de outros, nem o financeiro geral, nem a página da taxa de serviço. Isso é garantido no servidor **e** no banco.
- **Nada vai ao ar sem o Admin:** o organizador cria o evento como rascunho e envia para aprovação. Só depois do "Aprovar e publicar" o evento aparece no site e vende.
- **Estorno:** o organizador **pede**; a equipe do Espaço faz, pelo botão "Estornar pedido" que já existe.
- **Dinheiro:** painel por evento mostra **vendido, tarifa do banco, estornos, sua parte e situação do repasse**. A tarifa real de cada pagamento sai da parte do organizador. Repasse por PIX em até **5 dias úteis** depois do evento; o Admin marca "Pago" (registro que não se apaga).
- **Compradores:** o organizador vê **nome e e-mail** dos compradores dos próprios eventos (sem telefone, sem link do pedido, sem QR Code). A Política de Privacidade ganha uma versão nova dizendo isso.
- **Portaria:** o organizador faz check-in só de ingressos dos próprios eventos; o banco recusa os outros sem revelar de qual evento são.
- **Verificação em duas etapas obrigatória** (código de 6 dígitos num aplicativo do celular) para organizadores **e** para a equipe atual, com implantação sem trancar ninguém para fora.
- **Excluir evento:** sem vendas, o organizador exclui sozinho; com vendas, pede e o Admin decide (na prática, cancelar com reembolso de todos).
- **Achado no código [V]:** o site hoje **não guarda a tarifa do banco de pagamento** de cada venda. A spec propõe buscá-la depois de cada pagamento e guardá-la (seção 9).
- **Em 3 fases:** (1) duas etapas para a equipe; (2) contas de organizador, eventos e aprovação; (3) financeiro do organizador e repasses.

---

## 1. Objetivos

1. Permitir que organizadores convidados criem e operem eventos próprios no site, sem acesso a nada que não seja deles.
2. Manter o Espaço no controle: aprovação antes de publicar, estornos feitos pela equipe, dinheiro na conta do Espaço até depois do evento.
3. Dar ao organizador transparência total do dinheiro do evento (inclusive a tarifa real do banco) e um prazo claro de repasse.
4. Registrar de forma imutável quem aprovou, recusou, estornou, excluiu e pagou.
5. Subir o nível de segurança de todas as contas com acesso ao painel (duas etapas obrigatórias).
6. Cumprir a LGPD ao compartilhar nome e e-mail dos compradores com o organizador.

---

## 2. Decisões do dono (2026-10-13)

| # | Tema | Decisão |
| --- | --- | --- |
| 1 | Entrada | Só por convite: link de uso único, vale 7 dias, enviado pelo WhatsApp. Cadastro: nome, e-mail, senha, chave PIX, aceite dos "Termos do organizador", duas etapas. Mais a página pública "Quero fazer meu evento" (formulário que o Admin vê e responde com convite), protegida por verificação anti-robô e limite de envios. |
| 2 | Escopo | Organizador vê/edita só os próprios eventos; não vê nem exclui eventos de outros; sem acesso ao financeiro geral, à taxa de serviço ou a dados de outros eventos. |
| 3 | Publicação | Evento de organizador só vende/aparece depois da aprovação do Admin. |
| 4 | Estorno | Organizador pede; equipe do Espaço executa ("Estornar pedido"). |
| 5 | Dinheiro | Tudo cai na conta do Espaço; repasse por PIX manual depois do evento; sem comissão do Espaço; só a taxa de serviço do desenvolvedor (quando ligada). A tarifa real de cada pagamento sai da parte do organizador, explícito nos Termos e no painel do evento. |
| 6 | Prazo do repasse | Até 5 dias úteis depois do evento (contando do dia seguinte à última sessão). Admin marca como pago (quem/quando imutável). |
| 7 | Dados do comprador | Organizador vê nome e e-mail dos compradores dos próprios eventos; Política de Privacidade ganha versão nova. |
| 8 | Check-in | Organizador faz check-in só de ingressos dos próprios eventos (conferido no banco). |
| 9 | Duas etapas | Obrigatória (aplicativo autenticador, nível AAL2) para organizadores e equipe (Admin e secretaria), com implantação sem trancar contas. |
| 10 | Excluir evento | Sem vendas: direto. Com vendas: pedido ao Admin. |
| 11 | Textos | Textos ao comprador não citam fornecedores. Termos do organizador preferem termos genéricos (seção 13.0). |

Interpretação desta spec para a decisão 5 **[R]**: "tarifa real de cada pagamento" = a tarifa inteira que o banco cobrou sobre aquele pagamento (inclusive a parte que incide sobre a taxa de serviço). Assim o Espaço fica neutro em eventos de organizador. Para eventos do próprio Espaço continua valendo a decisão 4 da taxa de serviço (tarifa sobre a taxa fica com o Espaço). Se o dono preferir dividir proporcionalmente, muda só a fórmula da seção 10.2.

---

## 3. Como é hoje [V]

- **Contas:** só existe a equipe (`staff_profiles`, papel `admin`/`secretaria` + `is_developer`). `is_staff()` e `is_admin()` checam só se a linha existe; **não olham duas etapas**. Login por e-mail e senha (`/equipe/login`, `signInWithPassword`). Cadastro público desligado.
- **Proteção da área:** `src/proxy.ts` protege só `/equipe` (login + linha em `staff_profiles`). As ações usam `assertStaff()` / `requireStaffUser()`; o financeiro usa `requireFinanceAdmin()` → `staff_finance_role`.
- **Escrita no banco:** quase tudo passa por funções `service_role` que recebem `p_staff_user_id` e conferem `staff_profiles` dentro do banco (`save_event_with_sessions`, `set_session_sales_open`, `check_in_ticket`, `begin_order_refund`, `cancel_event_session`…). Exceções: criar/editar/excluir a linha de `events` usa a política `events_staff_write` com a sessão da equipe.
- **Leitura:** `orders`, `order_items`, `tickets`, `order_refunds` são legíveis por qualquer conta da equipe (RLS `is_staff()`), **todas as colunas** (inclusive `public_token`, telefone, IDs do banco de pagamento e `tickets.code`, que é o conteúdo do QR Code).
- **Publicação:** um evento aparece ao público quando `events.sales_open = true` (ou é "passado", via `event_is_past`). Não existe dono do evento nem aprovação.
- **Check-in:** `check_in_ticket(evento, sessão, código, usuário)` aceita qualquer conta da equipe e, para ingresso de outro evento, devolve **o nome do outro evento**. A assinatura antiga de 3 parâmetros ainda está nas migrations (a limpeza da fase 7 de sessões removeria) **[S: conferir se ainda existe em produção]**.
- **Tarifa do banco:** `amountCentsFromOrder` lê só `total_paid_amount`; o site grava `provider_order_id` (ORD…) e `provider_payment_id` (PAY…), mas **nenhuma tarifa nem valor líquido**. A consulta da order (`/v1/orders`) não traz tarifa; a documentação mostra a tarifa (`fee_details`) e o líquido (`transaction_details.net_received_amount`) só no detalhe do pagamento (`/v1/payments/{id}`).
- **Repasses existentes:** só da taxa de serviço (`service_fee_payouts` + itens, imutáveis por gatilho, "Marcar como pago" só por Admin não desenvolvedor). É o modelo que esta spec copia para o organizador.
- **Limite de envios:** `consume_rate_limit(bucket, chave, limite, janela)` e a verificação anti-robô (Turnstile) já protegem o checkout.

---

## 4. Papéis e permissões

### 4.1 Quem é quem

- **Admin** — conta do Espaço com `role = 'admin'`.
- **Desenvolvedor** — Admin com `is_developer = true`: vê tudo que o Admin vê, mas não registra dinheiro (repasses, ajustes, contestações, tarifa manual) nem vê a chave PIX dos organizadores.
- **Secretaria** — conta do Espaço com `role = 'secretaria'`: operação do dia a dia (eventos, cortesias, check-in, estornos, decidir pedidos), sem financeiro.
- **Organizador** — tipo de conta **novo e separado** (`organizer_profiles`). **Nunca** tem linha em `staff_profiles`; um gatilho impede a mesma pessoa de ser equipe e organizador ao mesmo tempo. Com isso, toda regra que hoje exige "equipe" continua recusando o organizador sem mudar nada (falha fechada).

### 4.2 Matriz

| Ação | Admin | Desenvolvedor | Secretaria | Organizador |
| --- | --- | --- | --- | --- |
| Ver todos os eventos no painel da equipe | ✔ | ✔ | ✔ | ✘ (só os próprios, no painel dele) |
| Criar evento | ✔ (já publicável) | ✔ | ✔ | ✔ rascunho, precisa aprovação |
| Editar evento | ✔ todos | ✔ todos | ✔ todos | ✔ próprios (regras da seção 6.4) |
| Abrir/pausar vendas | ✔ | ✔ | ✔ | ✔ próprios, só depois de aprovado |
| Aprovar / recusar evento de organizador | ✔ | ✔ | ✘ | ✘ |
| Gerar/revogar convite, ver "Quero fazer meu evento" | ✔ | ✔ | ✘ | ✘ |
| Suspender organizador, redefinir duas etapas de organizador | ✔ | ✔ | ✘ | ✘ |
| Ver nome e e-mail do comprador | ✔ | ✔ | ✔ | ✔ só dos próprios eventos |
| Ver telefone, link do pedido, código do ingresso | ✔ | ✔ | ✔ | ✘ nunca |
| Estornar pedido | ✔ | ✔ | ✔ | ✘ (só pedir) |
| Pedir estorno | — | — | — | ✔ próprios eventos |
| Decidir "Pago sem vaga" | ✔ | ✔ | ✔ | ✘ (vê o aviso) |
| Emitir cortesia | ✔ | ✔ | ✔ | conforme pergunta 2 |
| Trocar horário com venda / cancelar sessão | ✔ | ✔ | ✔ | ✘ (pede; seção 6.4) |
| Check-in | ✔ todos | ✔ todos | ✔ todos | ✔ só dos próprios eventos |
| Excluir evento sem vendas | ✔ | ✔ | ✔ | ✔ próprios |
| Excluir evento com vendas | ✔ decide o pedido | ✔ decide | ✘ | pede |
| Financeiro do evento (taxa) e página "Taxa de serviço" | ✔ | ✔ ver | ✘ | ✘ |
| Painel "Sua parte" do evento | ✔ todos | ✔ ver | ✘ | ✔ próprios |
| Página "Repasses" (organizadores) | ✔ | ✔ ver | ✘ | ✘ |
| Marcar repasse ao organizador como pago, lançar tarifa manual, ajuste | ✔ | ✘ | ✘ | ✘ |
| Ver chave PIX do organizador | ✔ | ✘ | ✘ | ✔ a própria |
| Confirmar troca de chave PIX | ✔ | ✘ | ✘ | pede |
| Redefinir duas etapas da equipe | ✔ (de outra conta, nunca a própria) | ✔ idem | ✘ | ✘ |

Tudo que diz ✔ é conferido **duas vezes**: no servidor (helper da seção 11.3) e dentro da função do banco (seção 8).

---

## 5. Fluxos

### 5.1 "Quero fazer meu evento" (público)

1. Visitante clica em "Quero fazer meu evento" (rodapé e bloco discreto no fim da página inicial).
2. Página `/quero-fazer-meu-evento`: texto curto ("Você produz eventos e quer vender ingressos pelo site do Espaço Byla? Conte sua ideia que a gente responde pelo WhatsApp.") e formulário:
   - Nome (2–120), WhatsApp ou e-mail para contato (até 160), ideia do evento (10–1000), data aproximada (opcional, até 60), caixa "Li a Política de Privacidade" (obrigatória).
3. Envio: verificação anti-robô (Turnstile, falha fechada como no checkout) + `consume_rate_limit` (3 por hora por IP; 30 por dia no total do site) + validação no servidor.
4. Tela de sucesso: "Recebemos! A equipe do Espaço Byla vai falar com você pelo contato informado." **Nenhum e-mail é enviado para quem pediu** (evita usar o formulário para mandar e-mail a terceiros).
5. A equipe recebe um aviso (seção 14) e o pedido aparece em **Organizadores → Pedidos do site** com "Nova".
6. Admin conversa pelo WhatsApp e clica **"Gerar convite"** no próprio pedido (fica ligado ao pedido e o pedido vira "Convidada") ou **"Arquivar"**.
7. Pedidos são apagados 180 dias depois de arquivados/convidados (LGPD: só o necessário).

### 5.2 Convite

1. Admin em **Organizadores → Convites → "Gerar convite"**, com um apelido interno opcional (ex.: "Peça de dezembro", até 80 caracteres; a tela pede para não colocar dados pessoais).
2. Servidor gera 32 bytes aleatórios (256 bits) e guarda **só o hash SHA-256**. O link aparece **uma única vez**: `https://ingressos.espacobyla.online/convite#<token>`.
   - O token vai depois do `#`: o navegador não envia essa parte ao servidor, então ela não aparece em registros de acesso da hospedagem nem no cabeçalho `Referer`. A página lê o token no navegador e o envia por POST.
3. Botões "Copiar link" e "Enviar pelo WhatsApp" (abre `wa.me` com o texto pronto: "Olá! Este é o seu convite para criar eventos no site do Espaço Byla. O link vale por 7 dias e só pode ser usado uma vez: <link>").
4. Lista de convites: "Ativo até dd/mm", "Usado em dd/mm por <nome>", "Vencido", "Revogado". Botão "Revogar" nos ativos.
5. Perdeu o link? Revoga e gera outro (o link não pode ser mostrado de novo porque só o hash existe).

### 5.3 Cadastro com duas etapas (onboarding)

Página `/convite` (celular primeiro), em passos com barra de progresso:

1. **Conferência do convite** — POST do token; o servidor confere hash, validade, uso e revogação. Resposta genérica para qualquer falha: "Este convite não vale mais. Peça um novo ao Espaço Byla." Limite: 20 tentativas por hora por IP.
2. **Seus dados** — nome completo (para contato), nome público (aparece na página do evento se a pergunta 5 = A), WhatsApp, e-mail.
3. **Confirmação do e-mail** — código de 6 dígitos enviado ao e-mail (se a pergunta 6 = A; 1 e-mail, vale 15 min, 5 tentativas).
4. **Senha** — mínimo 12 caracteres, sem outras regras de composição; aviso para não reaproveitar senha de outro site.
5. **Recebimento** — tipo e chave PIX, nome do titular (e CPF/CNPJ do titular se a pergunta 3 = A). Aviso: "O repasse vai para esta chave. Confira com cuidado."
6. **Termos** — texto dos "Termos do organizador" com rolagem e caixa "Li e aceito os Termos do organizador e a Política de Privacidade". Versão gravada.
7. Servidor: confere o token de novo, cria a conta com a chave `service_role` (`auth.admin.createUser`, e-mail já confirmado), chama `accept_organizer_invite` (marca o convite usado e cria o perfil na mesma transação). Se a função falhar, apaga a conta recém-criada (compensação) e mostra erro genérico. Dois envios ao mesmo tempo: só um passa (trava no convite).
8. **Duas etapas** — já logado, tela "Proteja sua conta": QR Code + código para digitar à mão + campo do código de 6 dígitos. Sugestão de aplicativos gratuitos (Google Authenticator, Microsoft Authenticator). Sem concluir este passo, nenhuma tela do painel abre (seção 11.2).
9. Pronto: "Sua conta está pronta. Crie seu primeiro evento."

Login depois: `/organizador/entrar` (e-mail + senha) → código de 6 dígitos → painel. Esqueceu a senha ou perdeu o celular: fala com o Espaço; o Admin gera um **link de redefinição** (mesmo mecanismo do convite, uso único, vale 24 h) ou **redefine as duas etapas** (apaga o fator; a pessoa cadastra de novo no próximo login). Tudo registrado no histórico.

### 5.4 Evento: rascunho → aprovação → no ar

1. Organizador em **Meus eventos → "Criar evento"**: o mesmo formulário da equipe (nome, local, descrição, capa, fotos, tipos de ingresso, sessões, lotação, cotas, preços), sem o interruptor de vendas.
2. Salva como **Rascunho** quantas vezes quiser. Rascunho nunca aparece no site (o banco impede vendas abertas sem aprovação).
3. **"Enviar para aprovação"** — confere: ao menos uma sessão futura, preços, lotação até o limite configurado (`organizer_settings.max_session_capacity`, padrão 100 **[R]**), capa. Estado vira **Em análise**; o formulário fica só leitura enquanto isso (botão "Voltar para rascunho" desfaz o envio).
4. Equipe recebe aviso; o evento aparece em **Aprovações** com prévia igual à página pública e uma lista de conferência: data e horários (sem choque com a agenda do Espaço), lotação, preços e meia-entrada (metade da inteira), descrição e classificação etária, fotos adequadas, organizador ativo.
5. Admin escolhe:
   - **"Aprovar e publicar"** — estado **Aprovado**, vendas abertas; evento aparece no site.
   - **"Aprovar sem publicar"** — aprovado, o organizador abre as vendas quando quiser.
   - **"Recusar"** — motivo obrigatório (5–500), visível ao organizador; volta a ser editável e pode ser reenviado.
6. Organizador recebe e-mail com a decisão (seção 14) e vê o selo no painel.
7. Depois de aprovado: pode pausar e reabrir as vendas; mudanças seguem a seção 6.4.

### 5.5 Pedido de estorno

1. Organizador, na lista de pedidos do evento, toca num pedido pago → **"Pedir estorno"** com motivo (5–500). Só pedido pago, sem check-in, sem outro pedido pendente para ele.
2. Equipe recebe aviso; na página do evento (equipe) aparece a faixa "1 pedido de estorno solicitado pelo organizador", e o pedido ganha o selo "Estorno pedido pelo organizador: <motivo>".
3. A equipe usa o **"Estornar pedido"** que já existe (mesmas regras: 100%, com taxa, bloqueado depois de check-in, e-mail ao comprador). Quando o pedido vira `estornado`, o pedido de estorno fecha sozinho como "Estornado".
4. Ou a equipe clica "Recusar pedido de estorno" com motivo (ex.: fora do prazo dos Termos de compra).
5. Organizador recebe e-mail com o resultado. Estorno feito diminui a parte dele (seção 10).

### 5.6 Exclusão de evento

- **Sem vendas** (nenhum pedido que tenha chegado a ser pago, nem pedido em andamento): "Excluir evento" com confirmação digitando o nome do evento. Sem nenhum pedido → apagado de verdade. Com pedidos só expirados/cancelados → **excluído logicamente** (`deleted_at`), some de todas as telas e do site.
- **Com vendas:** "Pedir exclusão" com motivo. As vendas pausam na hora (para não vender mais enquanto o Admin decide). O Admin, em **Aprovações → Exclusões**:
  - **Aceitar**: o painel leva ao fluxo existente de **cancelar sessão** para cada sessão ativa (motivo, confirmação "CANCELAR", aviso aos compradores, "Estornar todos"). Quando todas as sessões estão canceladas, o evento é excluído logicamente.
  - **Recusar** com motivo (ex.: "evento acontece amanhã, vamos conversar"); o organizador pode reabrir as vendas.

### 5.7 Repasse

1. No dia seguinte à última sessão, o evento vira "A pagar até dd/mm" (prazo: seção 10.3).
2. O sistema busca a tarifa real de cada pagamento (seção 9). Pagamento sem tarifa conhecida aparece como "tarifa a conferir"; o Admin pode lançar à mão, olhando o extrato do banco de pagamento.
3. Admin (não desenvolvedor) em **Repasses → "Marcar como pago"**: vê o valor (parte do organizador − descontos pendentes de outros eventos do mesmo organizador), a chave PIX e o titular; faz o PIX no banco e registra data do PIX e nota (ex.: código do PIX). Registro imutável.
4. Organizador recebe e-mail "Repasse de R$ X registrado em dd/mm" e o painel mostra "Pago em dd/mm".
5. Passou do prazo sem registro → "Atrasado" (vermelho) para o Admin e aviso diário à equipe; o organizador vê "Previsto até dd/mm — o Espaço foi avisado".

---

## 6. Regras de negócio

### 6.1 Estados do evento de organizador

| Estado (`approval_status`) | Site | Editar | Quem muda |
| --- | --- | --- | --- |
| `rascunho` | não aparece | livre | organizador (criar, voltar de "em análise") |
| `em_analise` | não aparece | travado | organizador envia; Admin decide |
| `recusado` | não aparece | livre | Admin recusa; organizador reenvia |
| `aprovado` | aparece quando vendas abertas (ou como passado) | seção 6.4 | Admin aprova |

Eventos do próprio Espaço (`organizer_id` nulo) ficam sempre `aprovado` e funcionam exatamente como hoje.

### 6.2 Trava no banco

Gatilho `events_guard_publication`: se `organizer_id` não é nulo e `approval_status <> 'aprovado'`, então `sales_open` tem de ser `false`. Assim, mesmo um erro no servidor não publica rascunho. Como `published_at` só é preenchido quando as vendas abrem (migration `past_events`), rascunho e recusado também nunca entram em "Eventos passados".

### 6.3 Dono do evento

- `events.organizer_id` é gravado na criação e **não muda** (gatilho recusa alteração). Transferir evento entre organizadores fica fora de escopo.
- Organizador suspenso: perde o acesso; eventos aprovados continuam vendendo até o Admin decidir (pausar ou cancelar), para não prejudicar compradores.

### 6.4 Mudanças depois da aprovação (proposta = pergunta 1, opção A)

| Mudança | Vale na hora? |
| --- | --- |
| Descrição, fotos, capa | Sim (registrada no histórico; Admin vê "alterado depois da aprovação") |
| Pausar / reabrir vendas | Sim |
| Nova sessão, preço de sessão ainda sem venda | Sim |
| Nome do evento, preço de sessão com venda, reduzir lotação | Pedido ao Admin |
| Trocar horário de sessão com venda, cancelar sessão | Pedido ao Admin (a equipe usa os fluxos atuais, com aviso aos compradores) |

### 6.5 Cortesias

Conforme a pergunta 2. Recomendação: o organizador emite cortesias até 10% da lotação de cada sessão; acima disso, só a equipe. Motivo: cortesia não paga taxa de serviço, e cortesias sem limite permitiriam vender "por fora" e usar o site só para a portaria.

### 6.6 Dados do comprador que o organizador vê

Por pedido: número do pedido, nome, e-mail, data, sessão, tipos e quantidades, valor dos ingressos, situação (pago, estornado, aguardando decisão…), quantos ingressos já entraram, e o pedido de estorno (se houver). **Nunca**: telefone, link do pedido (`public_token`), código dos ingressos, IDs do banco de pagamento, CPF. Sem planilha de compradores nesta entrega (fora de escopo).

---

## 7. Modelo de dados

Tudo aditivo e compatível com o código no ar. Cada tabela nova: RLS ligada, `revoke all ... from public, anon, authenticated`, políticas explícitas abaixo, escrita só por funções `service_role`.

### 7.1 Configuração e chave geral

```sql
create table public.organizer_settings (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default false,              -- área do organizador DESLIGADA ao publicar
  staff_mfa_enforced boolean not null default false,   -- trava de duas etapas no banco (fase 1)
  max_session_capacity integer not null default 100 check (max_session_capacity between 1 and 2000),
  courtesy_max_bps integer not null default 1000 check (courtesy_max_bps between 0 and 10000),
  updated_at timestamptz not null default now()
);
```

- Sem políticas; leitura por funções. Mudança só pelo dono no painel do banco (como `service_fee_settings`).
- `enabled = false` recusa login, cadastro e toda ação de organizador (falha fechada): serve de botão de emergência.

### 7.2 Perfil do organizador

```sql
create table public.organizer_profiles (
  user_id uuid primary key references auth.users (id) on delete restrict,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 120),
  public_name text not null check (char_length(btrim(public_name)) between 2 and 80),
  phone text not null check (char_length(phone) between 8 and 20),
  pix_key_type text not null check (pix_key_type in ('cpf','cnpj','email','telefone','aleatoria')),
  pix_key text not null check (char_length(pix_key) between 1 and 77),
  pix_holder_name text not null check (char_length(btrim(pix_holder_name)) between 2 and 120),
  pix_holder_document text,             -- só se pergunta 3 = A; CPF/CNPJ só dígitos
  pix_key_changed_at timestamptz,
  status text not null default 'ativo' check (status in ('ativo','suspenso','encerrado')),
  status_reason text check (status_reason is null or char_length(status_reason) between 5 and 500),
  terms_version text not null,
  terms_accepted_at timestamptz not null,
  invite_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizer_pix_change_requests (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references public.organizer_profiles (user_id),
  pix_key_type text not null, pix_key text not null,
  pix_holder_name text not null, pix_holder_document text,
  status text not null default 'pendente' check (status in ('pendente','confirmada','recusada','cancelada')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index on public.organizer_pix_change_requests (organizer_id) where status = 'pendente';
```

- Gatilho `forbid_staff_and_organizer`: recusa inserir em `organizer_profiles` quem está em `staff_profiles`, e o inverso.
- RLS `organizer_profiles`: `select` para `authenticated` quando `user_id = auth.uid() and public.is_organizer()` (o próprio, com duas etapas). Admin lê por função (não por RLS), para a chave PIX não ficar exposta a toda a equipe.
- Troca de chave PIX: o organizador pede (com duas etapas), recebe e-mail de aviso, e o Admin confirma em **Organizadores → Contas** antes do próximo repasse. Defesa contra quem roubar a conta e trocar a chave.

### 7.3 Convites e pedidos do site

```sql
create table public.organizer_signup_requests (      -- "Quero fazer meu evento"
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  contact text not null check (char_length(btrim(contact)) between 5 and 160),
  idea text not null check (char_length(btrim(idea)) between 10 and 1000),
  approx_date text check (approx_date is null or char_length(approx_date) <= 60),
  privacy_policy_version text not null,
  status text not null default 'nova' check (status in ('nova','convidada','arquivada')),
  handled_by uuid references auth.users (id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.organizer_invites (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'convite' check (kind in ('convite','redefinir_senha')),
  token_hash bytea not null unique,           -- sha256 do token; o token nunca é guardado
  target_user_id uuid references auth.users (id),  -- só em 'redefinir_senha'
  label text check (label is null or char_length(label) <= 80),
  request_id uuid references public.organizer_signup_requests (id) on delete set null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,            -- convite: +7 dias; redefinição: +24 h
  used_at timestamptz,
  used_by uuid references auth.users (id),
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id),
  check (used_at is null or revoked_at is null)
);
```

- Ambas **sem políticas** para `authenticated`: leitura e escrita só por funções (`service_role`).
- Limpeza diária (no cron `keep-alive` já existente): apaga convites vencidos/usados há mais de 30 dias e pedidos tratados há mais de 180 dias.

### 7.4 Evento

```sql
alter table public.events
  add column organizer_id uuid references public.organizer_profiles (user_id),
  add column approval_status text not null default 'aprovado'
    check (approval_status in ('rascunho','em_analise','aprovado','recusado')),
  add column submitted_at timestamptz,
  add column approval_decided_by uuid references auth.users (id) on delete set null,
  add column approval_decided_at timestamptz,
  add column approval_note text check (approval_note is null or char_length(approval_note) between 5 and 500),
  add column deleted_at timestamptz,
  add column deleted_by uuid references auth.users (id) on delete set null;
create index events_organizer_id_idx on public.events (organizer_id) where organizer_id is not null;
```

- Eventos existentes: `organizer_id` nulo, `aprovado` (nada muda).
- Gatilhos: `events_guard_publication` (seção 6.2), `events_organizer_immutable` (seção 6.3).

### 7.5 Pedidos de estorno e de exclusão (e de mudança)

```sql
create table public.organizer_ops_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('estorno','exclusao','mudanca')),
  event_id uuid not null references public.events (id),
  order_id uuid references public.orders (id),       -- obrigatório em 'estorno'
  details jsonb not null default '{}'::jsonb,         -- 'mudanca': o que muda (sem dados de comprador)
  reason text not null check (char_length(btrim(reason)) between 5 and 500),
  status text not null default 'pendente'
    check (status in ('pendente','atendido','recusado','cancelado')),
  requested_by uuid not null references auth.users (id),
  decided_by uuid references auth.users (id) on delete set null,
  decision_note text check (decision_note is null or char_length(decision_note) between 5 and 500),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check ((kind = 'estorno') = (order_id is not null))
);
create unique index on public.organizer_ops_requests (order_id) where kind = 'estorno' and status = 'pendente';
create unique index on public.organizer_ops_requests (event_id) where kind = 'exclusao' and status = 'pendente';
```

- Gatilho em `orders`: quando o status vira `estornado`, fecha o pedido de estorno pendente daquele pedido como `atendido`.
- Sem políticas; leitura por funções (organizador vê os dos próprios eventos; equipe vê todos).

### 7.6 Tarifa do banco por pagamento

```sql
create table public.order_payment_fees (
  order_id uuid primary key references public.orders (id),
  gross_cents integer not null check (gross_cents >= 0),
  fee_cents integer not null check (fee_cents >= 0),
  net_cents integer not null,
  source text not null check (source in ('api','manual')),
  fee_breakdown jsonb not null default '[]'::jsonb,   -- só tipo e valor de cada tarifa
  attempts integer not null default 0,
  last_error text check (last_error is null or char_length(last_error) <= 200),
  fetched_at timestamptz not null default now(),
  set_by uuid references auth.users (id) on delete set null,   -- em 'manual'
  check (gross_cents = fee_cents + net_cents)
);
```

- Sem políticas; leitura por funções. Atualizável só por função (a tarifa pode mudar depois de um estorno; seção 9). Cada mudança manual vai para o histórico (seção 7.8).

### 7.7 Repasses ao organizador

```sql
create table public.organizer_payouts (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references public.organizer_profiles (user_id),
  kind text not null check (kind in ('repasse','ajuste')),
  amount_cents integer not null,        -- repasse: > 0; ajuste: <> 0
  pix_date date,                        -- obrigatório no repasse
  pix_key_snapshot text,                -- chave usada (mascarada na tela)
  note text check (note is null or char_length(note) <= 140),
  reason text,                          -- obrigatório no ajuste (5–500)
  created_by uuid not null references auth.users (id),
  created_by_name text not null,
  created_at timestamptz not null default now()
);

create table public.organizer_payout_items (
  payout_id uuid not null references public.organizer_payouts (id),
  event_id uuid not null references public.events (id),
  amount_cents integer not null check (amount_cents <> 0),
  primary key (payout_id, event_id)
);
```

- Imutáveis: reaproveita o gatilho `reject_finance_record_change` (recusa update/delete/truncate). `grant select, insert` só para `service_role`.
- Soma dos itens = valor do repasse (conferido na função).

### 7.8 Histórico (auditoria)

```sql
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users (id) on delete set null,
  actor_kind text not null check (actor_kind in ('admin','secretaria','organizador','sistema')),
  action text not null,                -- lista fechada por check, ex.: 'convite_gerado', 'evento_aprovado'
  event_id uuid references public.events (id),
  order_id uuid references public.orders (id),
  organizer_id uuid references public.organizer_profiles (user_id),
  details jsonb not null default '{}'::jsonb,   -- nunca nome, e-mail, telefone, chave PIX ou token
  created_at timestamptz not null default now()
);
```

- Imutável (mesmo gatilho). Sem políticas; Admin lê por função; o organizador vê, pela tela do evento, só o histórico de aprovação/pedidos dos próprios eventos.
- Ações registradas: convite gerado/revogado/usado; conta criada/suspensa/reativada; duas etapas redefinidas; senha redefinida por link; troca de chave PIX pedida/confirmada/recusada; evento criado/enviado/aprovado/recusado/alterado depois da aprovação/excluído; vendas abertas/pausadas por organizador; pedido de estorno/exclusão/mudança criado/atendido/recusado; tarifa lançada à mão; repasse/ajuste registrado.

### 7.9 Feriados (dias úteis)

```sql
create table public.business_holidays (
  day date primary key,
  name text not null
);
```

- Semeada para 2026 e 2027 com feriados nacionais e os dias sem expediente bancário em Salvador (Carnaval, Sexta-feira Santa, Corpus Christi, 2 de Julho, 8 de Dezembro…) **[S: conferir a lista com o contador/banco]**. Leitura só por função; o dono atualiza uma vez por ano (lembrete junto do de renovação do domínio).

---

## 8. Funções do banco e mudanças no que existe

Padrão para todas: `set search_path = ''`; `revoke all ... from public, anon, authenticated`; `grant execute ... to service_role` (exceto as marcadas "RLS", que precisam de `grant execute to authenticated` porque são usadas em políticas e só devolvem verdadeiro/falso). As que escrevem recebem `p_actor_user_id` e reconferem papel, dono e duas etapas **dentro** do banco. Erros com prefixos estáveis: `ORG_ACESSO`, `ORG_DONO`, `ORG_ESTADO`, `ORG_CONVITE`, `ORG_DESLIGADO`, `ORG_TARIFA_PENDENTE`, `ORG_PIX_PENDENTE`, `ORG_MUDOU`, `ORG_NADA`.

### 8.1 Novas — identidade e acesso

| Função | Tipo | O que faz |
| --- | --- | --- |
| `jwt_is_aal2()` | RLS | `(select auth.jwt() ->> 'aal') = 'aal2'` |
| `my_account_kind()` | RLS, SECURITY DEFINER | `'equipe'`, `'organizador'` ou nulo para `auth.uid()`; não exige duas etapas e não revela mais nada. Usada no login e no `proxy` para mandar à tela de duas etapas certa. |
| `is_organizer()` | RLS, SECURITY DEFINER | organizador `ativo`, área ligada **e** `jwt_is_aal2()` |
| `owns_event(p_event_id)` | RLS, SECURITY DEFINER | `is_organizer()` e `events.organizer_id = auth.uid()` e `deleted_at is null` |
| `actor_event_access(p_actor_user_id, p_event_id)` | service_role | `'equipe'`, `'dono'` ou nulo. Base de todas as funções compartilhadas. Organizador: confere `status = 'ativo'`, área ligada e dono. |
| `organizer_access(p_actor_user_id)` | service_role | perfil resumido (status, nome público) ou erro `ORG_ACESSO` |

**Duas etapas dentro de funções `service_role`:** a chave `service_role` não carrega o login do usuário, então o banco não consegue ver o nível AAL nessas chamadas. Por isso a conferência de duas etapas dessas funções fica no helper do servidor (seção 11.3), que é o único caminho até elas; e as leituras feitas com a sessão do usuário (RLS) conferem no banco.

### 8.2 Novas — convites, cadastro, pedidos do site

| Função | Quem | O que faz |
| --- | --- | --- |
| `create_organizer_invite(p_admin, p_token_hash, p_kind, p_label, p_request_id, p_target_user_id)` | Admin | grava convite (7 dias / 24 h); pedido do site vira "convidada" |
| `revoke_organizer_invite(p_admin, p_invite_id)` | Admin | revoga se ativo |
| `check_organizer_invite(p_token_hash)` | público via servidor | devolve só `valido` / `invalido` |
| `accept_organizer_invite(p_token_hash, p_user_id, perfil..., p_terms_version)` | servidor | trava o convite (`for update`), confere validade, cria perfil, marca usado, histórico |
| `use_password_reset_invite(p_token_hash)` | servidor | confere e marca usado; devolve o `target_user_id` para o servidor trocar a senha |
| `submit_signup_request(nome, contato, ideia, data, versão)` | servidor (após anti-robô + limite) | grava pedido do site |
| `list_signup_requests(p_admin, p_status)` / `archive_signup_request(p_admin, p_id)` | Admin | — |
| `list_organizers(p_admin)` | Admin | lista; chave PIX só mascarada (`•••• 1234`); completa só para Admin não desenvolvedor na tela de repasse |
| `set_organizer_status(p_admin, p_user_id, p_status, p_reason)` | Admin | suspender/reativar/encerrar |
| `request_pix_change(p_actor, ...)` / `decide_pix_change(p_admin_nao_dev, p_id, p_ok)` | organizador / Admin | troca de chave PIX |

### 8.3 Novas — evento e operação do organizador

| Função | O que faz |
| --- | --- |
| `create_organizer_event(p_actor, nome, local, descrição, capa, tipos, sessões)` | cria em `rascunho` com `organizer_id = p_actor` e `sales_open = false`; reaproveita `save_event_ticket_types` / `save_event_sessions`; confere `max_session_capacity` |
| `submit_event_for_approval(p_actor, p_event_id)` | dono; `rascunho`/`recusado` → `em_analise`; valida sessão futura, preços, lotação |
| `withdraw_event_submission(p_actor, p_event_id)` | dono; `em_analise` → `rascunho` |
| `decide_event_approval(p_admin, p_event_id, p_decision, p_publish, p_note)` | Admin; `em_analise` → `aprovado` (abre vendas se `p_publish`) ou `recusado` (nota obrigatória) |
| `organizer_event_orders(p_actor, p_event_id, p_session_id)` | dono ou equipe; colunas da seção 6.6, nada além |
| `request_order_refund(p_actor, p_order_id, p_reason)` | dono; pedido pago, sem check-in, sem pedido pendente |
| `decline_ops_request(p_staff, p_request_id, p_note)` | equipe (estorno) / Admin (exclusão, mudança) |
| `delete_own_event(p_actor, p_event_id, p_confirm_name)` | dono; recusa se houve pedido pago ou em andamento; apaga ou exclui logicamente |
| `request_event_deletion(p_actor, p_event_id, p_reason)` | dono; pausa vendas e cria pedido |
| `finish_event_deletion(p_admin, p_event_id)` | Admin; só com todas as sessões canceladas; `deleted_at` |
| `request_event_change(p_actor, p_event_id, p_details, p_reason)` | dono; mudanças da seção 6.4 que pedem Admin |
| `issue_courtesy_ticket` (nova assinatura com `p_actor`) | equipe sem limite; dono até `courtesy_max_bps` da lotação da sessão (se pergunta 2 = A) |

### 8.4 Novas — dinheiro do organizador (fase 3)

| Função | O que faz |
| --- | --- |
| `record_payment_fee(p_order_id, gross, fee, net, breakdown, 'api')` | servidor, depois de consultar o banco de pagamento; insere ou atualiza |
| `record_payment_fee_manual(p_admin_nao_dev, p_order_id, p_fee_cents, p_note)` | lançamento manual; histórico |
| `orders_missing_fee(p_limit)` | pagos sem tarifa ou com tentativa falha, para o cron |
| `event_payout_due_date(p_event_id)` | 5º dia útil (seção 10.3) |
| `organizer_event_finance(p_actor, p_event_id)` | dono, Admin ou desenvolvedor; números da seção 10.2 |
| `organizer_payouts_overview(p_admin, p_from, p_to)` | lista para a página "Repasses" |
| `record_organizer_payout(p_event_id, p_admin_nao_dev, p_expected_amount_cents, p_pix_date, p_note)` | igual a `record_service_fee_payout`: trava, recalcula, confere valor esperado (`ORG_MUDOU`), recusa com tarifa pendente (`ORG_TARIFA_PENDENTE`) ou troca de PIX pendente (`ORG_PIX_PENDENTE`), abate descontos pendentes de outros eventos do mesmo organizador, recusa total ≤ 0 (`ORG_NADA`) |
| `record_organizer_payout_adjustment(p_event_id, p_admin_nao_dev, p_amount_cents, p_reason)` | correção sem apagar nada |

### 8.5 Mudanças em funções que já existem

| Função | Mudança |
| --- | --- |
| `is_staff()`, `is_admin()` | depois da fase 1 (com `staff_mfa_enforced = true`): passam a exigir `jwt_is_aal2()`. `staff_profiles_self` continua deixando a pessoa ler a própria linha sem duas etapas (necessário para o login mandar à tela do código). |
| `check_in_ticket` (v3, mesma lista de parâmetros, `p_staff_user_id` passa a significar "quem faz") | trocar a checagem de equipe por `actor_event_access(p_staff_user_id, p_event_id) is not null`. Para **organizador**, ingresso de outro evento devolve `evento_errado` **sem** o nome do outro evento ("Ingresso de outro evento"); equipe continua vendo o nome. `checked_in_by` grava o organizador. Remover a assinatura antiga de 3 parâmetros, se ainda existir. |
| `save_event_with_sessions` | checagem de equipe vira `actor_event_access`; dono só com estado `rascunho`/`recusado`, ou `aprovado` respeitando a seção 6.4 (`ORG_ESTADO`); dono nunca muda `sales_open` por aqui |
| `set_session_sales_open` | dono permitido só com evento `aprovado` |
| `event_is_past`, `public_past_events` | ignoram eventos com `deleted_at` |
| `begin_order_refund`, `accept_paid_order`, `cancel_event_session`, `start_session_refund_batch`, `queue_schedule_change_notice`, `cancel_courtesy_ticket`, finanças da taxa | **sem mudança**: continuam só da equipe (o organizador é recusado porque não está em `staff_profiles`) |

### 8.6 Mudanças em políticas (RLS)

| Tabela | Política hoje | Depois |
| --- | --- | --- |
| `events` | `events_public_read`: `sales_open or event_is_past(id) or is_staff()` | `deleted_at is null and (sales_open or event_is_past(id)) or is_staff() or owns_event(id)` |
| `events` | `events_staff_write` (equipe) | sem mudança; organizador não escreve direto |
| `event_sessions`, `session_ticket_types`, `ticket_types`, `event_images` | leitura pública pelo evento à venda/passado, ou `is_staff()` | + `or owns_event(<event_id>)`; evento excluído fora da leitura pública |
| `orders`, `order_items`, `tickets`, `order_refunds` | `is_staff()` | **sem mudança.** Organizador **não** ganha leitura direta: a política daria acesso a todas as colunas (telefone, link do pedido, código do QR). Ele lê só por `organizer_event_orders`. |
| `session_audit_log` e demais tabelas de sessão | `is_staff()` | sem mudança |
| `organizer_profiles` | — | `select` do próprio com `is_organizer()` |
| demais tabelas novas | — | sem políticas (só funções) |
| arquivos do bucket `event-media` | escrita só pelo servidor | sem mudança; a ação de upload confere o dono antes |

---

## 9. Tarifa real do banco de pagamento

**Problema [V]:** o site guarda só o total pago e os IDs da order (ORD…) e do pagamento (PAY…). A consulta `/v1/orders` não traz a tarifa.

**Proposta [R]:**

1. **Teste antes de construir (primeiro passo da fase 3)**, com as credenciais de teste (`APP_USR-` do vendedor de teste): consultar uma order paga e descobrir qual identificador do pagamento a API de Payments aceita (`transactions.payments[].id` ou `reference_id`) em `GET /v1/payments/{id}`, e conferir `fee_details[]` (tipo e valor) e `transaction_details.net_received_amount`. **[S]** A documentação mostra esses campos no pagamento, mas não confirma a ligação com pagamentos criados pela API de Orders.
2. **Captura automática:** depois que `confirmOrderPaid` marca o pedido como pago (ou quando a equipe aceita um "pago sem vaga"), o servidor faz a consulta acima e chama `record_payment_fee` com bruto, tarifa e líquido. A falha nunca atrapalha a confirmação nem o e-mail do ingresso (é feito depois, sem lançar erro).
3. **Nova tentativa:** o cron diário (`/api/cron/keep-alive`) chama `orders_missing_fee` e tenta de novo (até 5 tentativas). Depois disso, alerta a equipe uma vez: "Tarifa do pedido Nº … não encontrada; lance pelo extrato".
4. **Estorno:** depois de um estorno, consulta de novo e atualiza a tarifa com o valor que o banco realmente reteve. **[S]** Em estorno total o banco costuma devolver a tarifa; se devolver, a tarifa daquele pedido vira 0; se não, continua descontada (regra "tarifa real", dita nos Termos).
5. **Manual:** Admin (não desenvolvedor) lança a tarifa de um pedido pelo extrato, com nota. Fica marcado "lançada à mão por Fulano".
6. **Plano B** se o teste do item 1 falhar: lançamento manual por evento (total de tarifas do extrato do período) até haver integração. O repasse não fica bloqueado: o Admin lança e segue.
7. Vale para **todos** os pedidos pagos, não só de organizador (uma consulta a mais por venda; também ajuda o Espaço a saber o líquido dos próprios eventos).

---

## 10. Dinheiro do organizador

### 10.1 Quem paga o quê

- **Comprador** paga: preço do ingresso + taxa de serviço (quando ligada).
- **Taxa de serviço** é do desenvolvedor; **não entra nem sai** da parte do organizador.
- **Tarifa do banco** (cobrada sobre o pagamento inteiro) sai da parte do organizador (decisão 5; interpretação na seção 2).
- **Espaço** não cobra comissão.

### 10.2 Contas do evento

- **Pedidos que contam:** pedidos do evento que chegaram a ser pagos (`pago`, `estornado`). `aguardando_decisao` fica fora até ser aceito. Cortesias valem 0.
- **Vendido** = soma de `tickets_subtotal_cents` desses pedidos (só ingressos, sem a taxa de serviço).
- **Estornos** = soma de `tickets_subtotal_cents` dos estornados.
- **Contestações** = soma de `tickets_subtotal_cents` dos pagos contestados (registro manual já existente, `order_chargebacks`).
- **Tarifa do banco** = soma de `order_payment_fees.fee_cents` dos pedidos que contam (com o valor atualizado depois de estornos).
- **Sua parte** = vendido − estornos − contestações − tarifa do banco.
- **Já repassado** = soma de `organizer_payout_items` do evento.
- **Saldo** = sua parte − já repassado. Negativo = desconto pendente (pergunta 4).

Exemplo **[S: percentuais só ilustrativos; os reais vêm do extrato]**: 10 Inteiras de R$ 50,00 com taxa de 5% ligada. Vendido R$ 500,00. Compradores pagaram R$ 525,00. Cada pedido de 1 Inteira paga R$ 52,50. Tarifa do banco: 6 pagamentos PIX (~0,99% = R$ 0,52 cada) + 4 no cartão (~4,98% = R$ 2,61 cada) = R$ 3,12 + R$ 10,44 = R$ 13,56. Um pedido de cartão foi estornado (R$ 50,00 de ingresso; o banco devolveu a tarifa de R$ 2,61), então a tarifa do evento fica R$ 10,95. Sua parte = 500,00 − 50,00 − 0 − 10,95 = **R$ 439,05**.

### 10.3 Prazo do repasse

- "A pagar" começa no **dia seguinte à última sessão ativa** (mesma data de `event_fee_due_date`, horário de Brasília).
- **Prazo** = 5º dia útil contado a partir desse dia (ele mesmo conta, se for dia útil). Dia útil = segunda a sexta, fora de `business_holidays`.
- Exemplos: última sessão sexta 23/10/2026 → começa sábado 24/10 → dias úteis 26, 27, 28, 29, 30 → **prazo 30/10**. Última sessão sábado 14/11/2026 → começa domingo 15/11 (feriado) → 16, 17, 18, 19 e (20/11 é feriado) 23 → **prazo 23/11**.
- Ponto de atenção para o Espaço **[S]:** o dinheiro de cartão pode demorar a ficar disponível na conta do banco de pagamento (depende do prazo de recebimento escolhido na conta). O repasse em 5 dias úteis pode sair antes de o Espaço ter recebido as vendas no cartão.

### 10.4 Situação do repasse (calculada, não gravada)

| Situação | Quando | Organizador vê |
| --- | --- | --- |
| Evento em andamento | antes do dia seguinte à última sessão | "Repasse previsto até dd/mm" |
| A pagar até dd/mm | depois, saldo > 0, dentro do prazo | "Em conferência — previsto até dd/mm" |
| Conferindo tarifas | há pedido sem tarifa | "Conferindo a tarifa do banco de N pedidos" |
| Atrasado | passou do prazo, saldo > 0 | "Previsto até dd/mm — o Espaço foi avisado" |
| Pago em dd/mm | saldo = 0 e há repasse | "Pago em dd/mm · R$ X" |
| Sem valor a repassar | saldo = 0 sem repasse | "Sem valor a repassar" |
| Desconto pendente | saldo < 0 | "−R$ X será descontado do próximo repasse" (pergunta 4) |

---

## 11. Verificação em duas etapas (AAL2)

### 11.1 Como funciona

Supabase Auth com fator TOTP (aplicativo autenticador; incluso no plano gratuito). Depois de senha + código, o login fica no nível `aal2` (campo `aal` do token).

### 11.2 Telas

- **Cadastrar:** QR Code + código para digitar à mão + campo do código. Recomendação forte na tela: "Cadastre também em um segundo aparelho (ou guarde o código de configuração em lugar seguro)": o Supabase permite mais de um fator TOTP, e isso substitui códigos de recuperação.
- **Entrar:** depois da senha, "Digite o código de 6 dígitos do seu aplicativo autenticador".
- **Minha segurança:** lista de aparelhos cadastrados, "Adicionar aparelho", "Remover" (exige estar em `aal2`; não deixa remover o último).
- Rotas: `/equipe/seguranca` e `/organizador/seguranca`.

### 11.3 Onde é conferido

1. **`proxy.ts`** (conforto, não segurança): `/equipe` e `/organizador` mandam para a tela de cadastro/código quando o login está em `aal1`. `/organizador/*` exige conta de organizador; `/equipe/*` continua exigindo equipe.
2. **Servidor (segurança):** um helper único em `src/lib/auth/actor.ts` (`server-only`): `getActor()` lê o token verificado (`supabase.auth.getClaims()`, que confere a assinatura) e o usuário (`getUser()`), e devolve `{ userId, kind: 'equipe' | 'organizador', role, isDeveloper, aal2 }`. Em cima dele:
   - `requireStaffUser()` / `assertStaff()` / `requireFinanceAdmin()` passam a exigir `aal2` (atrás da chave `staff_mfa_enforced`, ver 11.4);
   - `requireOrganizer()` exige organizador ativo, área ligada e `aal2` desde o primeiro dia;
   - `requireEventAccess(eventId, { write })` devolve `'equipe' | 'dono'` ou lança `ActionError` genérico.
   Toda página, Server Action e `route.ts` (inclusive `/api/check-in`) chama um desses **dentro** dela.
3. **Banco:** `is_organizer()` exige `aal2`; `is_staff()`/`is_admin()` passam a exigir depois da 11.4. Funções `service_role` não enxergam o nível (seção 8.1), por isso o helper do servidor é obrigatório antes delas, e um teste de inventário (seção 16) confere isso em todo arquivo de ações.

### 11.4 Implantação para a equipe atual (sem trancar ninguém)

1. **Antes:** conferir no painel do Supabase que TOTP está ativo (Auth → MFA) e definir senha mínima de 12 caracteres para contas novas.
2. **Publicar o código** com as telas de duas etapas e o helper com `staff_mfa_enforced = false`. Nesse modo, quem entra sem fator vai direto para "Proteja sua conta" (obrigatório, mas basta a senha para cadastrar: ninguém fica trancado).
3. **As duas contas atuais** (Admin do Espaço e Admin desenvolvedor) cadastram o fator, de preferência em dois aparelhos cada. Tela **Equipe → Segurança da equipe** (Admin) mostra quem já tem duas etapas.
4. **Ligar a trava** (`staff_mfa_enforced = true`, com "pode" do dono) só quando todas as contas da equipe tiverem fator verificado. A partir daí servidor e banco exigem `aal2`.
5. **Perdeu o celular:** outro Admin usa "Redefinir duas etapas" (apaga os fatores; histórico). **Emergência** (todos os Admins sem acesso): o dono apaga o fator no painel do Supabase (Authentication → Users → fatores MFA) — documentado no guia de publicação.
6. Contas novas da equipe (criadas pelo dono no painel) cadastram o fator no primeiro login, pelo mesmo fluxo.

---

## 12. Telas (celular primeiro, textos para quem opera)

### 12.1 Público

- **Rodapé:** link "Quero fazer meu evento" ao lado de "Termos de compra".
- **Página inicial:** no fim, bloco discreto "Quer fazer seu evento no Espaço Byla? → Fale com a gente".
- **`/quero-fazer-meu-evento`:** formulário da seção 5.1; link para `/termos-organizador` ("Veja como funciona para organizadores").
- **`/termos-organizador`:** texto da seção 13 (público, para ler antes de aceitar).
- **Página do evento:** "Produção: <nome público>" abaixo do local, se a pergunta 5 = A.

### 12.2 Área do organizador (`/organizador`)

Menu: **Meus eventos** · **Minha conta** · Sair.

**Meus eventos** (cards, 1 coluna no celular):

```
┌───────────────────────────────────────────┐
│ [capa]  Peça Y                             │
│ 12 e 13 de dezembro · 2 sessões            │
│ ● À venda          38 de 100 vendidos      │
│ [Abrir]                                    │
└───────────────────────────────────────────┘
Selos: Rascunho · Em análise · Recusado (ver motivo) · À venda · Vendas pausadas · Encerrado
[+ Criar evento]
```

**Página do evento** (abas no celular, colunas no computador):

- **Evento** — formulário (travado em "Em análise"); faixa de estado: "Em análise: o Espaço Byla vai conferir e responder em breve." / "Recusado: <motivo>. Ajuste e envie de novo." / "Aprovado e à venda."
- **Vendas** — por sessão: vendidos, disponíveis, "Pausar vendas" / "Reabrir vendas".
- **Pedidos** — busca por nome ou número; cada pedido: Nº, nome, e-mail, sessão, itens, situação, "2 de 3 já entraram", botão "Pedir estorno". Aviso no topo: "Use estes dados só para a operação deste evento (Termos do organizador, item 9)."
- **Portaria** — botão "Abrir leitor de QR Code" (mesmo leitor da equipe).
- **Financeiro** (fase 3):

```
Financeiro do evento                     Repasse: previsto até 30/10
──────────────────────────────────────────────────────────────
Vendido (ingressos)                     R$ 500,00   10 pedidos
Tarifa do banco                         −R$ 10,95   ⓘ cobrada em cada pagamento
Estornos                                −R$ 50,00   1 pedido
Contestações                             R$ 0,00
──────────────────────────────────────────────────────────────
Sua parte                               R$ 439,05
Já repassado                             R$ 0,00
Situação do repasse                     Em conferência — previsto até 30/10
Chave PIX: e-mail •••@•••.com
──────────────────────────────────────────────────────────────
A taxa de serviço paga pelos compradores (R$ 22,50) não entra na sua parte.
```

  ⓘ "Tarifa do banco: valor que o banco responsável pelo pagamento cobra em cada venda (PIX ou cartão). Mostramos o valor real de cada pagamento."
- **Pedidos à equipe** — lista de estorno/exclusão/mudança com situação.
- Rodapé da página: "Excluir evento" (ou "Pedir exclusão" quando houve vendas).

**Minha conta:** dados, nome público, chave PIX (mascarada) + "Trocar chave PIX" (aviso: "A troca precisa ser confirmada pelo Espaço Byla antes do próximo repasse"), duas etapas, Termos aceitos (versão e data).

### 12.3 Painel da equipe

Menu (Admin): **Eventos** · **Aprovações** (com número de pendências) · **Organizadores** · **Repasses** · **Taxa de serviço**. Secretaria: **Eventos** (com a faixa de pedidos de estorno).

- **Aprovações:** abas "Eventos" (cards com prévia, lista de conferência, "Aprovar e publicar" / "Aprovar sem publicar" / "Recusar"), "Mudanças" (pedidos da seção 6.4) e "Exclusões".
- **Organizadores:** abas "Pedidos do site" (Nova/Convidada/Arquivada; "Gerar convite", "Arquivar"), "Convites" (gerar, copiar, WhatsApp, revogar) e "Contas" (status, eventos, "Suspender", "Redefinir duas etapas", "Link para nova senha", trocas de PIX pendentes com "Confirmar"/"Recusar").
- **Eventos (lista e página):** selo "Organizador: <nome público>" nos eventos de organizador; faixa "Pedido de estorno do organizador" no pedido. Tudo o mais igual a hoje.
- **Repasses** (`/equipe/repasses`): totais "A pagar", "Atrasados", "Pago no período"; uma linha/card por evento de organizador (organizador, data, sua parte, situação, prazo) e "Marcar como pago" (Admin não desenvolvedor) com a chave PIX completa e o titular só nessa tela.
- **Equipe → Segurança da equipe** (Admin): quem já tem duas etapas; "Redefinir duas etapas" de outra conta.

---

## 13. "Termos do organizador" (rascunho completo)

### 13.0 Escolha de palavras

O texto usa "banco responsável pelo pagamento" e "tarifa do banco", sem citar o fornecedor. Motivos: trocar de fornecedor não exige nova versão dos termos, e segue a regra dos textos públicos (a página é pública). O fornecedor aparece no extrato que o Espaço pode mostrar ao organizador quando pedir.

Constantes em `src/lib/legal/organizer-terms.ts` (`ORGANIZER_TERMS_VERSION`, data da publicação); página `/termos-organizador`. Os valores entre `{}` vêm das constantes.

---

**Termos do organizador — Espaço Byla Eventos**

*Atualizados em {data}.*

Estes termos valem para quem cria e vende ingressos de eventos próprios pelo site de ingressos do Espaço Byla ("organizador"). Ao marcar "Li e aceito" no cadastro, você concorda com eles e com a Política de Privacidade. O uso do espaço físico (aluguel, datas, horários, equipamentos, limpeza, segurança) segue acordo próprio com o Espaço Byla; estes termos tratam só da venda de ingressos pelo site.

**1. Quem somos**

{Espaço Byla — razão social, CNPJ, endereço}. Contato: {e-mail de contato}.

**2. Sua conta**

- A conta é criada só por convite do Espaço Byla. Ela é pessoal: não compartilhe a senha nem o aplicativo de verificação.
- A verificação em duas etapas é obrigatória. Se perder o celular, fale com o Espaço Byla para redefinir.
- Mantenha seus dados e sua chave PIX corretos. Trocar a chave PIX precisa da confirmação do Espaço Byla antes do próximo repasse.
- Você responde pelo que for feito na sua conta. Se suspeitar de uso indevido, avise na hora.

**3. Como o evento vai ao ar**

- Você cria o evento como rascunho e envia para aprovação. O evento só aparece no site e vende depois que o Espaço Byla aprova.
- O Espaço Byla pode recusar um evento, informando o motivo, e pode tirar do ar um evento que descumpra estes termos ou a lei.
- Depois de aprovado, algumas mudanças (nome, preço de sessão já vendida, redução de lugares, troca de horário, cancelamento de sessão) dependem de nova confirmação do Espaço Byla, porque afetam quem já comprou.

**4. Eventos que não aceitamos**

Eventos ilegais ou que incentivem crime; discriminação ou discurso de ódio; conteúdo sexual explícito; jogos de azar, rifas ou sorteios sem autorização; esquemas de pirâmide ou "investimento"; venda de produtos proibidos; eventos que coloquem pessoas em risco; eventos que usem marca, nome ou obra de terceiros sem autorização; e eventos com informação enganosa sobre atrações, datas ou preços.

**5. Ingressos e regras para quem compra**

- Os ingressos seguem os Termos de compra do site, que valem para todos os eventos: compra, entrada, meia-entrada, troca de horário, cancelamento, desistência e reembolso. Você não pode prometer ao comprador regras diferentes.
- A meia-entrada segue a lei e custa metade da inteira da mesma sessão.
- A lotação de cada sessão não pode passar do limite combinado com o Espaço Byla.
- A venda, o pagamento e os reembolsos são feitos pelo Espaço Byla, em nome de quem o comprador paga.

**6. Dinheiro: o que você recebe**

- Todo pagamento cai na conta do Espaço Byla no banco responsável pelo pagamento. O Espaço Byla **não cobra comissão** sobre as suas vendas.
- O site pode cobrar do comprador uma **taxa de serviço** ({percentual}% por item, mínimo {mínimo}), que paga a manutenção do site. Ela é paga pelo comprador e **não sai da sua parte**.
- O banco responsável pelo pagamento cobra uma **tarifa em cada pagamento** (PIX ou cartão). Essa tarifa **sai da sua parte**, pelo **valor real** cobrado em cada pagamento. Os valores de cada tipo de pagamento são definidos pelo banco e podem mudar.
- **Sua parte** = valor dos ingressos vendidos − estornos − contestações no cartão − tarifas do banco.
- No painel do evento você acompanha: vendido, tarifa do banco, estornos, sua parte e a situação do repasse.

**7. Repasse**

- O Espaço Byla paga sua parte por PIX, na chave cadastrada, **em até 5 dias úteis** contados do dia seguinte à última sessão do evento. Dias úteis: segunda a sexta, fora feriados nacionais e de Salvador.
- Ao registrar o pagamento, o Espaço Byla envia um e-mail com valor e data. O registro não pode ser apagado.
- O titular da chave PIX deve ser você ou a sua empresa.
- Se houver tarifa ainda em conferência, o repasse pode ser feito com o valor conferido até ali e o restante acertado no próximo repasse.

**8. Estornos, contestações e cancelamentos**

- Pedidos de reembolso dos compradores são analisados e feitos pelo Espaço Byla, conforme os Termos de compra (por exemplo: desistência em até 7 dias da compra e pelo menos 48 horas antes da sessão; troca de horário; sessão cancelada; pagamento sem lugar).
- Você pode pedir o estorno de um pedido do seu evento pelo painel. O Espaço Byla decide e faz o estorno, que devolve 100% ao comprador, incluindo a taxa de serviço.
- Todo estorno e toda contestação no cartão diminuem a sua parte no valor dos ingressos. Se o banco não devolver a tarifa daquele pagamento, ela continua descontada.
- Estorno ou contestação depois do repasse: {regra conforme a pergunta 4 — ex.: o valor é descontado do próximo repasse; se não houver outro evento em até 30 dias, você devolve por PIX em até 10 dias}.
- Para cancelar uma sessão ou o evento depois de vender, peça pelo painel. Todos os compradores recebem 100% de volta, e não há repasse sobre pedidos estornados.

**9. Dados dos compradores (LGPD)**

- Você vê nome e e-mail de quem comprou ingressos dos seus eventos, e a situação dos pedidos, **só para operar o evento** (por exemplo, conferir a lista de entrada ou avisar sobre uma mudança no evento).
- É proibido: usar esses dados para propaganda ou para outros eventos sem autorização da pessoa; vender, emprestar ou publicar os dados; copiar os dados para listas ou planilhas além do necessário para o evento.
- Guarde com segurança qualquer cópia e apague em até 90 dias depois do evento.
- Se houver vazamento ou acesso indevido, avise o Espaço Byla em até 24 horas.
- O Espaço Byla é o responsável pelos dados perante os compradores; você atua seguindo estas instruções. O Espaço Byla pode suspender o acesso se houver uso indevido.

**10. Portaria**

- Você pode conferir os ingressos dos seus eventos pelo leitor de QR Code do site. Cada QR Code vale uma entrada; o site recusa ingressos de outro evento, de outra sessão ou de sessão cancelada.
- Na entrada, confira o documento de quem usa meia-entrada, conforme os Termos de compra.
- Respeite a lotação e as regras de segurança do Espaço Byla.

**11. Suas responsabilidades**

Realizar o evento como anunciado; conseguir as autorizações e licenças necessárias (por exemplo, direitos autorais de música e classificação etária); informar corretamente atrações, datas, horários e restrições; responder pelo conteúdo do evento e pelos seus impostos sobre o que receber.

**12. Responsabilidades do Espaço Byla**

Manter o site de venda funcionando; receber os pagamentos; enviar os ingressos aos compradores; fazer os reembolsos devidos; pagar a sua parte no prazo; dar suporte pelo contato acima.

**13. Excluir um evento**

Sem vendas, você exclui pelo painel. Com vendas, peça a exclusão: as vendas pausam e o Espaço Byla decide; se aceitar, todos os compradores são reembolsados.

**14. Suspensão e encerramento**

- Você pode encerrar sua conta a qualquer momento, pedindo ao Espaço Byla. Eventos com vendas precisam acontecer ou ser cancelados com reembolso antes do encerramento.
- O Espaço Byla pode suspender ou encerrar a conta se você descumprir estes termos ou a lei, ou em caso de suspeita de fraude, com aviso e motivo.
- Valores devidos de eventos já realizados são pagos depois de descontados estornos e contestações pendentes.

**15. Mudanças nestes termos**

Se os termos mudarem, avisaremos no painel e pediremos um novo aceite no próximo acesso. Cada evento segue a versão aceita quando ele foi enviado para aprovação.

**16. Foro**

Fica eleito o foro de Salvador – BA.

---

**[S]** Pedir a quem cuida da parte jurídica e ao contador uma leitura antes de publicar, em especial: papel do organizador perante a LGPD (operador x controlador), documento fiscal do repasse e a cláusula de devolução depois do repasse.

---

## 14. E-mails (Resend, 100 por dia no plano gratuito)

Prioridade continua sendo os ingressos. Os avisos desta spec têm **teto próprio de 10 por dia** (bucket `email_org` em `consume_rate_limit`); acima disso ficam só no painel (as telas mostram tudo, com números de pendência). Nenhum e-mail leva nome ou e-mail de comprador, chave PIX ou token.

| Para | Quando | Assunto (texto curto) |
| --- | --- | --- |
| Equipe (`ALERT_EMAIL`) | pedido "Quero fazer meu evento" (no máximo 1 a cada 6 h, resumindo quantos chegaram) | "Novo pedido para fazer evento" |
| Equipe | evento enviado para aprovação | "Evento para aprovar: <nome>" |
| Equipe | pedido de estorno, exclusão ou mudança | "Pedido do organizador: <tipo> — <evento>" |
| Equipe | repasse atrasado (1 por evento por dia, no cron diário) | "Repasse atrasado: <evento>" |
| Equipe | tarifa não encontrada depois de 5 tentativas | "Tarifa a conferir: pedido Nº …" |
| Organizador | evento aprovado / recusado (com motivo) | "Seu evento foi aprovado" / "Seu evento precisa de ajustes" |
| Organizador | pedido de estorno/exclusão/mudança atendido ou recusado | "Resposta ao seu pedido" |
| Organizador | repasse registrado | "Repasse de R$ X registrado" |
| Organizador | troca de chave PIX pedida (para o e-mail da conta) e confirmada | "Sua chave PIX foi alterada" |
| Organizador | código de confirmação do e-mail no cadastro (pergunta 6) | "Seu código: 123456" |
| Organizador | conta suspensa | "Sua conta foi suspensa" |

O convite **não** vai por e-mail: é o link pelo WhatsApp (decisão 1).

---

## 15. Política de Privacidade e Termos de compra

### 15.1 Política de Privacidade — nova versão

`PRIVACY_POLICY_VERSION` muda para a data de publicação (ex.: `2026-11-xx`), e `PRIVACY_POLICY_UPDATED_LABEL` acompanha. Pedidos novos gravam a versão nova automaticamente (`create_checkout_order` já recebe a versão do servidor).

Mudanças no texto de `/privacidade`:

- **Introdução** — trocar "quando você compra ingressos por este site" por "quando você compra ingressos por este site, pede para fazer um evento ou usa uma conta de organizador".
- **"Quais dados recebemos"** — novos itens:
  - "**No pedido para fazer um evento:** nome, contato (WhatsApp ou e-mail) e a ideia do evento."
  - "**Na conta de organizador:** nome, nome público, e-mail, telefone, chave PIX e nome do titular{, CPF ou CNPJ do titular} e registros de acesso, usados para a conta, a segurança e o pagamento do organizador."
- **"Com quem compartilhamos"** — novo item, logo depois de "o banco responsável por processar o pagamento":
  - "**o organizador do evento**, quando o evento for produzido por um organizador parceiro (indicado na página do evento): apenas o seu nome, o seu e-mail e a situação do seu pedido e dos ingressos (inclusive se já foram usados na entrada), para a operação daquele evento — por exemplo, conferir a entrada ou avisar sobre mudanças. O organizador é obrigado, por contrato, a usar esses dados só para isso, a não enviar propaganda e a apagá-los depois do evento. Telefone, CPF e dados de pagamento nunca são compartilhados com o organizador."
- **"Para que usamos"** — novo item: "Analisar pedidos para fazer eventos e administrar as contas de organizadores, inclusive o pagamento da parte deles."
- **"Por quanto tempo guardamos"** — acrescentar: "Pedidos para fazer evento são apagados até 6 meses depois de respondidos. Dados da conta de organizador ficam guardados por até {5} anos depois do fim da parceria, para obrigações fiscais e contábeis."
- **"Segurança"** — trocar "acesso restrito à equipe do Espaço Byla" por "acesso restrito à equipe do Espaço Byla e, para os próprios eventos, aos organizadores parceiros, sempre com verificação em duas etapas".

### 15.2 Termos de compra — nova versão

`TERMS_VERSION` muda; na seção "Quem vende", acrescentar: "Alguns eventos são produzidos por organizadores parceiros, indicados na página do evento. Mesmo nesses casos, a venda, o pagamento, o atendimento e os reembolsos são feitos pelo Espaço Byla, conforme estes termos." Nenhuma outra regra muda.

---

## 16. Segurança

### 16.1 Ameaças e defesas

| Ameaça | Defesa |
| --- | --- |
| Organizador vira equipe (escalada de privilégio) | Tipos de conta em tabelas separadas, gatilho impede os dois ao mesmo tempo; escrita em `staff_profiles` revogada de `anon`/`authenticated` [V]; papéis só pelo dono no painel; funções da equipe conferem `staff_profiles` dentro do banco. |
| Organizador mexe em evento ou pedido de outro (IDOR) | Toda ação recebe IDs, valida UUID e confere dono **no servidor** (`requireEventAccess`) **e no banco** (`actor_event_access`/`owns_event`). Pedido é conferido pelo `event_id` do próprio pedido, nunca pelo que veio do navegador. |
| Vazamento por colunas (telefone, link do pedido, código do QR) | Organizador não tem leitura direta de `orders`/`tickets`; só funções com colunas fixas (seção 6.6). |
| Check-in revela outros eventos | `evento_errado` sem nome para organizador. |
| Roubo ou adivinhação do convite | Token de 256 bits, só o hash no banco, uso único, 7 dias, revogável; token depois do `#` (fora de registros e `Referer`); `Referrer-Policy: no-referrer` na página; 20 tentativas/h por IP; mensagem genérica. |
| Roubo de conta | Duas etapas obrigatórias; senha mínima de 12; mensagens genéricas no login; limites de tentativa do Supabase Auth; aviso por e-mail em troca de chave PIX. |
| Troca da chave PIX para desviar repasse | Troca precisa de confirmação do Admin; e-mail ao organizador; a tela de repasse mostra "chave alterada em dd/mm"; `ORG_PIX_PENDENTE` bloqueia repasse com troca em aberto. |
| Server Action chamada por POST direto | Cada ação chama o helper dentro dela; teste de inventário (16.3). |
| Ação de organizador sem duas etapas | Helper exige `aal2` do token verificado; `is_organizer()` exige no banco. |
| Spam no formulário público | Turnstile (falha fechada), `consume_rate_limit` (3/h por IP, 30/dia total), tamanhos máximos, nenhum e-mail para quem pede, aviso à equipe agrupado. |
| Conteúdo malicioso no evento (XSS, phishing) | React escapa o texto; e-mails escapam HTML; capa só `https` [V]; fotos pelo envio existente; aprovação do Admin e histórico de mudanças depois da aprovação. |
| Organizador some com o dinheiro / evento falso | Dinheiro fica com o Espaço até depois do evento; aprovação prévia; repasse só depois da última sessão. |
| Cortesia usada para fugir da taxa | Limite de cortesias do organizador (pergunta 2). |
| Admin registra repasse falso | Registro imutável, e-mail ao organizador a cada repasse, conta do desenvolvedor não registra dinheiro. Limite honesto: quem administra o banco consegue burlar qualquer regra. |
| Emergência (abuso em andamento) | `organizer_settings.enabled = false` desliga toda a área do organizador na hora; suspensão por conta. |

### 16.2 Regras gerais

- `service_role` só em módulos `server-only` [V]. Criação de conta e troca de senha por link usam a API de administração do Supabase Auth, só no servidor.
- Erros ao usuário são genéricos (`ActionError` via `runAction`); detalhe só no log, **sem** nome, e-mail, telefone, chave PIX, token ou código do ingresso.
- Toda entrada validada no servidor: tipos, formatos e tamanhos (seções 5 e 7).
- Nenhuma dependência nova: TOTP e criação de contas já estão no `@supabase/supabase-js`; QR Code do cadastro de duas etapas vem pronto do Supabase (imagem SVG); hash com `node:crypto`.
- CSP: nada novo de terceiros (o QR do Supabase vem como `data:`; conferir `img-src` em `src/lib/security/csp.ts`).

### 16.3 Testes de segurança obrigatórios

- **Inventário:** teste que lê `src/app/organizador/**/actions.ts`, `src/app/equipe/**/actions.ts` e `route.ts` e falha se alguma função exportada não chamar um helper de acesso (`requireOrganizer`, `requireEventAccess`, `requireStaffUser`, `assertStaff`, `requireFinanceAdmin`).
- **Matriz no banco:** para cada função nova ou alterada, chamar como anônimo, organizador A, organizador B (dono de outro evento), organizador suspenso, secretaria, Admin desenvolvedor e Admin; conferir aceita/recusa conforme a seção 4.2.
- **RLS com tokens:** organizador `aal1` não lê nada; organizador `aal2` lê só os próprios eventos/sessões/tipos/fotos e nunca `orders`/`tickets`; equipe `aal1` perde leitura depois de `staff_mfa_enforced`.

---

## 17. Plano de testes

1. **Unitários (Vitest):** dias úteis e prazo (exemplos da seção 10.3, virada de dia em Brasília com servidor em UTC); contas do organizador (seção 10.2, com estorno, contestação, tarifa pendente, saldo negativo); token do convite (geração, hash, formato); validações dos formulários; textos de situação do repasse; leitura da resposta do banco de pagamento para tarifa (formatos esperados e ausentes).
2. **Banco** (transação revertida, no padrão de `scripts/db-tests/*.mjs`): estados do evento e gatilho de publicação; dono imutável; convite usado duas vezes ao mesmo tempo; convite vencido/revogado; check-in de evento alheio sem nome; pedido de estorno duplicado; exclusão com e sem vendas; repasse com tarifa pendente, troca de PIX pendente, valor mudado, duplo clique, desconto de outro evento; registros imutáveis até para `service_role`; matriz da seção 16.3.
3. **Servidor:** cada ação e rota recusa anônimo, conta sem duas etapas, organizador de outro evento e (quando couber) secretaria e desenvolvedor, inclusive por POST direto (mesmo estilo de `tests/api/check-in-route.test.ts`).
4. **Teste do banco de pagamento** (fase 3, credenciais de teste): seção 9, item 1.
5. **Telas (local, dados falsos):** cadastro completo no celular, duas etapas, criar → enviar → aprovar → vender (pagamento de teste) → pedir estorno → estornar → painel financeiro → marcar repasse.
6. **Produção (só leitura, depois de cada publicação):** com a área desligada, nada muda para compradores e equipe; depois de ligar, o dono faz um convite de teste para uma conta própria, cria um evento de teste, aprova, confere que aparece, e exclui em seguida.

---

## 18. Publicação em fases

Cada fase tem plano próprio em `docs/superpowers/plans/`, migration aditiva com "pode" do dono (projeto Espaço Byla Eventos, fingerprint conferido) e deploy com "pode".

**Fase 1 — Duas etapas para a equipe** (≈1,5–2 dias)
Helper `getActor` com `aal2`; telas de cadastro/código/minha segurança; "Segurança da equipe" e "Redefinir duas etapas"; `organizer_settings` (só a chave `staff_mfa_enforced`); `is_staff()`/`is_admin()` com `aal2` atrás da chave; check-in exigindo `aal2`. Ligar a trava só depois de todas as contas cadastradas (seção 11.4). Independe do resto e já melhora a segurança de hoje.

**Fase 2 — Contas de organizador, eventos e aprovação** (≈5–7 dias; pode ser dividida em 2a e 2b)
- 2a: "Quero fazer meu evento", convites, cadastro, área do organizador, eventos próprios, aprovação, `organizer_id` e mudanças de RLS/funções, Termos do organizador, nova Política de Privacidade e Termos de compra, e-mails de aprovação.
- 2b: pedidos (compradores) do organizador, portaria só dos próprios eventos, pedidos de estorno/exclusão/mudança, cortesias com limite, histórico.
- Publicada com `organizer_settings.enabled = false`; o dono liga quando quiser.

**Fase 3 — Financeiro do organizador e repasses** (≈3–4 dias)
Teste do banco de pagamento (seção 9) → `order_payment_fees` e captura → painel "Financeiro" do organizador → `organizer_payouts` → página "Repasses" → feriados e prazo → avisos de atraso.

**Regra de ordem [R]:** o primeiro evento real de organizador só é aprovado depois da fase 3 no ar, para o painel e o prazo de repasse prometidos nos Termos existirem desde a primeira venda.

---

## 19. Fora de escopo

- Divisão automática do pagamento (split) ou repasse automático.
- Cadastro aberto de organizador (sem convite).
- Subcontas de portaria do organizador (pergunta 7).
- Planilha de compradores para o organizador; envio de e-mails em massa aos compradores pelo site.
- Comissão do Espaço, taxas diferentes por organizador, cupons de desconto.
- Página pública do organizador ("perfil do produtor"), domínio próprio.
- Transferir evento entre organizadores; reabrir sessão cancelada.
- Antecipação de repasse; emissão de nota fiscal ou recibo pelo site.
- Estorno parcial.
- Detecção automática de contestação (continua manual, como na taxa de serviço).

---

## 20. Riscos

1. **Tarifa pela API não confirmada [S]:** se a API de Payments não aceitar o pagamento criado pela API de Orders, a tarifa vira lançamento manual (seção 9, plano B), mais trabalho para o Admin.
2. **Repasse antes de receber o cartão [S]:** depende do prazo de recebimento configurado na conta do banco de pagamento (seção 10.3).
3. **E-mails no limite gratuito:** com avisos de sessão (até 80/dia) e ingressos, sobra pouco; por isso o teto de 10/dia e o painel como canal principal.
4. **Papel na LGPD e parte fiscal [S]:** confirmar com jurídico/contador (seção 13).
5. **Organizador suspenso com evento à venda:** decisão manual do Admin (pausar, manter ou cancelar).
6. **Confiança no administrador do banco** (estrutural, igual à taxa de serviço): mitigada com histórico imutável e e-mails, não eliminada.

---

## 21. Perguntas para o dono

1. **Mudanças depois da aprovação** (o evento já está à venda):
   - **A (recomendado):** descrição, fotos, pausar/reabrir vendas e sessão nova valem na hora (ficam no histórico); nome, preço de sessão com venda, redução de lugares, troca de horário e cancelamento de sessão viram pedido ao Admin.
   - **B:** qualquer mudança volta para análise (vendas pausam até o Admin aprovar).
   - **C:** tudo vale na hora; o Admin só vê o histórico.
2. **Cortesias do organizador:**
   - **A (recomendado):** o organizador emite cortesias até 10% da lotação de cada sessão; acima disso, só a equipe do Espaço.
   - **B:** sem limite.
   - **C:** organizador não emite; pede à equipe.
3. **Dados de quem recebe o repasse:**
   - **A (recomendado):** pedir nome e CPF/CNPJ do titular da chave PIX (tem de ser o organizador ou a empresa dele) e o Espaço confirma com o contador se precisa de nota ou recibo.
   - **B:** só a chave PIX e o nome do titular.
4. **Estorno ou contestação depois do repasse** (o organizador já recebeu):
   - **A (recomendado):** desconta do próximo repasse do mesmo organizador; se não houver outro evento em até 30 dias, ele devolve por PIX em até 10 dias (escrito nos Termos).
   - **B:** o Espaço assume a perda.
5. **Nome do organizador para o comprador:**
   - **A (recomendado):** mostrar "Produção: <nome público>" na página do evento e no e-mail do ingresso (transparência e base para a Política de Privacidade).
   - **B:** não mostrar; o evento aparece só como do Espaço Byla.
6. **Confirmar o e-mail no cadastro:**
   - **A (recomendado):** código de 6 dígitos enviado ao e-mail durante o cadastro (1 e-mail por organizador; evita e-mail digitado errado, que impediria avisos de repasse).
   - **B:** não confirmar; o Admin confere o e-mail na conversa pelo WhatsApp.
7. **Equipe de portaria do organizador:**
   - **A (recomendado):** fica para depois; nesta entrega o próprio organizador (ou a equipe do Espaço) faz o check-in.
   - **B:** incluir agora subcontas só de portaria para o organizador (mais telas, mais contas com duas etapas).
