# Capa por upload + galeria de fotos — design

Data: 2026-09-30 · Status: aprovado em conversa (seções 1–3), aguardando revisão deste documento.

## 1. Objetivo

Hoje a capa do evento é só um campo "URL da capa". A equipe quer:

- enviar a **capa** como arquivo (mantendo a opção de colar link);
- montar uma **galeria** de fotos por evento, exibida na página pública.

Público: equipe (Admin/secretaria) no painel; compradores na página do evento.

## 2. Decisões tomadas

| Tema | Decisão |
| --- | --- |
| Escopo | Capa + galeria |
| Exibição da galeria | Grade de miniaturas abaixo da descrição; toque abre tela cheia com setas/deslizar |
| Limite | Até 10 fotos por evento |
| Ordem | Ordem de envio; para reordenar, remove e envia de novo |
| Campo de link da capa | Mantido: enviar arquivo **ou** colar link |
| Onde guardar | Supabase Storage do projeto Espaço Byla Eventos (plano grátis, 1 GB) |
| Como enviar | Navegador envia direto ao Storage com autorização de envio emitida pelo servidor após checar equipe |

Alternativas descartadas: envio via Server Action/rota (limite de ~4,5 MB do corpo na Vercel quebra fotos de celular) e Vercel Blob (mais um serviço sem ganho).

## 3. Experiência da equipe (`EventForm` e página do evento no painel)

**Capa**

- Bloco "Capa do evento" com dois modos: **Enviar imagem** (arquivo) ou **Colar link** (campo atual).
- Após envio: prévia + **Trocar** / **Remover**.
- A capa é gravada ao **Salvar** o evento (como os demais campos). Funciona também em evento novo.

**Galeria ("Fotos do evento")**

- Seção abaixo do formulário, só em evento já salvo. Evento novo mostra: "Salve o evento para adicionar fotos."
- **Adicionar fotos**: seleção múltipla até completar 10; contador "N de 10".
- Cada foto é gravada na hora (sem "Salvar"). **Remover** pede confirmação.
- Estados: "Enviando…" por foto; erro simples ("Não foi possível enviar esta foto. Tente de novo.").

**Regras de arquivo (capa e galeria)**

- Aceita JPG, PNG, WebP (outros tipos recusados com mensagem clara).
- Redução no navegador antes do envio: lado maior ≤ 1920 px, WebP qualidade ~0,85; se o navegador não gerar WebP (ex.: Safari), usa JPEG.
- Trocar/remover arquivo enviado apaga o arquivo antigo do Storage.

## 4. Experiência do comprador (`/eventos/[slug]`)

- Capa no topo, como hoje.
- Galeria abaixo da descrição: grade (2–3 colunas no celular, 4 no computador), miniaturas com `loading="lazy"`.
- Toque/clique abre visualizador em tela cheia: setas, deslizar (touch), teclas ← → e Esc, botão fechar, foco preso no diálogo.
- Sem fotos → seção não aparece.
- Sem dependência nova: componente próprio.

## 5. Armazenamento e dados

**Bucket `event-media`** (Storage, projeto Espaço Byla Eventos)

- Público para leitura (URL pública); sem políticas de escrita para `anon`/`authenticated`.
- `file_size_limit` 5 MB; `allowed_mime_types`: `image/jpeg`, `image/png`, `image/webp`.
- Caminhos gerados **pelo servidor**, com nome aleatório (UUID):
  - capa: `covers/<uuid>.<ext>` (evento pode ainda não existir);
  - galeria: `events/<event_id>/<uuid>.<ext>`.

**Tabela `public.event_images`**

- `id uuid pk`, `event_id uuid not null references events(id) on delete cascade`, `storage_path text not null unique`, `created_at timestamptz not null default now()`.
- Check: `storage_path` segue `events/<event_id>/<uuid>.(webp|jpg|png)` e o `<event_id>` do caminho é o da linha.
- Índice `(event_id, created_at)`.
- RLS ligada:
  - leitura pública igual a `events_public_read` (evento com venda aberta, ou equipe);
  - **sem** política de escrita para `anon`/`authenticated` → escrita só via `service_role` em Server Actions após `assertStaff`.
