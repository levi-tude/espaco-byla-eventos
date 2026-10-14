# Contas de organizador — design

Data: 2026-10-13 · Status: **aprovado pelo dono em 2026-10-13** (todas as perguntas respondidas; decisões 12 a 20 na seção 2.1) · **Revisão 2026-10-14:** decisão 9 trocada de aplicativo autenticador (TOTP/AAL2) para **código por e-mail + aparelho lembrado por 30 dias** (motivo do dono: aplicativo autenticador é complicado demais para quem opera); decisões 21 a 23 (troca de chave PIX na fase 3, local vira pedido, textos legais junto com a fase 2) respondidas no plano da fase 2 (seção 2.1) · Base: `feat/sair-vercel` (`214c866`), migrations até `20261016100000_past_events.sql`.

Legenda: **[V]** verificado no código · **[S]** suposição, a confirmar · **[R]** recomendação desta spec.

Ponto de partida (dono, 2026-10-13): pessoas de fora (produtores, coletivos, professores) poderão fazer eventos no Espaço Byla vendendo ingressos pelo site. O dinheiro continua caindo 100% na conta do Espaço no banco de pagamento; depois do evento, o Espaço paga ao organizador a parte dele por PIX manual. O Espaço não cobra comissão; existe só a taxa de serviço do desenvolvedor (5%, quando ligada), paga pelo comprador.

## Resumo executivo

- **Entrada só por convite:** o Admin gera um link de uso único (vale 7 dias) e manda pelo WhatsApp. A pessoa abre, preenche os dados, a chave PIX e aceita os "Termos do organizador" (o e-mail confirmado no cadastro passa a receber o código de acesso). Quem não tem convite usa a página pública **"Quero fazer meu evento"**, e o Admin responde mandando o convite.
- **Cada um no seu quadrado:** o organizador só vê e mexe nos próprios eventos. Não vê eventos de outros, nem o financeiro geral, nem a página da taxa de serviço. Isso é garantido no servidor **e** no banco.
- **Nada vai ao ar sem o Admin:** o organizador cria o evento como rascunho e envia para aprovação. Só depois do "Aprovar e publicar" o evento aparece no site e vende.
- **Estorno:** o organizador **pede**; a equipe do Espaço faz, pelo botão "Estornar pedido" que já existe.
- **Cortesia:** o organizador **não emite**; pede à equipe do Espaço pelo WhatsApp, e a equipe emite pelo botão de cortesia que já existe.
- **Mudanças depois de aprovado:** textos, fotos, pausar vendas e sessão nova valem na hora; nome, local, preço já vendido, menos lugares, troca de horário e cancelamento viram pedido ao Admin.
- **Dinheiro:** painel por evento mostra **vendido, tarifa do banco, estornos, sua parte e situação do repasse**. A tarifa real de cada pagamento (inteira, inclusive a parte cobrada sobre a taxa de serviço) sai da parte do organizador. Repasse por PIX em até **5 dias úteis** depois do evento (calendário de Salvador, com Carnaval), para a chave de um titular com CPF/CNPJ igual ao do organizador; o Admin marca "Pago" (registro que não se apaga). Estorno ou contestação depois do repasse é descontado do próximo repasse (ou devolvido por PIX).
- **Compradores:** o organizador vê **nome e e-mail** dos compradores dos próprios eventos (sem telefone, sem link do pedido, sem QR Code). A página do evento e o e-mail do ingresso mostram "Produção: <nome do organizador>". A Política de Privacidade ganha uma versão nova dizendo isso.
- **Portaria:** o organizador faz check-in só de ingressos dos próprios eventos; o banco recusa os outros sem revelar de qual evento são.
- **Verificação em duas etapas obrigatória por código no e-mail** para organizadores **e** para a equipe atual: depois da senha, o site manda um código de 6 dígitos (vale 10 minutos) para o e-mail da conta; quem marca "Lembrar este aparelho" não digita código de novo nesse aparelho por 30 dias. Sem aplicativo, sem custo, sem trancar ninguém para fora (decisão 9, revista em 2026-10-14).
- **Excluir evento:** sem vendas, o organizador exclui sozinho; com vendas, pede e o Admin decide (na prática, cancelar com reembolso de todos).
- **Achado no código [V]:** o site hoje **não guarda a tarifa do banco de pagamento** de cada venda. A spec propõe buscá-la depois de cada pagamento e guardá-la (seção 9).
- **Em 3 fases:** (1) código por e-mail para a equipe; (2) contas de organizador, eventos e aprovação; (3) financeiro do organizador e repasses.

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
| 9 | Duas etapas | **Revista em 2026-10-14** (antes: aplicativo autenticador TOTP/AAL2; motivo da troca: aplicativo é complicado demais para quem opera). Obrigatória para organizadores e equipe (Admin, secretaria e desenvolvedor): depois de e-mail e senha, código de 6 dígitos enviado ao e-mail da conta, válido por 10 minutos; o aparelho pode ser lembrado por 30 dias ("Lembrar este aparelho por 30 dias", marcado por padrão). Custo zero (mesmo serviço de e-mail do site). Compradores não mudam. Seção 11. |
| 10 | Excluir evento | Sem vendas: direto. Com vendas: pedido ao Admin. |
| 11 | Textos | Textos ao comprador não citam fornecedores. Termos do organizador preferem termos genéricos (seção 13.0). |

### 2.1 Respostas às perguntas da spec (dono, 2026-10-13; 21 a 23 em 2026-10-14)

| # | Tema | Resposta | Onde muda |
| --- | --- | --- | --- |
| 12 (perg. 1) | Mudanças depois da aprovação | **A** — descrição, fotos/capa, pausar/reabrir vendas e sessão nova valem na hora (ficam no histórico); nome do evento, preço de sessão com venda, redução de lugares, troca de horário e cancelamento de sessão viram pedido ao Admin. | 6.4, 8.3, 12 |
| 13 (perg. 2) | Cortesias | **C** — o organizador **não emite** cortesias; pede à equipe do Espaço, que emite pelo fluxo atual. | 4.2, 6.5, 8.3, 13, 16 |
| 14 (perg. 3) | Dados de quem recebe | **A** — nome e CPF/CNPJ do titular da chave PIX, que tem de ser o próprio organizador (CPF) ou a empresa dele (CNPJ); o Espaço confirma com o contador se precisa de nota ou recibo. | 5.3, 7.2, 13, 15 |
| 15 (perg. 4) | Estorno/contestação depois do repasse | **A** — desconta do próximo repasse do mesmo organizador; sem outro evento com repasse em até 30 dias, o organizador devolve por PIX em até 10 dias. | 7.7, 8.4, 10.4, 10.5, 12.3, 13, 14 |
| 16 (perg. 5) | Nome do organizador ao comprador | **A** — "Produção: <nome público>" na página do evento e no e-mail do ingresso. | 12.1, 14, 15 |
| 17 (perg. 6) | Confirmar e-mail no cadastro | **A** — código de 6 dígitos por e-mail durante o cadastro. | 5.3, 7.3, 14 |
| 18 (perg. 7) | Portaria do organizador | **A** — sem subcontas nesta entrega; o próprio organizador (ou a equipe do Espaço) faz o check-in. | 19 |
| 19 (perg. 8) | Tarifa do banco sobre a taxa de serviço | **A** — o organizador paga a **tarifa real inteira** de cada pagamento, inclusive a parte que o banco cobra sobre a taxa de serviço. O Espaço fica neutro nos eventos de organizador. Nos eventos do próprio Espaço continua valendo a decisão 4 da spec da taxa de serviço. | 10.1, 10.2, 13 |
| 20 (perg. 9) | Dias úteis do prazo do repasse | **A** — Espaço Byla fica em Salvador (BA): dias úteis = segunda a sexta, fora feriados nacionais, o feriado estadual da Bahia, os feriados municipais de Salvador e os dias sem expediente bancário (segunda e terça de Carnaval). Lista, fontes e manutenção na seção 7.9. | 7.9, 10.3, 13 |
| 21 (plano fase 2, perg. 1 — 2026-10-14) | Troca da chave PIX pelo organizador | **A** — fica para a fase 3, antes do primeiro repasse. Na fase 2 a tela "Minha conta" mostra a chave mascarada e "Para trocar a chave PIX, fale com o Espaço Byla". | 4.2, 7.2, 8.4, 12.2, 18 |
| 22 (plano fase 2, perg. 2 — 2026-10-14) | Trocar o local depois da aprovação | **A** — vira "Pedir mudança" ao Admin, como nome e preço. | 6.4, 13 (item 3) |
| 23 (plano fase 2, perg. 3 — 2026-10-14) | Quando publicar os textos legais | **B** — Termos do organizador, nova Política de Privacidade e novos Termos de compra vão ao ar junto com o resto da fase 2 (sem deploy separado). A leitura do jurídico/contador (21.1) continua obrigatória antes de aprovar o primeiro evento real de organizador, que só acontece depois da fase 3. | 18, 21.1 |
**Cortesia a pedido — escolha desta spec [R]:** o pedido de cortesia vai **pelo WhatsApp**, sem tela nova. Motivo: a cortesia precisa de nome e e-mail do convidado; um formulário no painel guardaria esses dados num pedido intermediário (mais dados pessoais guardados, mais uma tela e mais uma regra), enquanto o botão "Emitir cortesia" que a equipe já usa resolve com uma conversa. O organizador vê as cortesias emitidas no próprio evento (lista de pedidos, valor R$ 0,00) e elas não mexem na parte dele. Se o volume crescer, um "Pedir cortesia" no painel pode entrar depois (fora de escopo).

