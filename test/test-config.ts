import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadConverterConfigSync,
  setActiveConverterConfig,
  type ConverterConfigData,
} from "../src/config-entry.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadConfig(configFolder: string): ConverterConfigData {
  return loadConverterConfigSync(configFolder, (relativePath) => {
    const full = path.join(repoRoot, relativePath);
    if (!fs.existsSync(full)) {
      throw new Error(`Missing required test config file: ${relativePath}`);
    }
    return JSON.parse(fs.readFileSync(full, "utf8"));
  });
}

export function activateConfig(configFolder: string): ConverterConfigData {
  const config = loadConfig(configFolder);
  setActiveConverterConfig(config);
  return config;
}
