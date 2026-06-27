import { Hono } from "hono";
import { stream } from "hono/streaming";
import { existsSync, readdirSync, statSync, createReadStream } from "fs";
import { join } from "path";
import { loadManifest } from "./manifest.js";
import { getStats, getAppliedJobs, getCrossInstanceApplied, getScoredJobs, getJob, updateJobStatus, listPdfs } from "./stats.js";
import { streamChatResponse, saveResumeAndRegen } from "./chat.js";
import type { ChatMessage } from "./chat.js";
import { startProcess, stopProcess, getStatus, subscribe, getLogs } from "./processes.js";
import type { RunMode } from "./processes.js";

const api = new Hono();

api.get("/instances", (c) => {
  try {
    const instances = loadManifest();
    const result = instances.map((instance) => ({
      instance,
      stats: getStats(instance),
      process: getStatus(instance.name),
    }));
    return c.json({ instances: result, crossInstance: getCrossInstanceApplied() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/instances]", msg);
    return c.json({ error: msg }, 500);
  }
});

api.get("/instances/:name/jobs", (c) => {
  const { name } = c.req.param();
  const instances = loadManifest();
  const instance = instances.find((i) => i.name === name);
  if (!instance) return c.json({ error: "Instance not found" }, 404);
  return c.json(getAppliedJobs(instance));
});

api.get("/instances/:name/status", (c) => {
  const { name } = c.req.param();
  return c.json(getStatus(name));
});

api.post("/instances/:name/start", async (c) => {
  const { name } = c.req.param();
  const instances = loadManifest();
  const instance = instances.find((i) => i.name === name);
  if (!instance) return c.json({ error: "Instance not found" }, 404);

  const body = await c.req.json().catch(() => ({}));
  const mode: RunMode = body.mode === "apply" ? "apply" : "run";

  const result = startProcess(instance, mode);
  if (!result.ok) return c.json({ error: result.error }, 409);
  return c.json({ ok: true, mode });
});

api.post("/instances/:name/stop", (c) => {
  const { name } = c.req.param();
  const result = stopProcess(name);
  if (!result.ok) return c.json({ error: result.error }, 409);
  return c.json({ ok: true });
});

api.get("/instances/:name/scored-jobs", (c) => {
  const { name } = c.req.param();
  const instances = loadManifest();
  const instance = instances.find((i) => i.name === name);
  if (!instance) return c.json({ error: "Instance not found" }, 404);
  return c.json(getScoredJobs(instance));
});

api.get("/instances/:name/scored-jobs/:url", (c) => {
  const { name } = c.req.param();
  const url = decodeURIComponent(c.req.param("url"));
  const instances = loadManifest();
  const instance = instances.find((i) => i.name === name);
  if (!instance) return c.json({ error: "Instance not found" }, 404);
  const job = getJob(instance, url);
  if (!job) return c.json({ error: "Job not found" }, 404);
  return c.json(job);
});

api.patch("/instances/:name/scored-jobs", async (c) => {
  const { name } = c.req.param();
  const instances = loadManifest();
  const instance = instances.find((i) => i.name === name);
  if (!instance) return c.json({ error: "Instance not found" }, 404);

  const body = await c.req.json().catch(() => null);
  if (!body?.url) return c.json({ error: "url required" }, 400);

  const { url, apply_status } = body as { url: string; apply_status: string | null };
  const appliedAt = apply_status === "applied" ? new Date().toISOString() : null;

  updateJobStatus(instance, url, apply_status ?? null, appliedAt);
  return c.json({ ok: true });
});

api.get("/instances/:name/pdfs", (c) => {
  const { name } = c.req.param();
  const instances = loadManifest();
  const instance = instances.find((i) => i.name === name);
  if (!instance) return c.json({ error: "Instance not found" }, 404);

  const dir = c.req.query("dir");
  const file = c.req.query("file");

  // Serve a single PDF file
  if (dir && file) {
    if (!["tailored_resumes", "cover_letters"].includes(dir) || !/^[^/\\]+\.pdf$/i.test(file)) {
      return c.json({ error: "Invalid path" }, 400);
    }
    const filePath = join(instance.dir, dir, file);
    if (!existsSync(filePath)) return c.json({ error: "Not found" }, 404);

    c.header("Content-Type", "application/pdf");
    c.header("Cache-Control", "private, max-age=60");
    c.header("Content-Disposition", `inline; filename="${file}"`);

    return stream(c, async (s) => {
      await new Promise<void>((resolve, reject) => {
        const rs = createReadStream(filePath);
        rs.on("data", (chunk) => s.write(chunk as Buffer).catch(() => rs.destroy()));
        rs.on("end", resolve);
        rs.on("error", reject);
      });
    });
  }

  // List all PDFs
  return c.json(listPdfs(instance));
});

// Chat: stream a Gemini response with job + resume context
api.post("/instances/:name/jobs/chat", async (c) => {
  const { name } = c.req.param();
  const body = await c.req.json().catch(() => null) as { jobUrl?: string; messages?: ChatMessage[] } | null;
  if (!body?.jobUrl || !Array.isArray(body?.messages)) {
    return c.json({ error: "jobUrl and messages required" }, 400);
  }
  const instances = loadManifest();
  const instance = instances.find((i) => i.name === name);
  if (!instance) return c.json({ error: "Instance not found" }, 404);

  c.header("Content-Type", "text/event-stream");
  c.header("Cache-Control", "no-cache");
  c.header("Connection", "keep-alive");

  return stream(c, async (s) => {
    let closed = false;
    s.onAbort(() => { closed = true; });
    try {
      await streamChatResponse(instance, body.jobUrl!, body.messages!, (chunk) => {
        if (!closed) s.write(`data: ${JSON.stringify(chunk)}\n\n`).catch(() => { closed = true; });
      });
      if (!closed) await s.write(`data: [DONE]\n\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!closed) await s.write(`data: ${JSON.stringify({ error: msg })}\n\n`).catch(() => {});
    }
  });
});

// Save edited resume text and regenerate PDF
api.post("/instances/:name/jobs/save-resume", async (c) => {
  const { name } = c.req.param();
  const body = await c.req.json().catch(() => null) as { jobUrl?: string; content?: string } | null;
  if (!body?.jobUrl || !body?.content) return c.json({ error: "jobUrl and content required" }, 400);
  const instances = loadManifest();
  const instance = instances.find((i) => i.name === name);
  if (!instance) return c.json({ error: "Instance not found" }, 404);
  try {
    await saveResumeAndRegen(instance, body.jobUrl, body.content);
    return c.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

// List all run log files for an instance
api.get("/instances/:name/logs", (c) => {
  const { name } = c.req.param();
  const instances = loadManifest();
  const instance = instances.find((i) => i.name === name);
  if (!instance) return c.json({ error: "Instance not found" }, 404);

  const logsDir = join(instance.dir, "logs");
  if (!existsSync(logsDir)) return c.json([]);

  const runs = readdirSync(logsDir)
    .filter((f) => /^run_.*\.log$/.test(f))
    .map((filename) => {
      const stat = statSync(join(logsDir, filename));
      // Derive ISO timestamp from filename: run_2026-06-19T00-30-00.log → 2026-06-19T00:30:00Z
      const ts = filename.replace("run_", "").replace(".log", "").replace(/-(\d{2})-(\d{2})-(\d{2})$/, "T$1:$2:$3");
      return { filename, startedAt: ts, size: stat.size, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map(({ filename, startedAt, size }) => ({ filename, startedAt, size }));

  return c.json(runs);
});

// Serve a full log file by filename
api.get("/instances/:name/logs/:filename", (c) => {
  const { name, filename } = c.req.param();

  // Guard against path traversal — only allow run_*.log filenames
  if (!/^run_[^/\\]+\.log$/.test(filename)) {
    return c.json({ error: "Invalid filename" }, 400);
  }

  const instances = loadManifest();
  const instance = instances.find((i) => i.name === name);
  if (!instance) return c.json({ error: "Instance not found" }, 404);

  const filePath = join(instance.dir, "logs", filename);
  if (!existsSync(filePath)) return c.json({ error: "Log not found" }, 404);

  c.header("Content-Type", "text/plain; charset=utf-8");
  c.header("Cache-Control", "no-cache");

  return stream(c, async (s) => {
    await new Promise<void>((resolve, reject) => {
      const rs = createReadStream(filePath);
      rs.on("data", (chunk) => s.write(chunk as Buffer).catch(() => rs.destroy()));
      rs.on("end", resolve);
      rs.on("error", reject);
    });
  });
});

// SSE log stream
api.get("/instances/:name/logs/stream", (c) => {
  const { name } = c.req.param();

  c.header("Content-Type", "text/event-stream");
  c.header("Cache-Control", "no-cache");
  c.header("Connection", "keep-alive");

  return stream(c, async (s) => {
    let closed = false;

    const writeSSE = (line: string): boolean => {
      if (closed) return false;
      // fire-and-forget — errors caught to prevent unhandled rejections
      s.write(`data: ${JSON.stringify(line)}\n\n`).catch(() => { closed = true; });
      return true;
    };

    // Flush buffered logs
    for (const line of getLogs(name)) {
      if (!writeSSE(line)) return;
    }

    // Stream new lines
    await new Promise<void>((resolve) => {
      const unsub = subscribe(name, (line) => {
        if (!writeSSE(line)) { unsub(); resolve(); }
      });
      s.onAbort(() => { closed = true; unsub(); resolve(); });
    });
  });
});

export default api;
