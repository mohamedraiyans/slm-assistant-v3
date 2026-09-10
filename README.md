# SLM Assistant v3

A multi-tenant RAG (Retrieval-Augmented Generation) assistant. Users sign in
with Google, upload documents, and chat with an LLM that answers using
context retrieved from those documents via a vector database. Admins manage
which LLM providers are available by adding encrypted API keys.

This is a from-scratch TypeScript rewrite of an earlier Python prototype
(`slm-assistant` v2), moving from local-only inference to a multi-provider,
multi-tenant architecture with proper auth, RBAC, and a real vector store.

## Tech stack

| Layer | Technology |
|---|---|
| Monorepo | Turborepo, npm workspaces, TypeScript |
| Backend | NestJS, Prisma ORM |
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS 4, shadcn/base-ui |
| Database | PostgreSQL |
| Vector store | Chroma (cosine similarity / HNSW) |
| Embeddings | Local, via `@huggingface/transformers` (Xenova/all-MiniLM-L6-v2) — never leaves the machine |
| RAG / LLM orchestration | LangChain (`@langchain/core`) — multi-provider `BaseChatModel`s (Groq, Azure OpenAI, Anthropic), a custom `BaseRetriever` over Chroma, and an LCEL generation chain (`ChatPromptTemplate → model → StringOutputParser`) |
| Cache | Redis (`ioredis`) — FAQ answer cache + frequency ranking, see below |
| Auth | Google OAuth2 (Passport) + JWT (httpOnly cookie), role-based access control |
| Secrets | AES-256-GCM encrypted provider API keys at rest |
| Document parsing | `pdf-parse`, `mammoth` (DOCX) |
| Infra (local dev) | Docker Compose — Postgres, Redis, Chroma, Adminer |

## Project structure

```
slm-assistant-v3/
├── apps/
│   ├── api/                       NestJS backend (port 4000)
│   │   ├── prisma/                Schema + migrations (User, Document,
│   │   │                          RefreshToken, ProviderCredential)
│   │   └── src/
│   │       ├── auth/              Google OAuth, JWT strategy, RBAC guards
│   │       ├── users/             Admin user list + delete (GET/DELETE /users)
│   │       ├── providers/         Encrypted LLM provider key vault (admin) +
│   │       │                      per-provider rate-limit usage tracking
│   │       ├── documents/         Upload, parsing, chunking, Chroma vector store,
│   │       │                      KnowledgeBaseRetriever (LangChain BaseRetriever)
│   │       ├── chat/              LCEL RAG chain, per-provider chat model factory
│   │       ├── faq/               Redis-backed answer cache + question frequency ranking
│   │       ├── redis/             Global module providing the shared ioredis client
│   │       ├── quiz/              Scaffolded — not implemented yet
│   │       ├── eval/              Scaffolded — not implemented yet
│   │       └── health/            Health check endpoint
│   └── web/                       Next.js frontend (port 3000)
│       ├── public/wallpaper.svg   Constellation background asset (login page
│       │                          + app-wide navy/amber theme)
│       └── src/
│           ├── app/
│           │   ├── login/         Google sign-in page (full wallpaper, glass card)
│           │   ├── admin/providers/  Admin UI for managing provider keys
│           │   └── admin/users/   Admin UI: view/delete users (table)
│           ├── components/dashboard/  Chat panel (usage badges, cache
│           │                          indicator), sidebar (Documents /
│           │                          Frequently Asked tabs, admin delete),
│           │                          dashboard shell
│           └── lib/               API client, auth helpers
├── packages/
│   └── shared-types/               Types shared between api and web (Role,
│                                    ProviderName, AuthUser, ChatMessage, ...)
├── docker-compose.yml               Postgres, Redis, Chroma, Adminer
├── CLAUDE.md                        Commands + architecture map for Claude Code
└── HOW_TO_RUN.txt                   Full local setup + troubleshooting guide
```

## Current features

**Auth & access control**
- Google OAuth2 login, JWT access tokens (httpOnly cookie)
- Role-based access control (`ADMIN` / `USER`)
- First-run admin bootstrap via an `ADMIN_EMAILS` allowlist — no manual DB edits

**Provider key vault (admin)**
- Admins add API keys for Groq, Azure OpenAI, or Anthropic from `/admin/providers`
- Keys are encrypted with AES-256-GCM before they touch Postgres
- Regular users only ever see a provider dropdown — never raw keys
- Currently configured and active: **Groq** and **Azure OpenAI**

