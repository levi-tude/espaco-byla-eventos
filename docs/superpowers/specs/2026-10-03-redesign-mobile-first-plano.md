# Plano visual mobile-first — Espaço Byla Eventos

> Etapa 2 da frente visual. **Nada deste plano é codado antes do "ok" do dono.**
> Base: medições feitas em 2026-10-03 no celular simulado (360 px), temas escuro e claro.

## 1. Diagnóstico (o que foi medido)

### O que já está bom
- Nenhuma tela tem rolagem horizontal da página inteira em 360 px.
- Capa em 16:9 com proporção estável; galeria com tela cheia acessível.
- Barra fixa "Comprar ingresso" na página do evento.
- Campos do checkout já têm o teclado certo (e-mail, telefone, quantidade numérica).

### Problemas encontrados

| Problema | Onde | Por que importa |
| --- | --- | --- |
| Texto branco sobre o azul da marca tem contraste **3,7** (mínimo AA: 4,5) | Todos os botões principais | Difícil de ler no sol, reprovado na regra AA |
| Amarelo do tema claro sobre branco tem contraste **2,2** | "Finalizar compra", "Programação", datas | Quase invisível no tema claro |
| Azul como texto sobre fundo claro: **3,4** | Links "Ver evento", e-mail | Reprovado para texto normal |
| Campos com letra de **14 px** | Checkout, painel, cortesia, busca | O iPhone dá zoom sozinho ao tocar no campo |
| Campos com **42 px** de altura | Checkout, painel | Abaixo dos 44 px de toque |
| Links "← Voltar…" com **19 px** de altura; rodapé com **16 px** | Todas as telas | Difícil acertar com o dedo |
| Botão de tema 40 × 40; "Sair", "Gerenciar" 38 px | Cabeçalhos e lista da equipe | Abaixo de 44 px |
| Caixa "Li e aceito" com área de toque de **20 × 20** | Checkout | Fácil errar o toque |
| Preços com `type=number` sem teclado decimal | Novo evento / painel | Teclado errado no celular |
| Tabela de participantes com **820 px** de largura | Painel do evento | No celular obriga a rolar para o lado |
| Painel do evento com **4.241 px** de altura em 360 px; formulário vem antes da lista e da cortesia | Painel do evento | Na portaria, o que se usa mais fica lá embaixo |
| Números repetidos (Lotação/Vendidos… e depois Inteiras/Meias/Total) | Painel do evento | Confunde |
| Página do pedido: 3 botões de navegação quebram em 2 linhas antes do ingresso | Pedido | O ingresso fica abaixo da dobra |
| Cartões dentro de cartões (borda + borda) | Checkout, painel | Perde ~50 px de largura no celular |
| Check-in: resultado da leitura aparece **abaixo** da câmera | Check-in | O porteiro precisa rolar para ver se liberou |
| Evento sem capa mostra só um degradê vazio | Home, lista | Parece quebrado |
| Nenhuma tela tem `loading.tsx`, `error.tsx` ou `not-found.tsx` próprios | Todas | Tela branca ou erro em inglês |
| ~50 cores fixas (`emerald`, `red`, `amber`, `zinc`, `white`) espalhadas em 24 arquivos | Vários | Contraste quebra em um dos temas |
| Fotos da galeria sem fundo enquanto carregam | Página do evento | Buracos vazios ao rolar |

## 2. Regras visuais (valem para todas as telas)

- **Largura:** desenhar para 360 px. Margem lateral de 16 px no celular, 24 px no tablet, conteúdo máximo de 1120 px no desktop.
- **Pontos de quebra:** celular até 639 px · tablet 640–1023 px · desktop a partir de 1024 px.
- **Texto:** corpo 16 px; texto de apoio no mínimo 14 px; nada de 12 px fora do rodapé legal. Linhas de leitura com até ~65 caracteres.
- **Toque:** tudo que é clicável com no mínimo 44 × 44 px e 8 px de espaço entre si.
- **Um cartão por nível:** no celular, seções separadas por espaço e linha fina, sem cartão dentro de cartão.
- **Botão principal sempre à vista:** barra fixa embaixo nas telas de compra (evento, checkout, pedido com "Baixar ingresso").
- **Cores só por tokens do tema**, nunca cor fixa. Status com par fundo/texto próprio para cada tema.
- **Movimento:** animações curtas e desligadas quando o celular pede "reduzir movimento".

### Cores (proposta)

