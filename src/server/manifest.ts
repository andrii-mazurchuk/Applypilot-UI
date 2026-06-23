import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import yaml from "js-yaml";

const MANIFEST_PATH = join(homedir(), ".applypilot", "instances.yaml");

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

export function loadManifest(): InstanceConfig[] {
  const raw = readFileSync(MANIFEST_PATH, "utf-8");
  const parsed = yaml.load(raw) as Manifest;
  return Object.entries(parsed.instances).map(([name, cfg]) => ({
    name,
    ...cfg,
  }));
}
