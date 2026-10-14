# Eventos passados na página inicial — design

Data: 2026-10-13 · Status: aprovado pelo dono em 2026-10-13 (decisões 1A, 2A, 3A, 4A, 5A).

## 1. Objetivo

Hoje um evento some do site quando as sessões acabam ou quando a equipe fecha as vendas. O dono quer, como Shotgun e Sympla, que os eventos que já aconteceram continuem visíveis numa parte "Eventos passados", servindo de vitrine do que o Espaço Byla já fez.

Público: compradores e visitantes (página inicial e página do evento); equipe (painel).

## 2. Decisões tomadas

| Tema | Decisão |
| --- | --- |
| Onde aparece | Página inicial, em duas partes: "Próximos eventos" em cima e "Eventos passados" embaixo |
| Quando vira passado | No dia seguinte à última sessão (horário de Brasília) — mesma data em que o evento vira "A pagar" no Financeiro |
| Quais aparecem | Todo evento que já foi publicado; a equipe pode esconder um (ex.: evento cancelado) |
| Página do evento passado | Continua abrindo: capa, fotos, descrição, datas e o aviso "Evento encerrado", sem compra |
| Quantos | Os 12 mais recentes, com botão "Ver mais" (12 por vez) |

Detalhes definidos neste documento (o dono pode mudar na revisão):

- **"Publicado"** = o evento já esteve com vendas abertas pelo menos uma vez. Rascunho que nunca abriu vendas nunca aparece.
- **Evento com todas as sessões canceladas** não aparece nos passados, automaticamente (sem precisar esconder).
- **Esconder** fica disponível para toda a equipe (Admin e secretaria), como abrir/fechar vendas.

## 3. Experiência do visitante

**Página inicial (`/`)**

- **Próximos eventos:** igual a hoje (cards, ou a capa grande quando só há um evento à venda).
- **Eventos passados:** abaixo, com título "Eventos passados". Grade de cards (1 coluna no celular, 2 no tablet, 3 no computador), do mais recente para o mais antigo. Cada card: capa 16:9, nome, data ("10 de outubro de 2026"; com várias sessões em dias diferentes, "10 e 11 de outubro de 2026" ou "De 10 a 12 de outubro de 2026"), local e "Ver evento →". Sem preço, sem selo de esgotado.
- Visual levemente mais discreto que os próximos (capa sem animação ao passar o mouse), para não competir com o que está à venda.
- **Ver mais:** botão no fim da grade quando houver mais eventos. Funciona sem JavaScript: leva a `/?passados=24#eventos-passados` (24, 36, …; máximo 120).
- **Sem próximos eventos:** mostra o aviso atual ("Nenhum evento à venda no momento") e, logo abaixo, os passados.
- **Sem passados:** a parte não aparece.

**Página do evento passado (`/eventos/[slug]`)**

- Capa, nome, local, descrição e galeria, como hoje.
- No lugar da caixa de ingressos: aviso **"Evento encerrado"**, com a data em que aconteceu e o link "Ver próximos eventos".
- Sem preços, sem botão de compra, sem barra fixa de compra no celular.
- A prévia do link no WhatsApp continua com a capa do evento.
- Tentativa de abrir o checkout de um evento passado continua recusada (as vendas de cada sessão já fecham sozinhas 5 min após o início).

## 4. Experiência da equipe

- Na página do evento no painel, um interruptor **"Mostrar nos eventos passados"** (ligado por padrão), com a explicação: "Depois que o evento acontece, ele continua no site em Eventos passados. Desligue para esconder."
- Na lista de eventos do painel, o selo do evento passado vira **"Encerrado"** (hoje mostra "Venda aberta/fechada").
- Esconder ou mostrar vale na hora, sem afetar pedidos, ingressos, check-in ou Financeiro.

## 5. Banco de dados (projeto Espaço Byla Eventos)

Migração nova `past_events`:

