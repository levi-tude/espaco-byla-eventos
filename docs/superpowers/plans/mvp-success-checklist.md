# Checklist de sucesso do MVP

Revisão dos critérios da seção 10 da especificação. Última atualização:
30/09/2026.

- [x] **Criar eventos com capacidade e preços.** O painel permite criar e
  editar eventos, definir inteira e meia e emitir cortesia pela equipe.
- [x] **Concluir compra e pagamento no site com taxa de marketplace próxima de
  zero.** Pagamento embutido (Mercado Pago Payment Brick + API de Orders), PIX
  e cartão, sem login do comprador. Validado com credenciais de teste (PIX e
  cartão) e em produção com compra real via PIX (29/09) e PIX real gerado pela
  API de Orders (30/09).
- [x] **Manter lista confiável e auditável de pagantes.** A equipe consulta
  participante, tipo, valor, status, pagamento e check-in por evento.
- [x] **Exibir status inequívocos.** A interface usa “Não pago”, “Pago”,
  “Cancelado” e “Check-in”.
- [ ] **Fazer check-in por QR no celular.** Leitura, validação e bloqueio de
  reutilização estão implementados; falta homologar câmera, permissões e rede
  em um celular real no site publicado.
- [ ] **Explicar a operação da porta em cerca de dois minutos.** A tela tem
  câmera, resultado claro e entrada manual, mas o tempo ainda não foi validado
  com Admin/secretaria.
- [x] **Manter o Git sem PII e fazer deploy seguro.** Repositório público com
  e-mail anônimo do GitHub nos commits, sem segredos; deploy na Vercel a partir
  de `main`, com segredos só no ambiente de produção.

## Pendências fora do código

- Compra real de R$ 1,00 pela API de Orders para confirmar o webhook do painel
  e o e-mail automático em produção.
- [x] E-mail dos ingressos (Resend, domínio `espacobyla.online` verificado):
  QR Code de cada ingresso no corpo do e-mail + botão para a página do pedido.
