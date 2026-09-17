# Decisão do provedor de pagamento do MVP

**Data:** 2026-09-17
**Decisão:** PagBank, via Checkout hospedado e inicialmente apenas PIX.

## Critérios avaliados

O MVP precisa aceitar PIX de qualquer banco, redirecionar o comprador para um
checkout seguro, confirmar o pagamento automaticamente por webhook e caber no
prazo sem armazenar dados de cartão. Também pesam a facilidade de testar em
sandbox e o fato de o Espaço Byla já operar com o PagBank.

### PagBank

- A API de Checkout cria uma sessão e devolve um link `PAY` hospedado.
- O checkout permite restringir `payment_methods` a `PIX`.
- `payment_notification_urls` recebe mudanças transacionais; `PAID` significa
  pagamento capturado.
- A autenticidade do webhook pode ser conferida por SHA-256 de
  `{token}-{corpo bruto}`, comparado a `x-authenticity-token`.
- O `reference_id` acompanha a transação e permite correlacioná-la ao pedido
  local de forma idempotente.
- Há ambiente próprio em `https://sandbox.api.pagseguro.com`.

### Mercado Pago

- O Checkout Pro também oferece checkout hospedado, PIX e notificações em tempo
  real para pagamentos `approved`.
- A notificação informa o ID do pagamento; a integração normalmente consulta a
  API de pagamentos para confirmar status e recuperar `external_reference`.
- Tem documentação e SDKs maduros, mas adicionaria essa consulta no webhook e
  não traz vantagem decisiva para o prazo atual.

## Conclusão

O PagBank atende todos os requisitos obrigatórios sem aumentar o escopo e ainda
preserva a preferência operacional definida na especificação. O adapter usa
HTTP nativo, evitando dependência de SDK, e começa em sandbox. O Mercado Pago
fica como alternativa caso a homologação real revele bloqueio de conta, prazo
ou comportamento de webhook.

Cartão pode ser habilitado em uma decisão posterior; incluí-lo agora exigiria
revisar regras, experiência e homologação. Credenciais ficam exclusivamente em
variáveis de ambiente.

## Referências oficiais

- [PagBank — Criar Checkout](https://developer.pagbank.com.br/reference/criar-checkout)
- [PagBank — Webhooks do Checkout](https://developer.pagbank.com.br/reference/webhooks-checkout)
- [PagBank — Autenticidade da notificação](https://developer.pagbank.com.br/reference/confirmar-autenticidade-da-notificacao)
- [Mercado Pago — Notificações de pagamento](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/payment-notifications)
