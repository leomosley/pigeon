import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { installSkill, removeSkill, skillPath } from "../src/skill";

describe("skill ownership", () => {
  test("installs and removes only Pigeon-managed skills", async () => {
    const home = await mkdtemp(join(tmpdir(), "pigeon-skill-"));
    await installSkill(home);
    expect(await readFile(join(skillPath(home), ".pigeon-managed"), "utf8")).toBe("");
    await removeSkill(home);
    expect(Bun.file(join(skillPath(home), "SKILL.md")).size).toBe(0);
  });

  test("refuses to replace or remove an unmanaged skill", async () => {
    const home = await mkdtemp(join(tmpdir(), "pigeon-skill-"));
    await mkdir(skillPath(home), { recursive: true });
    const path = join(skillPath(home), "SKILL.md");
    await writeFile(path, "user content");
    await expect(installSkill(home)).rejects.toThrow("Refusing to replace unmanaged skill");
    await removeSkill(home);
    expect(await readFile(path, "utf8")).toBe("user content");
  });
});
