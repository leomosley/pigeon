import { lstat, mkdir, mkdtemp, readFile, readlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { detectAgents, installSkill, removeSkill, skillPath } from "../src/skill";

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

describe("agent detection", () => {
  test("installs into every detected agent and none when absent", async () => {
    const home = await mkdtemp(join(tmpdir(), "pigeon-skill-"));
    expect(await detectAgents(home)).toHaveLength(0);
    expect(await installSkill(home)).toHaveLength(0);

    await mkdir(join(home, ".claude"), { recursive: true });
    await mkdir(join(home, ".config", "opencode"), { recursive: true });
    await removeSkill(home);

    const links = await installSkill(home);
    expect(links).toHaveLength(2);
    const claudeLink = join(home, ".claude", "skills", "pigeon");
    const opencodeLink = join(home, ".config", "opencode", "skills", "pigeon");
    expect((await lstat(claudeLink)).isSymbolicLink()).toBe(true);
    expect((await lstat(opencodeLink)).isSymbolicLink()).toBe(true);
    expect(await readFile(join(claudeLink, "SKILL.md"), "utf8")).toContain("name: pigeon");

    await removeSkill(home);
    await expect(lstat(claudeLink)).rejects.toThrow();
    await expect(lstat(opencodeLink)).rejects.toThrow();
  });

  test("leaves an unmanaged agent entry untouched", async () => {
    const home = await mkdtemp(join(tmpdir(), "pigeon-skill-"));
    const claudeSkill = join(home, ".claude", "skills", "pigeon");
    await mkdir(claudeSkill, { recursive: true });
    await writeFile(join(claudeSkill, "SKILL.md"), "user content");

    const links = await installSkill(home);
    expect(links).toHaveLength(0);
    expect(await readlink(claudeSkill).catch(() => null)).toBeNull();
    expect(await readFile(join(claudeSkill, "SKILL.md"), "utf8")).toBe("user content");

    await removeSkill(home);
    expect(await readFile(join(claudeSkill, "SKILL.md"), "utf8")).toBe("user content");
  });
});
