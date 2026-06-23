# ApplyPilot — Open Issues & Known Bugs

Issues known at 2026-06-19. Fix before running apply at scale.

---

## 1. ZipRecruiter 403 — Cloudflare Blocking (HIGH)

**Status:** Confirmed, not fixed  
**Symptom:** Every discover run gets HTTP 403 on all ZipRecruiter requests. Cloudflare bot detection.  
**Impact:** ZipRecruiter jobs are completely missing from both instances.

**Root cause:** JobSpy fetches ZipRecruiter but `searches.yaml` doesn't pass the `boards` filter through to JobSpy's `site_name` parameter. Even if it did, ZipRecruiter blocks headless requests.

**Fix options:**
1. Patch `discovery/jobspy.py` to wire `searches.yaml` `boards` field → JobSpy `site_name` param, then exclude `ziprecruiter` from `site_name`
2. Alternative: implement a ZipRecruiter-specific scraper using a residential proxy or browser

**Workaround:** Exclude `ziprecruiter` from searches until a real fix is in place.

---

## 2. UI Log Capture Incomplete (MEDIUM)

**Status:** Confirmed, not fixed  
**Symptom:** UI log viewer shows only partial output compared to terminal. Some log lines are missing, especially early startup lines.

**Root cause:** Windows process chain: `applypilot-ui (Bun) → applypilot.exe → python.exe`. The stdio pipe between Bun and the Python subprocess doesn't reliably capture all stdout/stderr. Windows spawned processes don't always flush pipes immediately.

**Recommended fix:** 
- Make the pipeline write all output to a log file (`logs/current.log`) using Python's `logging` module or simple `tee`
- UI reads the log file via tail (file polling or `fs.watch`) instead of capturing subprocess stdio
- This approach is reliable on all platforms

**Current behavior:** The `logs/` directory exists and `current.log` is written, but the SSE stream in `processes.ts` captures subprocess output — not the log file. The two sources are inconsistent.

**Fix location:** `applypilot-ui/src/server/processes.ts` — change log capture to tail `logs/current.log` instead of capturing subprocess stdout/stderr pipe.

---

## 3. Scoring Stage Not Run Yet (PIPELINE BLOCKER)

**Status:** Active  
**Impact:** Both instances are stuck at enrichment (0 scored jobs). No tailoring, cover letters, PDFs, or applications possible until scoring runs.

**To fix:** Run scoring for both instances:
```powershell
# embedded
$env:APPLYPILOT_DIR = "C:\Users\andre\.applypilot\instances\embedded"
$env:APPLYPILOT_SHARED_DIR = "C:\Users\andre\.applypilot"
applypilot run score tailor cover pdf

# python
$env:APPLYPILOT_DIR = "C:\Users\andre\.applypilot\instances\python"
$env:APPLYPILOT_SHARED_DIR = "C:\Users\andre\.applypilot"
applypilot run score tailor cover pdf
```

Or use the UI "Run pipeline" button on each instance card.

---

## 4. Python Instance Discover Incomplete

**Status:** Active  
**Impact:** `python` instance only ran ~14/36 search combinations before last stop. ~321 discovered vs. expected ~600+.

**To fix:** Re-run discover for python instance. It will skip already-discovered URLs (INSERT OR IGNORE) and continue fetching remaining combos.

---

## 5. `applied.db` Not Yet Battle-Tested End-to-End

**Status:** Implemented, not run end-to-end  
**Detail:** The cross-instance dedup registry (`applied.db`) was implemented in `database.py` and `launcher.py` but has never had a real successful application written to it (0 applied total). The code paths for `is_already_applied()` and `record_applied()` are written and manually unit-tested, but have not been exercised in a real pipeline run.

**Watch for:** If `record_applied()` fails silently (the exception is swallowed), duplicates could slip through. The `apply_attempts = 99` permanent-failure guard in `acquire_job()` is a backup, but the dedup registry is the primary guard.

---

## 6. Manual ATS Sites — No Apply Automation

**Status:** By design, but worth noting  
**Detail:** Jobs on Workday, Greenhouse, Lever, and similar ATS platforms are flagged in `config/sites.yaml` as `manual_ats`. The apply stage skips these and marks them `manual`. They represent a significant fraction of high-quality jobs.

**Long-term:** Implement Workday/Greenhouse-specific apply flows. Workday is the highest priority (largest coverage). This is a significant engineering effort.

---

## 7. `skip_dedup` Not Shown Correctly in UI Stats

**Status:** Minor, low priority  
**Detail:** The UI `stats.ts` counts `applyFailed` as `apply_error IS NOT NULL`. Jobs marked `skip_dedup` have an `apply_error` value ("applied via another instance"), so they're counted as failures in the UI. They should be excluded from the failure count.

**Fix:** In `stats.ts`, change the `applyFailed` query to exclude `apply_status = 'skip_dedup'`:
```sql
SUM(CASE WHEN apply_error IS NOT NULL AND apply_status != 'skip_dedup' THEN 1 ELSE 0 END) AS applyFailed
```

---

## 8. No Retry Limit on Enrichment Errors

**Status:** Low priority  
**Detail:** Jobs that fail enrichment (detail scrape error) don't have an attempt counter. They can be retried indefinitely on every enrichment run. In practice this wastes time re-scraping known-bad URLs.

**Fix:** Add `detail_attempts` column to DB schema. Mark jobs with `detail_attempts >= 3` as permanently failed in enrichment.
