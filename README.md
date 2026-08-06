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
| RAG / LLM orchestration | LangChain (`@langchain/core`) as a chat-model abstraction over Groq, Azure OpenAI, and Anthropic |
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
│   │       ├── users/             User module
│   │       ├── providers/         Encrypted LLM provider key vault (admin)
│   │       ├── documents/         Upload, parsing, chunking, Chroma vector store
│   │       ├── chat/              RAG orchestration, per-provider chat model factory
│   │       ├── quiz/              Scaffolded — not implemented yet
│   │       ├── eval/              Scaffolded — not implemented yet
│   │       └── health/            Health check endpoint
│   └── web/                       Next.js frontend (port 3000)
│       └── src/
│           ├── app/
│           │   ├── login/         Google sign-in page
│           │   └── admin/providers/  Admin UI for managing provider keys
│           ├── components/dashboard/  Chat panel, sidebar, dashboard shell
│           └── lib/               API client, auth helpers
├── packages/
│   └── shared-types/               Types shared between api and web (Role,
│                                    ProviderName, AuthUser, ChatMessage, ...)
├── docker-compose.yml               Postgres, Redis, Chroma, Adminer
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

**Document ingestion & retrieval**
- Upload PDF or DOCX files; parsed via `pdf-parse` / `mammoth`
- Line-based chunking (chunk size + overlap tuned to avoid diluting single facts)
- Chunks embedded locally (no external embedding API call) and stored in Chroma
- Cosine-similarity top-k retrieval at query time

**Chat**
- Retrieved chunks are assembled into context and sent to the user's chosen
  LLM provider via LangChain's `BaseChatModel` abstraction
- Per-user in-memory conversation history
- Answers include their source chunks for traceability

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
- **Redis-backed rate limiting**: Redis is already provisioned but unused
- **Persistent chat history**: current per-user memory is in-process and
  resets on server restart — needs a DB-backed store for multi-session history
- **Automated tests**: no test suite yet (an earlier Python version had full
  pytest coverage with fakes; this hasn't been ported to the TS rewrite)

## Getting started

See [`HOW_TO_RUN.txt`](./HOW_TO_RUN.txt) for full local setup, environment
variables, and troubleshooting. Quick reference:

```bash
docker compose up -d          # Postgres, Redis, Chroma, Adminer
npx turbo run dev             # api (:4000) + web (:3000)
```
