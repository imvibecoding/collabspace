/**
 * Moderation stack — layer 1 (pre-generation prompt filter) and layer 6
 * (per-room constraints). Layers 2–3 (hosted classifier, output classification)
 * plug in via `Classifier` so the provider can be swapped without touching rooms.
 */

export interface RoomRules {
  /** Hard cap on prompt length in words (e.g. 6 for the art room). */
  max_prompt_words?: number;
  max_prompt_chars?: number;
  /** Extra room-specific blocked terms. */
  blocklist?: string[];
}

export type FilterResult =
  | { allowed: true; normalized: string }
  | { allowed: false; reason: string; code: "empty" | "too_long" | "blocklist" | "classifier" };

/**
 * Prompts that pin violence onto a real ethnic, national or religious group
 * ("an <group> with a machete") are the main way a public, real-city world gets
 * used for racial caricature. They're held for review rather than hard-blocked,
 * since the same words are fine in other combinations.
 */
const GROUP_WORDS =
  "african|asian|arab|indian|chinese|jewish|muslim|islamic|aboriginal|indigenous|black|white|mexican|somali|sudanese|lebanese|greek|italian|vietnamese|romani|gypsy";
const VIOLENCE_WORDS =
  "machete|knife|gun|rifle|gang|thug|criminal|rob|robbing|robber|stab|shoot|shooting|attack|riot|invade|terrorist|bomb";

export function targetsGroupWithViolence(text: string): boolean {
  const t = text.toLowerCase();
  return new RegExp(`\\b(${GROUP_WORDS})\\b`).test(t) && new RegExp(`\\b(${VIOLENCE_WORDS})\\b`).test(t);
}

/** Cheap first line of defence. Keep short; the classifier does the heavy lifting. */
export const GLOBAL_BLOCKLIST: string[] = [
  "nsfw",
  "nude",
  "naked",
  "porn",
  "gore",
  "beheading",
  "child",
  "loli",
  "swastika",
  "nazi",
];

export interface Classifier {
  /** Return a reason string if the prompt should be blocked, else null. */
  check(prompt: string): Promise<string | null>;
}

export function normalizePrompt(prompt: string): string {
  return prompt.replace(/\s+/g, " ").trim();
}

export function countWords(prompt: string): number {
  const n = normalizePrompt(prompt);
  return n === "" ? 0 : n.split(" ").length;
}

function matchesBlocklist(normalized: string, list: string[]): string | null {
  const lower = normalized.toLowerCase();
  const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean);
  for (const term of list) {
    const t = term.toLowerCase();
    if (t.includes(" ") ? lower.includes(t) : tokens.includes(t)) return term;
  }
  return null;
}

/** Synchronous layers only (length + blocklists). */
export function filterPromptSync(prompt: string, rules: RoomRules = {}): FilterResult {
  const normalized = normalizePrompt(prompt);
  if (normalized === "") return { allowed: false, code: "empty", reason: "Prompt is empty" };

  if (rules.max_prompt_words && countWords(normalized) > rules.max_prompt_words) {
    return {
      allowed: false,
      code: "too_long",
      reason: `Prompt must be ${rules.max_prompt_words} words or fewer`,
    };
  }
  if (rules.max_prompt_chars && normalized.length > rules.max_prompt_chars) {
    return {
      allowed: false,
      code: "too_long",
      reason: `Prompt must be ${rules.max_prompt_chars} characters or fewer`,
    };
  }

  const hit = matchesBlocklist(normalized, [...GLOBAL_BLOCKLIST, ...(rules.blocklist ?? [])]);
  if (hit) return { allowed: false, code: "blocklist", reason: "Prompt contains a blocked term" };

  if (targetsGroupWithViolence(normalized)) {
    return {
      allowed: false,
      code: "blocklist",
      reason: "This reads as pinning violence on a real group of people. Describe the character without that.",
    };
  }

  return { allowed: true, normalized };
}

/** Full pre-generation pipeline: sync layers, then the hosted classifier if configured. */
export async function filterPrompt(
  prompt: string,
  rules: RoomRules = {},
  classifier?: Classifier,
): Promise<FilterResult> {
  const sync = filterPromptSync(prompt, rules);
  if (!sync.allowed || !classifier) return sync;
  const reason = await classifier.check(sync.normalized);
  if (reason) return { allowed: false, code: "classifier", reason };
  return sync;
}
