# Espaço Byla Eventos — Design do MVP

**Data:** 2026-09-17  
**Status:** aprovado pelo usuário (2026-09-17)  
**Produto:** Espaço Byla Eventos  
**Repo:** público (portfólio), sem PII

## 1. Problema e objetivo

O Espaço Byla vende ingressos de eventos/espetáculos. Hoje depende de Sympla/Shotgun (taxa alta de marketplace) ou de listas manuais frágeis em eventos pequenos.

**Objetivo do MVP:** plataforma própria de venda e controle de ingressos — como um site de ingressos “normal” (vários eventos, checkout online, QR na porta) — exclusiva do Espaço Byla, com taxa de marketplace ≈ 0 (apenas custo do meio de pagamento, se houver), lista auditável e operação simples para Admin/secretaria.

Este projeto é **novo e separado** do Byla Financeiro. Reutiliza disciplina e práticas; **não** copia dados reais nem acopla ao Financeiro na v1.

## 2. Decisões de escopo (aprovadas)

| Tema | Decisão |
|------|---------|
| Modelo | Plataforma multi-evento do Espaço Byla (não landing de um show só) |
| Compra | Checkout 100% no site |
| Operadores | Só equipe Byla (Admin e secretaria); sem produtores externos |
| Tipos | Inteira, meia; cortesia opcional (emitida pela equipe) |
| Porta | Check-in por QR no celular |
| Página | Link público compartilhável + home de eventos ativos |
| Dinheiro | Comprador paga com qualquer banco/app; valor cai na conta do Espaço Byla |
| Nome | Espaço Byla Eventos |
| GitHub | Público, zero PII |
| Abordagem | Completa na v1: comprar → pagar → ingresso QR → check-in → painel |

### Fora do MVP

- Produtores externos / multi-organizador
- Integração com Byla Financeiro
- Conciliação automática linha a linha com extrato bancário
- “Marcar pago na mão” como fluxo principal
- Lotes com preço por fase (pode entrar depois se necessário)
- Conta de comprador com histórico (compra sem login da equipe)

## 3. Personas e papéis

**Comprador (público)**  
Sem login de equipe. Abre link → escolhe evento → compra → paga → vê/recebe ingresso com QR.

**Equipe Espaço Byla (Admin e secretaria)**  
Com login. Cria/edita eventos, define preços e capacidade, vê lista, cancela ingressos, faz check-in na porta.

Na v1, Admin e secretaria compartilham as mesmas capacidades de operação (incluindo check-in). Diferenciação fina de permissões pode vir depois se a casa pedir.

## 4. Fluxos principais

### 4.1 Comprar

1. Pessoa acessa a home ou o link direto do evento.
2. Vê data, local, descrição, tipos e preços.
3. Escolhe inteira e/ou meia (cortesia não fica à venda aberta no site).
4. Informa nome e contato (e-mail obrigatório para envio do ingresso; telefone opcional na v1).
5. Segue para pagamento no site.

### 4.2 Pagar

1. Pagamento exclusivamente via checkout do site.
2. Só após confirmação do meio de pagamento o ingresso fica **pago**.
3. Falha, abandono ou cancelamento → status **não pago** ou **cancelado**; não autoriza entrada.

### 4.3 Ingresso

1. Após pago: QR único por ingresso (tela “meu ingresso” + e-mail).
2. O QR identifica o ingresso de forma estável (não reutilizável após check-in).

### 4.4 Check-in (porta)

1. Equipe abre o check-in do evento no celular.
2. Lê o QR.
3. Resultado inequívoco: liberado / já usado / inválido (não pago, cancelado, evento errado).

### 4.5 Admin / secretaria

1. Login → lista de eventos → criar/editar → abrir/fechar venda.
2. Ver capacidade, vendidos, restantes; lista de ingressos com busca por nome.
3. Cancelar ingresso quando necessário (registro auditável).

## 5. Telas

### Público (sem login de equipe)

- **Home** — eventos ativos (nome, data, capa se houver).
- **Página do evento** — detalhes, tipos/preços, CTA comprar.
- **Checkout** — seleção, dados do comprador, pagamento.
- **Meu ingresso** — após pago: dados do evento + QR (acessível por link seguro do pedido).

### Equipe (com login)

- **Eventos** — listar, criar, editar, abrir/fechar venda.
- **Detalhe do evento** — capacidade, tipos, contadores.
- **Lista de ingressos** — nome, tipo, status, busca; sem IDs internos no dia a dia.
- **Check-in** — câmera + resultado claro (ok / bloqueado).

Copy da UI: português claro, textos curtos, linguagem de operação (não jargão de desenvolvedor).

## 6. Regras de negócio

### Evento

- Campos: nome, data/hora, local, descrição, imagem de capa (opcional), capacidade total, venda aberta/fechada.
- Venda para quando capacidade esgotar ou venda for fechada manualmente.

### Tipos de ingresso

- **Inteira** e **meia**: preço por evento.
- **Cortesia**: preço zero; só a equipe emite (não listada como compra aberta no site).
- Soma de ingressos válidos (pago + cortesia emitida, excluindo cancelados) ≤ capacidade.

### Status do ingresso

| Status | Significado | Entra na porta? |
|--------|-------------|-----------------|
| Não pago | Pedido sem confirmação de pagamento | Não |
| Pago | Pagamento confirmado | Sim (se ainda sem check-in) |
| Cancelado | Anulado pela equipe ou pagamento cancelado | Não |
| Check-in | Já usado na porta | Não (já usado) |