**Provider usage tracking**
- Every chat call is made through a custom `fetch` wrapper injected into each
  LangChain client (`ChatGroq`/`AzureChatOpenAI`/`ChatAnthropic`), which reads
  the provider's rate-limit response headers (`x-ratelimit-*` for
  Groq/Azure, `anthropic-ratelimit-*` for Anthropic) — LangChain's own
  `invoke()` doesn't surface these, so this is the only way to see them
- `GET /providers/usage` exposes the latest reading per provider; the chat
  panel shows it as a colored `GROQ 82% left` badge next to the provider
  dropdown, so a user can tell when to switch providers before hitting a 429
- This reflects **rate-limit headroom**, not billing balance — none of the
  three providers expose a dollar-credit API per key. Some deployments (e.g.
  Azure's Model Router) don't return these headers at all, in which case the
  badge shows `—` rather than a guess

**Document ingestion & retrieval**
- Upload PDF or DOCX files; parsed via `pdf-parse` / `mammoth`
- Section-aware chunking: consecutive lines are grouped into ~70-word chunks and a
  new chunk is started at each heading, so a heading stays attached to the lines it
  introduces. (It was one-chunk-per-line, which silently broke structured documents
  — a résumé's `Education` heading became a contentless chunk that still outranked
  the entries beneath it, and one of two universities fell below the top-k cutoff.)
- Chunks embedded locally (no external embedding API call) and stored in Chroma
- Cosine-similarity retrieval with a per-document cap: results are over-fetched
  then trimmed so no single file can take every slot. (Plain top-k has no notion
  of coverage — with three documents uploaded, the one most densely on-topic won
  *all 8* slots and the other two never reached the LLM at all, so questions
  spanning documents silently answered from just one of them.)

**Chat**
- Retrieval goes through `KnowledgeBaseRetriever`, a real LangChain
  `BaseRetriever` wrapping the Chroma-backed vector store (not a raw method
  call) — kept as a custom retriever rather than adopting
  `@langchain/community`'s `Chroma` vectorstore, since that would also mean
  migrating the working local embedding function
- Generation is an LCEL chain — `ChatPromptTemplate | model |
  StringOutputParser`, composed with `RunnableSequence` — against whichever
  provider's `BaseChatModel` the user picked
- Per-user in-memory conversation history
- Answers include their source chunks (filename + similarity score) for
  traceability
- An empty/blank LLM response is treated as a failure, not a valid answer —
  it's never cached or saved to history, so a provider hiccup can't get
  served back forever

**Redis-backed FAQ cache**
- Every question is normalized (lowercased, trimmed, punctuation stripped) and
  its frequency tracked in a Redis sorted set — this powers a "Frequently
  Asked" tab in the sidebar, ranked by how often each question has actually
  been asked, so the list evolves with real usage instead of being curated
  by hand
- Before a chat message touches Chroma or calls out to an LLM provider,
  `ChatService` checks Redis for a cached answer to that exact
  (provider, normalized-question) pair. On a hit, the answer returns
  immediately — **no vector search and no LLM API call**, so repeat questions
  don't burn Groq/Azure/Anthropic quota at all. The chat UI marks these
  replies with a `⚡ cached` badge so the effect is visible, not just implied
- Cached per provider (not globally), since different providers can phrase
  answers differently — a cached Groq answer is never served for an Azure
  request
- Answers carry a 7-day TTL, but that's only there to garbage-collect orphans —
  the real invalidation path is explicit: uploading or deleting a document bumps
  a Redis version counter that instantly orphans every previously cached answer
  (an O(1) bump, not a key scan), so a knowledge-base change can never leave a
  stale answer live
- The ranking and the answers have deliberately different lifetimes — the
  frequency sorted set never expires, answers do — so the list can outlive the
  answers behind it. **Cache pre-warming** closes that gap: after a document
  change invalidates everything, the next FAQ poll kicks off a background job
  that re-generates answers for the top questions across every active provider,
  so clicking one is instant instead of paying for a fresh LLM call. It's gated
  by an atomic `SET NX` flag scoped to the cache version, so it runs exactly once
  per document change no matter how often the sidebar polls
- Clicking a question in the "Frequently Asked" tab sends it straight through
  the normal chat flow, so it's a live shortcut, not just a static list
- Admins can prune junk entries (e.g. a stray "yes") straight from the tab —
  `DELETE /chat/faq` is admin-only and just removes the question from the
  ranking; it doesn't affect the underlying cached answer

**User management (admin)**
- `/admin/users` lists every user in a table (email, name, role, joined date)
  with `GET /users` / `DELETE /users/:id`, both admin-only
- Deleting a user is blocked server-side if it's your own account (and the
  delete button is hidden client-side on your own row, showing "You" instead)
