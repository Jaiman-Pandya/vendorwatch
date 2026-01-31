export type ResearchMode = "basic" | "deep";

const DEFAULT_MODE: ResearchMode = "deep";

function parseEnvMode(): ResearchMode {
  const raw = process.env.RESEARCH_MODE?.trim().toLowerCase();
  if (raw === "basic" || raw === "deep") return raw;
  return DEFAULT_MODE;
}

let override: ResearchMode | null = null;

export function setResearchMode(mode: ResearchMode | null): void {
  override = mode;
}

export function getResearchMode(): ResearchMode {
  return override ?? parseEnvMode();
}

export function isDeepMode(): boolean {
  return getResearchMode() === "deep";
}
