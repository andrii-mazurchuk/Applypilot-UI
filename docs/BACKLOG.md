# ApplyPilot — Feature Backlog & Roadmap

Ordered roughly by priority. Items at the top are prerequisites for items below.

---

## Immediate (Unblock the Pipeline)

### Run scoring → tailor → cover → pdf for both instances
Not a code task — operational. Both instances have 600+ enriched jobs but 0 scored. Must run before any applications can go out.

### Fix ZipRecruiter 403
See `OPEN_ISSUES.md #1`. Wire `boards` field in `searches.yaml` through to JobSpy's `site_name` param so ZipRecruiter can be excluded cleanly. Alternative: residential proxy approach.

---

## Near-Term (Before Scaling Up Apply)

### Fix UI log capture (file-tail approach)
See `OPEN_ISSUES.md #2`. Change `processes.ts` to tail `logs/current.log` via file polling or `fs.watch` instead of capturing subprocess stdio pipe. Will fix the truncated-log problem on Windows.

### Fix `skip_dedup` counted as failure in UI
`stats.ts` `applyFailed` query should exclude `apply_status = 'skip_dedup'`. One-line SQL fix. See `OPEN_ISSUES.md #7`.

### End-to-end apply test
Run `applypilot apply` on at least one instance with scored + tailored + covered jobs. Verify `applied.db` gets written, UI counter updates, dedup works for the second instance.

---

## Medium-Term (Architecture & Configurability)

### `location_groups` in `searches.yaml`
Implement the planned location_groups schema (see `VISION.md` and `ARCHITECTURE.md`).

Steps:
1. Extend `searches.yaml` schema with `location_groups` array
2. Patch `discovery/jobspy.py` to use per-group locations and remote flags
3. Patch `scoring/scorer.py` to read matched group's `require_sponsorship` and include in scoring prompt
4. Patch `apply/prompt.py` to use group-specific `require_sponsorship` override
5. UI: expose location groups as toggleable checkboxes per instance run

### Enrichment retry limit
Add `detail_attempts` column, cap at 3. Stop re-scraping permanently broken URLs. See `OPEN_ISSUES.md #8`.

### `detail_error` review and recovery
Some enriched jobs have `detail_error` set but were still saved with `full_description`. Audit the enrichment error handling — make sure errors don't block scoring when description exists.

---

## Later (Scale & Quality)

### Workday apply automation
Implement a Workday-specific apply flow. Workday has a consistent UI pattern — a dedicated sub-agent that knows the Workday form structure would handle a large percentage of currently-skipped manual_ats jobs. High value, significant effort.

### Response tracking
Track employer responses: replied / no reply / rejected / interview.

Option A (manual): UI buttons on the job list panel to mark status  
Option B (auto): Gmail MCP scans inbox for company domains, updates `apply_status`

Do after core pipeline is stable and producing regular applications.

### Nightly / scheduled runs
Auto-trigger discover + score + tailor + cover pipeline on a schedule (e.g., 2am daily). Windows Task Scheduler or a cron-like mechanism via the UI. Apply runs separately (needs monitoring).

### Score threshold tuning
After first real apply batch, analyze rejection patterns. May need to raise min_score from 7 to 8 for some instances, or lower to 6 for sparse markets. Make this configurable per instance in the UI.

---

## Long-Term (Product-Level)

### Full UI configurability
Everything in `searches.yaml`, `profile.json`, and instance settings editable from the browser. No YAML required to operate the system. See `VISION.md` for full roadmap.

### Multi-instance parallelism
Currently instances run sequentially (one "Run pipeline" at a time per instance card). True parallelism: run scoring for `embedded` while running discover for `python` simultaneously. The DB WAL mode supports concurrent reads already — the main constraint is LLM API rate limits.

### DB architecture split
Separate shared discovery DB from per-instance scoring DB. Only worthwhile once the current flat-file-per-instance model becomes a real bottleneck (likely at 5+ instances).

### Greenhouse / Lever apply automation
After Workday, next highest coverage for high-quality jobs. Greenhouse in particular is common among tech startups.

---

## Decisions Not Yet Made

### How to handle apply parallelism on the same instance
Current: single apply worker. Chrome worker isolation exists (per-worker user data dir), so multiple parallel apply workers are technically supported. Question: how many Chrome windows can run simultaneously on the target machine? Needs benchmarking.

### How to rate-limit applies per company
Applying to 5 jobs at the same company on the same day looks bad. Need a dedup/rate-limit check in `acquire_job()` that checks company name or domain against recently applied jobs. Not implemented.

### Salary range filtering
Jobs below a salary floor are wasted effort. `searches.yaml` has a `salary_min` field but it's unclear if it's consistently applied across all discovery sources. Audit and enforce.