- `Document.uploadedBy` and `ProviderCredential.createdBy` are nullable with
  `onDelete: SetNull` — deleting a user who uploaded documents or added
  provider keys just clears the "created by" attribution; the shared
  resource itself isn't touched
- Deleting an admin isn't permanent: Google login re-promotes any
  `ADMIN_EMAILS` address to `ADMIN` on next sign-in, recreating the account
  if needed

**UI**
- Navy/amber theme (CSS variables in `globals.css`) rather than the default
  shadcn grayscale — the login page shows the full constellation wallpaper in
  a glass card; the dashboard/admin pages use the same palette on a solid
  background so dense chat/document text stays legible
- `color-scheme: dark` plus explicit `select`/`option` styling so native
  dropdown popups (which ignore normal CSS) match the rest of the theme
  instead of rendering the browser's light-mode default

**Infra**
- Dockerized local dependencies (Postgres, Redis, Chroma, Adminer)
- App processes run on the host via Turborepo for fast iteration

## Future features (roadmap)

- **Phase 3 — Kubernetes**: containerize the app itself (currently only
  dependencies run in Docker) and move to local kind/minikube, then a real cluster
- **Phase 4 — Quiz/Exam feature**: generate quizzes from uploaded documents
  (module scaffolded, not implemented)
- **Phase 5+ — Evaluation**: automated RAG answer-quality evaluation (module
  scaffolded, not implemented)
- **Redis-backed rate limiting**: Redis is now in active use for the FAQ
  cache; per-user/per-IP request rate limiting is a separate, still-unused
  use case for it
- **Persistent chat history**: current per-user memory is in-process and
  resets on server restart — needs a DB-backed store for multi-session history
- **End-to-end tests**: the unit suite below covers the retrieval and caching
  logic; there's no HTTP-level test hitting the real guards/controllers yet

## Tests

```bash
cd apps/api && npm test          # 76 tests, ~11s, no Docker or network needed
npm run test:cov                 # coverage report
```

Jest + ts-jest, unit-level, with every external dependency faked — the suite runs
without Postgres, Redis, Chroma, or a provider API key, so it's CI-ready as-is.

| Spec | What it pins down |
|---|---|
| `document-chunker.spec.ts` | Section/heading grouping, word-budget and overlap bounds, content preservation, positional chunk ids, degenerate input |
| `vector-store.service.spec.ts` | The per-file cap: coverage across documents, backfill when only one document is relevant, relevance ordering, distance→similarity scoring |
| `faq.service.spec.ts` | Question normalization, frequency ranking, per-provider cache isolation, version-bump invalidation, the atomic `SET NX` warm lock |
| `chat.service.spec.ts` | The RAG pipeline end-to-end: cache-hit short-circuit, empty-answer guard, conversation memory, background warming |

Three choices worth calling out:

- **The specs target the bugs that actually shipped.** Two retrieval bugs (a
  contentless heading chunk outranking real content; one document taking every
  retrieval slot) were found by hand, so each has a regression test that fails
  when the fix is reverted — verified by re-introducing all three bugs and
  confirming distinct tests caught each one.
- **Only the LLM is faked in the chat tests.** `FakeListChatModel` from
  `@langchain/core/utils/testing` stands in for the provider, but the
  `ChatPromptTemplate → model → StringOutputParser` sequence is the real chain,
  so a broken prompt fails the test rather than passing a mock.
- **`ChatService`'s cache test asserts absence, not presence** — on a cache hit
  it checks the retriever and provider factory are *never called*. That's the
  claim the Redis layer actually makes (repeat questions cost zero API quota),
  and it's only testable as a negative.

Writing the FAQ spec surfaced a live off-by-one: `currentVersion()` defaulted to
`1` while Redis `INCR` on a missing key also returns `1`, so the first document
upload against a fresh Redis invalidated nothing. Fixed, with a regression test.

## Getting started

See [`HOW_TO_RUN.txt`](./HOW_TO_RUN.txt) for full local setup, environment
variables, and troubleshooting. Quick reference:

```bash
docker compose up -d          # Postgres, Redis, Chroma, Adminer
npx turbo run dev             # api (:4000) + web (:3000)
```