- `events.published_at timestamptz null` — preenchido uma única vez, por gatilho, quando o evento é criado com vendas abertas ou quando as vendas abrem pela primeira vez. Nunca volta a `null`.
- `events.hidden_from_past boolean not null default false` — o interruptor da equipe.
- Função `public.event_is_past(p_event_id uuid) returns boolean` (`stable`, `security definer`, `search_path = ''`): verdadeiro quando `published_at` existe, `hidden_from_past` é falso, existe pelo menos uma sessão ativa (não cancelada, não arquivada) e a data de hoje em Brasília é igual ou posterior a `public.event_fee_due_date(id)` (dia seguinte à última sessão — a mesma regra do Financeiro).
- Leitura pública passa a incluir eventos passados, nas mesmas tabelas que a página do evento já lê:
  - `events_public_read`: `sales_open = true OR public.event_is_past(id) OR is_staff()`.
  - `event_images_public_read` e `event_sessions_public_read`: mesma troca (`e.sales_open = true OR public.event_is_past(e.id)`).
  - `ticket_types` e `session_ticket_types` **não** mudam: preços de evento passado continuam fechados ao público.
- `event_is_past`: `revoke all ... from public, anon, authenticated` e `grant execute` só para `anon` e `authenticated` (necessário para a política funcionar); não expõe nada além de verdadeiro/falso.
- Função `public.public_past_events(p_limit integer)` (`stable`, `security definer`, `search_path = ''`): devolve os eventos passados já ordenados pela última sessão (mais recente primeiro), só com campos públicos (id, slug, nome, local, capa, inícios das sessões ativas, fim da última sessão). Limite entre 1 e 121 (a página pede um a mais para saber se há "Ver mais"). Mesmo `revoke`/`grant` de `event_is_past`.
- Escrita de `hidden_from_past`: pela política de equipe que já existe em `events` (só equipe escreve).
- Sem dados existentes a migrar (o banco está vazio hoje); mesmo assim o gatilho trata eventos antigos: se `sales_open = true` na migração, `published_at = created_at`.

## 6. Código

- `src/lib/domain/past-events.ts`: rótulo de data do card (um dia, dois dias, intervalo) e cálculo do limite de "Ver mais" a partir de `?passados=` (padrão 12, passo 12, máximo 120, valor inválido vira 12). Funções puras, testadas.
- `src/app/page.tsx`: busca os próximos como hoje; busca os passados pela função `public_past_events` (já ordenados pela última sessão, do mais recente); monta as duas partes. `HomeSingleEvent` passa a aceitar a parte de passados abaixo da capa grande.
- `src/components/public/PastEventsSection.tsx`: grade de cards + "Ver mais".
- `src/app/eventos/[slug]/page.tsx`: estado "encerrado" quando o evento é passado: troca a caixa de ingressos pelo aviso e não carrega preços.
- Painel: interruptor `PastVisibilityToggle` (Server Action com `assertStaff`, validação do id, `runAction`) e selo "Encerrado" na lista.

## 7. Segurança e erros

- Nenhum dado novo fica público além do que já é público num evento à venda (nome, data, local, capa, fotos, descrição, sessões). Preços, quantidades vendidas e pedidos continuam restritos.
- A Server Action do interruptor revalida equipe dentro dela, valida o id e devolve erro genérico.
- Falha ao carregar os passados não derruba a página inicial: a parte simplesmente não aparece (os próximos continuam).

## 8. Testes

- Unitários: rótulos de data, limite do "Ver mais", estado "encerrado" da página do evento.
- Banco (antes de aplicar, em transação revertida): evento rascunho não aparece; evento publicado passa a aparecer no dia seguinte à última sessão; escondido não aparece; todo cancelado não aparece; visitante não lê preços de evento passado.
- Depois de aplicar, verificação pelo site em produção com um evento de teste (criado e apagado em seguida).

## 9. Fora do escopo

- Página separada "Eventos passados", busca e filtros por ano.
- Fotos enviadas pelo público, avaliações ou "eu fui".
- Reabrir vendas de evento passado.