**Tarifa (decisão 19):** "tarifa real de cada pagamento" = a tarifa inteira que o banco cobrou sobre aquele pagamento. Exemplo: o comprador paga R$ 52,50 no cartão (R$ 50,00 de ingresso + R$ 2,50 de taxa de serviço) e o banco cobra R$ 2,61; os R$ 2,61 saem da parte do organizador, e a taxa de serviço chega inteira ao desenvolvedor.

**Carnaval (escolha desta spec, dentro da decisão 20) [R]:** segunda e terça de Carnaval **não** são dias úteis para o prazo, embora não sejam feriado por lei (são ponto facultativo), porque os bancos não têm expediente e o mercado financeiro não as conta como dias úteis (Resolução CMN 4.880/2020). A Quarta-feira de Cinzas **conta** como dia útil: a contagem é por dia inteiro, os bancos abrem às 12h e o PIX funciona o dia todo. Mesma lógica para Corpus Christi (já é feriado municipal em Salvador) e para 24/12 e 31/12 (contam como dias úteis; PIX funciona).

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
| Suspender organizador, esquecer os aparelhos lembrados de um organizador | ✔ | ✔ | ✘ | ✘ |
| Ver nome e e-mail do comprador | ✔ | ✔ | ✔ | ✔ só dos próprios eventos |
| Ver telefone, link do pedido, código do ingresso | ✔ | ✔ | ✔ | ✘ nunca |
| Estornar pedido | ✔ | ✔ | ✔ | ✘ (só pedir) |
| Pedir estorno | — | — | — | ✔ próprios eventos |
| Decidir "Pago sem vaga" | ✔ | ✔ | ✔ | ✘ (vê o aviso) |
| Emitir / cancelar cortesia | ✔ (inclusive em evento de organizador, a pedido dele) | ✔ | ✔ | ✘ (pede à equipe pelo WhatsApp; vê as cortesias do próprio evento) |
| Pedir mudança (nome, local, preço vendido, lugares, horário, cancelar sessão) | — | — | — | ✔ próprios eventos aprovados |
| Decidir pedido de mudança | ✔ | ✔ | ✘ | ✘ |
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
| Esquecer aparelhos lembrados de outra conta da equipe | ✔ (de outra conta; a própria, em "Meus aparelhos") | ✔ idem | ✘ (só os próprios) | ✘ (só os próprios) |

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
2. **Seus dados** — nome completo (para contato), nome público (aparece como "Produção: <nome público>" na página do evento e no e-mail do ingresso; pode ser o nome da produtora ou do coletivo), WhatsApp, e-mail.
3. **Confirmação do e-mail** — código de 6 dígitos enviado ao e-mail (1 e-mail; vale 15 min; 5 tentativas; "Reenviar código" no máximo 2 vezes por convite). Só o hash do código é guardado (seção 7.3). Sem confirmar, o cadastro não continua.
4. **Senha** — mínimo 12 caracteres, sem outras regras de composição; aviso para não reaproveitar senha de outro site.
5. **Recebimento** — tipo e chave PIX, nome do titular e CPF ou CNPJ do titular (validados pelos dígitos verificadores). O titular tem de ser o próprio organizador (CPF) ou a empresa dele (CNPJ); a tela diz: "O repasse vai para esta chave. O titular precisa ser você ou a sua empresa. Confira com cuidado."
6. **Termos** — texto dos "Termos do organizador" com rolagem e caixa "Li e aceito os Termos do organizador e a Política de Privacidade". Versão gravada.
7. Servidor: confere o token de novo, cria a conta com a chave `service_role` (`auth.admin.createUser`, e-mail já confirmado), chama `accept_organizer_invite` (marca o convite usado e cria o perfil na mesma transação). Se a função falhar, apaga a conta recém-criada (compensação) e mostra erro genérico. Dois envios ao mesmo tempo: só um passa (trava no convite).
8. **Duas etapas** — nada a cadastrar: o e-mail confirmado no passo 3 é o canal do código de acesso. A tela final explica: "A cada acesso em um aparelho novo, enviaremos um código para o seu e-mail." O primeiro login logo depois do cadastro já pede o código (mesmo fluxo da equipe, seção 11), com "Lembrar este aparelho por 30 dias".
9. Pronto: "Sua conta está pronta. Crie seu primeiro evento."

Login depois: `/organizador/entrar` (e-mail + senha) → código de 6 dígitos no e-mail (pulado em aparelho lembrado) → painel. Esqueceu a senha: fala com o Espaço; o Admin gera um **link de redefinição** (mesmo mecanismo do convite, uso único, vale 24 h). Perdeu acesso ao e-mail: o Admin troca o e-mail da conta no painel do Supabase depois de confirmar a identidade pelo WhatsApp e **esquece os aparelhos lembrados** daquela conta. Tudo registrado no histórico.

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
5. Organizador recebe e-mail com o resultado. Estorno feito diminui a parte dele (seção 10); se o repasse do evento já foi feito, vira desconto pendente (seção 10.4).

### 5.5.1 Pedido de mudança (evento aprovado)

1. No formulário do evento aprovado, os campos da seção 6.4 que pedem Admin ficam travados com o botão **"Pedir mudança"**: o organizador informa o que quer mudar (ex.: "Sessão de 19h passa para 20h") e o motivo (5–500).
2. Equipe recebe aviso; o pedido aparece em **Aprovações → Mudanças**.
3. O Admin aplica a mudança pelos fluxos que já existem na página do evento (editor de sessões, trocar horário com e-mail aos compradores, cancelar sessão com estornos) e marca o pedido como **"Feito"**, ou **"Recusar"** com motivo.
4. Organizador recebe e-mail com o resultado.

### 5.5.2 Cortesia

O organizador pede pelo WhatsApp ao Espaço (quantas, sessão, nome e e-mail de cada convidado). A equipe emite pelo botão de cortesia que já existe, na página do evento. A cortesia aparece na lista de pedidos do organizador como "Cortesia" (R$ 0,00) e entra na portaria normalmente. O painel do organizador mostra o lembrete: "Precisa de cortesias? Peça à equipe do Espaço Byla pelo WhatsApp."

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

### 6.4 Mudanças depois da aprovação (decisão 12)

| Mudança | Vale na hora? |
| --- | --- |
| Descrição, fotos, capa | Sim (registrada no histórico; Admin vê "alterado depois da aprovação") |
| Pausar / reabrir vendas | Sim |
| Nova sessão, preço de sessão ainda sem venda | Sim |
| Nome do evento, local (decisão 22), preço de sessão com venda, reduzir lotação | Pedido ao Admin (seção 5.5.1) |
| Trocar horário de sessão com venda, cancelar sessão | Pedido ao Admin (a equipe usa os fluxos atuais, com aviso aos compradores) |

Antes da aprovação (rascunho ou recusado) tudo é livre. O banco confere a regra (`save_event_with_sessions` compara o que mudou e recusa com `ORG_ESTADO` o que precisa de pedido).

### 6.5 Cortesias (decisão 13)

O organizador **não emite nem cancela** cortesias: não há botão de cortesia na área dele, e as funções `issue_courtesy_ticket` / `cancel_courtesy_ticket` continuam só da equipe (recusam o organizador porque ele não está em `staff_profiles`). Ele pede pelo WhatsApp (seção 5.5.2). Motivo do dono e da regra: cortesia não paga taxa de serviço, e emissão livre permitiria vender "por fora" e usar o site só para a portaria. Cortesia vale R$ 0,00 e não entra na conta da parte do organizador.

### 6.6 Dados do comprador que o organizador vê

Por pedido (inclusive cortesias emitidas pela equipe): número do pedido, nome, e-mail, data, sessão, tipos e quantidades, valor dos ingressos, situação (pago, estornado, aguardando decisão, cortesia…), quantos ingressos já entraram, e o pedido de estorno (se houver). **Nunca**: telefone, link do pedido (`public_token`), código dos ingressos, IDs do banco de pagamento, CPF. Sem planilha de compradores nesta entrega (fora de escopo).

---

## 7. Modelo de dados

