import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { containsMojibake } from "../../packages/localization/src/index.js";

const roots = ["apps/admin-web", "apps/owner-mobile", "apps/staff-mobile", "packages/ui-web", "packages/ui-native", "docs/design", "docs/product"];
const allowedExtensions = new Set([".ts", ".tsx", ".css", ".md"]);

async function sourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const file = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return allowedExtensions.has(file.slice(file.lastIndexOf("."))) ? [file] : [];
  }));
  return nested.flat();
}

describe("Sprint 19 UI text encoding", () => {
  it("contains no corrupted hard-coded source text", async () => {
    const files = (await Promise.all(roots.map(sourceFiles))).flat();
    const corrupted = await Promise.all(files.map(async (file) => ({ file, content: await readFile(file, "utf8") })));
    expect(corrupted.filter(({ content }) => containsMojibake(content)).map(({ file }) => file)).toEqual([]);
  });
});
