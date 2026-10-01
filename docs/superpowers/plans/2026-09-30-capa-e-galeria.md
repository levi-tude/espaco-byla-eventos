# Capa por upload + galeria de fotos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A equipe envia a capa do evento como arquivo (ou cola um link) e monta uma galeria de até 10 fotos, exibida na página pública com visualizador em tela cheia.

**Architecture:** Fotos ficam no bucket público `event-media` do Supabase Storage. O navegador reduz a imagem e envia direto ao Storage com um token de envio de uso único, emitido por Server Action após `assertStaff()`. A galeria é registrada na tabela `event_images` (RLS, limite de 10 por trigger); a capa continua em `events.cover_image_url`.

**Tech Stack:** Next.js 16.3.8 (App Router, Server Actions), Supabase (`@supabase/supabase-js` 2.116 — `createSignedUploadUrl`, `uploadToSignedUrl`, `exists`, `remove`), Tailwind 4, `lucide-react` (já instalado), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-30-capa-e-galeria-design.md`

## Global Constraints

- Nenhuma dependência nova.
- Bucket: `event-media`; público só leitura; `file_size_limit` 5 MB (5242880); tipos `image/jpeg`, `image/png`, `image/webp`.
- Caminhos gerados no servidor: capa `covers/<uuid>.<ext>`, galeria `events/<event_id>/<uuid>.<ext>`; `<ext>` ∈ `webp|jpg|png`.
- Máximo **10** fotos por evento (tela + Server Action + trigger no banco).
- Redução no navegador: lado maior ≤ **1920 px**, WebP qualidade 0,85; se o navegador não gerar WebP, JPEG 0,85.
- Toda Server Action chama `assertStaff()` **antes** de qualquer acesso ao banco/Storage; retorno via `runAction` / `ActionError` / `ActionResult` (`src/lib/action-result.ts`).
- Cliente com `service_role` só em módulos `import "server-only"`.
- Arquivos `"use server"` só exportam funções `async` (tipos podem ser exportados); constantes ficam em `src/lib/media/rules.ts`.
- Textos de tela em português simples (equipe/comprador); erros genéricos para o usuário, detalhe só em `console.error`.
- Banco: só MCP `user-supabase-eventos`, projeto **Espaço Byla Eventos** (`rlzyjlrcasqbjztgbgit`). Antes de aplicar migration: declarar MCP + projeto no chat, conferir tabelas `events`, `tickets`, `orders`, `ticket_types`, `staff_profiles` e **pedir aprovação do usuário**. Se aparecer `alunos`/`transacoes`/`fluxo_*` → parar.
- Deploy (push em `main`) só com aprovação do usuário.
- `<img>` com `{/* eslint-disable-next-line @next/next/no-img-element */}` (padrão do projeto).

## File Structure

| Arquivo | Responsabilidade |
| --- | --- |
| `supabase/migrations/20261001120000_event_media.sql` (novo) | Bucket, tabela `event_images`, RLS, trigger do limite |
| `src/types/database.ts` (mod.) | Tipos de `event_images` |
| `src/lib/media/rules.ts` (novo) | Constantes, mensagens, `isUuid`, `isImageContentType` |
| `src/lib/media/paths.ts` (novo) | Montar/validar caminhos e URLs públicas |
| `src/lib/media/resize.ts` (novo) | Redução da imagem no navegador |
| `src/lib/media/storage.ts` (novo, server-only) | Token de envio, existe?, apagar |
| `src/lib/media/upload-client.ts` (novo) | Fluxo de envio no navegador |
| `src/lib/auth/staff.ts` (novo) | `assertStaff()` compartilhado |
| `src/app/equipe/eventos/media-actions.ts` (novo) | `requestImageUpload`, `addEventImage`, `removeEventImage` |
| `src/app/equipe/eventos/actions.ts` (mod.) | Usa `assertStaff` compartilhado; valida/limpa capa |
| `src/components/equipe/CoverField.tsx` (novo) | Campo "Capa do evento" (enviar ou colar link) |
| `src/components/equipe/EventForm.tsx` (mod.) | Usa `CoverField` |
| `src/components/equipe/EventGalleryManager.tsx` (novo) | Seção "Fotos do evento" no painel |
| `src/components/public/EventGallery.tsx` (novo) | Grade + tela cheia na página pública |
| `src/app/equipe/eventos/[id]/page.tsx`, `novo/page.tsx`, `src/app/eventos/[slug]/page.tsx` (mod.) | Buscar/exibir fotos |
| `tests/media/paths.test.ts`, `tests/media/resize.test.ts`, `tests/equipe/media-actions.test.ts`, `tests/equipe/event-cover.test.ts` (novos), `tests/equipe/staff-actions.test.ts` (mod.) | Testes |

---

### Task 1: Banco — bucket, tabela `event_images`, limite de 10

**Files:**
- Create: `supabase/migrations/20261001120000_event_media.sql`
- Modify: `src/types/database.ts` (bloco `Tables`, após `events`)

**Interfaces:**
- Produces: bucket `event-media`; tabela `public.event_images(id uuid, event_id uuid, storage_path text, created_at timestamptz)`; erro do trigger contém `Limite de 10 fotos`; unique em `storage_path` (código `23505`).

- [ ] **Step 1: Escrever a migration**

```sql
-- Fotos dos eventos: capa enviada pela equipe e galeria (até 10 por evento).
-- Leitura pública só pelas URLs do bucket; escrita só pelo servidor (service_role).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'event-media',
  'event-media',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table public.event_images (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  storage_path text not null unique,
  created_at timestamptz not null default now(),
  constraint event_images_path_format check (
    storage_path ~ (
      '^events/' || event_id::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg|png)$'
    )
  )
);

create index event_images_event_created_idx
  on public.event_images (event_id, created_at);

alter table public.event_images enable row level security;
revoke all on table public.event_images from public, anon, authenticated;
grant select on table public.event_images to anon, authenticated;

create policy event_images_public_read on public.event_images
  for select using (
    exists (
      select 1
      from public.events e
      where e.id = event_id and e.sales_open = true
    )
    or public.is_staff()
  );

create or replace function public.enforce_event_images_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- Serializa envios do mesmo evento para a contagem não estourar o limite.
  perform pg_advisory_xact_lock(hashtextextended('event_images:' || new.event_id::text, 0));

  select count(*) into v_count
  from public.event_images
  where event_id = new.event_id;

  if v_count >= 10 then
    raise exception 'Limite de 10 fotos por evento atingido.' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_event_images_limit() from public, anon, authenticated;

create trigger event_images_limit
  before insert on public.event_images
  for each row execute function public.enforce_event_images_limit();
```

- [ ] **Step 2: Gate de segurança antes de aplicar**

No chat: "Vou usar o MCP `user-supabase-eventos`, projeto Espaço Byla Eventos (`rlzyjlrcasqbjztgbgit`)". Rodar `list_tables` (schemas `public`) e confirmar `events`, `tickets`, `orders`, `ticket_types`, `staff_profiles` e ausência de `alunos`/`transacoes`/`fluxo_*`. **Pedir aprovação explícita do usuário** para criar o bucket e a tabela. Sem aprovação, parar.

- [ ] **Step 3: Aplicar via MCP**

`apply_migration` com `name: "event_media"` e o SQL do Step 1.

- [ ] **Step 4: Verificar no banco**

`execute_sql`:

```sql
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'event-media';
select relrowsecurity from pg_class where oid = 'public.event_images'::regclass;
select has_table_privilege('anon', 'public.event_images', 'INSERT') as anon_insert,
       has_table_privilege('authenticated', 'public.event_images', 'INSERT') as auth_insert,
       has_table_privilege('anon', 'public.event_images', 'SELECT') as anon_select;
