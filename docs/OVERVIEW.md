# ApplyPilot — Project Overview

Autonomous job application pipeline for Andrey Mazurchuk (Warsaw, Poland, CS student / ML engineer).  
The system discovers jobs, scores them with an LLM, tailors a resume and cover letter, then applies using a Claude Code + Playwright browser agent.

> **Platform note:** Paths in this document use Linux conventions (`/home/xxx/.applypilot/...`).  
> The original development machine (probook, Windows) used `C:\Users\andre\.applypilot\` — these are the same directory. All code uses `Path.home() / ".applypilot"` and `homedir()` and is cross-platform.

---

## Repositories / Directories

```
C:\work\utills\automation\
├── ApplyPilot\                  Python pipeline (core engine)
│   └── src\applypilot\
│       ├── config.py            Paths, env vars, tier detection
│       ├── database.py          SQLite schema, migrations, dedup registry
│       ├── pipeline.py          Stage orchestrator (sequential + streaming)
│       ├── cli.py               Click CLI entry point
│       ├── llm.py               LLM abstraction (Gemini / OpenAI / local)
│       ├── view.py              Rich terminal dashboard
│       ├── discovery\
│       │   ├── jobspy.py        JobSpy aggregator (Indeed, LinkedIn, etc.)
│       │   ├── workday.py       Workday corporate ATS scraper
│       │   └── smartextract.py  AI-powered scraper for custom sites
│       ├── enrichment\
│       │   └── detail.py        Full description + apply URL scraper
│       ├── scoring\
│       │   ├── scorer.py        LLM fit scoring (1–10)
│       │   ├── tailor.py        LLM resume tailoring
│       │   ├── cover_letter.py  LLM cover letter generation
│       │   ├── pdf.py           PDF conversion (tailored resumes + cover letters)
│       │   └── validator.py     Resume quality validation
│       ├── apply\
│       │   ├── launcher.py      Apply worker loop (Claude Code CLI subprocess)
│       │   ├── chrome.py        Chrome worker process management (CDP)
│       │   ├── dashboard.py     Live apply dashboard (Rich terminal)
│       │   └── prompt.py        System prompt builder for apply agent
│       ├── wizard\
│       │   └── init.py          `applypilot init` interactive setup
│       └── config\
│           ├── sites.yaml       Known sites, blocked ATS, manual ATS, base URLs
│           ├── employers.yaml   Employer-specific apply instructions
│           └── searches.example.yaml  Template for user searches config

├── applypilot-ui\               TypeScript/Bun dashboard (web UI)
│   └── src\
│       ├── server\
│       │   ├── index.ts         Hono entry point (port 3847)
│       │   ├── manifest.ts      Reads ~/.applypilot/instances.yaml
│       │   ├── stats.ts         Queries per-instance applypilot.db via bun:sqlite
│       │   ├── processes.ts     Start/stop pipeline processes, SSE log stream
│       │   └── routes.ts        API routes: /api/instances, /start, /stop, /logs
│       └── client\
│           ├── App.tsx          Main React app
│           ├── types.ts         Shared TypeScript types
│           └── components\
│               ├── InstanceCard.tsx  Per-instance stat card + controls
│               ├── JobList.tsx       Applied jobs slide-in panel
│               └── LogViewer.tsx     Live log viewer (SSE)

C:\Users\andre\.applypilot\     User data directory (shared across instances)
├── instances.yaml               Instance manifest (read by UI)
├── profile.json                 User profile (name, email, work auth, etc.)
├── .env                         API keys (GEMINI_API_KEY, etc.)
├── applied.db                   Shared cross-instance dedup registry (WAL SQLite)
├── ARCHITECTURE.md              Architectural decisions log
├── RESUME_FORMAT.md             Resume format constraints for LLM tailoring
└── instances\
    ├── embedded\                Instance: Embedded & Robotics
    │   ├── applypilot.db
    │   ├── resume.txt
    │   ├── searches.yaml
    │   ├── tailored_resumes\
    │   ├── cover_letters\
    │   └── logs\
    └── python\                  Instance: Python Engineering
        ├── applypilot.db
        ├── resume.txt
        ├── searches.yaml
        ├── tailored_resumes\
        ├── cover_letters\
        └── logs\
