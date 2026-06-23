import React, { useEffect, useState } from "react";
import type { InstanceData, Job } from "../types.js";

interface Props {
  data: InstanceData;
  onClose: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  applied: "bg-emerald-900/50 text-emerald-400 border border-emerald-800",
  failed: "bg-red-900/50 text-red-400 border border-red-800",
  in_progress: "bg-yellow-900/50 text-yellow-400 border border-yellow-800",
};

export default function JobList({ data, onClose }: Props) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    fetch(`/api/instances/${data.instance.name}/jobs`)
      .then((r) => r.json())
      .then((j) => { setJobs(j); setLoading(false); });
  }, [data.instance.name]);

  const filtered = filter === "all" ? jobs : jobs.filter((j) => j.apply_status === filter);

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="w-full max-w-3xl bg-zinc-950 border-l border-zinc-800 flex flex-col h-full overflow-hidden">
        {/* Panel header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div>
            <h2 className="font-semibold text-white text-lg">{data.instance.label}</h2>
            <p className="text-zinc-500 text-sm">{data.stats.applied} applications</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-xl leading-none">✕</button>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 px-6 py-3 border-b border-zinc-800">
          {["all", "applied", "failed"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded text-sm capitalize transition-colors ${
                filter === f ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Job list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="text-zinc-500 text-sm p-6">Loading...</p>
          ) : filtered.length === 0 ? (
            <p className="text-zinc-500 text-sm p-6">No applications yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-zinc-950 border-b border-zinc-800">
                <tr className="text-zinc-500 text-xs uppercase tracking-wide">
                  <th className="text-left px-6 py-3 font-medium">Title</th>
                  <th className="text-left px-6 py-3 font-medium">Site</th>
                  <th className="text-left px-6 py-3 font-medium">Score</th>
                  <th className="text-left px-6 py-3 font-medium">Applied</th>
                  <th className="text-left px-6 py-3 font-medium">Status</th>
                  <th className="text-left px-6 py-3 font-medium">Link</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900">
                {filtered.map((job) => (
                  <tr key={job.url} className="hover:bg-zinc-900/50 transition-colors">
                    <td className="px-6 py-3 text-zinc-200 max-w-xs truncate">{job.title ?? "—"}</td>
                    <td className="px-6 py-3 text-zinc-400">{job.site ?? "—"}</td>
                    <td className="px-6 py-3">
                      {job.fit_score != null ? (
                        <span className={`font-mono font-semibold ${job.fit_score >= 9 ? "text-emerald-400" : job.fit_score >= 7 ? "text-blue-400" : "text-zinc-400"}`}>
                          {job.fit_score}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-6 py-3 text-zinc-400 whitespace-nowrap">
                      {job.applied_at ? new Date(job.applied_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-6 py-3">
                      {job.apply_status ? (
                        <span className={`px-2 py-0.5 rounded text-xs ${STATUS_COLORS[job.apply_status] ?? "bg-zinc-800 text-zinc-400"}`}>
                          {job.apply_status}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-6 py-3">
                      {job.application_url ? (
                        <a href={job.application_url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline underline-offset-2">
                          open ↗
                        </a>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