| Uso | Escuro | Claro |
| --- | --- | --- |
| Fundo do botão principal | azul mais escuro (ex.: `#2563EB`, contraste 5,2 com branco) | igual |
| Azul como texto/link | `#4080FC` (5,1 sobre o fundo escuro) | azul escuro (ex.: `#1D5FD6`, 5,7 sobre branco) |
| Amarelo de destaque como texto | `#FFBD38` (11,3) | amarelo escuro (ex.: `#8A5A00`, 5,9) |
| Amarelo como enfeite (faixas, ícones grandes, selos) | `#FFBD38` | `#FFBD38` |

O azul `#4080FC` e o amarelo `#FFBD38` continuam sendo as cores da marca. Muda só **onde** cada tom é usado, para passar no contraste (decidido pelo dono, ver seção 7).

## 3. Componentes reutilizáveis (`src/components/ui/`)

Só apresentação: recebem props e repassam eventos, sem lógica de negócio. A outra frente pode reutilizar.

| Componente | O que é |
| --- | --- |
| `Button` / `ButtonLink` | Variantes: principal, secundário, discreto, perigo. Altura mínima de 44 px, estado "carregando" com texto ("Enviando…") e desabilitado |
| `Field` | Rótulo visível, campo de 16 px e 48 px de altura, dica e erro logo abaixo (`aria-describedby`) |
| `Checkbox` | Área de toque da linha inteira (≥ 44 px) |
| `Card` | Superfície com borda; no celular, só no nível de fora |
| `StatusBadge` | Venda aberta/fechada, Pago, Aguardando pagamento, Expirado, Estornado, Cortesia, Precisa de decisão, Usado, Novo |
| `Notice` | Aviso de informação, sucesso, atenção ou erro, com `role="status"` ou `role="alert"` |
| `EmptyState` | Ícone, frase curta e ação opcional ("Nenhum evento ainda" + "Criar evento") |
| `Skeleton` | Blocos cinza para telas carregando |
| `StickyActionBar` | Barra fixa inferior com resumo (ex.: total) e botão principal; respeita a área segura do iPhone |
| `BackLink` / `PageHeader` | "← Voltar" com 44 px de toque, título e ações da página |
| `CoverImage` | Capa 16:9 com fundo e marca do Byla quando o evento não tem capa |

## 4. Telas

Desenhos em texto: `[ ]` = botão, `___` = campo, `▓` = imagem.

### 4.1 Cabeçalho e rodapé (todas as telas)
```
┌────────────────────────────┐
│ ◼ ESPAÇO BYLA EVENTOS  [☾] │  ← 56 px, logo e botão de tema com 44 px
└────────────────────────────┘
...
  © 2026 Espaço Byla · Política de Privacidade   ← link com 44 px de toque
```
- **Equipe:** mesmo cabeçalho com "Eventos" e "Sair" em 44 px. No celular, "Sair" vai para um menu simples se faltar espaço.
- **Tablet e desktop:** iguais, com o conteúdo centralizado.

### 4.2 Home (vários eventos / um evento)
```
PROGRAMAÇÃO
ESPAÇO BYLA EVENTOS
Escolha seu evento…
┌──────────────────────────┐
│▓▓▓▓▓▓▓ capa 16:9 ▓▓▓▓▓▓▓▓│
│ NOME DO EVENTO           │
│ 📅 sáb, 9 out · 20h      │
│ 📍 Local                 │
│ a partir de R$ 30   [Ver]│  ← o cartão inteiro é clicável
└──────────────────────────┘
```
- **Tablet:** 2 colunas. **Desktop:** 3 colunas.
- **Um evento só:** capa grande, nome, data e botão "Comprar ingresso".
- **Estados:**
  - vazio: "Nenhum evento à venda agora" com o Instagram/contato do espaço, se houver;
  - carregando: esqueleto de 3 cartões.

### 4.3 Página do evento (com galeria)
```
← Ver programação
▓▓▓▓▓▓ capa 16:9 de ponta a ponta ▓▓▓▓▓
NOME DO EVENTO
📅 data · 📍 local
Ingressos
  Inteira ............ R$ 30
  Meia-entrada ....... R$ 15
Sobre o evento (descrição)
Fotos  ▓▓ ▓▓ (2 colunas, fundo enquanto carrega)
┌────────────────────────────┐
│ a partir de R$ 15 [Comprar]│  ← barra fixa (já existe; ganha o preço)
└────────────────────────────┘
```
- **Tablet:** galeria em 3 colunas.
- **Desktop:** duas colunas, como Sympla. Conteúdo à esquerda; à direita, um cartão fixo com os ingressos e "Comprar". A barra inferior some no desktop.
- **Estados:**
  - "Esgotado" e "Vendas encerradas" no lugar do botão;
  - "Reservas em andamento" (regra da outra frente; aqui só o visual).