```

---

## Pipeline Stages

```
discover → enrich → score → tailor → cover → pdf → [apply]
```

| Stage | Command | What it does |
|---|---|---|
| discover | `applypilot run discover` | JobSpy + Workday + smart extract → stores job URLs in DB |
| enrich | `applypilot run enrich` | Fetches full descriptions + apply URLs |
| score | `applypilot run score` | LLM rates each job fit 1–10 based on resume + profile |
| tailor | `applypilot run tailor` | LLM rewrites resume for each job scoring ≥7 |
| cover | `applypilot run cover` | LLM writes cover letter per job |
| pdf | `applypilot run pdf` | Converts .txt tailored resumes + cover letters → .pdf |
| apply | `applypilot apply` | Claude Code + Playwright fills out job application forms |

**Streaming mode:** `applypilot run --stream` runs all stages concurrently with DB as conveyor belt. This is the main mode used from the UI ("Run pipeline" button).

**Apply is separate:** The `apply` stage is a separate command from `run`. In the UI, "Run pipeline" = `applypilot run --stream`, "Apply" = `applypilot apply`.

---

## Key Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `APPLYPILOT_DIR` | `~/.applypilot` | Per-instance working directory (DB, resumes, logs) |
| `APPLYPILOT_SHARED_DIR` | same as `APPLYPILOT_DIR` | Shared files: profile.json, .env, applied.db |
| `APPLYPILOT_PROFILE` | `$SHARED_DIR/profile.json` | Override profile path |
| `APPLYPILOT_ENV_FILE` | `$SHARED_DIR/.env` | Override .env path |
| `CHROME_PATH` | auto-detect | Override Chrome executable |
| `GEMINI_API_KEY` | — | LLM API key (or `OPENAI_API_KEY`, `LLM_URL`) |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Pipeline engine | Python 3.14, Click CLI, Rich terminal UI |
| LLM | Gemini 2.0 Flash (via `GEMINI_API_KEY`), or OpenAI-compatible |
| Job discovery | [JobSpy](https://github.com/Bunsly/JobSpy), custom Workday scraper, smart extract |
| Apply agent | Claude Code CLI (`claude`) + Playwright MCP (browser) + Gmail MCP (OTP) |
| Web UI | Bun 1.x, Hono, React 18, Tailwind CSS, Vite |
| DB | SQLite with WAL mode, `bun:sqlite` in UI, `sqlite3` in Python |
| UI server | Port **3847** (http://localhost:3847) |

---

## Instance Model

One instance = one resume + one role profile. Country is NOT a reason to create a new instance — it's a dimension within `searches.yaml` via the planned `location_groups` extension.

See `C:\Users\andre\.applypilot\ARCHITECTURE.md` for full architectural decision log.

---

## How to Start the UI

```powershell
cd C:\work\utills\automation\applypilot-ui
bun run build    # if not built
bun run start    # runs on http://localhost:3847
```

---

## How to Run a Pipeline Manually

```powershell
# Set instance env vars then run
$env:APPLYPILOT_DIR = "C:\Users\andre\.applypilot\instances\embedded"
$env:APPLYPILOT_SHARED_DIR = "C:\Users\andre\.applypilot"
applypilot run --stream

# Or from the UI — "Run pipeline" button triggers this automatically
```

---

## Cross-Instance Deduplication

`~/.applypilot/applied.db` is a shared SQLite registry. Before every apply attempt, the launcher checks if the canonical URL has been applied to via any instance. If yes, the job is marked `skip_dedup` and skipped. This prevents duplicate applications when two instances discover the same job.

Written in: `applypilot/database.py` (`is_already_applied`, `record_applied`, `canonical_url`)  
Wired in: `applypilot/apply/launcher.py` (`acquire_job`, `worker_loop`)