Pedidos abandonados sem pagamento: permanecem **não pago**; não consomem capacidade de forma permanente além de uma janela curta de reserva se o meio de pagamento exigir hold — na implementação, preferir liberar capacidade quando o pagamento expirar/falhar.

### Auditoria

Lista do evento com comprador, tipo, valor, status e horários relevantes — suficiente para conferir com o banco sem planilha paralela.

## 7. Dinheiro

- Taxa de marketplace do produto ≈ 0.
- Comprador paga com qualquer banco/app; valor creditado na conta do Espaço Byla via o meio de pagamento escolhido.
- Critérios para escolher o meio de pagamento (na fase de implementação, sem travar na spec):
  1. Avaliar **PagBank** primeiro (banco já usado no ecossistema Byla).
  2. Se não atender bem PIX (e cartão, se desejado) + confirmação automática: avaliar alternativas da mesma classe (ex.: Mercado Pago).
  3. Exigir: confirmação automática confiável para marcar **pago**; segredos só em variáveis de ambiente de produção; nada sensível no Git público.
- Fora do MVP: conciliação automática com extrato; vínculo com Byla Financeiro.
- Painel: totais vendidos, quantidade por tipo, lista para batimento manual com o banco.

## 8. Arquitetura e stack

### Stack do MVP (aprovada)

- **Next.js** (App Router) — site público, painel, rotas de API (webhooks de pagamento, emissão de ingresso, check-in).
- **Supabase** — Postgres, autenticação da equipe, Row Level Security.
- **Deploy:** Vercel a partir do `main` no GitHub (app Next.js unificado; sem obrigatoriedade de Render na v1).
- **Meio de pagamento:** a definir na implementação com os critérios da seção 7.

### Unidades principais

1. **Catálogo público** — home + página do evento (somente leitura de eventos abertos).
2. **Checkout e pedidos** — cria pedido/ingressos, inicia pagamento, recebe confirmação.
3. **Ingressos** — QR, link do ingresso, status.
4. **Check-in** — validação do QR e marcação atômica (um uso).
5. **Painel da equipe** — CRUD de eventos, lista, cortesia, cancelamento.
6. **Auth equipe** — login Supabase; políticas RLS (equipe acessa operação; público não acessa dados sensíveis de outros).

### Dados (modelo lógico)

- `events` — dados do evento, capacidade, venda aberta/fechada.
- `ticket_types` — por evento: inteira / meia / cortesia, preço, ativo.
- `orders` — pedido do comprador (contato, total, status de pagamento).
- `tickets` — ingresso individual (tipo, status, código/QR estável, horário de check-in).
- `staff_profiles` — usuários da equipe (via Auth Supabase).

IDs internos estáveis; reimportações futuras (se houver) não são requisito da v1, mas status e códigos de ingresso devem ser idempotentes sob retentativa de webhook.

### Tratamento de erros (visão)

- Pagamento falhou / expirou → ingresso/pedido não pago; capacidade liberada.
- Webhook duplicado → não duplicar ingresso nem check-in (idempotência).
- QR de outro evento / cancelado / já usado → mensagem clara na tela de check-in.
- Sem rede na porta → fora do MVP (exige online na v1).

### Testes

- Apenas nomes e contatos **fictícios**.
- Cobrir: compra feliz, pagamento confirmado, QR válido, QR já usado, capacidade esgotada, cancelamento.

## 9. Segurança e portfólio

- GitHub público: zero PII real, zero `.env` com valores, zero dumps.
- Segredos de pagamento e Supabase só em ambiente de deploy.
- Comprador não acessa painel; equipe autentica.
- Publicar em ondas limpas; sem force-push em `main` sem pedido explícito.

## 10. Critério de sucesso do MVP

- Criar eventos com capacidade e preços (inteira/meia; cortesia pela equipe).
- Comprador conclui compra e pagamento no site; marketplace fee ≈ 0.
- Lista confiável e auditável de pagantes.
- Status inequívocos: não pago / pago / cancelado / check-in.
- Check-in por QR no celular utilizável por Admin/secretaria.
- Operação da porta explicável em ~2 minutos.
- Nada de PII no Git; deploy seguro se for a produção.

## 11. Reuso do Byla Financeiro vs criar do zero

### Reutilizar (processo / princípios / portões)

- Fluxo Superpowers: brainstorm → design por seções → spec → plano → implementação com verificação.
- Disciplina de GitHub público sem PII; dados reais só em ambiente autenticado.
- UX de operação: textos curtos, status claros, confirmação humana em ambiguidade.
- Ideias: vínculo pagamento↔pessoa, papéis de equipe vs público, publicar sem PII.
- Skills/regras de não commitar PII e publicar em ondas (quando existirem no ecossistema Byla).

### Não reutilizar na v1

- Parsers de planilha de mensalidades / fluxo de caixa de alunos.
- Conciliação de mensalidade / matches mensais / crédito recorrente.
- Schema ou UI do Financeiro “porque já existe”.
- Acoplamento ao produto Financeiro.

### Criar do zero neste repo

- Domínio de eventos, tipos de ingresso, pedidos, QR, check-in.
- UI pública de catálogo/checkout e UI de porta.
- Integração com meio de pagamento de checkout online.
- App Next.js + modelo Supabase deste produto.

## 12. Próximos passos (após aprovação desta spec)

1. Usuário revisa e aprova este arquivo (ou pede ajustes).
2. Escrever plano de implementação enxuto em `docs/superpowers/plans/`.
3. Só então scaffold e implementação — estritamente após aprovação do plano/prompts, conforme processo.

## Hard-gate

Não há scaffold de app nem escolha final do SDK de pagamento neste documento. Implementação começa somente após aprovação explícita da spec e do plano.
