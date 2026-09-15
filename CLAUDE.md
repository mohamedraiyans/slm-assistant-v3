# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

SLM Assistant v3 — a multi-tenant RAG assistant. Users sign in with Google, upload documents, and chat
with an LLM that answers using context retrieved from those documents via a vector database. Admins
manage which LLM providers are available by adding encrypted API keys, and can view/delete users. It's a
from-scratch TypeScript rewrite of an earlier Python prototype (`slm-assistant` v2).

See [README.md](./README.md) for the full feature list and [HOW_TO_RUN.txt](./HOW_TO_RUN.txt) for setup,
environment variables, and a running list of known gotchas — read that file's "Known gotchas" section
before debugging anything that looks like infra flakiness.

## Commands

This is a Turborepo/npm-workspaces monorepo (`apps/api`, `apps/web`, `packages/shared-types`), plus a
Python service in `services/speech` that is *not* an npm workspace — it builds and runs via Docker.

```bash
# One-time setup
npm install                          # installs all three workspaces
docker compose up -d                 # Postgres, Redis, Chroma, Adminer, speech (first build: 10+ min)
cd apps/api && npx prisma migrate dev

# Speech service (services/speech)
docker build --target test services/speech          # runs the pytest suite inside the image
docker compose up -d --build --no-deps speech       # rebuild + restart after changing app/ code

# Every session
docker compose up -d
npx turbo run dev                    # api (:4000) + web (:3000), persistent watch mode

# Type-checking (NOT `nest build` — see gotcha below)
cd apps/api && npx tsc --noEmit
cd apps/web && npx tsc --noEmit

# Lint / build / test (turbo runs these across all workspaces)
npx turbo run lint
npx turbo run build
npx turbo run test                   # jest unit suite in apps/api (see Testing below)

# Prisma migration after editing apps/api/prisma/schema.prisma
cd apps/api && npx prisma migrate dev --name describe_your_change
npx prisma generate                  # Prisma 7: migrate dev no longer does this for you
```

**Windows gotcha:** `nest start --watch` occasionally crashes on its own restart cycle
(`taskkill ... failed` / `Cannot find module .../dist/main`) — this is nest-cli's process-tree-kill racing
itself on Windows, not a code error. Just re-run `npm run dev` in `apps/api`. Never run `npx nest build`
manually while `--watch` is active elsewhere — it writes to the same `dist/` the watcher depends on and
reliably triggers this crash. Use `npx tsc --noEmit` for type-checking instead.

