/**
 * Generation-provider abstraction (brief §2.3).
 * Every AI capability sits behind one interface so rooms never talk to a
 * vendor directly. V1 ships an image interface with a mock provider (no cost,
 * used for local dev and tests) and a slot for a real hosted provider.
 */

export interface GenerateImageInput {
  prompt: string;
  /** Optional previous canvas to condition on (URL). Ignored by providers that can't. */
  baseImageUrl?: string | null;
  width?: number;
  height?: number;
  seed?: number;
}

export interface GeneratedAsset {
  /** Public URL or data: URI of the produced image. */
  url: string;
  provider: string;
  model: string;
  /** Actual upstream cost, for the ledger's markup tracking. */
  providerCostCents: number;
  /** Provenance / license metadata stored against the asset. */
  provenance: Record<string, unknown>;
}

export interface ImageProvider {
  readonly key: string;
  readonly label: string;
  /** Estimated cost before generation, in cents. Drives credit pricing. */
  estimateCostCents(input: GenerateImageInput): number;
  generate(input: GenerateImageInput): Promise<GeneratedAsset>;
}

function escapeXml(s: string) {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}

function hashHue(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

/** Zero-cost provider that renders the prompt into a coloured SVG. */
export class MockImageProvider implements ImageProvider {
  readonly key = "mock";
  readonly label = "Mock (local dev)";

  estimateCostCents() {
    return 0;
  }

  async generate(input: GenerateImageInput): Promise<GeneratedAsset> {
    const w = input.width ?? 1024;
    const h = input.height ?? 1024;
    const hue = hashHue(input.prompt);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,55%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},70%,35%)"/></linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>
<text x="50%" y="50%" font-family="sans-serif" font-size="${Math.round(w / 18)}" fill="white" text-anchor="middle" dominant-baseline="middle">${escapeXml(input.prompt)}</text>
</svg>`;
    const url = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    return {
      url,
      provider: this.key,
      model: "mock-svg-v1",
      providerCostCents: 0,
      provenance: { kind: "ai-generated", provider: this.key, prompt: input.prompt, license: "platform" },
    };
  }
}

/**
 * Placeholder for a real hosted image API. Wire the vendor call in `generate`
 * and set IMAGE_PROVIDER_API_KEY; keep cost estimates honest so the ledger's
 * margin tracking stays accurate.
 */
export class HostedImageProvider implements ImageProvider {
  readonly key = "hosted";
  readonly label = "Hosted image model";
  constructor(private readonly apiKey: string) {}

  estimateCostCents() {
    return 4; // typical ~$0.04 per 1024² image; adjust to the chosen vendor
  }

  async generate(input: GenerateImageInput): Promise<GeneratedAsset> {
    void input;
    void this.apiKey;
    throw new Error("Hosted image provider not configured yet");
  }
}

const registry: Record<string, () => ImageProvider> = {
  mock: () => new MockImageProvider(),
  hosted: () => new HostedImageProvider(process.env.IMAGE_PROVIDER_API_KEY ?? ""),
};

export function listImageProviders(): Array<{ key: string; label: string }> {
  const keys = process.env.IMAGE_PROVIDER_API_KEY ? ["mock", "hosted"] : ["mock"];
  return keys.map((k) => {
    const p = registry[k]();
    return { key: p.key, label: p.label };
  });
}

export function getImageProvider(key?: string | null): ImageProvider {
  const k = key && registry[key] ? key : (process.env.IMAGE_PROVIDER_DEFAULT ?? "mock");
  const factory = registry[k] ?? registry.mock;
  return factory();
}
