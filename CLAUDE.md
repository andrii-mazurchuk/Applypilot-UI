# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## What this repo is

`applypilot-ui` is the web dashboard for the ApplyPilot job automation pipeline.
It is a standalone TypeScript/Bun application — it does **not** contain ApplyPilot Python source.
ApplyPilot is an external dependency installed as a CLI binary (`pip install applypilot`).

## Dev setup

```bash
bun install
bun run dev     # Vite + Hono hot-reload, port 3847
```

Requires `applypilot` CLI installed and at least one instance configured under `~/.applypilot/`.
See `docs/OVERVIEW.md` for the full system architecture.

## Commands

```bash
bun run dev     # development server (Vite + Hono concurrently)
bun run build   # build dist/
bun run start   # build then serve on http://localhost:3847
```

## Stack

Bun 1.x, Hono, React 19, Tailwind CSS 3, Vite. Port 3847.

## Project structure

```
src/
├── server/
│   ├── index.ts      # Hono entry point, port 3847
│   ├── manifest.ts   # reads ~/.applypilot/instances.yaml
│   ├── stats.ts      # queries per-instance applypilot.db via bun:sqlite
│   ├── processes.ts  # start/stop pipeline processes, SSE log stream
│   └── routes.ts     # REST API routes
└── client/
    ├── App.tsx
    ├── types.ts
    └── components/
        ├── InstanceCard.tsx    # dashboard grid card (click → InstanceDetail)
        ├── InstanceDetail.tsx  # full per-instance view: stats, jobs, PDFs
        ├── LogViewer.tsx       # SSE log stream panel
        └── JobList.tsx
```

## How the UI talks to ApplyPilot

The server does two things:
1. Shells out `spawn("applypilot", args)` to start/stop pipeline runs
2. Reads the per-instance SQLite DB (`applypilot.db`) directly via `bun:sqlite`

There is no Python import — the boundary is the filesystem (`~/.applypilot/`) and the CLI binary.

## Runtime data (never in this repo)

```
~/.applypilot/
├── instances.yaml       # instance manifest (read by UI)
├── profile.json         # user profile + credentials
├── .env                 # API keys
├── applied.db           # cross-instance dedup registry
└── instances/
    ├── embedded/        # applypilot.db, resume.txt, tailored_resumes/, cover_letters/, logs/
    └── python/
```

## Key docs

- `docs/OVERVIEW.md` — system architecture
- `docs/BACKLOG.md` — feature backlog and known issues
- `docs/CURRENT_STATE.md` — pipeline status per instance
- `docs/VISION.md` — long-term goals
