# Lembrete de compra não finalizada — como ligar

Data: 2026-10-03 · Fase 6 da spec `docs/superpowers/specs/2026-10-01-estorno-tipos-carrinho-design.md` (aprovada pelo dono em 2026-10-03).

O lembrete já vem **desligado**. Ele só começa a ser enviado depois que você fizer os passos abaixo. Nenhum valor secreto aparece neste documento nem no Git.

## O que o lembrete faz

- Cerca de **1 hora** depois de alguém começar uma compra e não pagar, o site manda **um único e-mail**: "Você não terminou sua compra para <evento>", com o botão **Continuar compra**. O botão abre o checkout com a mesma seleção e os mesmos dados já preenchidos. Se não houver mais lugar, a própria página avisa.
- Todo lembrete tem o link **"Não quero receber lembretes"**. A pessoa confirma num botão e nunca mais recebe lembrete, em nenhum evento. Os e-mails com os ingressos continuam chegando normalmente.

**Não manda quando:**

- a pessoa pagou, ou fez outro pedido para o mesmo evento depois (pago ou não);
- o pedido foi cancelado por "Alterar seleção" (ela continuou comprando);
- as vendas estão fechadas, o evento já começou ou está sem lugares;
- já saiu um lembrete para esse e-mail nesse evento (no máximo 1 por e-mail e evento);
- o e-mail pediu para não receber;
- o pedido tem mais de 24 horas;
- o pedido foi feito antes da nova Política de Privacidade (versão de 2026-10-03), que avisa sobre o lembrete.

**Limites** (o plano grátis de e-mail permite 100 envios por dia, somando ingressos, lembretes e alertas da equipe; ingressos têm prioridade):

- no máximo **5 lembretes por execução** (a cada 15 minutos);
- no máximo **30 lembretes em 24 horas**. Sobram pelo menos 70 envios por dia para ingressos e alertas.
- Os números ficam em `src/lib/reminders/rules.ts`.

## Antes de começar

Confirme com quem cuida do código que estas três coisas já foram feitas (cada uma precisa da sua aprovação):

1. Migration `20261010100000_abandoned_reminders` aplicada no banco **Espaço Byla Eventos**.
2. Código publicado na Vercel (push em `main`).
3. Migration `20261010110000_abandoned_reminders_schedule` aplicada no mesmo banco (ela habilita as extensões de agendamento, mas **não liga nada**).

## Passo 1 — Criar o segredo

O segredo é uma senha longa que só o banco e o site conhecem. Ele impede que outra pessoa dispare os lembretes.

