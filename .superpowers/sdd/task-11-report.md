# Task 11 — Copy, seed fictício e deploy Vercel

## Entregue

- Padronizados os status públicos e da equipe como “Não pago”, “Pago”,
  “Cancelado” e “Check-in”; botões revisados e mantidos curtos.
- Criado `supabase/seed.sql` idempotente com “Noite de Teste”, “Maria Souza” e
  “João Teste”, cobrindo os quatro status de ingresso sem PII real.
- Documentado no README o deploy pela `main`, todas as variáveis de
  `.env.example`, separação de ambientes e a URL do webhook PagBank.
- Criado `docs/superpowers/plans/mvp-success-checklist.md` com cada critério da
  seção 10 marcado como entregue ou lacuna explícita.

## Verificação

- `npm test`: 7 arquivos e 21 testes aprovados.
- `npm run build`: build de produção aprovado.
- Diagnósticos dos arquivos TypeScript alterados: nenhum erro.
- `git diff --check`: aprovado.
- Varredura de PII/segredos: nenhum dado real encontrado; apenas o placeholder
  `PAGBANK_TOKEN=seu-token-de-sandbox` já documentado no README.

## Lacunas externas

Não foi realizado deploy: o repositório não possui remoto Git nem configuração
Vercel. Também permanecem pendentes credenciais e homologação reais de
Supabase/PagBank, câmera em celular e teste operacional com a equipe.

## Avisos existentes

Os testes avisam sobre futura mudança do carregador de configuração do Vite; o
build avisa que a convenção `middleware` do Next.js está obsoleta. Ambos
concluem com sucesso e estão fora do escopo desta tarefa.
