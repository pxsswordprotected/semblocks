# Developer panel

Bottom-left dashboard panel for read-only index status and owner-only maintenance actions.

## Sections

- `Index Status`: indexed profile, last sync, channels, blocks, block embedding progress, and missing embeddings.
- `Enrichment`: OCR, external content, transcript, chunk, and chunk embedding counts with explicit error counts.
- `Actions`: owner-only controls. `Run full pipeline` runs sync, OCR, external content, transcripts, chunks, and embedding in that order. Secondary buttons run the same endpoints individually.
- `Debug`: failed and recent sync logs. Destructive rebuild tools are intentionally hidden.

## Modes

The panel is visible on both `/` and `/dev`.

- Public mode (`ownerMode=false`): status is visible and action buttons are disabled.
- Owner mode (`ownerMode=true`): action buttons are enabled after admin login. Button state is only UX; write APIs remain protected server-side by `requireAdminApi()`.

## Data and actions

Status data comes from `GET /api/dev/status`, which returns counts and recent sync metadata only.

Action endpoints:

- `POST /api/arena/ingest?user=<arena_username>`
- `POST /api/ocr`
- `POST /api/external-content`
- `POST /api/transcripts`
- `POST /api/chunks`
- `POST /api/embed`

Sync and full pipeline use the stored indexed Are.na username from the status response; they do not derive a user from display name.
