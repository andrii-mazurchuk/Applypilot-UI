# ApplyPilot UI

Web dashboard for the [ApplyPilot](https://github.com/Pickle-Pixel/ApplyPilot) job automation pipeline.

Displays per-instance pipeline progress, scored jobs, tailored resumes, and cover letter PDFs. Lets you start/stop pipeline runs and stream live logs.

## Stack

- **Runtime**: Bun 1.x
- **Server**: Hono (REST API + SSE log streaming)
- **Client**: React 19, Tailwind CSS 3, Vite
- **Port**: 3847

## Prerequisites

1. [Bun](https://bun.sh) installed
2. `applypilot` CLI installed and at least one instance configured under `~/.applypilot/`
   - See [ApplyPilot setup](https://github.com/Pickle-Pixel/ApplyPilot) for details
   - The UI reads `~/.applypilot/instances.yaml` to discover instances

## Dev setup

```bash
bun install
bun run dev        # Vite + Hono with hot reload
```

Open `http://localhost:3847`

## Production

```bash
bun run build      # builds dist/
bun run start      # build + serve on :3847
```

## Architecture

```
src/
├── server/
│   ├── index.ts      # Hono entry point
│   ├── manifest.ts   # reads ~/.applypilot/instances.yaml
│   ├── stats.ts      # queries per-instance applypilot.db via bun:sqlite
│   ├── processes.ts  # start/stop pipeline processes, SSE log stream
│   └── routes.ts     # REST API
└── client/
    ├── App.tsx
    ├── types.ts
    └── components/
        ├── InstanceCard.tsx    # dashboard card (click to open detail)
        ├── InstanceDetail.tsx  # per-instance full-page view
        ├── LogViewer.tsx       # SSE log panel
        └── JobList.tsx
```

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/instances` | List all instances with stats |
| POST | `/api/instances/:name/start` | Start pipeline (`{ mode: "run" }`) |
| POST | `/api/instances/:name/stop` | Stop pipeline |
| GET | `/api/instances/:name/logs` | SSE stream of live logs |
| GET | `/api/instances/:name/scored-jobs` | Jobs with fit scores |
| GET | `/api/instances/:name/pdfs` | List PDF files |
| GET | `/api/instances/:name/pdfs?dir=&file=` | Stream a PDF file |
