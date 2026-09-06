import { describe, expect, it } from "vitest";
import { MockImageProvider, getImageProvider, listImageProviders } from "./image";

describe("MockImageProvider", () => {
  it("produces a data-URI SVG containing the prompt at zero cost", async () => {
    const p = new MockImageProvider();
    const asset = await p.generate({ prompt: "neon <fox>" });
    expect(asset.url.startsWith("data:image/svg+xml;base64,")).toBe(true);
    const svg = Buffer.from(asset.url.split(",")[1], "base64").toString();
    expect(svg).toContain("neon &lt;fox&gt;");
    expect(asset.providerCostCents).toBe(0);
    expect(asset.provenance).toMatchObject({ prompt: "neon <fox>", provider: "mock" });
  });
});

describe("registry", () => {
  it("falls back to mock for unknown keys", () => {
    expect(getImageProvider("nope").key).toBe("mock");
    expect(listImageProviders().map((p) => p.key)).toContain("mock");
  });
});