### 4.4 Checkout
```
← Voltar ao evento
FINALIZAR COMPRA · Nome do evento
Escolha seus ingressos      Resta 1 lugar
  Inteira      R$ 30    [–] 0 [+]
  Meia-entrada R$ 15    [–] 0 [+]
Seus dados
  Nome ______  E-mail ______  Telefone ______
  [✓] Li e aceito a Política de Privacidade   ← linha inteira tocável
┌────────────────────────────┐
│ Total R$ 45  [Continuar →] │  ← barra fixa
└────────────────────────────┘
```
- Sem cartão dentro de cartão. Nome do ingresso numa linha só (o seletor de quantidade fica mais compacto).
- **Desktop:** dados à esquerda, resumo do pedido fixo à direita.
- Erros perto de cada campo.
- **A outra frente** mexe em limite, carrinho, `?retomar=` e tipos de ingresso: eu mudo só a aparência, sem tocar em estado e funções.

### 4.5 Pedido (pagamento e ingressos)
O topo de toda variação é uma **faixa de status** (`Notice`) e um resumo curto do evento. Navegação: só "← Página do evento". "Voltar ao gerenciamento" aparece apenas para a equipe.

| Estado | O que aparece |
| --- | --- |
| Aguardando pagamento | "Reserva válida até 20:15", resumo do pedido e caixa de pagamento (PIX/cartão) **no tema do site** |
| Aguardando (PIX gerado) | QR e "copia e cola" em destaque, com aviso "assim que pagar, esta tela atualiza sozinha" (`aria-live`) |
| Sucesso | Faixa verde "Pagamento confirmado!", ingressos logo abaixo |
| Tempo esgotado | Faixa de atenção e botão "Escolher de novo com os mesmos dados" |
| Indisponível / Estornado | Faixa neutra com explicação simples, sem QR |
| Pago sem vaga | "Pagamento recebido, a equipe vai te avisar" |

**Ingressos:**
```
┌──────────────────────────┐
│ ESPAÇO BYLA EVENTOS      │
│ NOME DO EVENTO           │
│ Meia-entrada · Nome      │
│     ▓▓▓▓ QR ▓▓▓▓         │  ← QR sempre em fundo branco
│ Código: ABCD-1234        │  ← texto com a cor do tema
│ [Pago]                   │
└──────────────────────────┘
┌────────────────────────────┐
│ [Baixar ingresso (PDF)]    │  ← barra fixa
└────────────────────────────┘
```
- **Desktop:** ingressos em 2 colunas.

### 4.6 Política de Privacidade
- Tipografia de leitura: linhas de até ~65 caracteres, títulos com espaço, links com área de toque.
- **O texto não muda.**

### 4.7 Equipe — Login
- Cartão centralizado com campos de 16 px e 48 px, "Entrar" de largura total, erro em `Notice` e "Entrando…" enquanto carrega.

### 4.8 Equipe — Lista de eventos
```
EVENTOS                 [+ Novo evento]
Próximos
┌──────────────────────────┐
│▓ capa │ Nome do evento   │
│       │ sáb, 9 out · 20h │
│       │ [Venda aberta]   │
│       │ 12 vendidos / 80 │  ← se o dado já existir na página
└──────────────────────────┘   ← o cartão inteiro abre o evento
Passados (recolhido)
```
- **Desktop:** grade de 2–3 colunas.
- **Vazio:** "Nenhum evento ainda" e "Criar evento".

### 4.9 Equipe — Painel do evento (a maior mudança)
A ordem segue o uso no dia a dia: primeiro vender e controlar, depois editar.
```
← Eventos
NOME DO EVENTO   [Venda aberta]
sáb, 9 out · 20h · Local
┌──────┬──────┐
│Vend. │Reser.│   ← um só bloco de números (sem repetição)
├──────┼──────┤
│Rest. │Total │
└──────┴──────┘
[Abrir check-in]  [Ver página]  [Fechar venda]
Atalhos: Vendas · Participantes · Cortesia · Editar   ← fixos no topo ao rolar
— Precisa de decisão (só quando houver)
— Participantes (cartões no celular; tabela a partir do tablet)
— Emitir cortesia
— Estornos (se houver)
— Editar evento (formulário + capa + galeria)
```
- **Participante no celular:** um cartão com nome, tipo, `StatusBadge`, "Novo" e ações em 44 px. A tabela larga só aparece a partir do tablet, dentro de caixa com rolagem própria.
- **Desktop:** duas colunas. Números, participantes e decisões à esquerda; cortesia e edição à direita.
- **A outra frente** muda consultas, `OrdersPanel` e o editor de tipos: aqui só grade, espaçamento e cartões.