Tudo aditivo e compatível com o código no ar. Cada tabela nova: RLS ligada, `revoke all ... from public, anon, authenticated`, políticas explícitas abaixo, escrita só por funções `service_role`.

### 7.1 Configuração e chave geral

```sql
create table public.organizer_settings (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default false,              -- área do organizador DESLIGADA ao publicar
  max_session_capacity integer not null default 100 check (max_session_capacity between 1 and 2000),
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
  pix_holder_document text not null check (pix_holder_document ~ '^([0-9]{11}|[0-9]{14})$'),  -- CPF/CNPJ do titular, só dígitos
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
  pix_holder_name text not null,
  pix_holder_document text not null check (pix_holder_document ~ '^([0-9]{11}|[0-9]{14})$'),
  status text not null default 'pendente' check (status in ('pendente','confirmada','recusada','cancelada')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index on public.organizer_pix_change_requests (organizer_id) where status = 'pendente';
```

- Gatilho `forbid_staff_and_organizer`: recusa inserir em `organizer_profiles` quem está em `staff_profiles`, e o inverso.
- RLS `organizer_profiles`: `select` para `authenticated` quando `user_id = auth.uid() and public.is_organizer()` (o próprio, com o login verificado por código). Admin lê por função (não por RLS), para a chave PIX não ficar exposta a toda a equipe.
- Troca de chave PIX: o organizador pede (com o login verificado), recebe e-mail de aviso, e o Admin confirma em **Organizadores → Contas** antes do próximo repasse. Defesa contra quem roubar a conta e trocar a chave.
- CPF/CNPJ do titular (decisão 14): validado pelos dígitos verificadores no servidor; nas telas aparece mascarado (`•••.456.789-••`), completo só na tela de repasse do Admin não desenvolvedor; nunca em logs, e-mails ou planilhas. O Admin confere, ao confirmar a conta ou a troca de chave, que o titular é o organizador ou a empresa dele.

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
  email_code_hash bytea,                      -- confirmação do e-mail no cadastro (decisão 17)
  email_code_email text,                      -- e-mail para o qual o código foi enviado
  email_code_expires_at timestamptz,          -- +15 min
  email_code_attempts smallint not null default 0 check (email_code_attempts between 0 and 5),
  email_code_sends smallint not null default 0 check (email_code_sends between 0 and 3),
  email_verified_at timestamptz,
  check (used_at is null or revoked_at is null)
);
```

- Ambas **sem políticas** para `authenticated`: leitura e escrita só por funções (`service_role`).
- Código do e-mail: 6 dígitos de gerador criptográfico, guardado só como hash (com o id do convite no cálculo); 5 tentativas erradas invalidam o código; trocar o e-mail depois de confirmado exige novo código; `accept_organizer_invite` recusa se `email_verified_at` for nulo ou se o e-mail da conta for diferente de `email_code_email`. Os campos do código são apagados quando o convite é usado.
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

### 7.5 Pedidos de estorno, de exclusão e de mudança

(Cortesia não tem pedido no painel: vai pelo WhatsApp, decisão 13.)

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
  kind text not null check (kind in ('repasse','ajuste','devolucao')),
  amount_cents integer not null,        -- repasse: > 0; ajuste: <> 0; devolucao (organizador devolveu): < 0
  pix_date date,                        -- obrigatório no repasse e na devolução
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
  name text not null check (char_length(name) between 3 and 80),
  kind text not null check (kind in ('nacional','estadual','municipal','bancario','extra')),
  source text not null check (char_length(source) between 3 and 120)  -- ex.: 'Lei 662/1949', 'Lei Municipal 1.997/1967'
);
alter table public.business_holidays enable row level security;  -- sem políticas: leitura só por função
```

**Calendário adotado (decisão 20; Salvador – BA):** dia útil = segunda a sexta, fora as datas abaixo.

| Data | Nome | Tipo | Base |
| --- | --- | --- | --- |
| 1º/1 | Confraternização Universal | nacional | Lei 662/1949 (redação da Lei 10.607/2002) |
| móvel (Páscoa − 48 e − 47) | Segunda e terça de Carnaval | bancário | Resolução CMN 4.880/2020, art. 6º, I (ponto facultativo, não feriado: Portaria MGI 11.460/2025) |
| móvel (Páscoa − 2) | Sexta-feira da Paixão | municipal (religioso) | Lei 9.093/1995, art. 2º; Lei Municipal 1.997/1967 (Salvador); listada como feriado nacional na Portaria MGI 11.460/2025 |
| 21/4 | Tiradentes | nacional | Lei 662/1949 (redação da Lei 10.607/2002) |
| 1º/5 | Dia do Trabalho | nacional | Lei 662/1949 (redação da Lei 10.607/2002) |
| móvel (Páscoa + 60) | Corpus Christi | municipal (religioso) e bancário | Lei Municipal 1.997/1967; Resolução CMN 4.880/2020, art. 6º, II |
| 24/6 | São João | municipal (religioso) | Lei Municipal 1.997/1967 |
| 2/7 | Independência da Bahia (Dois de Julho) | estadual | Constituição do Estado da Bahia, art. 6º, § 3º; Lei 9.093/1995, art. 1º, II |
| 7/9 | Independência do Brasil | nacional | Lei 662/1949 (redação da Lei 10.607/2002) |
| 12/10 | Nossa Senhora Aparecida | nacional | Lei 6.802/1980 |
| 2/11 | Finados | nacional | Lei 662/1949 (redação da Lei 10.607/2002) |
| 15/11 | Proclamação da República | nacional | Lei 662/1949 (redação da Lei 10.607/2002) |
| 20/11 | Zumbi e Consciência Negra | nacional | Lei 14.759/2023 |
| 8/12 | Nossa Senhora da Conceição da Praia | municipal (religioso) | Lei Municipal 1.997/1967 |
| 25/12 | Natal | nacional | Lei 662/1949 (redação da Lei 10.607/2002) |

Datas móveis em 2026: Carnaval 16 e 17/2, Sexta-feira da Paixão 3/4, Corpus Christi 4/6. Em 2027: Carnaval 8 e 9/2, Sexta-feira da Paixão 26/3, Corpus Christi 27/5.

**Contam como dia útil** (de propósito): Quarta-feira de Cinzas (bancos abrem às 12h; PIX normal), 24/12 e 31/12, e os pontos facultativos do serviço público (ex.: sexta depois de Corpus Christi, Dia do Servidor). **Não são feriado em Salvador**, apesar de aparecerem em alguns sites de calendário: Aniversário de Salvador (29/3) e São José (19/3, feriado do Ceará). A lei municipal de Salvador usa as 4 vagas de feriado religioso permitidas pela Lei 9.093/1995 (São João, Conceição da Praia, Corpus Christi e Sexta-feira da Paixão).

