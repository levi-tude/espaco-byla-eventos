# Decisão do provedor de pagamento do MVP

**Data:** 2026-09-30 (atualização)  
**Decisão vigente:** **Mercado Pago**, via **Checkout Bricks (Payment Brick)**
com a **API de Orders**, pagamento embutido no site (PIX + cartão), sem login no
Mercado Pago.

## Contexto

O MVP precisa de PIX e cartão com experiência parecida com Sympla/Shotgun:
o comprador paga dentro do site, sem criar conta nem fazer login em carteira.
O cartão é tokenizado no navegador pelo SDK do Mercado Pago (o número não passa
pelo nosso servidor) e as credenciais ficam só em variáveis de ambiente.

O PagBank foi avaliado e integrado em sandbox, mas a conta de **produção**
retornou `allowlist_access_required`. A equipe migrou para o Mercado Pago.

O Checkout Pro (redirect) foi usado primeiro, mas levava o comprador para a
tela do Mercado Pago com login em destaque (obrigatório no modo teste). Foi
substituído pelo Payment Brick em 2026-09-24.

Em 2026-09-30 a integração saiu da API de Payments (marcada no painel como
"será descontinuada"; a documentação diz que segue suportada, mas novidades
só chegam em Orders) para a **API de Orders**.

## Como funciona

- Checkout cria o pedido (`pendente`, reserva de 30 min) e leva para
  `/pedidos/[publicToken]`, que mostra o Payment Brick.
- O servidor cria a cobrança em `POST /v1/orders` (`processing_mode:
  automatic`) com o valor lido do banco, `external_reference = orderId` e
  `X-Idempotency-Key`. Cartão envia `type` `credit_card`/`debit_card` conforme
  o Brick.
- Status: `processed` = pago; `action_required` = aguardando (PIX);
  `failed` = recusado. Cartão recusado volta como HTTP 402 com a order em
  `data` e o motivo em `errors[].details` (`"PAY…: insufficient_amount"`).
- PIX: a página mostra QR Code + copia e cola e consulta o pedido a cada poucos
  segundos (`GET /v1/orders?external_reference=&begin_date=&end_date=`; a busca
  vem sem QR, então a order completa é lida em `GET /v1/orders/{id}`).
- Webhook: configurado **no painel** (Orders não aceita `notification_url`),
  evento "Order (Mercado Pago)", URL `/api/payments/webhook`. O aviso só indica
  a order; o status é sempre relido na API. Apenas **confirma** pagamentos;
  recusa ou PIX expirado não cancelam o pedido.
- Variáveis: `MERCADOPAGO_ACCESS_TOKEN` (servidor) e `MERCADOPAGO_PUBLIC_KEY`
  (repassada ao navegador pela página).

## Credenciais

- Aplicação: Checkout Transparente com **"API de Orders"**, criada na conta
  real Espaço Byla.
- Teste: as **Credenciais de teste** dessa aplicação (prefixo `APP_USR-`,
  pertencem à conta vendedor de teste criada automaticamente). Credenciais
  `TEST-` são recusadas pela API de Orders (`invalid_credentials`). O e-mail do
  comprador precisa terminar em `@testuser.com`. Cartão aprovado: titular
  `APRO`, CPF `12345678909`, cartões da documentação de Orders.
- Produção: credenciais de produção da mesma aplicação + chave PIX cadastrada
  na conta Mercado Pago + webhook em modo produção.

## Referências

- [Payment Brick](https://www.mercadopago.com.br/developers/pt/docs/checkout-bricks/payment-brick/introduction)
- [Checkout API via Orders](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/integration-model)
- [Contas de teste (Orders)](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/resources/test-accounts)
- [Notificações de orders](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/notifications)
