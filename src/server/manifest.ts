import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import yaml from "js-yaml";

export interface InstanceConfig {
  name: string;
  label: string;
  dir: string;
  resume: string;
  searches: string;
}

export interface Manifest {
  shared: { profile: string; env: string };
  instances: Record<string, Omit<InstanceConfig, "name">>;
}

export function userDataDir(userId: string): string {
  return join(homedir(), ".applypilot", "users", userId);
}

export function loadManifest(userId: string): InstanceConfig[] {
  const manifestPath = join(userDataDir(userId), "instances.yaml");
  const raw = readFileSync(manifestPath, "utf-8");
  const parsed = yaml.load(raw) as Manifest;
  return Object.entries(parsed.instances).map(([name, cfg]) => ({
    name,
    ...cfg,
  }));
}
