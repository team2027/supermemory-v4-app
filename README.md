# chat-memory-assistant

A small chat assistant backend with long-term memory backed by the [Supermemory](https://supermemory.ai) TypeScript SDK.

Every exchange is stored in a per-user Supermemory container. Before each reply the assistant pulls the user's profile (static facts plus dynamic context) and, for users in the temporal memory rollout, searches a second container of dated messages so it can answer "when did I..." questions with real send times.

## Layout

```
src/
  env.ts                      environment schema
  feature-flags.ts            long-term memory rollout
  db/messages.ts              JSON file message store
  ai/
    supermemory.ts            client, profile fetch, save exchange
    supermemory-config.ts     container naming and extraction context
    supermemory-http.ts       direct HTTP ingest for follow-ups
    supermemory-backfill.ts   rebuild a user's memory from stored history
    temporal-events.ts        dated event parsing and document shape
    temporal-memory.ts        temporal search and background indexing
    memory-maintenance.ts     update or forget an indexed message
    assistant.ts              reply generation with memory context
    models.ts, types.ts       model interfaces (bring your own LLM)
  routes/
    memory-backfill.ts        GET status / POST backfill (admin)
    conversation-followup.ts  scheduled follow-up job
scripts/
  backfill-supermemory.ts     backfill one user from the CLI
  migrate-user-memory.ts      backfill all active users
```

Routes export standard `GET` / `POST` handlers that take a Web `Request` and return a `Response`, so they can be mounted in any framework that speaks the Fetch API.

## Setup

Requires Node.js 20 or newer.

```sh
npm install
cp .env.example .env
cp data/messages.example.json data/messages.json
```

| Variable | Purpose |
| --- | --- |
| `SUPERMEMORY_API_KEY` | Supermemory API key |
| `SUPERMEMORY_CONTAINER_TAG_PREFIX` | prefix for per-user containers, e.g. `user-` |
| `SUPERMEMORY_ENTITY_CONTEXT` | guidance passed to memory extraction on ingest |
| `MESSAGES_FILE` | path to the JSON message store |
| `ADMIN_TOKEN` | bearer token for the admin routes |
| `MEMORY_USER_IDS` | users with long-term memory reads, comma-separated or `*` |
| `TEMPORAL_MEMORY` | `off` or `allowlist` |
| `TEMPORAL_MEMORY_USER_IDS` | users in the temporal memory allowlist |

Wire your LLM provider in at startup with `configureModels({ chat, extraction })`.

## Memory containers

- `<prefix><id>`: conversation exchanges, read through `client.profile`. Follow-up messages are stored with `source: followup` metadata and only draw extraction context from `source: chat` memories.
- `<prefix><id>-time-v1`: one document per user message with send time, timezone and extracted events in metadata, keyed by `customId`

## Scripts

```sh
npm run typecheck
npm test
npm run backfill -- <userId> [--force]
npm run migrate-memory -- [--dry-run] [userId]
```

Tests mock the Supermemory client, so no API key or network access is needed.
