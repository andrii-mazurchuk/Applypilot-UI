# ApplyPilot — Documentation Index

Handoff docs for the autonomous job application pipeline.  
New agent: read these in order before touching any code.

| File | What's in it |
|---|---|
| [OVERVIEW.md](OVERVIEW.md) | Project structure, file map, pipeline stages, env vars, tech stack, how to start |
| [CURRENT_STATE.md](CURRENT_STATE.md) | What's implemented, pipeline DB stats per instance, what's been run so far |
| [OPEN_ISSUES.md](OPEN_ISSUES.md) | Known bugs and broken things — fix before scaling |
| [BACKLOG.md](BACKLOG.md) | Planned features, roadmap, open architectural questions |
| [VISION.md](VISION.md) | Long-term direction, multi-country model, final system goal |

## Key files outside this docs/ folder

| Path | Purpose |
|---|---|
| `~/.applypilot/ARCHITECTURE.md` | Architectural decision log (instance model, dedup, location_groups design) |
| `~/.applypilot/instances.yaml` | Instance manifest (read by UI and all tooling) |
| `~/.applypilot/profile.json` | User profile (name, email, work auth, sponsorship) |
| `~/.applypilot/.env` | API keys |
| `ApplyPilot/src/applypilot/config/sites.yaml` | Known sites, blocked ATS, manual ATS |
| `ApplyPilot/src/applypilot/config/employers.yaml` | Per-employer apply instructions |

## Immediate next actions

1. **Start UI:** `cd applypilot-ui && bun run start` → http://localhost:3847
2. **Run scoring for both instances** (both at 0 scored, pipeline is blocked)
3. **Fix ZipRecruiter 403** (see OPEN_ISSUES.md #1)
4. **Fix UI log capture** (see OPEN_ISSUES.md #2)
5. **First end-to-end apply test** after scoring + tailoring completes
