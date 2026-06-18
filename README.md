# Semblocks

[Write the short human intro here: what this is, why you made it, and what kind of research/archive workflow it is for.]

## What it does

Semblocks is a local-first semantic search dashboard for an Are.na profile.

It can:

- ingest an Are.na user's channels and blocks into SQLite
- build OpenAI embeddings for searchable block text
- OCR image blocks
- extract Link/Attachment page text through Jina Reader
- extract YouTube transcripts through `yt-dlp`
- search indexed blocks with text or image queries
- filter search results by channel, block type, and date added
- recommend channels for a query/image from the local index

## Personal note

[Write this part yourself if you want the README to sound like you. Good place for: why the project exists, what you learned, what is intentionally rough, and what you might revisit later.]

## Stack

- Next.js 15 App Router
- React 19
- TypeScript
- Tailwind CSS v4
- SQLite via `better-sqlite3`
- vector search via `sqlite-vec`
- OpenAI `text-embedding-3-small` embeddings
- OpenAI vision calls for image captions/OCR summaries
- Are.na public API
- Jina Reader for external Link/Attachment content
- `yt-dlp` for YouTube transcripts

## Requirements

- Node.js 24 or newer. CI runs on Node 24.
- npm
- An OpenAI API key
- A Jina API key if you want the full sync pipeline to complete
- An Are.na profile slug or Are.na profile URL
- Optional but recommended: an Are.na personal access token with read access
- Optional: `yt-dlp` installed on PATH for YouTube transcript extraction

## Setup

```bash
npm install
cp .env.example .env.local
```

Edit `.env.local`:

```env
ARENA_PROFILE_SLUG=your-are-na-slug
OPENAI_API_KEY=...
ARENA_TOKEN=...
JINA_API_KEY=...
ARESEARCH_ADMIN_PASSWORD=choose-a-local-admin-password
ADMIN_COOKIE_SECRET=use-a-long-random-secret
```

Generate a cookie secret with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Then run the app:

```bash
npm run dev
```

Open:

```txt
http://localhost:3000/dev
```

Log in with `ARESEARCH_ADMIN_PASSWORD`, then click **Sync new blocks**.

The default SQLite database path is:

```txt
data/aresearch.db
```

Override it with:

```env
SQLITE_PATH=/absolute/or/relative/path/to/your.db
```

## Environment variables

| Variable | Required | Used for |
| --- | --- | --- |
| `ARENA_PROFILE_SLUG` | yes | Runtime Are.na profile shown in the dashboard and used by the sync button. Accepts a bare slug or profile URL. |
| `OPENAI_API_KEY` | yes | Embeddings, OCR/image descriptions, image-query captions. |
| `JINA_API_KEY` | yes for full sync | Link/Attachment content extraction. Without it, the external-content stage fails. |
| `ARESEARCH_ADMIN_PASSWORD` | yes for `/dev` | Owner-mode login password. |
| `ADMIN_COOKIE_SECRET` | yes for `/dev` | Signs the owner-mode session cookie. |
| `ARENA_TOKEN` | recommended | Raises Are.na API rate limits. |
| `SQLITE_PATH` | no | Custom SQLite database path. Defaults to `data/aresearch.db`. |
| `YT_DLP_PATH` | no | Custom `yt-dlp` binary path. Defaults to `yt-dlp` on PATH. |

## Forking this for your own archive

This repo no longer hardcodes the original Are.na profile in the dashboard. To use it with your own data:

1. Set `ARENA_PROFILE_SLUG` in `.env.local`.
2. Use your own `OPENAI_API_KEY`, `JINA_API_KEY`, and optional `ARENA_TOKEN`.
3. Start with a fresh SQLite database, or set `SQLITE_PATH` to a new file.
4. Log in at `/dev`.
5. Run **Sync new blocks**.

Local database files and local env files are ignored by git.

The UI displays the configured profile when `ARENA_PROFILE_SLUG` is set. If it is not set but the database already has indexed data, the UI falls back to the most recently indexed profile.

## Owner mode vs public mode

`/dev` is owner mode:

- requires admin login
- can run sync/indexing jobs
- can run live semantic search against OpenAI
- can use filters and developer actions

`/` is public mode:

- does not expose admin actions
- does not run live OpenAI search for visitors
- can show public/demo behavior backed by stored demo searches

## Useful commands

```bash
npm run dev        # start local dev server
npm run build      # production build
npm run start      # start production server after build
npm run typecheck  # TypeScript check
npm test           # node:test suite
npm run demos      # rebuild stored demo searches from evals/queries.jsonl
npm run eval       # run search eval queries
```

## Data pipeline

The full sync job runs these stages:

1. ingest Are.na profile, channels, and blocks
2. OCR image blocks
3. extract Link/Attachment content with Jina Reader
4. extract YouTube transcripts with `yt-dlp`
5. chunk long text
6. embed pending blocks/chunks

The schema lives in `data/schema.sql`. On first database open, the app creates the SQLite file and applies the schema automatically.

## API notes

Most write/admin endpoints require owner-mode admin auth.

Important routes:

- `POST /api/jobs/sync?user=<slug-or-profile-url>` — enqueue full sync
- `GET /api/jobs/:id` — poll job status
- `GET /api/search?q=<query>&k=<limit>` — owner-only live text search
- `POST /api/search` — owner-only image search
- `GET /api/channels` — indexed channel list
- `GET /api/dev/status` — index/dev status summary

## Deployment notes

[Add your own notes here if you deploy this anywhere: platform, env vars, database persistence, admin access, and whether public mode is intended to be used.]

## Current limitations

[Write this in your own voice. Suggested bullets to fill in: what is experimental, what is tuned to your archive, what needs cleanup, and what you would not trust yet.]
