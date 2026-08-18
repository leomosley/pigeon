import { lstat, mkdir, mkdtemp, readFile, readlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { detectAgents, installSkill, removeSkill, skillPath } from "../src/skill";

describe("skill ownership", () => {
  test("installs and removes only Pigeon-managed skills", async () => {
    const home = await mkdtemp(join(tmpdir(), "pigeon-skill-"));
    await installSkill(home);
    for (const name of ["pigeon", "take-screenshot"]) {
      expect(await readFile(join(skillPath(name, home), ".pigeon-managed"), "utf8")).toBe("");
    }
    await removeSkill(home);
    expect(Bun.file(join(skillPath("pigeon", home), "SKILL.md")).size).toBe(0);
    expect(Bun.file(join(skillPath("take-screenshot", home), "SKILL.md")).size).toBe(0);
  });

  test("refuses to replace or remove an unmanaged skill", async () => {
    const home = await mkdtemp(join(tmpdir(), "pigeon-skill-"));
    await mkdir(skillPath("pigeon", home), { recursive: true });
    const path = join(skillPath("pigeon", home), "SKILL.md");
    await writeFile(path, "user content");
    await expect(installSkill(home)).rejects.toThrow("Refusing to replace unmanaged skill");
    await removeSkill(home);
    expect(await readFile(path, "utf8")).toBe("user content");
  });
});

describe("agent detection", () => {
  test("installs into every detected agent and only the source when absent", async () => {
    const home = await mkdtemp(join(tmpdir(), "pigeon-skill-"));
    expect(await detectAgents(home)).toHaveLength(0);
    // With no agents present, only the ~/.agents sources are installed.
    expect(await installSkill(home)).toEqual([
      skillPath("pigeon", home),
      skillPath("take-screenshot", home),
    ]);

    await mkdir(join(home, ".claude"), { recursive: true });
    await mkdir(join(home, ".config", "opencode"), { recursive: true });
    await removeSkill(home);

    const links = await installSkill(home);
    expect(links).toContain(skillPath("pigeon", home));
    expect(links).toContain(skillPath("take-screenshot", home));
    const claudeLink = join(home, ".claude", "skills", "pigeon");
    const opencodeLink = join(home, ".config", "opencode", "skills", "pigeon");
    expect(links).toContain(claudeLink);
    expect(links).toContain(opencodeLink);
    expect((await lstat(claudeLink)).isSymbolicLink()).toBe(true);
    expect((await lstat(opencodeLink)).isSymbolicLink()).toBe(true);
    expect(await readFile(join(claudeLink, "SKILL.md"), "utf8")).toContain("name: pigeon");

    // The companion skill is linked into detected agents too.
    const screenshotLink = join(home, ".claude", "skills", "take-screenshot");
    expect(links).toContain(screenshotLink);
    expect((await lstat(screenshotLink)).isSymbolicLink()).toBe(true);
    expect(await readFile(join(screenshotLink, "SKILL.md"), "utf8")).toContain(
      "name: take-screenshot"
    );

    await removeSkill(home);
    await expect(lstat(claudeLink)).rejects.toThrow();
    await expect(lstat(opencodeLink)).rejects.toThrow();
    await expect(lstat(screenshotLink)).rejects.toThrow();
  });

  test("leaves an unmanaged agent entry untouched", async () => {
    const home = await mkdtemp(join(tmpdir(), "pigeon-skill-"));
    const claudeSkill = join(home, ".claude", "skills", "pigeon");
    await mkdir(claudeSkill, { recursive: true });
    await writeFile(join(claudeSkill, "SKILL.md"), "user content");

    const links = await installSkill(home);
    expect(links).not.toContain(claudeSkill);
    expect(await readlink(claudeSkill).catch(() => null)).toBeNull();
    expect(await readFile(join(claudeSkill, "SKILL.md"), "utf8")).toBe("user content");

    await removeSkill(home);
    expect(await readFile(join(claudeSkill, "SKILL.md"), "utf8")).toBe("user content");
  });
});
