import { readFileSync, writeFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { spawn } from "child_process";
import type { InstanceConfig } from "./manifest.js";
import { getJob } from "./stats.js";
import type { ScoredJob } from "./stats.js";

// ── API key ────────────────────────────────────────────────────────────────────

function getChatOpenAIKey(userDir: string): string {
  if (process.env.CHAT_OPENAI_API_KEY) return process.env.CHAT_OPENAI_API_KEY;
  const envPath = join(userDir, ".env");
  if (existsSync(envPath)) {
    const match = readFileSync(envPath, "utf-8").match(/^CHAT_OPENAI_API_KEY\s*=\s*(.+)$/m);
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
    "You are an editor, not a consultant. When the user asks for any change — remove a section,",
    "reword a bullet, add a skill, sharpen the summary — apply it immediately and output the",
    "full revised resume using the tags below. Do not describe what you would do; just do it.",
    "",
    "Decision rule:",
    "- User requests a change (remove, add, rewrite, fix, improve, tailor…) → output [REVISED RESUME] straight away.",
    "- User asks a question (what's missing? how does this compare?) → answer briefly without a resume block.",
    "- User intent is genuinely unclear → ask one short clarifying question, then act.",
    "",
    "When outputting a revised resume, use EXACTLY this format (no extra text inside the tags):",
    "",
    "[REVISED RESUME]",
    "<full resume text — preserve all sections and formatting not explicitly changed>",
    "[/REVISED RESUME]",
    "",
    "After the closing tag, add one short sentence explaining what you changed and why.",
    "Be concise. Reference specific lines from the resume and job description when relevant.",
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
  userDir: string,
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

  const apiKey = getChatOpenAIKey(userDir);
  if (!apiKey) throw new Error("CHAT_OPENAI_API_KEY not set in user .env");

  const openAiMessages = [
    { role: "system", content: buildSystemPrompt(job, resumeText) },
    ...messages.map((m) => ({ role: m.role === "model" ? "assistant" : "user", content: m.content })),
  ];

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: openAiMessages,
      stream: true,
      max_tokens: 4096,
      temperature: 0.4,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 300)}`);
  }

  if (!res.body) throw new Error("No response body from OpenAI");

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
      if (!jsonStr || jsonStr === "[DONE]") continue;
      try {
        const chunk = JSON.parse(jsonStr);
        const text: string | undefined = chunk?.choices?.[0]?.delta?.content;
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