### 4.10 Equipe — Novo evento / formulário
- Campos de 16 px e 48 px; capacidade com teclado numérico; preços com teclado decimal; data com o seletor nativo.
- Botão "Salvar" fixo embaixo no celular; mensagem de sucesso ou erro em `Notice`.
- O editor de tipos de ingresso (fase 5 da outra frente) recebe o mesmo estilo depois.

### 4.11 Equipe — Check-in (portaria)
```
← Evento   CHECK-IN · Nome
┌────────────────────────────┐
│                            │
│     câmera (tela quase     │
│        inteira)            │
│                            │
├────────────────────────────┤
│ ✔ LIBERADO  Nome · Inteira │  ← resultado grande, por cima da câmera
└────────────────────────────┘
[Digitar código]  ← abre o campo manual
```
- **Resultados:**
  - verde "Liberado";
  - vermelho "Já utilizado às 20:41";
  - vermelho "Estornado";
  - cinza "Código não encontrado".
- Cada resultado tem texto e ícone, nunca só cor. O anúncio usa `aria-live`.
- Cabeçalho reduzido para a câmera ocupar o máximo da tela.

## 5. Estados em todas as telas

- **Carregando:** `loading.tsx` com esqueleto em home, evento, checkout, pedido, lista e painel da equipe.
- **Erro:** `error.tsx` em português ("Algo deu errado. Tente de novo.") com botão "Tentar de novo"; detalhe só no log.
- **Não encontrado:** `not-found.tsx` com link para a programação.
- **Vazio:** `EmptyState` nas listas (eventos, participantes, galeria, estornos).
- **Sucesso:** `Notice` de sucesso depois de salvar, emitir cortesia e confirmar pagamento.

## 6. Ordem de execução (passos pequenos, um commit por passo)

Cada passo é verificado assim:
- `lint`, testes e build passando;
- telas em 360, 390, 768 e 1280 px, temas claro e escuro;
- sem rolagem lateral, toque ≥ 44 px e contraste conferido;
- prints no resumo.

| # | Passo | Depende da outra frente? |
| --- | --- | --- |
| 1 | Tokens de cor (botão, texto azul/amarelo, status) + componentes `ui/` | Não |
| 2 | Cabeçalho, rodapé, "Voltar", `error.tsx` e `not-found.tsx` | Não |
| 3 | Home (vários eventos e evento único) + `CoverImage` | Não |
| 4 | Página do evento + galeria + barra com preço + desktop em 2 colunas | Pouco (só visual de "Esgotado") |
| 5 | Política de Privacidade (só tipografia) | Não |
| 6 | Equipe: login e lista de eventos | Não |
| 7 | Equipe: check-in em tela cheia | Pouco (rótulo "Estornado" já existe) |
| 8 | Equipe: painel do evento (ordem, atalhos, cartões de participante) | **Sim**: depois do dia de publicação |
| 9 | Checkout | **Sim**: depois do dia de publicação; a fase 5 (tipos) muda essa tela |
| 10 | Pedido (todos os estados) + caixa de pagamento no tema do site | **Sim**: só dá para ver os estados novos com o banco atualizado |
| 11 | `loading.tsx` / esqueletos em todas as telas | Não |

Os passos 1 a 7 e o 11 podem começar já, sem esperar a outra frente. Os passos 8 a 10 ficam para depois do dia de publicação, porque usam telas que a outra frente ainda está mudando.

## 7. Decisões do dono (2026-10-03)

1. **Azul dos botões:** azul um pouco mais escuro só no fundo dos botões, texto branco.
2. **Amarelo no tema claro:** dourado escuro nos textos; amarelo vivo só como enfeite. Tema escuro sem mudança.
3. **Painel do evento:** nova ordem aprovada (vender e controlar primeiro, editar por último), com atalhos fixos no topo.
4. **Desktop da página do evento:** duas colunas, com o cartão de compra fixo à direita (padrão Sympla).
