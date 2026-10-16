# Roteiro: teste com dois organizadores de teste (um não pode mexer no outro)

Objetivo: confirmar que o **Organizador A** não consegue ver, editar nem dar entrada em ingressos do evento do **Organizador B** (e vice-versa), mesmo copiando o endereço (link) do evento do outro.

Este teste usa a área real, mas **só com contas e eventos de teste** que você vai apagar no fim. Nada de dados de pessoas reais: use e-mails seus (ou aliases) e nomes inventados, tipo "Organizador Teste A" e "Evento Teste A".

> Esta área hoje está **desligada**. **Não tente ligar sozinho.** Quando for fazer o teste, peça ao agente: *"pode ligar a área de organizadores para o teste"*. Ele liga, e no fim você pede para desligar.

## Antes de começar

- Dois navegadores diferentes (ou um normal e uma janela anônima) para não misturar logins. Ex.: Chrome = Organizador A, janela anônima ou Edge = Organizador B.
- Dois e-mails que você consiga abrir (para receber o código de confirmação).
- Entrar como Admin do Espaço em um terceiro lugar (ou na mesma janela do Admin).
- Um celular ou um ingresso de teste só se quiser testar a portaria de verdade (opcional; o roteiro abaixo funciona sem comprar nada).

## Passo 1: ligar a área (peça ao agente)

1. Peça ao agente para ligar a área de organizadores. Espere ele confirmar.
2. Anote o horário: no fim do teste você pede para desligar.

## Passo 2: Admin cria dois convites

1. Entre como Admin em `/equipe/login` (senha + código do e-mail).
2. Abra a página **Organizadores** (menu da equipe, endereço `/equipe/organizadores`).
3. Crie **dois convites**: um para "Organizador Teste A" e outro para "Organizador Teste B", cada um com um e-mail diferente.
4. Copie o link de cada convite. Não mande para ninguém.

## Passo 3: cadastro dos dois organizadores

1. **Navegador A:** abra o link do convite A, crie a conta (senha forte, mínimo 12 caracteres com letras e números) e confirme o código recebido por e-mail.
2. **Navegador B:** faça o mesmo com o link do convite B.
3. Confirme: cada um entra na própria tela (`/organizador`) e vê só o próprio nome.

## Passo 4: cada um cria um evento pequeno, sem publicar

1. **Organizador A:** em "Novo evento", crie "Evento Teste A": uma data futura, capacidade 5, um tipo de ingresso. **Salve sem enviar para aprovação** (fica rascunho/sem publicar).
2. **Organizador B:** crie "Evento Teste B" do mesmo jeito.
3. Em cada navegador, abra o evento e **copie o endereço da barra do navegador** (algo como `/organizador/eventos/<código>`). Cole num bloco de notas: "endereço do evento A" e "endereço do evento B".

## Passo 5: o Organizador A tenta mexer no evento do B

No **navegador A** (logado como A), faça cada tentativa abaixo e anote o resultado. Em todas, o **esperado é negar**: página "não encontrada" (404), mensagem de sem permissão, ou voltar para o início. **Nunca** pode aparecer nome, capa, preço, compradores ou botões do Evento Teste B.

| # | Tentativa | Esperado |
|---|-----------|----------|
| 1 | Colar o endereço do evento B (`/organizador/eventos/<código do B>`) | Negado / não encontrado |
| 2 | Colar o endereço da portaria do B (o mesmo endereço, terminando em `/portaria`) | Negado / não encontrado |
| 3 | Tentar trocar a capa do evento B (se alguma tela do B chegar a abrir, tente enviar uma capa) | Negado; a capa do B **não muda** |
| 4 | Tentar ver compradores do B (lista de compradores/pedidos do B) | Negado; nenhum nome ou e-mail do B aparece |
| 5 | Tentar dar entrada (check-in) em um ingresso do B, se você tiver um (ou só abrir a portaria dele) | Negado |
| 6 | Abrir as páginas da equipe, ex.: `/equipe`, `/equipe/organizadores`, `/equipe/repasses` | Manda para o login da equipe; nada da equipe aparece |
| 7 | Abrir a lista "Meus eventos" do A | Aparece **só** "Evento Teste A" |

Dica: depois dos testes, no navegador B confira que o "Evento Teste B" **continua igual** (mesmo nome, mesma capa, sem alteração).

## Passo 6: repetir ao contrário

Repita as tentativas 1 a 7 no **navegador B**, tentando mexer no evento do A. Mesmo resultado esperado: tudo negado, B só vê o "Evento Teste B".

## Se algo falhar

Se em **qualquer** tentativa aparecer informação do outro organizador, ou a capa/evento do outro mudar:

1. **Pare o teste.** Não continue clicando.
2. Tire print da tela e anote o endereço usado e o horário.
3. Peça ao agente para **desligar a área de organizadores na hora** e avise que houve falha. A área não vai para produção até isso ser corrigido.

## Passo 7: limpeza (obrigatória)

1. Cada organizador (ou o Admin) apaga o próprio evento de teste. Sem vendas, é possível apagar digitando o nome do evento.
2. O Admin, na página **Organizadores**, **suspende** as duas contas de teste (e apaga ou cancela os convites que sobraram).
3. Se criou algum ingresso de cortesia ou compra de teste, estorne/cancele pelo painel da equipe.
4. Peça ao agente: *"pode desligar a área de organizadores"*. Peça para ele confirmar que ficou desligada (as páginas `/organizador` devem dar "não encontrada").
5. Feche as janelas dos dois navegadores e **apague as senhas de teste** que você anotou em qualquer lugar.

## Resultado

Anote em uma linha: data, "tudo negado conforme esperado" ou o que falhou. Isso conta como uma das condições para ligar a área de organizadores de verdade (junto com a revisão de segurança completa e a revisão rápida de advogado/contador).
