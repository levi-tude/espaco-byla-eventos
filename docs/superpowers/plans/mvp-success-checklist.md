# Checklist de sucesso do MVP

Revisão dos critérios da seção 10 da especificação em 17/09/2026.

- [x] **Criar eventos com capacidade e preços.** O painel permite criar e
  editar eventos, definir inteira e meia e emitir cortesia pela equipe.
- [ ] **Concluir compra e pagamento no site com taxa de marketplace próxima de
  zero.** Checkout Pro (Mercado Pago) implementado; faltam validação ponta a
  ponta com credenciais de teste/produção e URL pública.
- [x] **Manter lista confiável e auditável de pagantes.** A equipe consulta
  participante, tipo, valor, status, pagamento e check-in por evento.
- [x] **Exibir status inequívocos.** A interface usa “Não pago”, “Pago”,
  “Cancelado” e “Check-in”.
- [ ] **Fazer check-in por QR no celular.** Leitura, validação e bloqueio de
  reutilização estão implementados; falta homologar câmera, permissões e rede
  em um celular real com Supabase publicado.
- [ ] **Explicar a operação da porta em cerca de dois minutos.** A tela tem
  câmera, resultado claro e entrada manual, mas o tempo ainda não foi validado
  com Admin/secretaria.
- [ ] **Manter o Git sem PII e fazer deploy seguro.** O conteúdo versionado e o
  seed usam somente dados fictícios e nenhum segredo; ainda não há remoto Git
  nem projeto Vercel configurado para validar o deploy de produção.
