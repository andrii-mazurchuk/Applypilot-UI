import React, { useEffect, useRef, useState } from "react";
import type { InstanceData, InstanceStats, RunMode, ProcessStatus, ScoredJob, PdfFile } from "../types.js";

interface Props {
  data: InstanceData;
  onBack: () => void;
  onStart: (mode: RunMode) => void;
  onStop: () => void;
  onViewLogs: () => void;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024).toFixed(0)} KB`;
}

function pdfFilename(txtPath: string): string {
  const parts = txtPath.split("/");
  return parts[parts.length - 1].replace(/\.txt$/, ".pdf");
}

function pdfUrl(instanceName: string, dir: string, file: string): string {
  return `/api/instances/${instanceName}/pdfs?dir=${encodeURIComponent(dir)}&file=${encodeURIComponent(file)}`;
}

function resumePdfUrl(instanceName: string, resumePath: string): string {
  return pdfUrl(instanceName, "tailored_resumes", pdfFilename(resumePath));
}

function coverPdfUrl(instanceName: string, coverPath: string): string {
  return pdfUrl(instanceName, "cover_letters", pdfFilename(coverPath));
}

// ── sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <p className="text-zinc-500 text-xs uppercase tracking-wide mb-1">{label}</p>
      <p className="text-white text-2xl font-bold tabular-nums">{fmt(Number(value))}</p>
      {sub && <p className="text-zinc-600 text-xs mt-0.5">{sub}</p>}
    </div>
  );
}

function PipelineRow({
  label, value, total, isActive, isRunning,
}: {
  label: string; value: number; total: number; isActive: boolean; isRunning: boolean;
}) {
  const pct = total <= 0 ? 0 : Math.min(100, (value / total) * 100);
  const done = pct >= 100;
  const touched = pct > 0;
  const active = isActive && isRunning;

  return (
    <div className="flex items-center gap-3">
      <span className={`w-16 text-sm ${active ? "text-amber-400 font-medium" : done ? "text-zinc-200" : touched ? "text-zinc-400" : "text-zinc-600"}`}>
        {label}
      </span>
      <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            active ? "bg-amber-400 animate-pulse" : done ? "bg-blue-500" : touched ? "bg-blue-400" : ""
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`w-12 text-right text-sm font-mono tabular-nums ${done ? "text-zinc-300" : touched ? "text-zinc-400" : "text-zinc-700"}`}>
        {value > 0 ? fmt(value) : "—"}
      </span>
      <span className="w-10 text-right text-xs text-zinc-600">
        {pct > 0 ? `${Math.round(pct)}%` : ""}
      </span>
    </div>
  );
}

function ScoreHistogram({ distribution }: { distribution: Array<{ score: number; count: number }> }) {
  const total = distribution.reduce((s, d) => s + d.count, 0);
  if (total === 0) return null;
  const max = Math.max(...distribution.map((d) => d.count));

  const colorFor = (score: number) =>
    score >= 9 ? "bg-emerald-500" : score >= 7 ? "bg-blue-500" : score >= 5 ? "bg-yellow-500" : "bg-zinc-600";

  const allScores = Array.from({ length: 10 }, (_, i) => i + 1);
  const byScore = Object.fromEntries(distribution.map((d) => [d.score, d.count]));

  return (
    <div>
      <p className="text-xs text-zinc-500 uppercase tracking-wide mb-3">Score distribution</p>
      <div className="flex items-end gap-1 h-16">
        {allScores.map((score) => {
          const count = byScore[score] ?? 0;
          const h = max > 0 ? (count / max) * 100 : 0;
          return (
            <div key={score} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full flex items-end justify-center" style={{ height: 52 }}>
                <div
                  className={`w-full rounded-t ${colorFor(score)} transition-all`}
                  style={{ height: `${h}%`, minHeight: count > 0 ? 2 : 0 }}
                  title={`Score ${score}: ${count} jobs`}
                />
              </div>
              <span className="text-zinc-600 text-[10px]">{score}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-3 text-xs text-zinc-600">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500 inline-block" /> 9–10 great</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-500 inline-block" /> 7–8 good</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-yellow-500 inline-block" /> 5–6 ok</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-zinc-600 inline-block" /> &lt;5 low</span>
      </div>
    </div>
  );
}

type JobFilter = "ready" | "applied" | "failed" | "highfit" | "all";

const FILTER_LABELS: Record<JobFilter, string> = {
  ready: "Ready to apply",
  applied: "Applied",
  failed: "Failed",
  highfit: "High fit (≥7)",
  all: "All scored",
};

function scoreColor(score: number | null): string {
  if (score == null) return "text-zinc-600";
  if (score >= 9) return "text-emerald-400";
  if (score >= 7) return "text-blue-400";
  if (score >= 5) return "text-yellow-400";
  return "text-zinc-500";
}

const STATUS_BADGE: Record<string, string> = {
  applied: "bg-emerald-900/60 text-emerald-300 border border-emerald-800",
  skip_dedup: "bg-zinc-800 text-zinc-500",
  in_progress: "bg-yellow-900/60 text-yellow-300 border border-yellow-800",
};
const failedBadge = "bg-red-900/60 text-red-300 border border-red-800";

function statusBadge(status: string | null): { cls: string; label: string } {
  if (!status) return { cls: "bg-zinc-800/50 text-zinc-600", label: "not applied" };
  const cls = STATUS_BADGE[status] ?? (status.startsWith("fail") ? failedBadge : "bg-zinc-800 text-zinc-400");
  return { cls, label: status.replace(/_/g, " ") };
}

function JobsTable({ jobs, instanceName }: { jobs: ScoredJob[]; instanceName: string }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (jobs.length === 0) {
    return <p className="text-zinc-500 text-sm p-6">No jobs match this filter.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[700px]">
        <thead className="sticky top-0 bg-zinc-900 border-b border-zinc-800 z-10">
          <tr className="text-zinc-500 text-xs uppercase tracking-wide">
            <th className="text-left px-5 py-3 font-medium">Title</th>
            <th className="text-left px-3 py-3 font-medium">Site</th>
            <th className="text-center px-3 py-3 font-medium">Score</th>
            <th className="text-left px-3 py-3 font-medium">Location</th>
            <th className="text-left px-3 py-3 font-medium">Status</th>
            <th className="text-center px-3 py-3 font-medium">Docs</th>
            <th className="text-center px-3 py-3 font-medium">Link</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/60">
          {jobs.map((job) => {
            const { cls, label } = statusBadge(job.apply_status);
            const isExpanded = expanded === job.url;
            return (
              <React.Fragment key={job.url}>
                <tr
                  className="hover:bg-zinc-800/40 transition-colors cursor-pointer"
                  onClick={() => setExpanded(isExpanded ? null : job.url)}
                >
                  <td className="px-5 py-3 text-zinc-200 max-w-xs">
                    <span className="truncate block" title={job.title ?? ""}>{job.title ?? "—"}</span>
                  </td>
                  <td className="px-3 py-3">
                    <span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">
                      {job.site ?? "—"}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className={`font-bold font-mono text-base ${scoreColor(job.fit_score)}`}>
                      {job.fit_score ?? "—"}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-zinc-400 text-xs max-w-[140px] truncate">
                    {job.location ?? "—"}
                  </td>
                  <td className="px-3 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${cls}`}>{label}</span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <div className="flex items-center justify-center gap-2">
                      {job.tailored_resume_path ? (
                        <a
                          href={resumePdfUrl(instanceName, job.tailored_resume_path)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-zinc-400 hover:text-white text-xs underline underline-offset-2"
                          title="Resume PDF"
                        >
                          CV
                        </a>
                      ) : <span className="text-zinc-700 text-xs">—</span>}
                      {job.cover_letter_path ? (
                        <a
                          href={coverPdfUrl(instanceName, job.cover_letter_path)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-zinc-400 hover:text-white text-xs underline underline-offset-2"
                          title="Cover letter PDF"
                        >
                          CL
                        </a>
                      ) : <span className="text-zinc-700 text-xs">—</span>}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-center">
                    {job.application_url ? (
                      <a
                        href={job.application_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-blue-400 hover:text-blue-300 text-xs"
                        title={job.application_url}
                      >
                        ↗
                      </a>
                    ) : job.url ? (
                      <a
                        href={job.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-zinc-500 hover:text-zinc-300 text-xs"
                        title={job.url}
                      >
                        ↗
                      </a>
                    ) : <span className="text-zinc-700">—</span>}
                  </td>
                </tr>
                {isExpanded && job.score_reasoning && (
                  <tr className="bg-zinc-800/30">
                    <td colSpan={7} className="px-5 py-3 text-zinc-400 text-xs leading-relaxed">
                      <span className="text-zinc-500 font-medium">Reasoning: </span>
                      {job.score_reasoning}
                      {job.apply_error && (
                        <span className="block mt-1 text-red-400">
                          <span className="font-medium">Apply error: </span>{job.apply_error}
                        </span>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PdfGrid({ pdfs, instanceName }: { pdfs: PdfFile[]; instanceName: string }) {
  const [viewer, setViewer] = useState<PdfFile | null>(null);

  const resumes = pdfs.filter((p) => p.type === "resume");
  const covers = pdfs.filter((p) => p.type === "cover");

  const PdfCard = ({ pdf }: { pdf: PdfFile }) => (
    <button
      onClick={() => setViewer(pdf)}
      className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-500 rounded-lg p-3 text-left transition-colors group w-full"
    >
      <div className="text-zinc-400 group-hover:text-zinc-200 text-3xl mb-2 leading-none">📄</div>
      <p className="text-zinc-300 text-xs font-mono break-all leading-relaxed line-clamp-2">
        {pdf.filename.replace(/^(linkedin|indeed|glassdoor|google)_/, "").replace(/\.pdf$/, "").replace(/_/g, " ")}
      </p>
      <p className="text-zinc-600 text-xs mt-1">{fmtBytes(pdf.size)}</p>
    </button>
  );

  return (
    <>
      {resumes.length > 0 && (
        <div className="mb-6">
          <h3 className="text-zinc-400 text-xs uppercase tracking-widest font-medium mb-3">
            Tailored Resumes ({resumes.length})
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {resumes.map((pdf) => <PdfCard key={pdf.filename} pdf={pdf} />)}
          </div>
        </div>
      )}
      {covers.length > 0 && (
        <div>
          <h3 className="text-zinc-400 text-xs uppercase tracking-widest font-medium mb-3">
            Cover Letters ({covers.length})
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {covers.map((pdf) => <PdfCard key={pdf.filename} pdf={pdf} />)}
          </div>
        </div>
      )}
      {resumes.length === 0 && covers.length === 0 && (
        <p className="text-zinc-500 text-sm">No PDFs generated yet.</p>
      )}

      {/* PDF Viewer Modal */}
      {viewer && (
        <div className="fixed inset-0 z-50 bg-black/95 flex flex-col">
          <div className="flex items-center justify-between px-6 py-3 border-b border-zinc-800 bg-zinc-950">
            <div>
              <span className="text-white text-sm font-mono">{viewer.filename}</span>
              <span className="ml-3 text-zinc-500 text-xs">{fmtBytes(viewer.size)}</span>
            </div>
            <div className="flex items-center gap-4">
              <a
                href={pdfUrl(instanceName, viewer.dir, viewer.filename)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 text-sm"
              >
                Open in new tab ↗
              </a>
              <button
                onClick={() => setViewer(null)}
                className="text-zinc-400 hover:text-white text-xl leading-none"
              >
                ✕
              </button>
            </div>
          </div>
          <iframe
            src={pdfUrl(instanceName, viewer.dir, viewer.filename)}
            className="flex-1 w-full border-0 bg-zinc-900"
            title={viewer.filename}
          />
        </div>
      )}
    </>
  );
}

const STATUS_DOT: Record<ProcessStatus, string> = {
  idle:    "bg-zinc-600",
  running: "bg-emerald-400 shadow-[0_0_6px_#34d399] animate-pulse",
  done:    "bg-blue-400",
  error:   "bg-red-400",
  stopped: "bg-yellow-400",
};

// ── main component ────────────────────────────────────────────────────────────

export default function InstanceDetail({ data, onBack, onStart, onStop, onViewLogs }: Props) {
  const { instance, stats, process: proc } = data;
  const isRunning = proc.status === "running";

  const [jobFilter, setJobFilter] = useState<JobFilter>("ready");
  const [scoredJobs, setScoredJobs] = useState<ScoredJob[]>([]);
  const [pdfs, setPdfs] = useState<PdfFile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`/api/instances/${instance.name}/scored-jobs`).then((r) => r.json()),
      fetch(`/api/instances/${instance.name}/pdfs`).then((r) => r.json()),
    ]).then(([jobs, pdfList]) => {
      setScoredJobs(Array.isArray(jobs) ? jobs : []);
      setPdfs(Array.isArray(pdfList) ? pdfList : []);
      setLoading(false);
    });
  }, [instance.name]);

  const filteredJobs = scoredJobs.filter((job) => {
    switch (jobFilter) {
      case "ready":   return !!job.tailored_resume_path && !job.applied_at;
      case "applied": return !!job.applied_at;
      case "failed":  return !!(job.apply_status && job.apply_status !== "applied" && job.apply_status !== "skip_dedup" && job.applied_at == null);
      case "highfit": return (job.fit_score ?? 0) >= 7;
      default:        return true;
    }
  });

  // Build filter tab counts
  const counts: Record<JobFilter, number> = {
    ready:   scoredJobs.filter((j) => !!j.tailored_resume_path && !j.applied_at).length,
    applied: scoredJobs.filter((j) => !!j.applied_at).length,
    failed:  scoredJobs.filter((j) => !!(j.apply_status && j.apply_status !== "applied" && j.apply_status !== "skip_dedup" && j.applied_at == null)).length,
    highfit: scoredJobs.filter((j) => (j.fit_score ?? 0) >= 7).length,
    all:     scoredJobs.length,
  };

  const pipelineStages = [
    { label: "discover", value: stats.discovered, total: Math.max(1, stats.discovered) },
    { label: "enrich",   value: stats.enriched,   total: Math.max(1, stats.discovered) },
    { label: "score",    value: stats.scored,      total: Math.max(1, stats.enriched) },
    { label: "tailor",   value: stats.tailored,    total: Math.max(1, stats.highFit) },
    { label: "cover",    value: stats.cover,        total: Math.max(1, stats.tailored || 1) },
    { label: "apply",    value: stats.applied,     total: Math.max(1, stats.tailored || 1) },
  ];

  const activeStagePct = (s: (typeof pipelineStages)[0]) =>
    s.total <= 1 && s.value === 0 ? 0 : Math.min(100, (s.value / s.total) * 100);

  const activeLabel = isRunning
    ? (pipelineStages.find((s) => activeStagePct(s) > 0 && activeStagePct(s) < 100) ??
       pipelineStages.find((s) => activeStagePct(s) === 0))?.label ?? null
    : null;

  const readyCount = stats.tailored - stats.applied;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center gap-3">
        <button
          onClick={onBack}
          className="text-zinc-500 hover:text-zinc-200 text-sm transition-colors"
        >
          ← Dashboard
        </button>
        <span className="text-zinc-700">/</span>
        <span className="font-semibold text-white">{instance.label}</span>
        <div className="flex items-center gap-1.5 ml-1">
          <span className={`w-2 h-2 rounded-full ${STATUS_DOT[proc.status]}`} />
          <span className="text-zinc-500 text-xs">{proc.status}</span>
          {proc.exitCode !== null && (
            <span className={`text-xs ml-1 ${proc.exitCode === 0 ? "text-emerald-400" : "text-red-400"}`}>
              exit {proc.exitCode}
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={onViewLogs}
            className="px-3 py-1.5 rounded text-sm text-zinc-500 hover:text-zinc-200 border border-zinc-800 hover:border-zinc-600 transition-colors"
          >
            Logs
          </button>
          {isRunning ? (
            <button
              onClick={onStop}
              className="px-3 py-1.5 rounded text-sm bg-red-900/50 text-red-400 border border-red-800 hover:bg-red-900 transition-colors"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={() => onStart("run")}
              className="px-3 py-1.5 rounded text-sm bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors"
            >
              Run pipeline
            </button>
          )}
        </div>
      </header>

      <main className="px-6 py-8 max-w-7xl mx-auto space-y-6">

        {/* Stats strip */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          <StatCard label="Discovered" value={stats.discovered} />
          <StatCard label="Scored" value={stats.scored} />
          <StatCard label="High fit" value={stats.highFit} sub="score ≥7" />
          <StatCard label="Tailored" value={stats.tailored} />
          <StatCard label="Ready" value={readyCount > 0 ? readyCount : stats.tailored} sub="to apply" />
          <StatCard label="Applied" value={stats.applied} />
        </div>

        {/* Pipeline + Source breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Pipeline progress */}
          <div className="lg:col-span-2 bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
            <h2 className="text-zinc-300 text-xs uppercase tracking-widest font-medium">Pipeline</h2>
            <div className="space-y-2.5">
              {pipelineStages.map((s) => (
                <PipelineRow
                  key={s.label}
                  label={s.label}
                  value={s.value}
                  total={s.total}
                  isActive={s.label === activeLabel}
                  isRunning={isRunning}
                />
              ))}
            </div>
            {stats.scoreDistribution.length > 0 && (
              <div className="pt-4 border-t border-zinc-800">
                <ScoreHistogram distribution={stats.scoreDistribution} />
              </div>
            )}
          </div>

          {/* Source breakdown */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
            <h2 className="text-zinc-300 text-xs uppercase tracking-widest font-medium mb-4">By source</h2>
            {stats.bySource.length === 0 ? (
              <p className="text-zinc-600 text-sm">No data yet.</p>
            ) : (
              <div className="space-y-2.5">
                {stats.bySource.map(({ site, count }) => {
                  const pct = (count / stats.discovered) * 100;
                  return (
                    <div key={site} className="flex items-center gap-2">
                      <span className="w-20 text-xs text-zinc-400 truncate">{site}</span>
                      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div className="h-full bg-zinc-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-10 text-right text-xs font-mono text-zinc-500">{fmt(count)}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Process timing */}
            {proc.status !== "idle" && (
              <div className="mt-6 pt-4 border-t border-zinc-800 text-xs text-zinc-500 space-y-1">
                {proc.mode && <p>Mode: <span className="text-zinc-300">{proc.mode}</span></p>}
                {proc.startedAt && <p>Started: <span className="text-zinc-300">{new Date(proc.startedAt).toLocaleString()}</span></p>}
                {proc.endedAt && <p>Ended: <span className="text-zinc-300">{new Date(proc.endedAt).toLocaleString()}</span></p>}
                {stats.dbModifiedAt && <p>DB updated: <span className="text-zinc-300">{new Date(stats.dbModifiedAt).toLocaleString()}</span></p>}
              </div>
            )}
          </div>
        </div>

        {/* Scored jobs */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          {/* Section header + filter tabs */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 flex-wrap gap-3">
            <h2 className="text-zinc-300 text-xs uppercase tracking-widest font-medium">Jobs</h2>
            <div className="flex gap-1 flex-wrap">
              {(["ready", "highfit", "all", "applied", "failed"] as JobFilter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setJobFilter(f)}
                  className={`px-3 py-1 rounded text-xs transition-colors ${
                    jobFilter === f
                      ? "bg-zinc-700 text-white"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {FILTER_LABELS[f]}
                  <span className={`ml-1.5 ${jobFilter === f ? "text-zinc-300" : "text-zinc-600"}`}>
                    {counts[f]}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <p className="text-zinc-500 text-sm p-6">Loading jobs...</p>
          ) : (
            <div className="max-h-[600px] overflow-y-auto">
              <JobsTable jobs={filteredJobs} instanceName={instance.name} />
            </div>
          )}
        </div>

        {/* Documents */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <h2 className="text-zinc-300 text-xs uppercase tracking-widest font-medium mb-4">Documents</h2>
          {loading ? (
            <p className="text-zinc-500 text-sm">Loading...</p>
          ) : (
            <PdfGrid pdfs={pdfs} instanceName={instance.name} />
          )}
        </div>

      </main>
    </div>
  );
}