**Env:** exactly one `.env` file at the repo root (gitignored), loaded by both `docker-compose.yml` and
`apps/api` (via `prisma.config.ts` / `app.module.ts`, since `ConfigModule` points two levels up from
`apps/api`'s cwd). `apps/web` is the exception — it reads `apps/web/.env.local` instead.

## Testing

Jest + ts-jest, `apps/api` only, `testRegex: .*\.spec\.ts$` with `rootDir: src` — specs live
next to the code they cover, not in a separate `test/` tree. Everything external is faked, so
`npm test` needs no Docker, no network and no API key.

Two constraints that are easy to trip over:

- **Never import a Prisma-backed service into a unit spec without stubbing it.** The generated
  client lives in `apps/api/generated/`, which is *outside* jest's `rootDir`, so ts-jest doesn't
  transform it and the suite dies on `Cannot use import statement outside a module`. When a class
  is needed only as a Nest DI token (e.g. `ProvidersService` in `chat.service.spec.ts`), add
  `jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }))`.
- **Fake the model, not the chain.** `chat.service.spec.ts` uses `FakeListChatModel` from
  `@langchain/core/utils/testing` so the real `ChatPromptTemplate → model → StringOutputParser`
  sequence still executes. Assert on prompt contents by spying on the model's `invoke` and casting
  the first argument to `ChatPromptValue`.

- **`@nestjs/bullmq` must stay on 11.x while Nest is on 11.** v12 is ESM-only (built for Nest 12): it
  still loads at runtime on Node 24 via `require(esm)`, but jest can't parse it, so every spec touching
  the processor fails with `Unexpected token 'export'`.

The speech service's pytest suite (`services/speech/tests`) has the same no-network rule. Its pure modules
(`normalize`, `quran`, `align`, `clips`, `reference`) never import `faster_whisper`, so they also run on a
host Python with only pytest installed; `test_api.py` skips itself there and runs in the Docker test stage.

When changing retrieval behaviour, check the change actually fails a test before trusting the
suite: several chunker properties (e.g. "both universities land in one chunk") survive mutations
that break real behaviour, because the heading-merge step reassembles runs of headings either way.
`document-chunker.spec.ts`'s "starts a new chunk at a heading even when the budget has room left"
is the test that pins section boundaries specifically.

## Architecture

### Backend (`apps/api`, NestJS + Prisma/Postgres)

Module boundaries matter here — trace a request across modules rather than assuming one file owns a
feature:

- **`chat/`** — `ChatService.handleChat()` is the RAG pipeline. Retrieval goes through
  `KnowledgeBaseRetriever` (a real LangChain `BaseRetriever` living in `documents/`, wrapping the Chroma
  vector store), and generation is an LCEL chain: `RunnableSequence.from([ChatPromptTemplate, model,
  StringOutputParser])`. Retrieval is deliberately a *separate step* rather than folded into the chain,
  because the retrieved `Document[]` (with filename + score metadata) is needed on its own for source
  citations and the FAQ cache entry. `generateAnswer()` is the shared retrieval+generation core, kept free
  of memory/counter side effects so background cache warming can reuse it.
  `provider-factory.service.ts` swaps `ChatGroq` / `AzureChatOpenAI` / `ChatAnthropic` behind
  `BaseChatModel`, so everything above it is written once regardless of provider.
- **`faq/`** — Redis-backed answer cache + question-frequency ranking, sitting in front of the RAG
  pipeline. `ChatService` checks `FaqService.getCachedAnswer(provider, question)` *before* touching Chroma
  or calling the LLM; a hit skips both entirely. Cache keys are versioned
  (`faq:answer:v{version}:{provider}:{question}`) — uploading or deleting *any* document bumps the version
  via `invalidateAll()`, which is an O(1) `INCR`, not a key scan/delete. An empty/blank LLM response is
  treated as a failure and is never cached (see the `answer.trim()` check in `generateAnswer`) — a provider
  hiccup must not get served forever from cache.
  Two lifetimes to keep straight: the ranking (`faq:counts`, a sorted set) **never expires**, while answers
  carry a 7-day TTL *and* die on any version bump. That asymmetry is why the FAQ list can list questions
  that have no cached answer behind them. `ChatService.warmFrequentQuestions()` closes that gap — triggered
  fire-and-forget from `GET /chat/faq`, gated by `FaqService.claimWarmSlot()` (a `SET NX` on
  `faq:warmed:v{version}`) so it pre-generates the top questions × active providers exactly once per
  version, not on every 30s poll from the sidebar.
- **`providers/`** — encrypted (AES-256-GCM) LLM API key vault, plus `ProviderUsageService`, which reads
  rate-limit response headers (`x-ratelimit-*` / `anthropic-ratelimit-*`) captured via a custom `fetch`
  wrapper injected into each LangChain client in `provider-factory.service.ts` — this is necessary because
  `model.invoke()` doesn't surface response headers on its own. This is rate-limit headroom, not billing
  balance; some deployments (e.g. Azure's Model Router) don't return these headers at all, and the frontend
  correctly shows `—` rather than guessing.
- **`documents/`** — upload → `document-extractor.ts` (pdf-parse/mammoth) → `document-chunker.ts`
  (groups lines into ~70-word chunks, forcing a new chunk at each heading so headings stay attached to
  their section; chunk ids are positional, which is why `uploadDocument` deletes a file's existing chunks
  before re-adding) → `vector-store.service.ts` (Chroma, cosine/HNSW,
  local embeddings via `@huggingface/transformers`). Retrieval is top-12 (`TOP_K` in
  `knowledge-base-retriever.ts`), and `VectorStoreService.query` over-fetches then trims with a per-file
  cap (`spreadAcrossFiles`) — plain top-k has no notion of document coverage, so one densely on-topic file
  took *every* slot and hid relevant passages in every other file. Unused slots are backfilled ignoring
  the cap, so single-document questions still get a full context window. The raw uploaded file on disk
  (`apps/api/data/docs/`) and the Chroma vectors are independent — deleting one does not delete the other
  unless you go through `DocumentsService.removeDocument()`, which cleans up both plus bumps the FAQ cache
  version.
- **`features/`** — admin feature flags. Keys are declared in `feature-registry.ts` (typed `FeatureKey` in
  shared-types); the `FeatureFlag` table stores only overrides. Gate a controller with
  `@UseGuards(JwtAuthGuard, FeatureGuard)` + `@RequireFeature('key')` — auth guard first, so anonymous
  callers get 401 and signed-in callers get 404 when the feature is off. The web hides the tab too, but the
  guard is the actual switch.
- **`recitation/`** — recitation practice, phases 1–2 of 5 (see README): reference audio upload/list/
  stream/delete/reprocess and per-word timings under `/recitation/references`, feature-gated. Audio type
  comes from `detectAudioFormat` (magic bytes), never the extension or client MIME; files live in
  `apps/api/data/recitations/` under uuid names; `toSummary` is an explicit allowlist so `storedName` never
  reaches responses. Upload enqueues a BullMQ job (`recitation-queue.ts`, job id `align-<referenceId>` so
  re-adding is a no-op); `RecitationProcessor` (concurrency 1) calls `SpeechClient`, which classifies
  failures as retryable (unreachable/5xx/408/429) or permanent (other 4xx → `UnrecoverableError`, no
  retries). A result below `MIN_MATCH_RATE` is stored but marked FAILED — it usually means the wrong surah
  or range. `RecitationService.onApplicationBootstrap` re-queues anything left PENDING/PROCESSING.
  Deliberately no LLM in this pipeline.

### Speech service (`services/speech`, Python/FastAPI)

Stateless: the api owns files, jobs and results; this service only reads audio from the shared bind mount
(`apps/api/data/recitations` → `/data/recitations:ro`) and returns timed words. `POST /v1/references/align`
only accepts a uuid-shaped `storedName` (it's joined onto a directory path).

- `convert_model.py` runs in a Docker build stage: official `tarteel-ai/whisper-base-ar-quran` pinned to a
  commit, plus `openai/whisper-base`'s generation config (for its alignment heads), converted to CTranslate2
  int8. torch/transformers never reach the runtime image. `PROVENANCE.json` travels with the model.
- `normalize.py` is for matching only, never display. Code points are written numerically on purpose —
  literal combining marks are invisible in editors (and a file-writing tool silently turned `\u` escapes
  into literals once). Changing it: re-verify that vowelled and plain Tanzil editions still give 0 key
  mismatches across all 78,248 words.
- `transcribe.py` decodes pause-separated clips grouped to ≤15 s via `clip_timestamps`. Don't swap this for
  faster-whisper's `vad_filter` — that rejoins speech into one stream and measured no better than no VAD
  (whole-window decoding dropped Al-Fatiha's basmala). Temperature is fixed at 0 for reproducibility.
- `align.py` is a banded Needleman–Wunsch; `skip_costs` of 0 mark optional words. `reference.py` uses that
  for the isti'adha/basmala preamble — needed because الرجيم/الرحيم differ by one letter.
- `data/quran-simple.txt` is Tanzil's text, which its license forbids modifying: `.gitattributes` exempts it
  from line-ending conversion. Never edit or reformat it.
- **`users/`** — admin-only list/delete. `Document.uploadedBy` and `ProviderCredential.createdBy` are
  nullable with `onDelete: SetNull` specifically so deleting a user doesn't cascade-delete shared team
  resources (documents, provider keys) — it just clears the attribution.
- Every admin-only route uses `RolesGuard` + `@Roles('ADMIN')`; regular auth is `JwtAuthGuard` (httpOnly
  cookie, 60min access token + rotating refresh token). First-run admin bootstrap is via `ADMIN_EMAILS` in
  `.env` — matching emails are (re-)promoted to `ADMIN` on every Google login via
  `AuthService.upsertFromGoogleProfile`, which also means deleting an admin user isn't permanent.

### Frontend (`apps/web`, Next.js App Router)

- **Admin UI is modals, not routes.** "Provider keys" and "Users" open as `Dialog`s
  (`components/ui/dialog.tsx`, wrapping `@base-ui/react/dialog`) directly on the dashboard via
  self-fetching client components (`provider-manager.tsx`, `user-manager.tsx`) — there is no
  `/admin/providers` or `/admin/users` route.
- **Theme is one CSS-variable system, not light/dark modes.** `globals.css` sets a navy/amber palette
  directly on `:root` (no `.dark` toggle exists in the app) sampled from `public/wallpaper.svg`. Every
  component should use semantic Tailwind tokens (`bg-background`, `border-border`, `text-muted-foreground`,
  `bg-primary`) rather than raw color utilities like `zinc-800` — that's what makes the theme swappable
  from one file. Native `<select>` popups need the `color-scheme: dark` + explicit `option` styling already
  in `globals.css`, since browsers render dropdown popups outside normal CSS control.
- **Mobile is a breakpoint-driven drawer, not a separate layout.** The dashboard sidebar is one component
  rendered once; a wrapper `div` toggles between `fixed` (off-canvas, slide-in via `translate-x`) below
  `md` and `static` (persistent) at `md`+ — see `dashboard.tsx`'s `sidebarOpen` state. Don't duplicate the
  `<Sidebar>` render for a "mobile version."
- Client components generally self-fetch via `credentials: "include"` cross-origin calls to
  `NEXT_PUBLIC_API_URL` rather than receiving server-fetched props — this is the dominant pattern
  (`ChatPanel`, `Sidebar`, `ProviderManager`, `UserManager` all do this), not an exception.
- Chat replies are tagged client-side with which provider generated them (`(Groq AI)` / `(Azure OpenAI)` /
  `(Anthropic)`, each a distinct color) — this works without a backend change because the FAQ cache is
  already keyed per-provider, so the frontend's own `provider` selection state at request time is
  authoritative.
- This Next.js version (16) has real breaking changes vs. older training data — `apps/web/AGENTS.md` flags
  this; check `node_modules/next/dist/docs/` before assuming an API works the way you remember.

### Shared types (`packages/shared-types`)

No build step — `main`/`types` point straight at `src/index.ts`, consumed as TS source by both apps via
workspace resolution. Edit it directly; changes are immediately visible, no watch/compile step needed.
