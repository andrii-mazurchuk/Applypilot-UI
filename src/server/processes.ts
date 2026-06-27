import { spawn, type ChildProcess } from "child_process";
import { homedir } from "os";
import { join, dirname } from "path";
import {
  existsSync, mkdirSync, writeFileSync, unlinkSync, readdirSync,
  readFileSync, openSync, readSync, closeSync, fstatSync,
  watch as fsWatch,
} from "fs";
import type { InstanceConfig } from "./manifest.js";

export type ProcessStatus = "idle" | "running" | "done" | "error" | "stopped";
export type RunMode = "run" | "apply";

interface ProcessState {
  pid: number | null;
  child: ChildProcess | null;
  status: ProcessStatus;
  mode: RunMode | null;
  logs: string[];
  startedAt: string | null;
  endedAt: string | null;
  exitCode: number | null;
  logFile: string | null;
  subscribers: Set<(line: string) => void>;
}

const VENV_BIN = join(homedir(), ".applypilot", "venv", "bin");

function userSharedDir(userId: string): string {
  return join(homedir(), ".applypilot", "users", userId);
}

const processes = new Map<string, ProcessState>();

function getOrCreate(name: string): ProcessState {
  if (!processes.has(name)) {
    processes.set(name, {
      pid: null, child: null, status: "idle", mode: null,
      logs: [], startedAt: null, endedAt: null,
      exitCode: null, logFile: null, subscribers: new Set(),
    });
  }
  return processes.get(name)!;
}

function emit(state: ProcessState, line: string) {
  state.logs.push(line);
  for (const sub of state.subscribers) {
    try { sub(line); } catch { /* subscriber gone */ }
  }
}

function pidFile(instanceDir: string) {
  return join(instanceDir, ".pipeline.pid");
}

function runLogFile(instanceDir: string, isoTimestamp: string): string {
  const ts = isoTimestamp.replace(/:/g, "-").replace(/\..+/, "");
  return join(instanceDir, "logs", `run_${ts}.log`);
}

/** Returns the newest run_*.log in the logs dir, or null if none exist. */
function newestLogFile(instanceDir: string): string | null {
  const logsDir = join(instanceDir, "logs");
  if (!existsSync(logsDir)) return null;
  const files = readdirSync(logsDir)
    .filter((f) => /^run_.*\.log$/.test(f))
    .sort()
    .reverse();
  return files.length > 0 ? join(logsDir, files[0]) : null;
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/**
 * Tail a log file, emitting new lines to `state` as they appear.
 * Uses fs.watch + setInterval polling as a fallback.
 * Returns a cleanup function to stop the tail.
 */
function startLogTail(logFile: string, state: ProcessState): () => void {
  let offset = 0;

  function readNew() {
    if (!existsSync(logFile)) return;
    try {
      const fd = openSync(logFile, "r");
      const stats = fstatSync(fd);
      if (stats.size > offset) {
        const len = stats.size - offset;
        const buf = Buffer.alloc(len);
        readSync(fd, buf, 0, len, offset);
        closeSync(fd);
        offset = stats.size;
        for (const line of buf.toString("utf-8").split(/\r?\n/)) {
          if (line.trim()) emit(state, line);
        }
      } else {
        closeSync(fd);
      }
    } catch { /* file may not be ready yet */ }
  }

  // Poll every 250ms as primary mechanism
  const interval = setInterval(readNew, 250);

  // fs.watch on the log directory (fires when file is created or written)
  let watcher: ReturnType<typeof fsWatch> | null = null;
  try {
    watcher = fsWatch(dirname(logFile), (_, filename) => {
      if (filename && logFile.endsWith(filename)) readNew();
    });
  } catch { /* watch not available on this platform — polling covers it */ }

  return () => {
    clearInterval(interval);
    watcher?.close();
  };
}

function processKey(userId: string, instanceName: string): string {
  return `${userId}:${instanceName}`;
}

/** Called at server startup — restores state for any instance whose process survived a crash. */
export function restoreFromDisk(userId: string, instances: InstanceConfig[]) {
  for (const inst of instances) {
    const pf = pidFile(inst.dir);
    if (!existsSync(pf)) continue;
    try {
      const pid = parseInt(readFileSync(pf, "utf-8").trim(), 10);
      const key = processKey(userId, inst.name);
      if (!isNaN(pid) && isAlive(pid)) {
        const state = getOrCreate(key);
        state.pid = pid;
        state.status = "running";
        state.startedAt = state.startedAt ?? new Date().toISOString();
        const lf = newestLogFile(inst.dir);
        if (lf && existsSync(lf)) {
          state.logFile = lf;
          const lines = readFileSync(lf, "utf-8").split("\n").filter(Boolean);
          state.logs = lines;
          emit(state, "[system] Server restarted — process still running, log restored");
          startLogTail(lf, state);
        }
      } else {
        try { unlinkSync(pf); } catch {}
      }
    } catch { /* corrupt pid file */ }
  }
}

export function startProcess(userId: string, instance: InstanceConfig, mode: RunMode): { ok: boolean; error?: string } {
  const key = processKey(userId, instance.name);
  const state = getOrCreate(key);
  if (state.status === "running") return { ok: false, error: "Already running" };

  const logsDir = join(instance.dir, "logs");
  if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });

  const startedAt = new Date().toISOString();
  const lf = runLogFile(instance.dir, startedAt);
  const pf = pidFile(instance.dir);

  // Write system header to the log file before Python starts so the tail
  // picks it up as the first lines of output
  const header = [
    `[system] Starting: applypilot ${mode} for "${instance.name}"`,
    `[system] APPLYPILOT_DIR=${instance.dir}`,
  ];
  writeFileSync(lf, header.join("\n") + "\n", { encoding: "utf-8" });

  const args = mode === "run" ? ["run"] : ["apply"];

  // Strip any LLM keys inherited from the Bun server's environment so that
  // each instance exclusively uses its own .env file (set via APPLYPILOT_ENV_FILE).
  const { GEMINI_API_KEY: _g, OPENAI_API_KEY: _o, ...inheritedEnv } = process.env;
  const env: NodeJS.ProcessEnv = {
    ...inheritedEnv,
    PATH: `${VENV_BIN}:${process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin"}`,
    APPLYPILOT_DIR: instance.dir,
    APPLYPILOT_SHARED_DIR: userSharedDir(userId),
    APPLYPILOT_ENV_FILE: join(instance.dir, ".env"),
    APPLYPILOT_LOG_FILE: lf,
    PYTHONIOENCODING: "utf-8",
    PYTHONUNBUFFERED: "1",
    VIRTUAL_ENV: join(homedir(), ".applypilot", "venv"),
  };

  // stdout ignored — Python writes to APPLYPILOT_LOG_FILE.
  // stderr piped only to catch crash tracebacks that bypass logging.
  const child = spawn("applypilot", args, {
    env,
    shell: true,
    detached: true,
    stdio: ["ignore", "ignore", "pipe"],
  });

  // Do NOT unref — we keep a reference so the shutdown handler can signal the child.
  // The HTTP server keeps the event loop alive regardless.

  if (child.pid) writeFileSync(pf, String(child.pid));

  state.pid = child.pid ?? null;
  state.child = child;
  state.status = "running";
  state.mode = mode;
  state.logs = [...header];
  state.startedAt = startedAt;
  state.endedAt = null;
  state.exitCode = null;
  state.logFile = lf;

  // Tail the log file for all normal output
  const stopTail = startLogTail(lf, state);

  // Capture stderr for Python crash tracebacks
  child.stderr?.on("data", (data: Buffer) => {
    for (const line of data.toString().split(/\r?\n/)) {
      if (!line.trim()) continue;
      const out = `[err] ${line}`;
      emit(state, out);
    }
  });

  child.on("close", (code) => {
    stopTail();
    const status: ProcessStatus = code === 0 ? "done" : code === null ? "stopped" : "error";
    state.status = status;
    state.exitCode = code;
    state.endedAt = new Date().toISOString();
    state.pid = null;
    state.child = null;
    emit(state, `[system] Process exited with code ${code}`);
    try { unlinkSync(pf); } catch {}
  });

  child.on("error", (err) => {
    stopTail();
    state.status = "error";
    state.pid = null;
    state.child = null;
    state.endedAt = new Date().toISOString();
    emit(state, `[system] Failed to start: ${err.message}`);
    try { unlinkSync(pf); } catch {}
  });

  return { ok: true };
}