- Trigger `BEFORE INSERT` garante **no máximo 10** por evento, com trava por evento (`pg_advisory_xact_lock`) contra envios simultâneos. Função com `search_path` fixo; `REVOKE` de `public, anon, authenticated`.

**Capa**

- Continua em `events.cover_image_url`: URL pública do bucket (quando enviada) ou link colado.
- É "nossa" se começa com `<SUPABASE_URL>/storage/v1/object/public/event-media/covers/`. Só essas são apagadas ao trocar/remover; links externos nunca.

## 6. Fluxos (servidor)

Todas as ações abaixo são Server Actions em `src/app/equipe/eventos/…`, no padrão `runAction` / `ActionError` / `ActionResult`, com `assertStaff()` **dentro** de cada uma. O cliente do Storage com `service_role` fica em módulo `server-only`.

1. **`requestImageUpload(target, eventId?, contentType)`**
   - valida `contentType` (lista acima) e, para galeria, `eventId` (UUID, evento existe, < 10 fotos);
   - gera caminho aleatório e chama `createSignedUploadUrl` (sem `upsert`: não sobrescreve);
   - devolve `{ path, token }`. O cliente envia com `uploadToSignedUrl`.
2. **`addEventImage(eventId, path)`**
   - confere prefixo `events/<eventId>/`, formato do nome e que o objeto existe no bucket;
   - insere em `event_images` (trigger barra a 11ª); em falha, apaga o objeto enviado;
   - `revalidateEventSurfaces`.
3. **`removeEventImage(eventId, imageId)`** — apaga linha e objeto; revalida.
4. **Capa** — `createEvent`/`updateEvent` continuam recebendo `coverImageUrl`. Se a nova URL é do nosso bucket, valida que aponta para `covers/` e que o objeto existe. Ao mudar/remover, apaga a capa antiga se for nossa (falha ao apagar só gera log).

Leitura pública: a página do evento busca `event_images` pelo cliente de servidor atual (RLS) e monta URLs públicas.

## 7. Segurança (resumo)

- Toda ação revalida login + equipe no servidor; entradas validadas (UUID, tipo, caminho).
- Nome do arquivo decidido pelo servidor; autorização de envio de uso único (validade definida pelo Supabase).
- Bucket limita tamanho e tipo (defesa em profundidade além do navegador).
- Limite de 10 no banco, não só na tela.
- CSP atual já cobre: `img-src https:` (exibição) e `connect-src` com a URL do Supabase (envio).
- Sem PII nas fotos/caminhos; mensagens de erro genéricas, detalhe só no log.

## 8. Riscos conhecidos / fora do escopo

- Capa enviada e evento nunca salvo deixa arquivo órfão em `covers/` (pequeno; limpeza manual futura se necessário).
- Apagar evento remove as linhas de `event_images`, mas não os arquivos (não há exclusão de evento na UI hoje).
- Fora do escopo: reordenar por arrastar, legendas, vídeo, recorte de imagem.

## 9. Testes

- Vitest (mocks de Supabase):
  - quem não é equipe → recusado em todas as ações;
  - tipo de arquivo inválido → recusado;
  - caminho de outro evento / fora do padrão → recusado;
  - 11ª foto → recusada;
  - remover → apaga linha e objeto;
  - capa: apaga antiga só quando é nossa.
- Utilitário de redução de imagem: cálculo de dimensões e escolha de formato.
- Verificação manual no navegador (local): enviar capa, colar link, adicionar/remover fotos, galeria em tela cheia no celular e no computador.

## 10. Mudanças no banco (exigem aprovação na execução)

Via MCP `user-supabase-eventos`, projeto **Espaço Byla Eventos** (`rlzyjlrcasqbjztgbgit`), após conferir as tabelas `events`, `tickets`, `orders`, `ticket_types`, `staff_profiles`:

- criar bucket `event-media` (config acima);
- migration `event_images` (tabela, RLS, políticas, trigger, revokes);
- atualizar `src/types/database.ts`.
