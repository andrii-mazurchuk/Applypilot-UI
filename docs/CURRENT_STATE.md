# ApplyPilot — Current State (as of 2026-06-19)

> **Platform note:** Paths below are for Linux (ideapad, user `xxx`). Original development was on Windows (probook) where `~/.applypilot` was `C:\Users\andre\.applypilot`.

## Pipeline Status

> Numbers verified from transferred DBs on 2026-06-19. These are the actual counts in the files on ideapad.

### Instance: `embedded` (Embedded & Robotics)
- DB: `~/.applypilot/instances/embedded/applypilot.db`
- **Discovered:** 1718 jobs
- **Enriched:** 1718 jobs (100% — all full descriptions scraped)
- **Scored:** 0 — scoring stage has not been run yet
- **Applied:** 0

**Next step:** Run scoring, tailoring, cover letters, then PDF conversion:
```bash
export APPLYPILOT_DIR=~/.applypilot/instances/embedded
export APPLYPILOT_SHARED_DIR=~/.applypilot
applypilot run score tailor cover pdf
```

### Instance: `python` (Python Engineering)
- DB: `~/.applypilot/instances/python/applypilot.db`
- **Discovered:** 1660 jobs
- **Enriched:** 1658 jobs
- **Scored:** 1658 jobs — scoring is COMPLETE
- **Applied:** 0

**Next step:** Run tailoring, cover letters, PDF — scoring already done:
```bash
export APPLYPILOT_DIR=~/.applypilot/instances/python
export APPLYPILOT_SHARED_DIR=~/.applypilot
applypilot run tailor cover pdf
```

---

## What Is Implemented and Working

### Python pipeline (ApplyPilot)
- [x] Discovery: JobSpy (Indeed, LinkedIn, Glassdoor, ZipRecruiter), Workday corporate, smart extract
- [x] Enrichment: full description + apply URL scraper
- [x] Scoring: LLM fit scoring 1–10 with reasoning
- [x] Tailoring: LLM resume tailoring per job, with validation and retry
- [x] Cover letters: LLM cover letter generation
- [x] PDF conversion: tailored resumes + cover letters → PDF
- [x] Apply: Claude Code CLI + Playwright MCP browser agent, Gmail MCP for OTP
- [x] Tier detection: gates features based on installed deps (Claude CLI, Chrome, LLM API key)
- [x] Multi-instance: APPLYPILOT_DIR env var per instance
- [x] Shared config: APPLYPILOT_SHARED_DIR for profile.json + .env
- [x] Cross-instance dedup: `applied.db` shared registry with canonical URL normalization
- [x] `skip_dedup` apply_status for jobs blocked by dedup check

### Web UI (applypilot-ui)
- [x] Instance cards with live stats (discovered, high-fit, applied, failed)
- [x] Score distribution bar per instance
- [x] Process status indicator (idle / running / done / error / stopped)
- [x] "Run pipeline" button → `applypilot run --stream`
- [x] "Apply" button → `applypilot apply`
- [x] "Stop" button → kills process
- [x] Live log viewer (SSE stream, last N lines buffered)
- [x] Log file list + full log file viewer per instance
- [x] Applied jobs list per instance (title, site, score, status, link)
- [x] "X applied" cross-instance counter in header (from `applied.db`)
- [x] Auto-refresh every 5 seconds
- [x] Running on **port 3847** (`http://localhost:3847`)

### Configuration files
- [x] `~/.applypilot/instances.yaml` — instance manifest
- [x] `~/.applypilot/profile.json` — user profile
- [x] `~/.applypilot/.env` — API keys
- [x] Per-instance `searches.yaml` for both `embedded` and `python`
- [x] Per-instance `resume.txt` for both instances
- [x] `~/.applypilot/ARCHITECTURE.md` — architectural decision log

---

## Apply Stage — How It Works

When `applypilot apply` runs:

1. `init_applied_db()` creates `applied.db` if not exists
2. Worker loop calls `acquire_job()` which:
   - Locks with `BEGIN IMMEDIATE` (prevents two workers claiming same job)
   - Checks `manual_ats` list — skips Workday/Greenhouse/Lever (too complex for automation)
   - Checks `is_already_applied()` against `applied.db` — skips with `skip_dedup` if found
   - Claims the job row with `apply_status = 'in_progress'`
3. Spawns Chrome worker (isolated user data dir via CDP)
4. Spawns Claude Code CLI subprocess with:
   - Playwright MCP (browser control via CDP)
   - Gmail MCP (OTP retrieval if needed)
   - System prompt from `apply/prompt.py` (job details, resume, profile, instructions)
5. Agent outputs `RESULT:APPLIED`, `RESULT:FAILED:reason`, `RESULT:CAPTCHA`, etc.
6. On `RESULT:APPLIED`: calls `record_applied(job, instance_name)` → writes to `applied.db`
7. Permanent failures (captcha, sso_required, cloudflare_blocked, already_applied, expired) → `apply_attempts = 99`, never retried
8. Retryable failures → increments `apply_attempts`, retried up to `max_apply_attempts` (default 3)

---

## UI Server — How to Start

```powershell
cd C:\work\utills\automation\applypilot-ui
bun run start     # serves pre-built dist/ on port 3847
# OR
bun run dev       # dev mode with hot reload
```

Build is already done (`dist/` exists). If source changes: `bun run build` first.

---

## LLM Configuration

Using **Gemini 2.0 Flash** via `GEMINI_API_KEY` set in `~/.applypilot/.env`.

The LLM is used for:
- Scoring (`scoring/scorer.py`)
- Resume tailoring (`scoring/tailor.py`)  
- Cover letter generation (`scoring/cover_letter.py`)
- Smart extract discovery (`discovery/smartextract.py`)

LLM abstraction is in `llm.py` — also supports OpenAI-compatible endpoints via `LLM_URL`.
