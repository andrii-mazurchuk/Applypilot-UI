import React, { useState } from "react";
import type { InstanceData, InstanceStats, RunMode, ProcessStatus } from "../types.js";

interface Props {
  data: InstanceData;
  onOpen: () => void;
  onViewLogs: () => void;
  onStart: (mode: RunMode) => void;
  onStop: () => void;
}

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function PipelineProgress({ stats, isRunning }: { stats: InstanceStats; isRunning: boolean }) {
  const stages = [
    { key: "discover", label: "discover", value: stats.discovered, total: Math.max(1, stats.discovered) },
    { key: "enrich",   label: "enrich",   value: stats.enriched,   total: Math.max(1, stats.discovered) },
    { key: "score",    label: "score",    value: stats.scored,     total: Math.max(1, stats.enriched) },
    { key: "tailor",   label: "tailor",   value: stats.tailored,   total: Math.max(1, stats.highFit) },
    { key: "cover",    label: "cover",    value: stats.cover,      total: Math.max(1, stats.tailored || 1) },
    { key: "apply",    label: "apply",    value: stats.applied,    total: Math.max(1, stats.tailored || 1) },
  ];

  const getPct = (s: (typeof stages)[0]) =>
    s.total <= 1 && s.value === 0 ? 0 : Math.min(100, (s.value / s.total) * 100);

  // Active stage: last stage that has work in progress (pct > 0, < 100)
  const activeKey = isRunning
    ? (stages.find((s) => getPct(s) > 0 && getPct(s) < 100) ??
       stages.find((s) => getPct(s) === 0))?.key ?? null
    : null;

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        {stages.map((stage) => {
          const pct = getPct(stage);
          const done = pct >= 100;
          const active = stage.key === activeKey;
          const touched = pct > 0;

          return (
            <div key={stage.key} className="flex items-center gap-2.5">
              <span
                className={`w-[4.5rem] text-xs ${
                  active ? "text-amber-400 font-medium" : done ? "text-zinc-300" : touched ? "text-zinc-400" : "text-zinc-600"
                }`}
              >
                {stage.label}
              </span>

              <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    active
                      ? "bg-amber-400 animate-pulse"
                      : done
                      ? "bg-blue-500"
                      : touched
                      ? "bg-blue-400"
                      : ""
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>

              <span
                className={`w-10 text-right text-xs font-mono tabular-nums ${
                  done ? "text-zinc-300" : touched ? "text-zinc-400" : "text-zinc-700"
                }`}
              >
                {stage.value > 0 ? fmt(stage.value) : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScoreBar({ distribution }: { distribution: Array<{ score: number; count: number }> }) {
  const total = distribution.reduce((s, d) => s + d.count, 0);
  if (total === 0) return null;
  const colorFor = (score: number) =>
    score >= 9 ? "bg-emerald-500" : score >= 7 ? "bg-blue-500" : score >= 5 ? "bg-yellow-500" : "bg-zinc-600";

  return (
    <div>
      <p className="text-xs text-zinc-600 uppercase tracking-wide mb-1.5">Score distribution</p>
      <div className="flex h-1.5 w-full rounded-full overflow-hidden gap-px">
        {distribution.map(({ score, count }) => (
          <div
            key={score}
            className={colorFor(score)}
            style={{ width: `${(count / total) * 100}%` }}
            title={`Score ${score}: ${count} jobs`}
          />
        ))}
      </div>
    </div>
  );
}

const STATUS_DOT: Record<ProcessStatus, string> = {
  idle:    "bg-zinc-600",
  running: "bg-emerald-400 shadow-[0_0_6px_#34d399] animate-pulse",
  done:    "bg-blue-400",
  error:   "bg-red-400",
  stopped: "bg-yellow-400",
};

const STATUS_LABEL: Record<ProcessStatus, string> = {
  idle:    "idle",
  running: "running",
  done:    "done",
  error:   "error",
  stopped: "stopped",
};

export default function InstanceCard({ data, onOpen, onViewLogs, onStart, onStop }: Props) {
  const { instance, stats, process: proc } = data;
  const isRunning = proc.status === "running";

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col gap-4 hover:border-zinc-600 transition-colors cursor-pointer" onClick={onOpen}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="font-semibold text-white text-base group-hover:text-blue-300 transition-colors">{instance.label}</span>
        <div className="flex items-center gap-2">
          <span className="text-zinc-600 text-xs">{STATUS_LABEL[proc.status]}</span>
          <span className={`w-2 h-2 rounded-full ${STATUS_DOT[proc.status]}`} />
        </div>
      </div>

      {/* Pipeline progress */}
      {stats.dbExists ? (
        <>
          <PipelineProgress stats={stats} isRunning={isRunning} />
          {stats.scoreDistribution.length > 0 && (
            <ScoreBar distribution={stats.scoreDistribution} />
          )}
        </>
      ) : (
        <p className="text-sm text-zinc-500">No data yet — pipeline hasn't run</p>
      )}

      {/* Process info */}
      {proc.status !== "idle" && (
        <div className="text-xs text-zinc-500 border-t border-zinc-800 pt-3 flex items-center justify-between">
          <span>
            {proc.mode ?? "—"}
            {proc.startedAt && ` · ${new Date(proc.startedAt).toLocaleTimeString()}`}
            {proc.endedAt && ` → ${new Date(proc.endedAt).toLocaleTimeString()}`}
          </span>
          {proc.exitCode !== null && (
            <span className={proc.exitCode === 0 ? "text-emerald-400" : "text-red-400"}>
              exit {proc.exitCode}
            </span>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
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
        <button
          onClick={onViewLogs}
          className="px-3 py-1.5 rounded text-sm text-zinc-500 hover:text-zinc-300 transition-colors ml-auto"
        >
          Logs
        </button>
        <button
          onClick={onOpen}
          className="px-3 py-1.5 rounded text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Details →
        </button>
      </div>
    </div>
  );
}
