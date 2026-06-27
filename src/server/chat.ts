import { readFileSync, writeFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { spawn } from "child_process";
import type { InstanceConfig } from "./manifest.js";
import { getJob } from "./stats.js";
import type { ScoredJob } from "./stats.js";

// ── API key ────────────────────────────────────────────────────────────────────

function getGeminiKey(): string {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const envPath = join(homedir(), ".applypilot", ".env");
  if (existsSync(envPath)) {
    const match = readFileSync(envPath, "utf-8").match(/^GEMINI_API_KEY\s*=\s*(.+)$/m);
    if (match) return match[1].trim().replace(/^["']|["']$/g, "");
  }
  return "";
}

// ── System prompt ──────────────────────────────────────────────────────────────

function buildSystemPrompt(job: ScoredJob, resumeText: string): string {
  const lines = [
    "You are an expert CV/resume tailoring specialist. Help the user refine their tailored resume for this specific job application.",
    "",
    "## Job",
    `Title: ${job.title ?? "Unknown"}`,
    `Location: ${job.location ?? "Not specified"}`,
    `Site: ${job.site ?? "Unknown"}`,
    `Fit score: ${job.fit_score ?? "??"}/10`,
  ];

  if (job.score_reasoning) {
    lines.push("", "## Score reasoning", job.score_reasoning);
  }

  if (job.full_description) {
    // Cap at 3000 chars to leave room for resume + history
    lines.push("", "## Job description", job.full_description.slice(0, 3000));
    if (job.full_description.length > 3000) lines.push("[…truncated]");
  }

  lines.push(
    "",
    "## Current tailored resume",
    resumeText,
    "",
    "## Your role",
    "- Answer questions about job fit and resume gaps",
    "- Suggest specific wording improvements with reasoning",
    "- Rewrite any section on request",
    "- When the user asks for a complete revised resume, output it EXACTLY like this:",
    "",
    "[REVISED RESUME]",
    "<full resume text here — preserve all sections and formatting>",
    "[/REVISED RESUME]",
    "",
    "Only use those tags when producing a full revised version. For partial suggestions, just write them inline.",
    "Be concise and specific. Reference exact lines from the resume and job description.",
  );

  return lines.join("\n");
}

// ── Gemini streaming ───────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "model";
  content: string;
}

export async function streamChatResponse(
  instance: InstanceConfig,
  jobUrl: string,
  messages: ChatMessage[],
  onChunk: (text: string) => void,
): Promise<void> {
  const job = getJob(instance, jobUrl);
  if (!job) throw new Error("Job not found");

  let resumeText = "(No tailored resume — run the tailor stage first)";
  if (job.tailored_resume_path && existsSync(job.tailored_resume_path)) {
    resumeText = readFileSync(job.tailored_resume_path, "utf-8");
  }

  const apiKey = getGeminiKey();
  if (!apiKey) throw new Error("GEMINI_API_KEY not set in ~/.applypilot/.env");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: buildSystemPrompt(job, resumeText) }] },
        contents: messages.map((m) => ({ role: m.role, parts: [{ text: m.content }] })),
        generationConfig: { maxOutputTokens: 4096, temperature: 0.4 },
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 300)}`);
  }

  if (!res.body) throw new Error("No response body from Gemini");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr) continue;
      try {
        const chunk = JSON.parse(jsonStr);
        const text: string | undefined = chunk?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) onChunk(text);
      } catch {
        // skip malformed chunks
      }
    }
  }
}

// ── Resume save + PDF regen ────────────────────────────────────────────────────

function runPdfStage(instance: InstanceConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    const venvBin = join(homedir(), ".applypilot", "venv", "bin");
    const env = {
      ...process.env,
      PATH: `${venvBin}:${process.env.PATH ?? ""}`,
      APPLYPILOT_DIR: instance.dir,
      APPLYPILOT_SHARED_DIR: join(homedir(), ".applypilot"),
      VIRTUAL_ENV: join(homedir(), ".applypilot", "venv"),
    };
    const child = spawn("applypilot", ["run", "pdf"], { env, stdio: "ignore" });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("PDF regeneration timed out after 30s"));
    }, 30_000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0 || code === null) resolve();
      else reject(new Error(`pdf stage exited with code ${code}`));
    });
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
  });
}

export async function saveResumeAndRegen(
  instance: InstanceConfig,
  jobUrl: string,
  content: string,
): Promise<void> {
  const job = getJob(instance, jobUrl);
  if (!job?.tailored_resume_path) throw new Error("Job has no tailored resume path");

  const txtPath = job.tailored_resume_path;
  const pdfPath = txtPath.replace(/\.txt$/, ".pdf");

  writeFileSync(txtPath, content, "utf-8");
  if (existsSync(pdfPath)) unlinkSync(pdfPath);

  await runPdfStage(instance);
}