select tgname from pg_trigger where tgrelid = 'public.event_images'::regclass and not tgisinternal;
```

Expected: bucket `public = true`, `5242880`, 3 tipos; `relrowsecurity = true`; `anon_insert = false`, `auth_insert = false`, `anon_select = true`; trigger `event_images_limit`. Depois `get_advisors` (security): nenhum alerta novo sobre `event_images`/`enforce_event_images_limit`.

- [ ] **Step 5: Tipos em `src/types/database.ts`** — inserir logo após o fechamento do bloco `events` (antes de `orders: {`):

```ts
      event_images: {
        Row: {
          created_at: string;
          event_id: string;
          id: string;
          storage_path: string;
        };
        Insert: {
          created_at?: string;
          event_id: string;
          id?: string;
          storage_path: string;
        };
        Update: {
          created_at?: string;
          event_id?: string;
          id?: string;
          storage_path?: string;
        };
        Relationships: [
          {
            foreignKeyName: "event_images_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
```

- [ ] **Step 6: Checar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261001120000_event_media.sql src/types/database.ts
git commit -m "feat(midia): bucket event-media e tabela event_images com limite de 10"
```

---

### Task 2: Regras e caminhos de mídia (funções puras)

**Files:**
- Create: `src/lib/media/rules.ts`, `src/lib/media/paths.ts`
- Test: `tests/media/paths.test.ts`

**Interfaces:**
- Produces (`rules.ts`): `MEDIA_BUCKET = "event-media"`, `MAX_GALLERY_IMAGES = 10`, `MAX_IMAGE_BYTES`, `IMAGE_ACCEPT`, `type ImageContentType`, `isImageContentType(v): v is ImageContentType`, `isUuid(v): v is string`, mensagens `INVALID_IMAGE_TYPE_MESSAGE`, `IMAGE_TOO_LARGE_MESSAGE`, `GALLERY_FULL_MESSAGE`, `UPLOAD_FAILED_MESSAGE`, `COVER_NOT_FOUND_MESSAGE`.
- Produces (`paths.ts`): `buildCoverPath(type, id?)`, `buildGalleryPath(eventId, type, id?)`, `isCoverPath(path)`, `isGalleryPathForEvent(path, eventId)`, `publicMediaUrl(supabaseUrl, path)`, `isOwnMediaUrl(supabaseUrl, url)`, `coverPathFromUrl(supabaseUrl, url): string | null`.

- [ ] **Step 1: Teste que falha** — `tests/media/paths.test.ts`

```ts
import { describe, expect, it } from "vitest";

import {
  buildCoverPath,
  buildGalleryPath,
  coverPathFromUrl,
  isCoverPath,
  isGalleryPathForEvent,
  isOwnMediaUrl,
  publicMediaUrl,
} from "@/lib/media/paths";
import { isImageContentType, isUuid } from "@/lib/media/rules";

const supabaseUrl = "https://proj.supabase.co";
const eventId = "00000000-0000-4000-8000-000000000001";
const otherEventId = "00000000-0000-4000-8000-000000000002";
const fileId = "11111111-1111-4111-8111-111111111111";

describe("regras de mídia", () => {
  it("aceita só JPG, PNG e WebP", () => {
    expect(isImageContentType("image/webp")).toBe(true);
    expect(isImageContentType("image/jpeg")).toBe(true);
    expect(isImageContentType("image/png")).toBe(true);
    expect(isImageContentType("image/gif")).toBe(false);
    expect(isImageContentType("image/svg+xml")).toBe(false);
    expect(isImageContentType(undefined)).toBe(false);
  });

  it("reconhece UUID em minúsculas", () => {
    expect(isUuid(eventId)).toBe(true);
    expect(isUuid("../../etc")).toBe(false);
    expect(isUuid(123)).toBe(false);
  });
});

describe("caminhos de mídia", () => {
  it("monta caminho da capa com extensão pelo tipo", () => {
    expect(buildCoverPath("image/webp", fileId)).toBe(`covers/${fileId}.webp`);
    expect(buildCoverPath("image/jpeg", fileId)).toBe(`covers/${fileId}.jpg`);
    expect(isCoverPath(buildCoverPath("image/png"))).toBe(true);
  });

  it("monta caminho da galeria dentro da pasta do evento", () => {
    const path = buildGalleryPath(eventId, "image/webp", fileId);
    expect(path).toBe(`events/${eventId}/${fileId}.webp`);
    expect(isGalleryPathForEvent(path, eventId)).toBe(true);
    expect(isGalleryPathForEvent(path, otherEventId)).toBe(false);
  });

  it("recusa caminhos fora do padrão", () => {
    expect(isCoverPath(`covers/${fileId}.gif`)).toBe(false);
    expect(isCoverPath(`covers/../${fileId}.webp`)).toBe(false);
    expect(isGalleryPathForEvent(`events/${eventId}/../x.webp`, eventId)).toBe(false);
    expect(isGalleryPathForEvent(`covers/${fileId}.webp`, eventId)).toBe(false);
  });

  it("monta URL pública e identifica capa nossa", () => {
    const url = publicMediaUrl(`${supabaseUrl}/`, `covers/${fileId}.webp`);
    expect(url).toBe(`${supabaseUrl}/storage/v1/object/public/event-media/covers/${fileId}.webp`);
    expect(isOwnMediaUrl(supabaseUrl, url)).toBe(true);
    expect(coverPathFromUrl(supabaseUrl, url)).toBe(`covers/${fileId}.webp`);
  });

  it("links externos ou de galeria não contam como capa nossa", () => {
    expect(coverPathFromUrl(supabaseUrl, "https://exemplo.com/capa.jpg")).toBeNull();
    expect(coverPathFromUrl(supabaseUrl, null)).toBeNull();
    const galleryUrl = publicMediaUrl(supabaseUrl, `events/${eventId}/${fileId}.webp`);
    expect(isOwnMediaUrl(supabaseUrl, galleryUrl)).toBe(true);
    expect(coverPathFromUrl(supabaseUrl, galleryUrl)).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/media/paths.test.ts`
Expected: FAIL (módulos não existem).

- [ ] **Step 3: `src/lib/media/rules.ts`**

```ts
export const MEDIA_BUCKET = "event-media";
export const MAX_GALLERY_IMAGES = 10;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const IMAGE_EXTENSIONS = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
} as const;

export type ImageContentType = keyof typeof IMAGE_EXTENSIONS;

export const IMAGE_ACCEPT = Object.keys(IMAGE_EXTENSIONS).join(",");

export const INVALID_IMAGE_TYPE_MESSAGE = "Use uma imagem JPG, PNG ou WebP.";
export const IMAGE_TOO_LARGE_MESSAGE = "A imagem ficou grande demais. Tente outra foto.";
export const GALLERY_FULL_MESSAGE = `A galeria já tem ${MAX_GALLERY_IMAGES} fotos. Remova uma para adicionar outra.`;
export const UPLOAD_FAILED_MESSAGE = "Não foi possível enviar esta foto. Tente de novo.";
export const COVER_NOT_FOUND_MESSAGE = "A capa enviada não foi encontrada. Envie a imagem de novo.";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function isImageContentType(value: unknown): value is ImageContentType {
  return typeof value === "string" && Object.hasOwn(IMAGE_EXTENSIONS, value);
}

export function imageExtension(contentType: ImageContentType): string {
  return IMAGE_EXTENSIONS[contentType];
}
```

- [ ] **Step 4: `src/lib/media/paths.ts`**

```ts
import { imageExtension, type ImageContentType, MEDIA_BUCKET } from "@/lib/media/rules";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const COVER_PATH_RE = new RegExp(`^covers/${UUID}\\.(webp|jpg|png)$`);
const GALLERY_PATH_RE = new RegExp(`^events/(${UUID})/${UUID}\\.(webp|jpg|png)$`);

export function buildCoverPath(
  contentType: ImageContentType,
  id: string = crypto.randomUUID(),
): string {
  return `covers/${id}.${imageExtension(contentType)}`;
}

export function buildGalleryPath(
  eventId: string,
  contentType: ImageContentType,
  id: string = crypto.randomUUID(),
): string {
  return `events/${eventId}/${id}.${imageExtension(contentType)}`;
}

export function isCoverPath(path: string): boolean {
  return COVER_PATH_RE.test(path);
}

export function isGalleryPathForEvent(path: string, eventId: string): boolean {
  return GALLERY_PATH_RE.exec(path)?.[1] === eventId;
}

export function publicMediaUrl(supabaseUrl: string, path: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${MEDIA_BUCKET}/${path}`;
}

export function isOwnMediaUrl(supabaseUrl: string, url: string): boolean {
  return url.startsWith(publicMediaUrl(supabaseUrl, ""));
}

/** Caminho no bucket quando a capa foi enviada por nós; `null` para links externos. */
export function coverPathFromUrl(
  supabaseUrl: string,
  url: string | null | undefined,
): string | null {
  if (!url || !isOwnMediaUrl(supabaseUrl, url)) return null;
  const path = url.slice(publicMediaUrl(supabaseUrl, "").length);
  return isCoverPath(path) ? path : null;
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run tests/media/paths.test.ts`
Expected: PASS (7 testes).

- [ ] **Step 6: Commit**

```bash
git add src/lib/media/rules.ts src/lib/media/paths.ts tests/media/paths.test.ts
git commit -m "feat(midia): regras e caminhos das fotos"
```

---

### Task 3: Redução de imagem no navegador

**Files:**
- Create: `src/lib/media/resize.ts`
- Test: `tests/media/resize.test.ts`

**Interfaces:**
- Produces: `MAX_IMAGE_DIMENSION = 1920`, `fitWithin(width, height, max?) => { width, height }`, `resizeImage(file: File): Promise<Blob>` (tipo do Blob: `image/webp` ou `image/jpeg`).

- [ ] **Step 1: Teste que falha** — `tests/media/resize.test.ts`

```ts
import { describe, expect, it } from "vitest";

import { fitWithin, MAX_IMAGE_DIMENSION } from "@/lib/media/resize";

describe("fitWithin", () => {
  it("reduz mantendo a proporção pelo lado maior", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1920, height: 1440 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1440, height: 1920 });
  });

  it("não aumenta imagem pequena", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("nunca devolve dimensão zero", () => {
    expect(fitWithin(10000, 1)).toEqual({ width: MAX_IMAGE_DIMENSION, height: 1 });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/media/resize.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: `src/lib/media/resize.ts`**

```ts
export const MAX_IMAGE_DIMENSION = 1920;
const QUALITY = 0.85;

export function fitWithin(
  width: number,
  height: number,
  max: number = MAX_IMAGE_DIMENSION,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
}

/** Só no navegador. Safari não gera WebP pelo canvas, então cai para JPEG. */
export async function resizeImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas indisponível.");
    context.drawImage(bitmap, 0, 0, width, height);

    const webp = await canvasToBlob(canvas, "image/webp");
    if (webp?.type === "image/webp") return webp;

    const jpeg = await canvasToBlob(canvas, "image/jpeg");
    if (!jpeg) throw new Error("Não foi possível gerar a imagem.");
    return jpeg;
  } finally {
    bitmap.close();
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/media/resize.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/media/resize.ts tests/media/resize.test.ts
git commit -m "feat(midia): reduz a foto no navegador antes do envio"
```

---

### Task 4: `assertStaff` compartilhado + Server Actions da galeria

**Files:**
- Create: `src/lib/auth/staff.ts`, `src/lib/media/storage.ts`, `src/app/equipe/eventos/media-actions.ts`
- Modify: `src/app/equipe/eventos/actions.ts` (remover `assertStaff` local, linhas ~102-106; importar do módulo novo)
- Modify: `tests/equipe/staff-actions.test.ts` (adicionar mock de `server-only`)
- Test: `tests/equipe/media-actions.test.ts`

**Interfaces:**
- Consumes: Task 2 (`rules.ts`, `paths.ts`); Task 1 (tabela `event_images`).
- Produces:
  - `assertStaff(): Promise<void>` e `STAFF_ONLY_MESSAGE = "Acesso restrito à equipe."` em `@/lib/auth/staff`.
  - `createUploadToken(path): Promise<string>`, `mediaObjectExists(path): Promise<boolean>`, `removeMediaObjects(paths: string[]): Promise<void>` em `@/lib/media/storage`.
  - `type UploadTarget = "cover" | "gallery"`, `type UploadTicket = { path: string; token: string }`,
    `requestImageUpload(target, contentType, eventId?): Promise<ActionResult<UploadTicket>>`,
    `addEventImage(eventId, path): Promise<ActionResult<{ id: string; url: string }>>`,
    `removeEventImage(eventId, imageId): Promise<ActionResult>` em `@/app/equipe/eventos/media-actions`.

- [ ] **Step 1: Teste que falha** — `tests/equipe/media-actions.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  createAdminClient: vi.fn(),
  createUploadToken: vi.fn(),
  mediaObjectExists: vi.fn(),
  removeMediaObjects: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/media/storage", () => ({
  createUploadToken: mocks.createUploadToken,
  mediaObjectExists: mocks.mediaObjectExists,
  removeMediaObjects: mocks.removeMediaObjects,
}));

import {
  addEventImage,
  removeEventImage,
  requestImageUpload,
} from "@/app/equipe/eventos/media-actions";
import {
  GALLERY_FULL_MESSAGE,
  INVALID_IMAGE_TYPE_MESSAGE,
} from "@/lib/media/rules";

const eventId = "00000000-0000-4000-8000-000000000001";
const otherEventId = "00000000-0000-4000-8000-000000000002";
const imageId = "00000000-0000-4000-8000-000000000003";
const galleryPath = `events/${eventId}/11111111-1111-4111-8111-111111111111.webp`;

type Result = { data?: unknown; count?: number | null; error?: unknown };

function table(result: Result) {
  const settled = {
    data: result.data ?? null,
    count: result.count ?? null,
    error: result.error ?? null,
  };
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => settled),
    single: vi.fn(async () => settled),
    then: (resolve: (value: typeof settled) => unknown) => resolve(settled),
  };
  return chain;
}

function useTables(tables: Record<string, ReturnType<typeof table>>) {
  mocks.createAdminClient.mockReturnValue({ from: (name: string) => tables[name] });
  return tables;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.createUploadToken.mockResolvedValue("token-de-envio");
  mocks.mediaObjectExists.mockResolvedValue(true);
});

describe("ações de fotos sem login de equipe", () => {
  const actions = {
    requestImageUpload: () => requestImageUpload("gallery", "image/webp", eventId),
    addEventImage: () => addEventImage(eventId, galleryPath),
    removeEventImage: () => removeEventImage(eventId, imageId),
  };

  it.each(Object.entries(actions))("%s é recusada antes de tocar no banco", async (_n, action) => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect(await action()).toEqual({ ok: false, error: "Acesso restrito à equipe." });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.createUploadToken).not.toHaveBeenCalled();
    expect(mocks.removeMediaObjects).not.toHaveBeenCalled();
  });
});

describe("requestImageUpload", () => {
  it("recusa tipo de arquivo não permitido", async () => {
    expect(await requestImageUpload("cover", "image/gif")).toEqual({
      ok: false,
      error: INVALID_IMAGE_TYPE_MESSAGE,
    });
    expect(mocks.createUploadToken).not.toHaveBeenCalled();
  });

  it("capa recebe caminho aleatório em covers/", async () => {
    const result = await requestImageUpload("cover", "image/webp");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.path).toMatch(/^covers\/[0-9a-f-]{36}\.webp$/);
    expect(result.data.token).toBe("token-de-envio");
  });

  it("galeria recusa evento inválido", async () => {
    expect(await requestImageUpload("gallery", "image/webp", "../x")).toEqual({
      ok: false,
      error: "Evento inválido.",
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("galeria cheia não recebe autorização de envio", async () => {
    useTables({
      events: table({ data: { slug: "show" } }),
      event_images: table({ count: 10 }),
    });
    expect(await requestImageUpload("gallery", "image/jpeg", eventId)).toEqual({
      ok: false,
      error: GALLERY_FULL_MESSAGE,
    });
    expect(mocks.createUploadToken).not.toHaveBeenCalled();
  });

  it("galeria com espaço recebe caminho dentro da pasta do evento", async () => {
    useTables({
      events: table({ data: { slug: "show" } }),
      event_images: table({ count: 3 }),
    });
    const result = await requestImageUpload("gallery", "image/jpeg", eventId);
    expect(result.ok && result.data.path.startsWith(`events/${eventId}/`)).toBe(true);
    expect(result.ok && result.data.path.endsWith(".jpg")).toBe(true);
  });
});

describe("addEventImage", () => {
  it("recusa foto de outro evento sem tocar no banco", async () => {
    expect(await addEventImage(otherEventId, galleryPath)).toEqual({
      ok: false,
      error: "Foto inválida.",
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("recusa quando o arquivo não chegou ao armazenamento", async () => {
    const tables = useTables({
      events: table({ data: { slug: "show" } }),
      event_images: table({ data: { id: imageId } }),
    });
    mocks.mediaObjectExists.mockResolvedValue(false);
    const result = await addEventImage(eventId, galleryPath);
    expect(result.ok).toBe(false);
    expect(tables.event_images.insert).not.toHaveBeenCalled();
  });

  it("11ª foto: banco recusa, arquivo é apagado", async () => {
    useTables({
      events: table({ data: { slug: "show" } }),
      event_images: table({
        error: { code: "23514", message: "Limite de 10 fotos por evento atingido." },
      }),
    });
    expect(await addEventImage(eventId, galleryPath)).toEqual({
      ok: false,
      error: GALLERY_FULL_MESSAGE,
    });
    expect(mocks.removeMediaObjects).toHaveBeenCalledWith([galleryPath]);
  });

  it("foto repetida não apaga o arquivo que já está em uso", async () => {
    useTables({
      events: table({ data: { slug: "show" } }),
      event_images: table({ error: { code: "23505", message: "duplicate key" } }),
    });
    const result = await addEventImage(eventId, galleryPath);
    expect(result).toEqual({ ok: false, error: "Esta foto já foi adicionada." });
    expect(mocks.removeMediaObjects).not.toHaveBeenCalled();
  });

  it("registra a foto e devolve a URL pública", async () => {
    const tables = useTables({
      events: table({ data: { slug: "show" } }),
      event_images: table({ data: { id: imageId } }),
    });
    expect(await addEventImage(eventId, galleryPath)).toEqual({
      ok: true,
      data: {
        id: imageId,
        url: `https://proj.supabase.co/storage/v1/object/public/event-media/${galleryPath}`,
      },
    });
    expect(tables.event_images.insert).toHaveBeenCalledWith({
      event_id: eventId,
      storage_path: galleryPath,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/eventos/show");
  });
});

describe("removeEventImage", () => {
  it("apaga o registro e o arquivo", async () => {
    const tables = useTables({
      events: table({ data: { slug: "show" } }),
      event_images: table({ data: { storage_path: galleryPath } }),
    });
    expect(await removeEventImage(eventId, imageId)).toEqual({ ok: true, data: undefined });
    expect(tables.event_images.delete).toHaveBeenCalled();
    expect(mocks.removeMediaObjects).toHaveBeenCalledWith([galleryPath]);
  });

  it("foto inexistente devolve mensagem clara", async () => {
    useTables({
      events: table({ data: { slug: "show" } }),
      event_images: table({ data: null }),
    });
    expect(await removeEventImage(eventId, imageId)).toEqual({
      ok: false,
      error: "Foto não encontrada.",
    });
    expect(mocks.removeMediaObjects).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/equipe/media-actions.test.ts`
Expected: FAIL (módulo `media-actions` não existe).

- [ ] **Step 3: `src/lib/auth/staff.ts`**

```ts
import { ActionError } from "@/lib/action-result";
import { createServerClient } from "@/lib/supabase/server";

export const STAFF_ONLY_MESSAGE = "Acesso restrito à equipe.";

export async function assertStaff(): Promise<void> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("is_staff");
  if (error || !data) throw new ActionError(STAFF_ONLY_MESSAGE);
}
```

(`@/lib/supabase/server` já é `server-only`.)

- [ ] **Step 4: `src/lib/media/storage.ts`**

```ts
import "server-only";

import { MEDIA_BUCKET } from "@/lib/media/rules";
import { createAdminClient } from "@/lib/supabase/admin";

function bucket() {
  return createAdminClient().storage.from(MEDIA_BUCKET);
}

/** Token de envio de uso único; sem upsert, não sobrescreve arquivo existente. */
export async function createUploadToken(path: string): Promise<string> {
  const { data, error } = await bucket().createSignedUploadUrl(path);
  if (error || !data) throw new Error(`Falha ao autorizar envio: ${error?.message}`);
  return data.token;
}

export async function mediaObjectExists(path: string): Promise<boolean> {
  const { data } = await bucket().exists(path);
  return data === true;
}

/** Falha ao apagar só vai para o log: não deve desfazer a ação da equipe. */
export async function removeMediaObjects(paths: string[]): Promise<void> {
  if (!paths.length) return;
  const { error } = await bucket().remove(paths);
  if (error) console.error("[midia] Falha ao apagar arquivo.", error.message);
}
```

- [ ] **Step 5: `src/app/equipe/eventos/media-actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";

import { ActionError, type ActionResult, runAction } from "@/lib/action-result";
import { assertStaff } from "@/lib/auth/staff";
import {
  buildCoverPath,
  buildGalleryPath,
  isGalleryPathForEvent,
  publicMediaUrl,
} from "@/lib/media/paths";
import {
  GALLERY_FULL_MESSAGE,
  INVALID_IMAGE_TYPE_MESSAGE,
  isImageContentType,
  isUuid,
  MAX_GALLERY_IMAGES,
} from "@/lib/media/rules";
import {
  createUploadToken,
  mediaObjectExists,
  removeMediaObjects,
} from "@/lib/media/storage";
import { createAdminClient } from "@/lib/supabase/admin";

export type UploadTarget = "cover" | "gallery";
export type UploadTicket = { path: string; token: string };

type Admin = ReturnType<typeof createAdminClient>;

export async function requestImageUpload(
  target: UploadTarget,
  contentType: string,
  eventId?: string,
): Promise<ActionResult<UploadTicket>> {
  return runAction(
    () => requestImageUploadOrThrow(target, contentType, eventId),
    "Não foi possível preparar o envio da foto.",
  );
}

export async function addEventImage(
  eventId: string,
  path: string,
): Promise<ActionResult<{ id: string; url: string }>> {
  return runAction(
    () => addEventImageOrThrow(eventId, path),
    "Não foi possível adicionar a foto.",
  );
}

export async function removeEventImage(
  eventId: string,
  imageId: string,
): Promise<ActionResult> {
  return runAction(
    () => removeEventImageOrThrow(eventId, imageId),
    "Não foi possível remover a foto.",
  );
}

async function requireEventSlug(admin: Admin, eventId: string): Promise<string> {
  const { data, error } = await admin
    .from("events")
    .select("slug")
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ActionError("Evento não encontrado.");
  return data.slug;
}

async function galleryCount(admin: Admin, eventId: string): Promise<number> {
  const { count, error } = await admin
    .from("event_images")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

function revalidateGallery(eventId: string, slug: string) {
  revalidatePath(`/equipe/eventos/${eventId}`);
  revalidatePath(`/eventos/${slug}`);
}

async function requestImageUploadOrThrow(
  target: UploadTarget,
  contentType: string,
  eventId?: string,
): Promise<UploadTicket> {
  await assertStaff();
  if (!isImageContentType(contentType)) throw new ActionError(INVALID_IMAGE_TYPE_MESSAGE);

  if (target === "cover") {
    const path = buildCoverPath(contentType);
    return { path, token: await createUploadToken(path) };
  }

  if (target !== "gallery" || !isUuid(eventId)) throw new ActionError("Evento inválido.");
  const admin = createAdminClient();
  await requireEventSlug(admin, eventId);
  if ((await galleryCount(admin, eventId)) >= MAX_GALLERY_IMAGES) {
    throw new ActionError(GALLERY_FULL_MESSAGE);
  }
  const path = buildGalleryPath(eventId, contentType);
  return { path, token: await createUploadToken(path) };
}

async function addEventImageOrThrow(
  eventId: string,
  path: string,
): Promise<{ id: string; url: string }> {
  await assertStaff();
  if (!isUuid(eventId) || typeof path !== "string" || !isGalleryPathForEvent(path, eventId)) {
    throw new ActionError("Foto inválida.");
  }

  const admin = createAdminClient();
  const slug = await requireEventSlug(admin, eventId);
  if (!(await mediaObjectExists(path))) {
    throw new ActionError("A foto não chegou ao servidor. Tente de novo.");
  }

  const { data, error } = await admin
    .from("event_images")
    .insert({ event_id: eventId, storage_path: path })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") throw new ActionError("Esta foto já foi adicionada.");
    await removeMediaObjects([path]);
    if (error.message.includes("Limite de 10 fotos")) throw new ActionError(GALLERY_FULL_MESSAGE);
    throw new Error(error.message);
  }

  revalidateGallery(eventId, slug);
  return {
    id: data.id,
    url: publicMediaUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!, path),
  };
}

async function removeEventImageOrThrow(eventId: string, imageId: string): Promise<undefined> {
  await assertStaff();
  if (!isUuid(eventId) || !isUuid(imageId)) throw new ActionError("Foto inválida.");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("event_images")
    .delete()
    .eq("id", imageId)
    .eq("event_id", eventId)
    .select("storage_path")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new ActionError("Foto não encontrada.");

  await removeMediaObjects([data.storage_path]);
  revalidateGallery(eventId, await requireEventSlug(admin, eventId));
}
```

- [ ] **Step 6: `actions.ts` usa o `assertStaff` compartilhado**

Em `src/app/equipe/eventos/actions.ts`: apagar a função local

```ts
async function assertStaff(): Promise<void> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("is_staff");
  if (error || !data) throw new ActionError("Acesso restrito à equipe.");
}
```

e adicionar o import (junto dos outros `@/lib/...`):

```ts
import { assertStaff } from "@/lib/auth/staff";
```

- [ ] **Step 7: Mock de `server-only` no teste existente**

Em `tests/equipe/staff-actions.test.ts`, logo após `vi.mock("next/cache", ...)`:

```ts
vi.mock("server-only", () => ({}));
```

(Necessário porque a Task 5 fará `actions.ts` importar `@/lib/media/storage`.)

- [ ] **Step 8: Rodar e ver passar**

Run: `npx vitest run tests/equipe`
Expected: PASS (media-actions + staff-actions).

- [ ] **Step 9: Commit**

```bash
git add src/lib/auth/staff.ts src/lib/media/storage.ts src/app/equipe/eventos/media-actions.ts src/app/equipe/eventos/actions.ts tests/equipe/media-actions.test.ts tests/equipe/staff-actions.test.ts
git commit -m "feat(midia): acoes da equipe para enviar e remover fotos da galeria"
```

---

### Task 5: Capa — validar capa enviada e apagar a antiga

**Files:**
- Modify: `src/app/equipe/eventos/actions.ts` (`normalizeInput`, `createEventOrThrow`, `updateEventOrThrow`)
- Test: `tests/equipe/event-cover.test.ts`

**Interfaces:**
- Consumes: `coverPathFromUrl`, `isOwnMediaUrl` (Task 2); `mediaObjectExists`, `removeMediaObjects` (Task 4); `COVER_NOT_FOUND_MESSAGE` (Task 2).
- Produces: `createEvent`/`updateEvent` com mesma assinatura; capa do nosso bucket precisa existir; capa antiga nossa é apagada quando trocada/removida; link precisa ser `http:`/`https:`.

- [ ] **Step 1: Teste que falha** — `tests/equipe/event-cover.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  adminRpc: vi.fn(),
  previousCover: { value: null as string | null },
  mediaObjectExists: vi.fn(),
  removeMediaObjects: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    rpc: mocks.rpc,
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        like: () => chain,
        maybeSingle: async () => ({ data: { slug: "show" }, error: null }),
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.adminRpc,
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({
          data: { cover_image_url: mocks.previousCover.value },
          error: null,
        }),
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/media/storage", () => ({
  mediaObjectExists: mocks.mediaObjectExists,
  removeMediaObjects: mocks.removeMediaObjects,
}));

