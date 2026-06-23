# ApplyPilot — Vision & Long-Term Goals

## What We're Building

A fully autonomous job application system that:
- Discovers jobs across all major boards and corporate ATS systems
- Scores each job against a specific role profile using LLM
- Tailors resume and cover letter per job, per profile
- Applies end-to-end using browser automation (Claude Code + Playwright)
- Runs multiple instances for different roles simultaneously
- Handles multi-country job search with per-location sponsorship rules
- Tracks all application outcomes (applied, replied, rejected, interview)
- Is fully configurable and operable from the web UI — no terminal required

The target is inhuman throughput: dozens of applications per day, across multiple roles and geographies, with per-job personalization that looks handcrafted.

---

## Instance Architecture

**One instance = one role profile.** Not one per country.

- `embedded` instance → Embedded & Robotics resume, searches for firmware/robotics/C++ roles
- `python` instance → Python Engineering resume, searches for backend/data/ML roles
- Future: `analyst` instance (Data Analyst), `ml` instance (ML Engineer)

Country/location is handled inside `searches.yaml` via `location_groups` (planned). Each location group carries its own remote flag, sponsorship requirement, and location filter patterns. This avoids instance explosion (no `embedded-warsaw`, `embedded-eu-remote`, etc.).

---

## Location Groups (Planned)

```yaml
location_groups:
  - name: warsaw_local
    locations: ["Warsaw, Poland", "Poland"]
    remote: false
    require_sponsorship: "No"
    work_permit_note: "PESEL UKR / student permit — no sponsorship required"
    accept_patterns: ["Warsaw", "Warszawa", "Poland", "Polska", "Hybrid"]

  - name: eu_remote
    locations: ["Remote", "Europe"]
    remote: true
    only_remote: true
    require_sponsorship: "No"
    accept_patterns: ["Remote", "Anywhere", "Europe", "Worldwide"]

  - name: global_remote
    locations: ["Remote", "Worldwide"]
    remote: true
    only_remote: true
    require_sponsorship: "Yes"   # overseas employer, may need visa
    accept_patterns: ["Remote", "Anywhere", "Worldwide"]
```

When implemented:
- Scorer reads matched group's `require_sponsorship` to evaluate job fit correctly
- Apply prompt overrides `profile.json` sponsorship field with group value
- UI exposes location groups as toggleable checkboxes per run

---

## UI Configurability Roadmap

Everything should eventually be operable from the browser without touching YAML or terminal.

Priority order:

1. **Done:** Start/stop pipeline per instance, view live logs
2. **Done:** View stats (discovered, scored, applied) and applied job list
3. **Done:** "X applied" cross-instance counter in header
4. **Next:** Toggle location groups per run
5. **Later:** Edit score threshold, salary range, sponsorship override per instance
6. **Later:** Create/edit instances (new dir + resume + searches.yaml via UI)
7. **Future:** Response tracking UI (mark replied / rejected / interview)
8. **Future:** Full-run scheduling (nightly runs, auto-restart)

---

## Response Tracking (Backlog)

Track what happens after applications go out: replied, no reply, rejected, interview scheduled.

Two options under consideration:
1. **Manual:** UI button to mark a job's status
2. **Email integration:** Gmail MCP auto-scans inbox for known company domains, updates DB

Do not implement until the core pipeline (score → tailor → cover → apply) is proven end-to-end stable and producing real applications.

---

## DB Architecture Rethink (Long-Term)

Current: one `applypilot.db` per instance holds everything (discovery through apply).

Future: split into:
- **Shared discovery DB** — all instances write discovered jobs here, dedup at source
- **Per-instance scoring DB** — each instance scores + tailors independently  
- **Shared applications registry** — `applied.db` (already started, currently cross-instance dedup only)

This is a significant fork. Do not attempt until the pipeline is proven end-to-end and the current DB model is clearly a bottleneck.

---

## Final State Vision

From Andrey's direction: the final system should be able to apply not just to multiple job roles but to multiple countries simultaneously. Different countries will have different sponsorship requirements, remote work rules, and work auth contexts. The `location_groups` design is the mechanism for this. Multi-country + multi-role = all combinations handled through instance × location_group cross-product, without code changes — pure YAML configuration.