function killProcessGroup(pid: number, signal: NodeJS.Signals) {
  // Try killing the whole process group first (catches any children the pipeline spawned).
  // On Linux, detached processes get their own PGID == their PID, so -pid targets the group.
  try { process.kill(-pid, signal); } catch {
    // Fallback: kill just the process if group kill fails (e.g. permissions, non-Linux)
    try { process.kill(pid, signal); } catch {}
  }
}

export function stopProcess(userId: string, name: string): { ok: boolean; error?: string } {
  const key = processKey(userId, name);
  const state = processes.get(key);
  if (!state || state.status !== "running") return { ok: false, error: "No running process" };

  const pid = state.pid;
  if (pid) {
    killProcessGroup(pid, "SIGTERM");
    setTimeout(() => {
      try { if (isAlive(pid)) killProcessGroup(pid, "SIGKILL"); } catch {}
    }, 5000);
  }
  state.status = "stopped";
  state.pid = null;
  state.child = null;
  return { ok: true };
}

/**
 * Gracefully stop all running pipeline processes.
 * Sends SIGTERM and waits up to gracePeriodMs, then force-kills survivors.
 * Called by the server's SIGTERM/SIGINT handler before exiting.
 */
export async function shutdownAll(gracePeriodMs = 10_000): Promise<void> {
  const running = [...processes.entries()].filter(
    ([, s]) => s.status === "running" && s.pid != null
  );
  if (running.length === 0) return;

  console.log(`[server] Stopping ${running.length} pipeline process(es)...`);

  for (const [name, state] of running) {
    console.log(`[server] Sending SIGTERM to ${name} (pid=${state.pid})`);
    if (state.pid) killProcessGroup(state.pid, "SIGTERM");
  }

  // Poll until all have exited or the grace period expires
  const deadline = Date.now() + gracePeriodMs;
  while (Date.now() < deadline) {
    const stillRunning = running.filter(([, s]) => s.status === "running");
    if (stillRunning.length === 0) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  // Force-kill anything still alive
  for (const [name, state] of running) {
    if (state.status === "running" && state.pid != null) {
      console.log(`[server] Force-killing ${name} (pid=${state.pid})`);
      killProcessGroup(state.pid, "SIGKILL");
    }
  }
}

export function getStatus(userId: string, name: string) {
  const s = getOrCreate(processKey(userId, name));
  return {
    status: s.status,
    mode: s.mode,
    logs: s.logs,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    exitCode: s.exitCode,
    pid: s.pid,
  };
}

export function subscribe(userId: string, name: string, cb: (line: string) => void): () => void {
  const state = getOrCreate(processKey(userId, name));
  state.subscribers.add(cb);
  return () => state.subscribers.delete(cb);
}

export function getLogs(userId: string, name: string): string[] {
  return getOrCreate(processKey(userId, name)).logs;
}

export { newestLogFile };
