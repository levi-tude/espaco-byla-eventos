# Decisão do provedor de pagamento do MVP

**Data:** 2026-09-23 (atualização)  
**Decisão vigente:** **Mercado Pago**, via **Checkout Pro** (preferência + redirect).

## Contexto

O MVP precisa de PIX (e, depois, outros meios oferecidos pelo Checkout Pro),
checkout hospedado (sem guardar cartão no nosso servidor), confirmação por
notificação e credenciais só em variáveis de ambiente.

O PagBank foi avaliado e integrado em sandbox, mas a conta de **produção**
retornou `allowlist_access_required` (homologação/allowlist obrigatória via
contato com o PagBank). A equipe decidiu migrar para o Mercado Pago.

## Mercado Pago (escolhido)

- Checkout Pro: cria `preference`, redireciona para `init_point` /
  `sandbox_init_point`.
- `external_reference` correlaciona o pagamento ao `orderId` local.
- Notificações em `notification_url` → webhook consulta
  `GET /v1/payments/{id}` e trata `status=approved`.
- Credenciais de teste e de produção no painel Developers
  (`MERCADOPAGO_ACCESS_TOKEN`).

## O que ficou fora deste repo

- Adapter e testes PagBank foram removidos.
- Conta PagBank da casa pode continuar existindo para outros usos; **não** é
  mais o provedor do app de ingressos.

## Referências

- [Checkout Pro — criar preferência](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/create-payment-preference)
- [Credenciais](https://www.mercadopago.com.br/developers/pt/docs/your-integrations/credentials)