import { createEvent, updateEvent } from "@/app/equipe/eventos/actions";
import { COVER_NOT_FOUND_MESSAGE } from "@/lib/media/rules";

const eventId = "00000000-0000-4000-8000-000000000001";
const base = "https://proj.supabase.co/storage/v1/object/public/event-media";
const ownCover = `${base}/covers/11111111-1111-4111-8111-111111111111.webp`;
const newOwnCover = `${base}/covers/22222222-2222-4222-8222-222222222222.webp`;
const input = {
  name: "Show",
  startsAt: "2026-12-01T20:00",
  venue: "Espaço Byla",
  description: "",
  capacity: 100,
  fullPriceCents: 5000,
  halfPriceCents: 2500,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.adminRpc.mockResolvedValue({ error: null });
  mocks.mediaObjectExists.mockResolvedValue(true);
  mocks.previousCover.value = null;
});

describe("capa do evento", () => {
  it("recusa link que não é http/https", async () => {
    expect(await createEvent({ ...input, coverImageUrl: "javascript:alert(1)" })).toEqual({
      ok: false,
      error: "Informe uma URL válida para a capa.",
    });
  });

  it("recusa capa do nosso armazenamento que não existe", async () => {
    mocks.mediaObjectExists.mockResolvedValue(false);
    expect(await updateEvent(eventId, { ...input, coverImageUrl: newOwnCover })).toEqual({
      ok: false,
      error: COVER_NOT_FOUND_MESSAGE,
    });
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("recusa foto da galeria usada como capa", async () => {
    const galleryUrl = `${base}/events/${eventId}/11111111-1111-4111-8111-111111111111.webp`;
    expect(await updateEvent(eventId, { ...input, coverImageUrl: galleryUrl })).toEqual({
      ok: false,
      error: COVER_NOT_FOUND_MESSAGE,
    });
  });

  it("trocar capa enviada apaga o arquivo antigo", async () => {
    mocks.previousCover.value = ownCover;
    expect(await updateEvent(eventId, { ...input, coverImageUrl: newOwnCover })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(mocks.removeMediaObjects).toHaveBeenCalledWith([
      "covers/11111111-1111-4111-8111-111111111111.webp",
    ]);
  });

  it("remover capa enviada apaga o arquivo", async () => {
    mocks.previousCover.value = ownCover;
    await updateEvent(eventId, { ...input, coverImageUrl: "" });
    expect(mocks.removeMediaObjects).toHaveBeenCalledTimes(1);
  });

  it("manter a mesma capa não apaga nada", async () => {
    mocks.previousCover.value = ownCover;
    await updateEvent(eventId, { ...input, coverImageUrl: ownCover });
    expect(mocks.removeMediaObjects).not.toHaveBeenCalled();
  });

  it("capa antiga por link externo nunca é apagada", async () => {
    mocks.previousCover.value = "https://exemplo.com/capa.jpg";
    await updateEvent(eventId, { ...input, coverImageUrl: newOwnCover });
    expect(mocks.removeMediaObjects).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/equipe/event-cover.test.ts`
Expected: FAIL (javascript: aceito; capa não validada; nada apagado).

- [ ] **Step 3: Validação do link em `normalizeInput`**

Substituir o bloco atual:

```ts
  if (normalized.coverImageUrl) {
    try {
      new URL(normalized.coverImageUrl);
    } catch {
      throw new ActionError("Informe uma URL válida para a capa.");
    }
  }
```

por:

```ts
  if (normalized.coverImageUrl && !isHttpUrl(normalized.coverImageUrl)) {
    throw new ActionError("Informe uma URL válida para a capa.");
  }
```

e adicionar, acima de `normalizeInput`:

```ts
function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Helpers de capa em `actions.ts`**

Imports novos:

```ts
import { coverPathFromUrl, isOwnMediaUrl } from "@/lib/media/paths";
import { COVER_NOT_FOUND_MESSAGE } from "@/lib/media/rules";
import { mediaObjectExists, removeMediaObjects } from "@/lib/media/storage";
```

Funções (abaixo de `revalidateEventSurfaces`):

```ts
function supabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL!;
}

/** Capa do nosso armazenamento precisa ser de `covers/` e existir de fato. */
async function assertCoverUploaded(coverImageUrl: string | null | undefined) {
  if (!coverImageUrl || !isOwnMediaUrl(supabaseUrl(), coverImageUrl)) return;
  const path = coverPathFromUrl(supabaseUrl(), coverImageUrl);
  if (!path || !(await mediaObjectExists(path))) {
    throw new ActionError(COVER_NOT_FOUND_MESSAGE);
  }
}
```

- [ ] **Step 5: Usar em `createEventOrThrow`**

Logo após `const normalized = normalizeInput(input);`:

```ts
  await assertCoverUploaded(normalized.coverImageUrl);
```

- [ ] **Step 6: Usar em `updateEventOrThrow`**

Trocar o início da função até antes de `const { error: eventError } = await admin.rpc(...)` por:

```ts
async function updateEventOrThrow(id: string, input: EventInput): Promise<undefined> {
  const normalized = normalizeInput(input);
  await assertStaff();
  await assertCoverUploaded(normalized.coverImageUrl);
  const admin = createAdminClient();
  const { data: previous } = await admin
    .from("events")
    .select("cover_image_url")
    .eq("id", id)
    .maybeSingle();
```

E, depois do tratamento de `eventError` e antes de `const slug = await getEventSlug(id);`:

```ts
  const previousCoverPath = coverPathFromUrl(supabaseUrl(), previous?.cover_image_url);
  if (previousCoverPath && previous?.cover_image_url !== normalized.coverImageUrl) {
    await removeMediaObjects([previousCoverPath]);
  }
```

- [ ] **Step 7: Rodar e ver passar**

Run: `npx vitest run tests/equipe`
Expected: PASS (event-cover, media-actions, staff-actions).

- [ ] **Step 8: Commit**

```bash
git add src/app/equipe/eventos/actions.ts tests/equipe/event-cover.test.ts
git commit -m "feat(midia): valida capa enviada e apaga a capa antiga"
```

---

### Task 6: Campo "Capa do evento" no formulário

**Files:**
- Create: `src/lib/media/upload-client.ts`, `src/components/equipe/CoverField.tsx`
- Modify: `src/components/equipe/EventForm.tsx` (bloco "URL da capa", linhas ~177-186; botão Salvar)

**Interfaces:**
- Consumes: `requestImageUpload`, `UploadTarget` (Task 4); `resizeImage` (Task 3); `rules.ts`, `publicMediaUrl`, `isOwnMediaUrl` (Task 2); `createClient` (`@/lib/supabase/client`).
- Produces: `uploadImage(file, target, eventId?): Promise<{ ok: true; path: string } | { ok: false; error: string }>`; `<CoverField defaultValue={string | null} onBusyChange={(busy) => void} />` que sempre renderiza exatamente um input `name="coverImageUrl"`.

- [ ] **Step 1: `src/lib/media/upload-client.ts`**

```ts
import { requestImageUpload, type UploadTarget } from "@/app/equipe/eventos/media-actions";
import { resizeImage } from "@/lib/media/resize";
import {
  IMAGE_TOO_LARGE_MESSAGE,
  INVALID_IMAGE_TYPE_MESSAGE,
  isImageContentType,
  MAX_IMAGE_BYTES,
  MEDIA_BUCKET,
  UPLOAD_FAILED_MESSAGE,
} from "@/lib/media/rules";
import { createClient } from "@/lib/supabase/client";

export type UploadOutcome = { ok: true; path: string } | { ok: false; error: string };

/** Reduz a foto, pede autorização ao servidor e envia direto ao armazenamento. */
export async function uploadImage(
  file: File,
  target: UploadTarget,
  eventId?: string,
): Promise<UploadOutcome> {
  if (!isImageContentType(file.type)) return { ok: false, error: INVALID_IMAGE_TYPE_MESSAGE };

  try {
    const blob = await resizeImage(file);
    if (blob.size > MAX_IMAGE_BYTES) return { ok: false, error: IMAGE_TOO_LARGE_MESSAGE };

    const ticket = await requestImageUpload(target, blob.type, eventId);
    if (!ticket.ok) return ticket;

    const { error } = await createClient()
      .storage.from(MEDIA_BUCKET)
      .uploadToSignedUrl(ticket.data.path, ticket.data.token, blob, {
        contentType: blob.type,
      });
    if (error) return { ok: false, error: UPLOAD_FAILED_MESSAGE };

    return { ok: true, path: ticket.data.path };
  } catch {
    return { ok: false, error: UPLOAD_FAILED_MESSAGE };
  }
}
```

- [ ] **Step 2: `src/components/equipe/CoverField.tsx`**

```tsx
"use client";

import { ImagePlus } from "lucide-react";
import { useRef, useState } from "react";

import { isOwnMediaUrl, publicMediaUrl } from "@/lib/media/paths";
import { IMAGE_ACCEPT } from "@/lib/media/rules";
import { uploadImage } from "@/lib/media/upload-client";

type CoverFieldProps = {
  defaultValue: string | null;
  onBusyChange: (busy: boolean) => void;
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const inputClass = "rounded-lg border border-byla-border px-3 py-2.5 font-normal";
const tabClass =
  "rounded-lg border px-3 py-2 text-sm font-medium transition aria-pressed:border-byla-blue aria-pressed:bg-byla-blue/10 aria-pressed:text-foreground border-byla-border text-byla-muted";

export function CoverField({ defaultValue, onBusyChange }: CoverFieldProps) {
  const [url, setUrl] = useState(defaultValue ?? "");
  const [mode, setMode] = useState<"upload" | "link">(
    defaultValue && !isOwnMediaUrl(supabaseUrl, defaultValue) ? "link" : "upload",
  );
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function handleFile(file: File | undefined) {
    if (fileInput.current) fileInput.current.value = "";
    if (!file) return;
    setError(null);
    setUploading(true);
    onBusyChange(true);
    const result = await uploadImage(file, "cover");
    setUploading(false);
    onBusyChange(false);
    if (!result.ok) return setError(result.error);
    setUrl(publicMediaUrl(supabaseUrl, result.path));
  }

  return (
    <fieldset className="grid gap-3">
      <legend className="mb-2 text-sm font-medium">Capa do evento (opcional)</legend>

      <div className="flex flex-wrap gap-2">
        <button
          aria-pressed={mode === "upload"}
          className={tabClass}
          onClick={() => setMode("upload")}
          type="button"
        >
          Enviar imagem
        </button>
        <button
          aria-pressed={mode === "link"}
          className={tabClass}
          onClick={() => setMode("link")}
          type="button"
        >
          Colar link
        </button>
      </div>

      {mode === "link" ? (
        <input
          aria-label="Link da capa"
          className={inputClass}
          name="coverImageUrl"
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://..."
          type="url"
          value={url}
        />
      ) : (
        <>
          <input name="coverImageUrl" type="hidden" value={url} />
          <input
            accept={IMAGE_ACCEPT}
            aria-label="Arquivo da capa"
            className="sr-only"
            onChange={(event) => handleFile(event.target.files?.[0])}
            ref={fileInput}
            tabIndex={-1}
            type="file"
          />
          {url ? (
            <div className="grid gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt="Prévia da capa"
                className="aspect-video w-full max-w-md rounded-lg border border-byla-border object-cover"
                src={url}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  className="rounded-lg border border-byla-border px-4 py-2 text-sm font-medium disabled:opacity-50"
                  disabled={uploading}
                  onClick={() => fileInput.current?.click()}
                  type="button"
                >
                  Trocar
                </button>
                <button
                  className="rounded-lg border border-byla-border px-4 py-2 text-sm font-medium disabled:opacity-50"
                  disabled={uploading}
                  onClick={() => setUrl("")}
                  type="button"
                >
                  Remover
                </button>
              </div>
            </div>
          ) : (
            <button
              className="flex w-full max-w-md items-center justify-center gap-2 rounded-lg border border-dashed border-byla-border px-4 py-8 text-sm font-medium text-byla-muted transition hover:text-foreground disabled:opacity-50"
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
              type="button"
            >
              <ImagePlus aria-hidden className="h-5 w-5" />
              Escolher imagem
            </button>
          )}
          {uploading ? (
            <p className="text-sm text-byla-muted" role="status">
              Enviando…
            </p>
          ) : null}
        </>
      )}

      {error ? (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}
      <p className="text-xs text-byla-muted">
        JPG, PNG ou WebP. A imagem é reduzida automaticamente. A capa vale ao salvar o evento.
      </p>
    </fieldset>
  );
}
```

- [ ] **Step 3: Integrar em `EventForm.tsx`**

Import:

```tsx
import { CoverField } from "@/components/equipe/CoverField";
```

Estado (junto de `message`):

```tsx
  const [coverBusy, setCoverBusy] = useState(false);
```

Substituir o bloco:

```tsx
      <label className="grid gap-2 text-sm font-medium">
        URL da capa (opcional)
        <input
          className="rounded-lg border border-byla-border px-3 py-2.5 font-normal"
          defaultValue={event?.coverImageUrl ?? ""}
          name="coverImageUrl"
          placeholder="https://..."
          type="url"
        />
      </label>
```

por:

```tsx
      <CoverField defaultValue={event?.coverImageUrl ?? null} onBusyChange={setCoverBusy} />
```

No botão Salvar: `disabled={isPending || coverBusy}` e texto
`{coverBusy ? "Enviando capa..." : isPending ? "Salvando..." : "Salvar"}`.

- [ ] **Step 4: Lint e tipos**

Run: `npx tsc --noEmit; npm run lint`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/lib/media/upload-client.ts src/components/equipe/CoverField.tsx src/components/equipe/EventForm.tsx
git commit -m "feat(midia): campo de capa com envio de imagem ou link"
```

---

### Task 7: Seção "Fotos do evento" no painel

**Files:**
- Create: `src/components/equipe/EventGalleryManager.tsx`
- Modify: `src/app/equipe/eventos/[id]/page.tsx`, `src/app/equipe/eventos/novo/page.tsx`

**Interfaces:**
- Consumes: `uploadImage` (Task 6); `addEventImage`, `removeEventImage` (Task 4); `publicMediaUrl` (Task 2); `MAX_GALLERY_IMAGES`, `IMAGE_ACCEPT` (Task 2).
- Produces: `<EventGalleryManager eventId={string} images={{ id: string; url: string }[]} />`.

- [ ] **Step 1: `src/components/equipe/EventGalleryManager.tsx`**

```tsx
"use client";

import { ImagePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { addEventImage, removeEventImage } from "@/app/equipe/eventos/media-actions";
import { IMAGE_ACCEPT, MAX_GALLERY_IMAGES } from "@/lib/media/rules";
import { uploadImage } from "@/lib/media/upload-client";

type EventGalleryManagerProps = {
  eventId: string;
  images: { id: string; url: string }[];
};

export function EventGalleryManager({ eventId, images }: EventGalleryManagerProps) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(0);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const remaining = MAX_GALLERY_IMAGES - images.length;
  const busy = pending > 0 || removingId !== null;

  async function handleFiles(list: FileList | null) {
    const chosen = Array.from(list ?? []);
    if (fileInput.current) fileInput.current.value = "";
    if (!chosen.length) return;

    const files = chosen.slice(0, Math.max(remaining, 0));
    const skipped = chosen.length - files.length;
    let failed = 0;
    let lastError = "";
    setMessage(null);
    setPending(files.length);

    for (const file of files) {
      try {
        const uploaded = await uploadImage(file, "gallery", eventId);
        const added = uploaded.ok ? await addEventImage(eventId, uploaded.path) : uploaded;
        if (!added.ok) {
          failed += 1;
          lastError = added.error;
        }
      } catch {
        failed += 1;
        lastError = "Não foi possível enviar esta foto. Tente de novo.";
      }
      setPending((count) => count - 1);
    }

    const notes: string[] = [];
    if (failed === 1) notes.push(lastError);
    if (failed > 1) notes.push(`${failed} fotos não foram enviadas. Tente de novo.`);
    if (skipped > 0) {
      notes.push(`O limite é de ${MAX_GALLERY_IMAGES} fotos; ${skipped} ficaram de fora.`);
    }
    setMessage(notes.join(" ") || null);
    router.refresh();
  }

  async function handleRemove(imageId: string) {
    if (!window.confirm("Remover esta foto da galeria?")) return;
    setMessage(null);
    setRemovingId(imageId);
    try {
      const result = await removeEventImage(eventId, imageId);
      if (!result.ok) setMessage(result.error);
      else router.refresh();
    } catch {
      setMessage("Não foi possível remover a foto.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <section className="mt-8 grid gap-4 rounded-xl border border-byla-border bg-byla-surface p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-foreground">Fotos do evento</h2>
          <p className="text-sm text-byla-muted">
            {images.length} de {MAX_GALLERY_IMAGES}. Aparecem na página do evento na ordem de envio.
          </p>
        </div>
        <button
          className="flex items-center gap-2 rounded-lg bg-byla-blue px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
          disabled={remaining <= 0 || busy}
          onClick={() => fileInput.current?.click()}
          type="button"
        >
          <ImagePlus aria-hidden className="h-4 w-4" />
          Adicionar fotos
        </button>
        <input
          accept={IMAGE_ACCEPT}
          aria-label="Arquivos das fotos"
          className="sr-only"
          multiple
          onChange={(event) => handleFiles(event.target.files)}
          ref={fileInput}
          tabIndex={-1}
          type="file"
        />
      </div>

      {pending > 0 ? (
        <p className="text-sm text-byla-muted" role="status">
          Enviando {pending} {pending === 1 ? "foto" : "fotos"}…
        </p>
      ) : null}
      {message ? (
        <p className="text-sm text-red-400" role="alert">
          {message}
        </p>
      ) : null}

      {images.length ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {images.map((image, index) => (
            <li className="grid gap-2" key={image.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt={`Foto ${index + 1} da galeria`}
                className="aspect-square w-full rounded-lg border border-byla-border object-cover"
                loading="lazy"
                src={image.url}
              />
              <button
                className="rounded-lg border border-byla-border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                disabled={busy}
                onClick={() => handleRemove(image.id)}
                type="button"
              >
                {removingId === image.id ? "Removendo..." : "Remover"}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-byla-muted">Nenhuma foto ainda.</p>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Página do evento no painel** — `src/app/equipe/eventos/[id]/page.tsx`

Imports:

```tsx
import { EventGalleryManager } from "@/components/equipe/EventGalleryManager";
import { publicMediaUrl } from "@/lib/media/paths";
```

Adicionar ao `Promise.all` (5º item) e à desestruturação (`{ data: images }`):

```tsx
    supabase
      .from("event_images")
      .select("id, storage_path")
      .eq("event_id", id)
      .order("created_at", { ascending: true }),
```

Logo após `<EventForm ... />`:

```tsx
      <EventGalleryManager
        eventId={event.id}
        images={(images ?? []).map(({ id: imageId, storage_path }) => ({
          id: imageId,
          url: publicMediaUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!, storage_path),
        }))}
      />
```

- [ ] **Step 3: Aviso no evento novo** — `src/app/equipe/eventos/novo/page.tsx`, logo após `<EventForm />`:

```tsx
      <p className="mt-6 rounded-xl border border-dashed border-byla-border p-5 text-sm text-byla-muted">
        Salve o evento para adicionar fotos à galeria.
      </p>
```

- [ ] **Step 4: Lint e tipos**

Run: `npx tsc --noEmit; npm run lint`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/components/equipe/EventGalleryManager.tsx "src/app/equipe/eventos/[id]/page.tsx" src/app/equipe/eventos/novo/page.tsx
git commit -m "feat(midia): secao Fotos do evento no painel da equipe"
```

---

### Task 8: Galeria na página pública com tela cheia

**Files:**
- Create: `src/components/public/EventGallery.tsx`
- Modify: `src/app/eventos/[slug]/page.tsx`

**Interfaces:**
- Consumes: `publicMediaUrl` (Task 2); tabela `event_images` com RLS pública (Task 1).
- Produces: `<EventGallery eventName={string} images={{ id: string; url: string }[]} />` (não renderiza nada sem fotos).

- [ ] **Step 1: `src/components/public/EventGallery.tsx`**

```tsx
"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { type KeyboardEvent, type TouchEvent, useEffect, useRef, useState } from "react";

type EventGalleryProps = {
  eventName: string;
  images: { id: string; url: string }[];
};

const SWIPE_MIN_PX = 50;
const navButtonClass =
  "absolute top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white transition hover:bg-black/80";

export function EventGallery({ eventName, images }: EventGalleryProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const touchStartX = useRef<number | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const count = images.length;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (index !== null && !dialog.open) dialog.showModal();
    if (index === null && dialog.open) dialog.close();
  }, [index]);

  if (!count) return null;

  function show(next: number) {
    setIndex(((next % count) + count) % count);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (index === null) return;
    if (event.key === "ArrowRight") show(index + 1);
    if (event.key === "ArrowLeft") show(index - 1);
  }

  function handleTouchEnd(event: TouchEvent<HTMLDialogElement>) {
    const start = touchStartX.current;
    touchStartX.current = null;
    if (start === null || index === null) return;
    const delta = event.changedTouches[0].clientX - start;
    if (Math.abs(delta) < SWIPE_MIN_PX) return;
    show(delta < 0 ? index + 1 : index - 1);
  }

  return (
    <section className="mt-10">
      <h2 className="font-semibold text-foreground">Fotos</h2>
      <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {images.map((image, position) => (
          <li key={image.id}>
            <button
              aria-label={`Abrir foto ${position + 1} de ${count}`}
              className="block w-full overflow-hidden rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue"
              onClick={() => setIndex(position)}
              type="button"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt=""
                className="aspect-square w-full object-cover transition duration-300 hover:scale-[1.03]"
                decoding="async"
                loading="lazy"
                src={image.url}
              />
            </button>
          </li>
        ))}
      </ul>

      <dialog
        aria-label={`Fotos de ${eventName}`}
        className="m-0 h-dvh max-h-none w-screen max-w-none bg-black/95 p-0 text-white backdrop:bg-black/80"
        onClose={() => setIndex(null)}
        onKeyDown={handleKeyDown}
        onTouchEnd={handleTouchEnd}
        onTouchStart={(event) => {
          touchStartX.current = event.touches[0].clientX;
        }}
        ref={dialogRef}
      >
        {index !== null ? (
          <div className="relative flex h-full w-full items-center justify-center p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt={`Foto ${index + 1} de ${count} de ${eventName}`}
              className="max-h-full max-w-full select-none object-contain"
              src={images[index].url}
            />
            <button
              aria-label="Fechar"
              className="absolute right-4 top-4 rounded-full bg-black/60 p-2 text-white transition hover:bg-black/80"
              onClick={() => setIndex(null)}
              type="button"
            >
              <X aria-hidden className="h-6 w-6" />
            </button>
            {count > 1 ? (
              <>
                <button
                  aria-label="Foto anterior"
                  className={`${navButtonClass} left-3`}
                  onClick={() => show(index - 1)}
                  type="button"
                >
                  <ChevronLeft aria-hidden className="h-7 w-7" />
                </button>
                <button
                  aria-label="Próxima foto"
                  className={`${navButtonClass} right-3`}
                  onClick={() => show(index + 1)}
                  type="button"
                >
                  <ChevronRight aria-hidden className="h-7 w-7" />
                </button>
              </>
            ) : null}
            <p className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-sm">
              {index + 1} / {count}
            </p>
          </div>
        ) : null}
      </dialog>
    </section>
  );
}
```

- [ ] **Step 2: Página pública** — `src/app/eventos/[slug]/page.tsx`

Imports:

```tsx
import { EventGallery } from "@/components/public/EventGallery";
import { publicMediaUrl } from "@/lib/media/paths";
```

Trocar `const [{ data: ticketTypes }, { count: occupied }] = await Promise.all([` por
`const [{ data: ticketTypes }, { count: occupied }, { data: images }] = await Promise.all([`
e adicionar como 3º item:

```tsx
    supabase
      .from("event_images")
      .select("id, storage_path")
      .eq("event_id", event.id)
      .order("created_at", { ascending: true }),
```

Depois de `const hasAvailability = ...`:

```tsx
  const gallery = (images ?? []).map(({ id, storage_path }) => ({
    id,
    url: publicMediaUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!, storage_path),
  }));
```

Dentro da coluna de texto, logo após o bloco `{event.description ? (...) : null}`:

```tsx
              <EventGallery eventName={event.name} images={gallery} />
```

- [ ] **Step 3: Lint e tipos**

Run: `npx tsc --noEmit; npm run lint`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/components/public/EventGallery.tsx "src/app/eventos/[slug]/page.tsx"
git commit -m "feat(midia): galeria com tela cheia na pagina do evento"
```

---

### Task 9: Verificação final e entrega

**Files:** nenhum novo (ajustes só se algo falhar).

- [ ] **Step 1: Suite completa**

Run: `npm test; npx tsc --noEmit; npm run lint; npm run build`
Expected: todos os testes passam (86 anteriores + novos), sem erros de tipo/lint, build OK. Se `next-env.d.ts` mudar, `git checkout -- next-env.d.ts`.

- [ ] **Step 2: Teste manual no navegador (local, `npm run dev -- -p 3200`)**

Com login da equipe:
1. Novo evento → "Enviar imagem" → escolher JPG grande de celular → prévia aparece → Salvar → capa aparece em `/eventos/<slug>` e na home.
2. Editar → "Trocar" capa → Salvar → nova capa; conferir no Storage (dashboard) que a antiga sumiu de `covers/`.
3. "Colar link" com URL externa → Salvar → capa externa aparece.
4. Tentar arquivo `.gif` → mensagem "Use uma imagem JPG, PNG ou WebP.".
5. "Adicionar fotos" com 3 fotos → contador "3 de 10" → aparecem na página pública abaixo da descrição.
6. Selecionar 9 fotos com 3 já enviadas → só 7 enviadas + aviso do limite; botão desativa em 10.
7. Remover uma foto → some do painel e da página pública.
8. Página pública: tocar numa miniatura → tela cheia; setas, ← →, Esc; no modo celular do DevTools, deslizar.
9. Console do navegador sem erros de CSP.

- [ ] **Step 3: Advisors**

MCP `user-supabase-eventos` → `get_advisors` (security e performance): nenhum alerta novo além dos já aceitos (`is_staff` security definer, `rate_limit_hits` sem políticas, proteção de senha vazada).

- [ ] **Step 4: Commit de ajustes (se houver) e pedido de deploy**

Perguntar ao usuário se pode publicar. Com aprovação:

```bash
git checkout main
git merge --ff-only feat/mvp
git push
git checkout feat/mvp
```

Conferir CI verde no GitHub e deploy "Ready" na Vercel; abrir `/eventos/<slug>` em produção (teste passivo).
