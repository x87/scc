import {
  convertScToTs as convertScToTsWithConfig,
} from "./browser.ts";
import {
  loadConverterConfig,
  setActiveConverterConfig,
  type ConverterConfigData,
} from "./config-entry.ts";

const browserConfigCache = new Map<string, Promise<ConverterConfigData>>();

function configAssetUrl(relativePath: string): string {
  return `./configs/${relativePath.replace(/\\/g, "/")}`;
}

async function fetchConfigJson(relativePath: string): Promise<unknown> {
  const response = await fetch(configAssetUrl(relativePath));
  if (!response.ok) {
    throw new Error(`Failed to load config file ${relativePath}: HTTP ${response.status}`);
  }
  return response.json();
}

function getConfig(configFolder: string): Promise<ConverterConfigData> {
  const key = configFolder.trim();
  if (!key) {
    throw new Error("Config folder is required in browser conversion.");
  }
  let p = browserConfigCache.get(key);
  if (!p) {
    p = loadConverterConfig(key, fetchConfigJson);
    browserConfigCache.set(key, p);
  }
  return p;
}

export async function convertScToTs(code: string, configFolder: string): Promise<string> {
  const config = await getConfig(configFolder);
  setActiveConverterConfig(config);
  return convertScToTsWithConfig(code, {
    commands: config.commands,
    vars: config.vars,
    consts: config.consts,
  });
}

if (typeof window !== "undefined") {
  (window as any).convertScToTs = convertScToTs;
  (window as any).scConverterReady = true;
}
