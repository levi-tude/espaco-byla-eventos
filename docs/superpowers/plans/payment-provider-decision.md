# Decisão do provedor de pagamento do MVP

**Data:** 2026-09-24 (atualização)  
**Decisão vigente:** **Mercado Pago**, via **Checkout Bricks (Payment Brick)**,
pagamento embutido no site (PIX + cartão), sem login no Mercado Pago.

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

## Como funciona

- Checkout cria o pedido (`pendente`, reserva de 30 min) e leva para
  `/pedidos/[publicToken]`, que mostra o Payment Brick.
- O servidor cria o pagamento em `POST /v1/payments` com o valor lido do banco,
  `external_reference = orderId` e `X-Idempotency-Key`.
- PIX: a página mostra QR Code + copia e cola e consulta o pedido a cada poucos
  segundos (`/v1/payments/search?external_reference=`) até aprovar.
- Webhook (`notification_url`, só com https público) apenas **confirma**
  pagamentos aprovados; recusa ou PIX expirado não cancelam o pedido.
- Variáveis: `MERCADOPAGO_ACCESS_TOKEN` (servidor) e `MERCADOPAGO_PUBLIC_KEY`
  (repassada ao navegador pela página).

## Credenciais

- Teste: criar, **na conta real** Espaço Byla, uma aplicação Checkout
  Transparente (API de Payments) e usar as **Credenciais de teste** dela
  (prefixo `TEST-`). O e-mail do comprador deve ser diferente do e-mail da
  conta Mercado Pago. Cartão exige valor mínimo (R$ 0,01 só mostra PIX); PIX de
  teste só gera o QR, não pode ser pago.
- Credenciais de contas "vendedor de teste" (`APP_USR-`, com ou sem aplicação
  própria) retornam `Unauthorized use of live credentials` em `/v1/payments`.
- A API de Payments está marcada como "será descontinuada" no painel; migrar
  para a API de Orders antes de depender dela a longo prazo.
- Produção: credenciais de produção da conta Espaço Byla + chave PIX cadastrada
  na conta Mercado Pago.

## Referências

- [Payment Brick](https://www.mercadopago.com.br/developers/pt/docs/checkout-bricks/payment-brick/introduction)
- [Guest flow (sdk-js)](https://github.com/mercadopago/sdk-js/blob/main/docs/bricks/payment-guest.md)
- [Credenciais](https://www.mercadopago.com.br/developers/pt/docs/your-integrations/credentials)