**Fontes consultadas em 2026-10-13:**
- Portaria MGI nº 11.460/2025 (feriados nacionais e pontos facultativos de 2026): [DOU](https://www.in.gov.br/en/web/dou/-/portaria-mgi-n-11.460-de-29-de-dezembro-de-2025-678388627)
- Resolução CMN nº 4.880/2020, art. 6º (dias não úteis no mercado financeiro: Carnaval e Corpus Christi): [texto](https://www.normasbrasil.com.br/norma/resolucao-4880-2020_406827.html)
- Febraban, expediente bancário no Carnaval de 2026 (fechado segunda e terça; Cinzas a partir das 12h; PIX normal): [notícia](https://portal.febraban.org.br/noticia/4421/pt-br/)
- Constituição do Estado da Bahia, art. 6º, § 3º (Dois de Julho): [Assembleia Legislativa da Bahia](https://www.al.ba.gov.br/fserver/:imagensAlbanet:upload:Constituicao_EGBA_EC-36.pdf)
- Lei Municipal de Salvador nº 1.997/1967 (feriados municipais): [texto](https://www.normasbrasil.com.br/norma/lei-1997-1967-salvador_178349.html)
- Justiça Federal da Bahia, Portaria SJBA-DIREF 30/2026 e 162/2026 (feriados municipais de Salvador em 2026 com a mesma base legal): [notícia](https://www.trf1.jus.br/sjba/noticias/justica-federal-da-bahia-divulga-portaria-de-feriados-e-pontos-facultativos-para-2026-), [portaria](https://www.trf1.jus.br/sjba/conteudo/Portaria%20SJBA-DIREF%20162-2026.pdf)
- Prefeitura de Salvador, Decreto 41.381/2026 (Carnaval como ponto facultativo municipal, não feriado): [texto](https://www.legisweb.com.br/legislacao/?id=490544)

**Como o calendário é mantido:**
- Uma função de servidor (`src/lib/finance/business-days.ts`) calcula as datas a partir das regras acima (fixas + Páscoa pelo cálculo gregoriano). Testes conferem 2026 e 2027 contra a tabela desta seção.
- A migration da fase 3 grava em `business_holidays` os anos de 2026 a 2030, gerados por essa função, com nome, tipo e base legal. `event_payout_due_date` lê só a tabela.
- **Falha fechada:** se a data de início do prazo cair num ano que ainda não está na tabela, a função devolve vazio e as telas mostram "Prazo a confirmar" (nada de prazo calculado sem feriados).
- **Aviso ao Admin:** a partir de 1º de novembro, a página "Repasses" mostra "Feriados de {ano seguinte} ainda não cadastrados" se faltar o ano seguinte, e "Calendário cadastrado até 31/12/{ano}" sempre no rodapé.
- **Revisão anual (dezembro):** quando sair a portaria do governo federal do ano seguinte, alguém da equipe (ou o desenvolvedor) confere se mudou alguma lei ou se a Prefeitura/Estado antecipou ou mudou algum feriado; mudanças pontuais entram como `kind = 'extra'` por migration, com a fonte. Lembrete no Google Agenda do dono em dezembro, junto dos lembretes que já existem.
- Mudar a tabela não altera repasses já registrados; muda só o prazo calculado de eventos ainda "A pagar".

---

## 8. Funções do banco e mudanças no que existe

Padrão para todas: `set search_path = ''`; `revoke all ... from public, anon, authenticated`; `grant execute ... to service_role` (exceto as marcadas "RLS", que precisam de `grant execute to authenticated` porque são usadas em políticas e só devolvem verdadeiro/falso). As que escrevem recebem `p_actor_user_id` e reconferem papel e dono **dentro** do banco (a verificação do login é conferida antes, pelo helper do servidor com a sessão do usuário; seção 8.1). Erros com prefixos estáveis: `ORG_ACESSO`, `ORG_DONO`, `ORG_ESTADO`, `ORG_CONVITE`, `ORG_DESLIGADO`, `ORG_TARIFA_PENDENTE`, `ORG_PIX_PENDENTE`, `ORG_MUDOU`, `ORG_NADA`, `ORG_DEVOLUCAO`, `ORG_EMAIL`.

### 8.1 Novas — identidade e acesso

| Função | Tipo | O que faz |
| --- | --- | --- |
| `session_is_verified()` | RLS, SECURITY DEFINER (fase 1) | a sessão do token atual (`auth.jwt() ->> 'session_id'`) tem linha válida em `verified_sessions` para `auth.uid()` (seção 11) |
| `my_account_kind()` | RLS, SECURITY DEFINER | `'equipe'`, `'organizador'` ou nulo para `auth.uid()`; não exige o código e não revela mais nada. Usada no login e no `proxy` para mandar à tela do código certa. |
| `is_organizer()` | RLS, SECURITY DEFINER | organizador `ativo`, área ligada **e** `session_is_verified()` |
| `owns_event(p_event_id)` | RLS, SECURITY DEFINER | `is_organizer()` e `events.organizer_id = auth.uid()` e `deleted_at is null` |
| `actor_event_access(p_actor_user_id, p_event_id)` | service_role | `'equipe'`, `'dono'` ou nulo. Base de todas as funções compartilhadas. Organizador: confere `status = 'ativo'`, área ligada e dono. |
| `organizer_access(p_actor_user_id)` | service_role | perfil resumido (status, nome público) ou erro `ORG_ACESSO` |

**Duas etapas dentro de funções `service_role`:** a chave `service_role` não carrega o login do usuário, então o banco não consegue ver a sessão nessas chamadas. Por isso a conferência dessas funções fica no helper do servidor (seção 11.3), que chama `is_staff()`/`is_organizer()` **com a sessão do usuário** antes de usar a `service_role`; e as leituras feitas com a sessão do usuário (RLS) conferem no banco.

### 8.2 Novas — convites, cadastro, pedidos do site

| Função | Quem | O que faz |
| --- | --- | --- |
| `create_organizer_invite(p_admin, p_token_hash, p_kind, p_label, p_request_id, p_target_user_id)` | Admin | grava convite (7 dias / 24 h); pedido do site vira "convidada" |
| `revoke_organizer_invite(p_admin, p_invite_id)` | Admin | revoga se ativo |
| `check_organizer_invite(p_token_hash)` | público via servidor | devolve só `valido` / `invalido` |
| `start_invite_email_code(p_token_hash, p_email, p_code_hash)` | servidor (após limite por IP) | grava hash do código e e-mail; recusa depois de 3 envios |
| `verify_invite_email_code(p_token_hash, p_code_hash)` | servidor | confere código, validade e tentativas; marca `email_verified_at` |
| `accept_organizer_invite(p_token_hash, p_user_id, perfil..., p_terms_version)` | servidor | trava o convite (`for update`), confere validade e e-mail confirmado (igual ao da conta), valida CPF/CNPJ do titular, cria perfil, marca usado, apaga os campos do código, histórico |
| `use_password_reset_invite(p_token_hash)` | servidor | confere e marca usado; devolve o `target_user_id` para o servidor trocar a senha |
| `submit_signup_request(nome, contato, ideia, data, versão)` | servidor (após anti-robô + limite) | grava pedido do site |
| `list_signup_requests(p_admin, p_status)` / `archive_signup_request(p_admin, p_id)` | Admin | — |
| `list_organizers(p_admin)` | Admin | lista; chave PIX e CPF/CNPJ do titular só mascarados (`•••• 1234`); completos só para Admin não desenvolvedor na tela de repasse |
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
| `request_event_change(p_actor, p_event_id, p_details, p_reason)` | dono, evento `aprovado`; mudanças da seção 6.4 que pedem Admin |
| `finish_event_change(p_admin, p_request_id)` | Admin marca o pedido de mudança como feito, depois de aplicar pelos fluxos existentes |

Cortesia: **nenhuma função nova** (decisão 13). `issue_courtesy_ticket` e `cancel_courtesy_ticket` ficam como estão, só da equipe.

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
| `record_organizer_refund_received(p_event_id, p_admin_nao_dev, p_amount_cents, p_pix_date, p_note)` | "Devolução recebida" (seção 10.5); só com saldo negativo e valor ≤ o saldo devido |
| `organizer_overdue_refunds(p_organizer_id)` | usada por `submit_event_for_approval` para recusar com `ORG_DEVOLUCAO` |

### 8.5 Mudanças em funções que já existem

| Função | Mudança |
| --- | --- |
| `is_staff()`, `is_admin()` | desde a fase 1: passam a exigir `session_is_verified()` (sem chave de liga/desliga; a ordem de publicação da seção 11.4 evita trancar a equipe). `staff_profiles_self` continua deixando a pessoa ler a própria linha sem o código. |
| `check_in_ticket` (v3, mesma lista de parâmetros, `p_staff_user_id` passa a significar "quem faz") | trocar a checagem de equipe por `actor_event_access(p_staff_user_id, p_event_id) is not null`. Para **organizador**, ingresso de outro evento devolve `evento_errado` **sem** o nome do outro evento ("Ingresso de outro evento"); equipe continua vendo o nome. `checked_in_by` grava o organizador. Remover a assinatura antiga de 3 parâmetros, se ainda existir. |
| `save_event_with_sessions` | checagem de equipe vira `actor_event_access`; dono só com estado `rascunho`/`recusado`, ou `aprovado` respeitando a seção 6.4 (`ORG_ESTADO`); dono nunca muda `sales_open` por aqui |
| `set_session_sales_open` | dono permitido só com evento `aprovado` |
| `event_is_past`, `public_past_events` | ignoram eventos com `deleted_at` |
| `begin_order_refund`, `accept_paid_order`, `cancel_event_session`, `start_session_refund_batch`, `queue_schedule_change_notice`, `issue_courtesy_ticket`, `cancel_courtesy_ticket`, finanças da taxa | **sem mudança**: continuam só da equipe (o organizador é recusado porque não está em `staff_profiles`) |
| `sendOrderTicketsEmail` (servidor, não é função do banco) | o e-mail do ingresso ganha a linha "Produção: <nome público>" quando o evento tem organizador (decisão 16) |

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
| nome público do organizador na página do evento | — | sem política nova: a página lê por função `public_event_producer(p_event_id)` (RLS, SECURITY DEFINER; devolve só o nome público de evento visível ao público), para não abrir `organizer_profiles` |
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
- **Tarifa do banco** (cobrada sobre o pagamento inteiro) sai inteira da parte do organizador, inclusive a parte cobrada sobre a taxa de serviço (decisões 5 e 19).
- **Espaço** não cobra comissão.

### 10.2 Contas do evento

- **Pedidos que contam:** pedidos do evento que chegaram a ser pagos (`pago`, `estornado`). `aguardando_decisao` fica fora até ser aceito. Cortesias (emitidas só pela equipe) valem 0 e não mexem em nada.
- **Vendido** = soma de `tickets_subtotal_cents` desses pedidos (só ingressos, sem a taxa de serviço).
- **Estornos** = soma de `tickets_subtotal_cents` dos estornados.
- **Contestações** = soma de `tickets_subtotal_cents` dos pagos contestados (registro manual já existente, `order_chargebacks`).
- **Tarifa do banco** = soma de `order_payment_fees.fee_cents` dos pedidos que contam (com o valor atualizado depois de estornos).
- **Sua parte** = vendido − estornos − contestações − tarifa do banco.
- **Já repassado** = soma de `organizer_payout_items` do evento (devoluções do organizador entram negativas).
- **Saldo** = sua parte − já repassado. Negativo = desconto pendente (decisão 15, seção 10.5).

Exemplo **[S: percentuais só ilustrativos; os reais vêm do extrato]**: 10 Inteiras de R$ 50,00 com taxa de 5% ligada. Vendido R$ 500,00. Compradores pagaram R$ 525,00. Cada pedido de 1 Inteira paga R$ 52,50. Tarifa do banco: 6 pagamentos PIX (~0,99% = R$ 0,52 cada) + 4 no cartão (~4,98% = R$ 2,61 cada) = R$ 3,12 + R$ 10,44 = R$ 13,56. Um pedido de cartão foi estornado (R$ 50,00 de ingresso; o banco devolveu a tarifa de R$ 2,61), então a tarifa do evento fica R$ 10,95. Sua parte = 500,00 − 50,00 − 0 − 10,95 = **R$ 439,05**.

### 10.3 Prazo do repasse

- "A pagar" começa no **dia seguinte à última sessão ativa** (mesma data de `event_fee_due_date`, horário de Brasília).
- **Prazo** = 5º dia útil contado a partir desse dia (ele mesmo conta, se for dia útil). Dia útil = segunda a sexta, fora de `business_holidays` (calendário de Salvador com Carnaval, decisão 20, seção 7.9).
- Exemplos: última sessão sexta 23/10/2026 → começa sábado 24/10 → dias úteis 26, 27, 28, 29, 30 → **prazo 30/10**. Última sessão sábado 14/11/2026 → começa domingo 15/11 (feriado) → 16, 17, 18, 19 e (20/11 é feriado) 23 → **prazo 23/11**. Última sessão sábado 20/06/2026 → começa domingo 21/06 → 22, 23, (24/06 São João) 25, 26 e 29 → **prazo 29/06**. Última sessão sábado 06/02/2027 → começa domingo 07/02 → (8 e 9/02 Carnaval) 10 (Cinzas conta), 11, 12, 15 e 16 → **prazo 16/02/2027**.
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
| Desconto pendente | saldo < 0, até 30 dias | "−R$ X será descontado do próximo repasse" |
| Devolução pendente | saldo < 0 há mais de 30 dias sem repasse que o abata | "Devolva R$ X por PIX ao Espaço Byla até dd/mm" (prazo de 10 dias; seção 10.5) |

### 10.5 Estorno ou contestação depois do repasse (decisão 15)

1. O evento fica com saldo negativo e aparece "Desconto pendente" para o organizador e o Admin, com o motivo (estorno do pedido Nº … ou contestação).
2. No próximo repasse do **mesmo organizador**, `record_organizer_payout` abate o valor automaticamente (linha negativa do evento antigo).
3. Se em **30 dias** (contados do dia em que o saldo ficou negativo) não houver repasse que abata tudo, a situação vira "Devolução pendente": o organizador recebe e-mail e vê no painel o valor, a chave PIX do Espaço (`ORGANIZER_REFUND_PIX_KEY` no ambiente do servidor; nunca no Git) e o prazo de **10 dias**.
4. Quando o PIX chega, o Admin (não desenvolvedor) registra **"Devolução recebida"** (valor e data), lançamento imutável que zera o saldo.
5. Passado o prazo, o Admin vê "Devolução atrasada" e decide fora do sistema (conversa, suspensão da conta). O organizador não consegue enviar evento novo para aprovação enquanto houver devolução atrasada (`ORG_DEVOLUCAO`).

---

## 11. Verificação em duas etapas (código por e-mail)

Revista em 2026-10-14 (decisão 9). Plano de implementação da fase 1: `docs/superpowers/plans/2026-10-14-codigo-email-equipe.md`.

### 11.1 Como funciona

1. A pessoa entra com e-mail e senha (Supabase Auth, como hoje). O login cria uma **sessão** do Supabase; o token dela traz o campo `session_id`.
2. Se o navegador tem um **aparelho lembrado** válido daquela mesma conta (cookie `httpOnly`, `Secure`, `SameSite=Lax`, caminho da área, 30 dias), a sessão é marcada como verificada na hora, sem e-mail.
3. Senão, o servidor gera um código de 6 dígitos (gerador criptográfico), guarda só o **hash com sal** e manda o código ao e-mail da conta. Vale **10 minutos**; **5 tentativas** erradas invalidam o código; um código novo invalida o anterior; reenvio só depois de 60 s; no máximo 5 códigos por hora e 10 por dia por conta (mais um teto geral de 40 por dia para todo o site).
4. Código certo → linha em `verified_sessions` (sessão + usuário + validade). Com "Lembrar este aparelho por 30 dias" (marcado por padrão), o servidor cria um token aleatório de 32 bytes, guarda só o hash em `trusted_devices` e grava o cookie.
5. Validade da sessão verificada: 30 dias com aparelho lembrado; 12 horas sem. Quando vence, o aparelho lembrado reverifica sozinho; sem ele, novo código.
6. Sair apaga as sessões verificadas da conta (o aparelho continua lembrado até vencer ou ser esquecido).

Tabelas (RLS ligada, **sem nenhuma política**: só funções `security definer` e `service_role`): `login_email_codes`, `verified_sessions`, `trusted_devices`. Genéricas por usuário: a fase 2 só acrescenta "é organizador" à função que diz quem pode usar o código (`login_code_eligible`).

### 11.2 Telas

- **Entrar:** e-mail e senha (sem mudança) → `/equipe/verificar` (organizador: `/organizador/verificar`): "Enviamos um código de 6 dígitos para o seu e-mail" com o e-mail mascarado (`fu***@ex***.com`), campo numérico com preenchimento automático do celular, caixa "Lembrar este aparelho por 30 dias", "Reenviar código" (espera de 60 s) e "Sair".
- **Meus aparelhos** (fase 2, junto com a área do organizador): lista dos aparelhos lembrados (navegador e data) com "Esquecer"; Admin pode esquecer os de outra conta. Até lá, o dono usa o SQL do plano (seção "Emergência").

### 11.3 Onde é conferido

1. **`proxy.ts`** (conforto, não segurança): `/equipe/*` sem login → `/equipe/login`; com login de equipe não verificado → `/equipe/verificar`; verificado em `/equipe/login` ou `/equipe/verificar` → `/equipe`. Lê o estado por `staff_access_status()` (com a sessão do usuário).
2. **Servidor (segurança):** `requireStaffUser()` / `assertStaff()` / `requireFinanceAdmin()` / `/api/check-in` chamam `is_staff()` **com a sessão do usuário**, e `is_staff()` passou a exigir a sessão verificada. Na fase 2, o helper `getActor()` (`src/lib/auth/actor.ts`) generaliza isso para `requireOrganizer()` / `requireEventAccess()`.
3. **Banco:** `is_staff()`, `is_admin()` (fase 1) e `is_organizer()` (fase 2) exigem `session_is_verified()`. Toda política RLS que usa `is_staff()` passa a exigir o código sem mudar a política. Funções `service_role` não enxergam a sessão (seção 8.1), por isso o helper do servidor é obrigatório antes delas, e um teste de inventário (seção 16) confere isso.

### 11.4 Implantação para a equipe atual (sem trancar ninguém)

1. **Antes:** conferir que cada conta da equipe usa um e-mail que a pessoa realmente abre (o código vai para lá).
2. **Migration 1** (`staff_email_code`): só cria tabelas e funções; nada muda para o site no ar.
3. **Publicar o código** novo: a tela do código passa a valer pelo `proxy` e pelo layout da equipe.
4. **Migration 2** (`staff_email_code_enforce`): `is_staff()`/`is_admin()` passam a exigir a sessão verificada no banco. Logo depois, cada conta entra e digita o código uma vez.
5. **Perdeu acesso ao e-mail:** outro Admin (ou o dono) troca o e-mail da conta no painel do Supabase. **Emergência** (e-mail fora do ar, ninguém consegue entrar): o dono insere uma linha em `verified_sessions` pelo SQL Editor do Supabase (passo a passo no plano). Não existe chave de ambiente para desligar a verificação (seria uma porta dos fundos).
6. Contas novas da equipe (criadas pelo dono no painel) usam o mesmo fluxo no primeiro login.

---

## 12. Telas (celular primeiro, textos para quem opera)

### 12.1 Público

- **Rodapé:** link "Quero fazer meu evento" ao lado de "Termos de compra".
- **Página inicial:** no fim, bloco discreto "Quer fazer seu evento no Espaço Byla? → Fale com a gente".
- **`/quero-fazer-meu-evento`:** formulário da seção 5.1; link para `/termos-organizador` ("Veja como funciona para organizadores").
- **`/termos-organizador`:** texto da seção 13 (público, para ler antes de aceitar).
- **Página do evento:** "Produção: <nome público>" abaixo do local, nos eventos de organizador (decisão 16). Eventos do próprio Espaço não mostram a linha. O e-mail do ingresso traz a mesma linha.

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

- **Evento** — formulário (travado em "Em análise"; depois de aprovado, os campos da seção 6.4 que pedem Admin ficam travados com o botão "Pedir mudança"); faixa de estado: "Em análise: o Espaço Byla vai conferir e responder em breve." / "Recusado: <motivo>. Ajuste e envie de novo." / "Aprovado e à venda."
- **Vendas** — por sessão: vendidos, disponíveis, "Pausar vendas" / "Reabrir vendas".
- **Pedidos** — busca por nome ou número; cada pedido: Nº, nome, e-mail, sessão, itens, situação, "2 de 3 já entraram", botão "Pedir estorno" (não aparece em cortesia). Cortesias emitidas pela equipe aparecem com o selo "Cortesia". Aviso no topo: "Use estes dados só para a operação deste evento (Termos do organizador, item 9)." Lembrete: "Precisa de cortesias? Peça à equipe do Espaço Byla pelo WhatsApp."
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

**Minha conta:** dados, nome público, chave PIX e CPF/CNPJ do titular (mascarados) + "Trocar chave PIX" (fase 3, decisão 21; aviso: "A troca precisa ser confirmada pelo Espaço Byla antes do próximo repasse"; na fase 2 aparece só "Para trocar a chave PIX, fale com o Espaço Byla"), aparelhos lembrados ("Esquecer"), Termos aceitos (versão e data).

### 12.3 Painel da equipe

Menu (Admin): **Eventos** · **Aprovações** (com número de pendências) · **Organizadores** · **Repasses** · **Taxa de serviço**. Secretaria: **Eventos** (com a faixa de pedidos de estorno).

- **Aprovações:** abas "Eventos" (cards com prévia, lista de conferência — inclusive o nome público que vai aparecer como "Produção" —, "Aprovar e publicar" / "Aprovar sem publicar" / "Recusar"), "Mudanças" (pedidos da seção 6.4: a equipe aplica a mudança pelo editor normal e marca "Feito", ou "Recusar" com motivo) e "Exclusões".
- **Organizadores:** abas "Pedidos do site" (Nova/Convidada/Arquivada; "Gerar convite", "Arquivar"), "Convites" (gerar, copiar, WhatsApp, revogar) e "Contas" (status, eventos, "Suspender", "Esquecer aparelhos lembrados", "Link para nova senha", trocas de PIX pendentes com "Confirmar"/"Recusar").
- **Eventos (lista e página):** selo "Organizador: <nome público>" nos eventos de organizador; faixa "Pedido de estorno do organizador" no pedido. O botão "Emitir cortesia" de hoje serve também para eventos de organizador (a equipe emite quando ele pede pelo WhatsApp). Tudo o mais igual a hoje.
- **Repasses** (`/equipe/repasses`): totais "A pagar", "Atrasados", "Pago no período", "A receber de organizadores"; uma linha/card por evento de organizador (organizador, data, sua parte, situação, prazo) e "Marcar como pago" (Admin não desenvolvedor) com a chave PIX completa e o titular (nome e CPF/CNPJ completos) só nessa tela. Eventos com saldo negativo mostram "Desconto pendente", "Devolução pendente até dd/mm" ou "Devolução atrasada", com o botão "Devolução recebida" (Admin não desenvolvedor; valor e data do PIX).
- **Equipe → Segurança da equipe** (Admin, fase 2): aparelhos lembrados de cada conta; "Esquecer aparelhos" de outra conta.

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

- A conta é criada só por convite do Espaço Byla. Ela é pessoal: não compartilhe a senha nem o acesso ao seu e-mail.
- A verificação em duas etapas é obrigatória: ao entrar num aparelho novo, enviamos um código ao seu e-mail. Só marque "Lembrar este aparelho" em aparelho seu. Se perder o acesso ao e-mail, fale com o Espaço Byla.
- No cadastro, confirmamos o seu e-mail com um código. Use um e-mail que você acessa: é por ele que avisamos sobre aprovações, pedidos e repasses.
- Mantenha seus dados e sua chave PIX corretos. Trocar a chave PIX precisa da confirmação do Espaço Byla antes do próximo repasse.
- Seu nome público aparece como "Produção: <nome público>" na página do evento e no e-mail do ingresso dos compradores.
- Você responde pelo que for feito na sua conta. Se suspeitar de uso indevido, avise na hora.

**3. Como o evento vai ao ar**

- Você cria o evento como rascunho e envia para aprovação. O evento só aparece no site e vende depois que o Espaço Byla aprova.
- O Espaço Byla pode recusar um evento, informando o motivo, e pode tirar do ar um evento que descumpra estes termos ou a lei.
- Depois de aprovado, algumas mudanças (nome, local, preço de sessão já vendida, redução de lugares, troca de horário, cancelamento de sessão) dependem de nova confirmação do Espaço Byla, porque afetam quem já comprou.

**4. Eventos que não aceitamos**

Eventos ilegais ou que incentivem crime; discriminação ou discurso de ódio; conteúdo sexual explícito; jogos de azar, rifas ou sorteios sem autorização; esquemas de pirâmide ou "investimento"; venda de produtos proibidos; eventos que coloquem pessoas em risco; eventos que usem marca, nome ou obra de terceiros sem autorização; e eventos com informação enganosa sobre atrações, datas ou preços.

**5. Ingressos e regras para quem compra**

- Os ingressos seguem os Termos de compra do site, que valem para todos os eventos: compra, entrada, meia-entrada, troca de horário, cancelamento, desistência e reembolso. Você não pode prometer ao comprador regras diferentes.
- A meia-entrada segue a lei e custa metade da inteira da mesma sessão.
- A lotação de cada sessão não pode passar do limite combinado com o Espaço Byla.
- A venda, o pagamento e os reembolsos são feitos pelo Espaço Byla, em nome de quem o comprador paga.
- **Cortesias** (ingressos gratuitos) são emitidas só pela equipe do Espaço Byla. Se precisar, peça pelo WhatsApp informando a sessão, a quantidade e o nome e e-mail de cada convidado. Cortesias não entram na conta da sua parte.

**6. Dinheiro: o que você recebe**

- Todo pagamento cai na conta do Espaço Byla no banco responsável pelo pagamento. O Espaço Byla **não cobra comissão** sobre as suas vendas.
- O site pode cobrar do comprador uma **taxa de serviço** ({percentual}% por item, mínimo {mínimo}), que paga a manutenção do site. Ela é paga pelo comprador e **não sai da sua parte**.
- O banco responsável pelo pagamento cobra uma **tarifa em cada pagamento** (PIX ou cartão). Essa tarifa **sai da sua parte**, pelo **valor real e inteiro** cobrado em cada pagamento, inclusive a parte que o banco cobra sobre a taxa de serviço (por exemplo: num pagamento de R$ 52,50, sendo R$ 50,00 de ingresso e R$ 2,50 de taxa de serviço, toda a tarifa daquele pagamento sai da sua parte). Os valores de cada tipo de pagamento são definidos pelo banco e podem mudar.
- **Sua parte** = valor dos ingressos vendidos − estornos − contestações no cartão − tarifas do banco.
- No painel do evento você acompanha: vendido, tarifa do banco, estornos, sua parte e a situação do repasse.

**7. Repasse**

- O Espaço Byla paga sua parte por PIX, na chave cadastrada, **em até 5 dias úteis** contados do dia seguinte à última sessão do evento. Dias úteis: segunda a sexta, exceto feriados nacionais, o Dois de Julho, os feriados municipais de Salvador e a segunda e a terça de Carnaval (dias sem expediente bancário). O painel do evento mostra a data-limite já calculada.
- Ao registrar o pagamento, o Espaço Byla envia um e-mail com valor e data. O registro não pode ser apagado.
- O titular da chave PIX deve ser você (CPF) ou a sua empresa (CNPJ). Pedimos o nome e o CPF ou CNPJ do titular no cadastro para conferir isso e para a nossa contabilidade. Se a lei exigir, você emite nota fiscal ou recibo do valor recebido.
- Se houver tarifa ainda em conferência, o repasse pode ser feito com o valor conferido até ali e o restante acertado no próximo repasse.

**8. Estornos, contestações e cancelamentos**

- Pedidos de reembolso dos compradores são analisados e feitos pelo Espaço Byla, conforme os Termos de compra (por exemplo: desistência em até 7 dias da compra e pelo menos 48 horas antes da sessão; troca de horário; sessão cancelada; pagamento sem lugar).
- Você pode pedir o estorno de um pedido do seu evento pelo painel. O Espaço Byla decide e faz o estorno, que devolve 100% ao comprador, incluindo a taxa de serviço.
- Todo estorno e toda contestação no cartão diminuem a sua parte no valor dos ingressos. Se o banco não devolver a tarifa daquele pagamento, ela continua descontada.
- **Estorno ou contestação depois do repasse:** o valor é descontado do seu próximo repasse. Se em 30 dias não houver repasse que cubra esse valor, você devolve o valor por PIX ao Espaço Byla em até 10 dias depois do aviso. Enquanto houver devolução atrasada, você não consegue enviar evento novo para aprovação.
- Para cancelar uma sessão ou o evento depois de vender, peça pelo painel. Todos os compradores recebem 100% de volta, e não há repasse sobre pedidos estornados.

**9. Dados dos compradores (LGPD)**

- Você vê nome e e-mail de quem comprou ingressos dos seus eventos, e a situação dos pedidos, **só para operar o evento** (por exemplo, conferir a lista de entrada ou avisar sobre uma mudança no evento).
- É proibido: usar esses dados para propaganda ou para outros eventos sem autorização da pessoa; vender, emprestar ou publicar os dados; copiar os dados para listas ou planilhas além do necessário para o evento.
- Guarde com segurança qualquer cópia e apague em até 90 dias depois do evento.
- Se houver vazamento ou acesso indevido, avise o Espaço Byla em até 24 horas.
- O Espaço Byla é o responsável pelos dados perante os compradores; você atua seguindo estas instruções. O Espaço Byla pode suspender o acesso se houver uso indevido.

**10. Portaria**

- Você pode conferir os ingressos dos seus eventos pelo leitor de QR Code do site, com a sua conta (ela é pessoal; não há contas extras de portaria). Se precisar de ajuda na entrada, combine com o Espaço Byla. Cada QR Code vale uma entrada; o site recusa ingressos de outro evento, de outra sessão ou de sessão cancelada.
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

**[S]** Pedir a quem cuida da parte jurídica e ao contador uma leitura antes de aprovar o primeiro evento real de organizador (os textos vão ao ar com a fase 2, decisão 23), em especial: papel do organizador perante a LGPD (operador x controlador), documento fiscal do repasse e a cláusula de devolução depois do repasse (lista completa na seção 21.1).

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
| Organizador | saldo negativo virou "Devolução pendente" (seção 10.5) | "Devolução pendente: R$ X até dd/mm" |
| Organizador | troca de chave PIX pedida (para o e-mail da conta) e confirmada | "Sua chave PIX foi alterada" |
| Organizador | código de confirmação do e-mail no cadastro (decisão 17; fora do teto de 10/dia, limitado a 3 por convite) | "Seu código do Espaço Byla Eventos" (o código vai no corpo, nunca no assunto) |
| Equipe e organizador | código de acesso ao entrar em aparelho novo (decisão 9; fora do teto de 10/dia; até 5 por hora e 10 por dia por conta, 40 por dia no site) | "Seu código de acesso" (o código vai no corpo, nunca no assunto) |
| Comprador | e-mail do ingresso já existente | ganha a linha "Produção: <nome público>" em eventos de organizador (decisão 16) |
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
  - "**Na conta de organizador:** nome, nome público, e-mail (confirmado por código), telefone, chave PIX, nome e CPF ou CNPJ do titular da chave e registros de acesso, usados para a conta, a segurança, o pagamento do organizador e obrigações fiscais e contábeis. O nome público aparece na página dos eventos do organizador."
- **"Com quem compartilhamos"** — novo item, logo depois de "o banco responsável por processar o pagamento":
  - "**o organizador do evento**, quando o evento for produzido por um organizador parceiro (indicado como "Produção" na página do evento e no e-mail do ingresso): apenas o seu nome, o seu e-mail e a situação do seu pedido e dos ingressos (inclusive se já foram usados na entrada), para a operação daquele evento — por exemplo, conferir a entrada ou avisar sobre mudanças. O organizador é obrigado, por contrato, a usar esses dados só para isso, a não enviar propaganda e a apagá-los depois do evento. Telefone, CPF e dados de pagamento nunca são compartilhados com o organizador."
- **"Para que usamos"** — novo item: "Analisar pedidos para fazer eventos e administrar as contas de organizadores, inclusive o pagamento da parte deles."
- **"Por quanto tempo guardamos"** — acrescentar: "Pedidos para fazer evento são apagados até 6 meses depois de respondidos. Dados da conta de organizador ficam guardados por até {5} anos depois do fim da parceria, para obrigações fiscais e contábeis."
- **"Segurança"** — trocar "acesso restrito à equipe do Espaço Byla" por "acesso restrito à equipe do Espaço Byla e, para os próprios eventos, aos organizadores parceiros, sempre com verificação em duas etapas".

### 15.2 Termos de compra — nova versão

`TERMS_VERSION` muda; na seção "Quem vende", acrescentar: "Alguns eventos são produzidos por organizadores parceiros, indicados como "Produção" na página do evento e no e-mail do ingresso. Mesmo nesses casos, a venda, o pagamento, o atendimento e os reembolsos são feitos pelo Espaço Byla, conforme estes termos." Nenhuma outra regra muda.

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
| Roubo de conta | Código por e-mail obrigatório em aparelho novo (só hash com sal no banco, 10 min, 5 tentativas, limites de envio); aparelho lembrado por cookie `httpOnly` com só o hash no banco; senha mínima de 12; mensagens genéricas no login; limites de tentativa do Supabase Auth; aviso por e-mail em troca de chave PIX. |
| Troca da chave PIX para desviar repasse | Troca precisa de confirmação do Admin; e-mail ao organizador; a tela de repasse mostra "chave alterada em dd/mm"; `ORG_PIX_PENDENTE` bloqueia repasse com troca em aberto. |
| Server Action chamada por POST direto | Cada ação chama o helper dentro dela; teste de inventário (16.3). |
| Ação sem o código | Helper chama `is_staff()`/`is_organizer()` com a sessão do usuário, e o banco exige `session_is_verified()`. |
| Spam no formulário público | Turnstile (falha fechada), `consume_rate_limit` (3/h por IP, 30/dia total), tamanhos máximos, nenhum e-mail para quem pede, aviso à equipe agrupado. |
| Conteúdo malicioso no evento (XSS, phishing) | React escapa o texto; e-mails escapam HTML; capa só `https` [V]; fotos pelo envio existente; aprovação do Admin e histórico de mudanças depois da aprovação. |
| Organizador some com o dinheiro / evento falso | Dinheiro fica com o Espaço até depois do evento; aprovação prévia; repasse só depois da última sessão. |
| Cortesia usada para fugir da taxa | Organizador não emite cortesia (decisão 13): só a equipe, pelas funções que já recusam quem não está em `staff_profiles`. |
| E-mail errado ou de outra pessoa no cadastro | Código de 6 dígitos (só o hash guardado, 15 min, 5 tentativas, 3 envios por convite); conta criada só com o e-mail confirmado. |
| CPF/CNPJ do titular exposto | Mascarado nas telas, completo só na tela de repasse do Admin não desenvolvedor; nunca em logs, e-mails, planilhas ou histórico. |
| Nome público usado para enganar comprador | Nome público é revisado pelo Admin na aprovação de cada evento; texto escapado; até 80 caracteres. |
| Admin registra repasse falso | Registro imutável, e-mail ao organizador a cada repasse, conta do desenvolvedor não registra dinheiro. Limite honesto: quem administra o banco consegue burlar qualquer regra. |
| Emergência (abuso em andamento) | `organizer_settings.enabled = false` desliga toda a área do organizador na hora; suspensão por conta. |

### 16.2 Regras gerais

- `service_role` só em módulos `server-only` [V]. Criação de conta e troca de senha por link usam a API de administração do Supabase Auth, só no servidor.
- Erros ao usuário são genéricos (`ActionError` via `runAction`); detalhe só no log, **sem** nome, e-mail, telefone, chave PIX, token ou código do ingresso.
- Toda entrada validada no servidor: tipos, formatos e tamanhos (seções 5 e 7).
- Nenhuma dependência nova: criação de contas já está no `@supabase/supabase-js`; código e token com `node:crypto`; e-mail pelo serviço já usado.
- CSP: nada novo de terceiros.

### 16.3 Testes de segurança obrigatórios

- **Inventário:** teste que lê `src/app/organizador/**/actions.ts`, `src/app/equipe/**/actions.ts` e `route.ts` e falha se alguma função exportada não chamar um helper de acesso (`requireOrganizer`, `requireEventAccess`, `requireStaffUser`, `assertStaff`, `requireFinanceAdmin`).
- **Matriz no banco:** para cada função nova ou alterada, chamar como anônimo, organizador A, organizador B (dono de outro evento), organizador suspenso, secretaria, Admin desenvolvedor e Admin; conferir aceita/recusa conforme a seção 4.2.
- **RLS com tokens:** organizador com sessão não verificada não lê nada; verificado lê só os próprios eventos/sessões/tipos/fotos e nunca `orders`/`tickets`; equipe com sessão não verificada não lê nada restrito (desde a fase 1).
- **Cortesia:** organizador chamando `issue_courtesy_ticket` / `cancel_courtesy_ticket` (direto ou por qualquer ação) é recusado; a área do organizador não tem ação de cortesia (o teste de inventário confere).

---

## 17. Plano de testes

1. **Unitários (Vitest):** calendário de Salvador (datas de 2026 e 2027 da seção 7.9, Páscoa, Carnaval, Cinzas contando como dia útil); dias úteis e prazo (exemplos da seção 10.3, virada de dia em Brasília com servidor em UTC, ano sem calendário → "Prazo a confirmar"); contas do organizador (seção 10.2, com estorno, contestação, tarifa pendente, saldo negativo, cortesia valendo 0); desconto pendente → devolução pendente aos 30 dias → prazo de 10 dias (seção 10.5); token do convite e código do e-mail (geração, hash, formato, validade); CPF/CNPJ (dígitos verificadores, máscara); validações dos formulários; quais campos de evento aprovado pedem Admin (seção 6.4); linha "Produção" no e-mail do ingresso (com e sem organizador); textos de situação do repasse; leitura da resposta do banco de pagamento para tarifa (formatos esperados e ausentes).
2. **Banco** (transação revertida, no padrão de `scripts/db-tests/*.mjs`): estados do evento e gatilho de publicação; dono imutável; convite usado duas vezes ao mesmo tempo; convite vencido/revogado; código do e-mail errado 5 vezes, vencido e reenviado demais; cadastro sem e-mail confirmado ou com CPF/CNPJ inválido; check-in de evento alheio sem nome; pedido de estorno duplicado; `save_event_with_sessions` do dono recusando, em evento aprovado, nome, preço vendido, redução de lugares e troca de horário (e aceitando descrição, fotos e sessão nova); pedido de mudança feito/recusado; exclusão com e sem vendas; repasse com tarifa pendente, troca de PIX pendente, valor mudado, duplo clique, desconto de outro evento; devolução recebida zerando o saldo; envio para aprovação recusado com devolução atrasada; registros imutáveis até para `service_role`; matriz da seção 16.3.
3. **Servidor:** cada ação e rota recusa anônimo, conta sem duas etapas, organizador de outro evento e (quando couber) secretaria e desenvolvedor, inclusive por POST direto (mesmo estilo de `tests/api/check-in-route.test.ts`).
4. **Teste do banco de pagamento** (fase 3, credenciais de teste): seção 9, item 1.
5. **Telas (local, dados falsos):** cadastro completo no celular (com código do e-mail e CPF/CNPJ), código de acesso e aparelho lembrado, criar → enviar → aprovar → "Produção" na página do evento → vender (pagamento de teste) → cortesia emitida pela equipe aparece na lista do organizador → pedir mudança → pedir estorno → estornar → painel financeiro → marcar repasse → estorno depois do repasse vira desconto pendente.
6. **Produção (só leitura, depois de cada publicação):** com a área desligada, nada muda para compradores e equipe; depois de ligar, o dono faz um convite de teste para uma conta própria, cria um evento de teste, aprova, confere que aparece, e exclui em seguida.

---

## 18. Publicação em fases

Cada fase tem plano próprio em `docs/superpowers/plans/`, migration aditiva com "pode" do dono (projeto Espaço Byla Eventos, fingerprint conferido) e deploy com "pode".

**Fase 1 — Código por e-mail para a equipe** (≈1–1,5 dia; plano `2026-10-14-codigo-email-equipe.md`)
Tabelas `login_email_codes`, `verified_sessions`, `trusted_devices`; tela `/equipe/verificar`; e-mail do código; aparelho lembrado por 30 dias; `is_staff()`/`is_admin()` exigindo sessão verificada (migration separada, aplicada depois do deploy, seção 11.4); `/api/check-in` passando a usar `is_staff()`; limpeza diária no cron `keep-alive`. "Meus aparelhos" e "Segurança da equipe" ficam para a fase 2. Independe do resto e já melhora a segurança de hoje.

**Fase 2 — Contas de organizador, eventos e aprovação** (≈5–7 dias; pode ser dividida em 2a e 2b)
- 2a: "Quero fazer meu evento", convites, cadastro (código do e-mail, CPF/CNPJ do titular), área do organizador, eventos próprios, aprovação, regras de mudança depois da aprovação e "Pedir mudança", `organizer_id` e mudanças de RLS/funções, "Produção" na página do evento e no e-mail do ingresso, Termos do organizador, nova Política de Privacidade e Termos de compra, e-mails de aprovação.
- 2b: pedidos (compradores e cortesias) do organizador, portaria só dos próprios eventos, pedidos de estorno e de exclusão, histórico. Sem cortesia na área do organizador (decisão 13).
- Publicada com `organizer_settings.enabled = false`; o dono liga quando quiser. Termos do organizador, nova Política de Privacidade e novos Termos de compra sobem no mesmo deploy (decisão 23).

**Fase 3 — Financeiro do organizador e repasses** (≈3–4 dias)
Teste do banco de pagamento (seção 9) → `order_payment_fees` e captura → painel "Financeiro" do organizador → `organizer_payouts` → página "Repasses" → feriados e prazo → desconto pendente e devolução (seção 10.5) → avisos de atraso → troca de chave PIX pedida pelo organizador e confirmada pelo Admin (decisão 21). Fórmula da tarifa (decisão 19) e calendário de Salvador (decisão 20, seção 7.9) já definidos.

**Regra de ordem [R]:** o primeiro evento real de organizador só é aprovado depois da fase 3 no ar, para o painel e o prazo de repasse prometidos nos Termos existirem desde a primeira venda.

---

## 19. Fora de escopo

- Divisão automática do pagamento (split) ou repasse automático.
- Cadastro aberto de organizador (sem convite).
- Subcontas de portaria do organizador (decisão 18).
- Cortesia emitida pelo organizador e tela "Pedir cortesia" (decisão 13: pedido pelo WhatsApp; a tela pode entrar depois se o volume crescer).
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
7. **Devolução que não chega:** quando o organizador não devolve no prazo (seção 10.5), o sistema só bloqueia novos envios para aprovação; cobrar fica com o Espaço, fora do site.
8. **Mais dados pessoais guardados:** CPF/CNPJ do titular passa a existir no banco (decisão 14); mitigado com máscara, acesso mínimo e prazo de guarda na Política de Privacidade.
9. **Dependência do e-mail para entrar (decisão 9):** se o serviço de e-mail falhar ou o limite diário acabar, ninguém entra em aparelho novo (aparelhos lembrados continuam entrando). Mitigação: códigos têm prioridade sobre avisos, volume pequeno, e procedimento de emergência pelo SQL Editor (seção 11.4). Código por e-mail é mais fraco que aplicativo (quem invadir o e-mail passa das duas etapas); o dono aceitou em troca da simplicidade.

---

## 21. Perguntas para o dono

Nenhuma pergunta em aberto. As perguntas 1 a 9 foram respondidas em 2026-10-13 (1A, 2C, 3A, 4A, 5A, 6A, 7A, 8A, 9A) e viraram as decisões 12 a 20 (seção 2.1). As 3 perguntas do plano da fase 2 foram respondidas em 2026-10-14 (1A, 2A, 3B) e viraram as decisões 21 a 23.

### 21.1 Revisões recomendadas antes do primeiro evento real de organizador (jurídico e contador)

Não bloqueiam o desenvolvimento nem a publicação da fase 2 (decisão 23: os textos vão ao ar junto com ela), mas o dono deve pedir e ajustar o que vier delas **antes de aprovar o primeiro evento real de organizador** (que só acontece depois da fase 3). Ajustes viram nova versão dos Termos/Política:

1. **Jurídico:** papel do organizador perante a LGPD (operador x controlador) e o texto do item 9 dos Termos do organizador.
2. **Jurídico:** cláusula de devolução depois do repasse (item 8: desconto em 30 dias, devolução por PIX em 10 dias) e a de suspensão/encerramento (item 14).
3. **Contador:** documento fiscal do repasse (nota ou recibo do organizador) e uso do CPF/CNPJ do titular (decisão 14).
4. **Contador:** confirmar o calendário de dias úteis da seção 7.9 (Salvador com Carnaval) para o compromisso de "5 dias úteis".