- Abra o PowerShell e rode:

  ```powershell
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

- Vai aparecer uma sequência de 64 letras e números. Copie. Ela será usada nos passos 2 e 3.
- Se preferir, use um gerador de senhas com **pelo menos 48 caracteres, só letras e números**.
- Não cole o segredo em chat, e-mail, documento ou no Git.

## Passo 2 — Colocar o segredo na Vercel

1. Entre na Vercel → projeto **espaco-byla-eventos** → **Settings** → **Environment Variables**.
2. Clique em **Add**:
   - **Key:** `REMINDER_CRON_SECRET`
   - **Value:** o segredo do passo 1
   - **Environments:** só **Production**
3. Salve.
4. Vá em **Deployments**, abra o menu (⋯) do deploy mais recente de produção e clique em **Redeploy**. Sem isso, o site não enxerga a variável nova.

## Passo 3 — Colocar o mesmo segredo no Vault da Supabase

1. Entre na Supabase → projeto **Espaço Byla Eventos**.
2. Abra **Integrations** → **Vault** (em alguns painéis fica em **Project Settings** → **Vault**).
3. Clique em **Add new secret**:
   - **Name:** `reminder_cron_secret` (exatamente assim, tudo minúsculo)
   - **Secret:** o mesmo segredo do passo 1
4. Salve.

Use a tela do Vault, e não o SQL Editor, para o segredo não ficar no histórico de consultas.

## Passo 4 — Ligar o agendamento

1. Na Supabase, abra **SQL Editor** → **New query**.
2. Cole e rode (botão **Run**):

```sql
select cron.schedule(
  'abandoned-reminders',
  '*/15 * * * *',
  $$select public.invoke_abandoned_reminders()$$
);
```

3. Deve aparecer um número (o código do job). Pronto: a cada 15 minutos o banco chama o site, e o site decide quem recebe.

## Passo 5 — Conferir se está funcionando

Espere uns 20 minutos e confira:

- **Supabase** → **Integrations** → **Cron**: o job `abandoned-reminders` aparece, com execuções "succeeded".
- **Resposta do site:** no SQL Editor, rode:

  ```sql
  select status_code, created from net._http_response order by created desc limit 5;
  ```

  - `200`: funcionando (mesmo quando não há lembrete para mandar).
  - `401`: o segredo da Vercel e o do Vault estão diferentes, ou faltou o **Redeploy** do passo 2.
  - `503`: falta configurar o envio de e-mails do site.
  - Nenhuma linha: confira o nome `reminder_cron_secret` no Vault.
- **Teste real (opcional):** depois do deploy, comece uma compra com o seu e-mail num evento à venda e não pague. Em cerca de 1h a 1h15 chega o lembrete. Clique em **Continuar compra** (a seleção volta preenchida) e depois em **Não quero receber lembretes**.

## Como desligar

Qualquer uma destas opções desliga. A primeira é a recomendada:

1. No SQL Editor, rode:

```sql
select cron.unschedule('abandoned-reminders');
```

2. Apagar o segredo `reminder_cron_secret` no Vault: o job continua rodando, mas não chama mais o site.
3. Apagar `REMINDER_CRON_SECRET` na Vercel (e fazer Redeploy): o site recusa as chamadas.

Para ligar de novo depois da opção 1, repita o passo 4.

## Trocar o segredo

Gere um novo (passo 1) e troque **nos dois lugares**: Vercel (com Redeploy) e Vault (edite `reminder_cron_secret`). Enquanto só um lado estiver trocado, o site recusa as chamadas e nada é enviado.

## Se o endereço do site mudar

O banco chama `https://espaco-byla-eventos.vercel.app/api/cron/abandoned-reminders`. Se o site ganhar outro domínio, crie no Vault o segredo `reminder_cron_url` com o endereço completo novo, terminando em `/api/cron/abandoned-reminders` e começando com `https://`.

## Detalhes técnicos (para quem mantém o código)

- Banco: `claim_abandoned_order_reminders(limite, teto, versão mínima da política)` reivindica os pedidos numa trava única (execuções sobrepostas não duplicam) e devolve os dados do e-mail; `mark_abandoned_reminder_sent` marca o envio; `release_abandoned_reminder` libera quando o envio falha (até 3 tentativas). Uma reivindicação presa por mais de 30 min (envio que caiu no meio) pode ser refeita; o envio usa chave de idempotência por pedido, então o serviço de e-mail não repete o mesmo lembrete em 24 h.
- Descadastro: token aleatório de 64 caracteres por pedido (`orders.reminder_optout_token`); a tabela `email_reminder_optouts` guarda só o hash SHA-256 do e-mail normalizado. A página `/lembretes/cancelar` só mostra o botão; o registro acontece no POST (`/api/lembretes/cancelar`), porque leitores de e-mail abrem links sozinhos. O e-mail também leva os cabeçalhos `List-Unsubscribe` e `List-Unsubscribe-Post` (descadastro com um clique pelo próprio programa de e-mail).
- Rota: `POST /api/cron/abandoned-reminders` compara `Authorization: Bearer <segredo>` em tempo constante com `REMINDER_CRON_SECRET`; sem a variável, recusa sempre (401).
- Teste das migrations em Postgres temporário: `scripts/db-tests/abandoned-reminders.mjs` (instruções no topo do arquivo).
