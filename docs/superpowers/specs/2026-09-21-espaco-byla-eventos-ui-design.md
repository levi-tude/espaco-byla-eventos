# Design UI — Espaço Byla Eventos (noite cultural)

**Data:** 2026-09-21  
**Status:** rascunho para revisão do usuário  
**Escopo:** redesign visual do front (público + equipe). Sem mudança de regras de negócio do MVP. PagBank continua pendente de credenciais.

## 1. Produto (posicionamento)

- Nome do produto no site: **Espaço Byla Eventos**.
- Não é o site institucional do Espaço Byla (aulas, modalidades, aluguel, missão).
- É a plataforma para **vender ingressos** dos eventos do Espaço Byla, com taxa de marketplace próxima de zero (alternativa a Sympla/Shotgun).
- Referência de UX: **confiança/clareza Sympla** + **presença/atmosfera Shotgun**, sem copiar marketplace (filtros, cidade, mapa, revenda).

## 2. Direção visual — claro + escuro

- Temas via `next-themes` (`class` no `<html>`), padrão **escuro**, com opção claro e sistema.
- Escuro (“noite cultural”): fundo `#0A0A0B` / surface `#111`, texto claro.
- Claro (brand book): fundo `#F4F5F7` / surface branco, texto `#0A0A0B`, bordas navy suaves.
- Primária (CTA): azul marca `#4080FC` (texto do botão sempre branco).
- Destaque: amarelo marca `#FFBD38` (tom um pouco mais fechado no claro).
- Apoio: azul escuro `#0C3974`.
- Toggle sol/lua no header; logo adaptativa (flor clara no escuro; marca amarelo/azul no claro).
- Hero sobre capa de evento permanece com overlay escuro e texto branco em ambos os temas.
- Logo: flor do brand book (versão mono clara no header; círculo amarelo + flor azul onde couber). Assets de referência extraídos do PDF “Conheça o Espaço Byla” (pasta local `.design-refs/`, fora do Git).
- Tipografia: corpo legível estilo Open Sans; títulos com display forte via fonte web livre próxima do espírito Sailors/Zing (sem depender de fonte paga no MVP).
- Evitar: roxo genérico de IA, cream+terracota, cards cinza “SaaS”, visual Material/Ant.

## 3. Stack de UI (somente repos famosos)

Já no projeto: Next.js (App Router), Tailwind CSS.

Adotar na implementação:

| Base | Uso |
|------|-----|
| [shadcn-ui/ui](https://github.com/shadcn-ui/ui) | Botões, inputs, dialog, sheet — código no repo, tema Byla |
| [radix-ui/primitives](https://github.com/radix-ui/primitives) | Acessibilidade sob o shadcn |
| [lucide-icons/lucide](https://github.com/lucide-icons/lucide) | Ícones |
| [motiondivision/motion](https://github.com/motiondivision/motion) | 2–3 motions de presença (não decoração excessiva) |

Não adotar: MUI, Ant Design, Chakra, DaisyUI, starters obscuros.

## 4. Home pública

- Header: logo + **Espaço Byla Eventos**.
- Copy de programação/compra — nunca “conheça o espaço / modalidades”.

| Situação | Layout |
|----------|--------|
| 1 evento com venda aberta | Hero full-bleed da capa; nome, data, local; CTA **Garantir ingresso** |
| 2+ eventos | Grade de capas grandes (1 col mobile / 2–3 desktop); sem filtros de marketplace |
| 0 eventos | Mensagem calma: nenhum evento com venda aberta |

Motion: entrada suave do hero/grade; hover discreto no CTA (desktop).

## 5. Página do evento

- Capa dominante; nome, data, horário, local.
- Preços Inteira/Meia em evidência; CTA **Comprar ingresso** (fixo no mobile).
- Descrição curta do evento se existir no cadastro.
- Sem conteúdo institucional do brand book.
- Link de volta à programação (home).

## 6. Checkout

- Coluna estreita, foco total na compra.
- Quantidades Inteira/Meia, total destacado, dados do comprador, CTA **Ir para o pagamento**.
- Sem capa full-bleed.
- Enquanto PagBank não estiver configurado: UI pronta; mensagem amigável de pagamento em configuração — **sem cobrança falsa**.

## 7. Página do ingresso + PDF

- Pass escuro com QR grande, nome, tipo, status, código, **Baixar ingresso (PDF)**.
- Nav: Voltar (staff logado → gerenciamento do evento; público → evento), Início, Página do evento.
- PDF alinhado à identidade (escuro + marca), sem abrir impressão no lugar do download.
- Estados: aguardando pagamento / pago / indisponível.

## 8. Área da equipe

Ferramenta operacional (Sympla), mesma paleta noite, sem hero de cartaz:

- Login, lista de eventos, gerenciar evento, novo evento, check-in.
- Check-in: manter comportamento atual (pausa após resultado + “Próximo ingresso”, inclusive “Já utilizado”).
- shadcn para formulários, diálogos (ex.: cancelar ingresso), botões.

## 9. Fora de escopo deste redesign

- Integração PagBank / webhook real (credenciais pendentes).
- Deploy Vercel / GitHub remoto.
- Site institucional do Espaço Byla.
- Novas regras de negócio (tipos de ingresso, taxas, etc.).

## 10. Ordem de implementação sugerida

1. Tokens CSS + layout shell (header, fontes, tema escuro).
2. Assets de logo (do brand book) em `public/`.
3. Home → evento → checkout → ingresso/PDF.
4. Área equipe (login + painéis) no mesmo sistema.
5. Polish motion + revisão mobile.

## 11. Critério de sucesso visual

- Primeira dobra da home passa no “brand test”: sem o header, ainda parece Espaço Byla Eventos (não um template Sympla clone).
- Compra e equipe continuam óbvios em ~segundos (clareza operacional).
- Mobile usável na porta (check-in) e na compra (CTA no polegar).
