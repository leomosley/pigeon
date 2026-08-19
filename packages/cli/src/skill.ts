import { access, lstat, mkdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";

const pigeonSkill = `---
name: pigeon
description: >
  Share a local artifact with the user through Pigeon and return a public URL.
  Use when asked to share a file, upload output, or provide an artifact link.
  To capture a screenshot first, use the take-screenshot skill.
---

# Pigeon

Upload an artifact to the user's Cloudflare R2 bucket and return its public URL.
Never expose credentials or print the raw output of \`pigeon env\`.

## Upload an artifact

1. Load the route into the environment. Do this and the upload in a single shell
   invocation so the secrets never linger:

   - sh: \`eval "$(pigeon env --shell sh)"\`
   - PowerShell: \`Invoke-Expression (& pigeon env --shell powershell | Out-String)\`

   This sets \`AWS_ACCESS_KEY_ID\`, \`AWS_SECRET_ACCESS_KEY\`, \`AWS_REGION\` (\`auto\`),
   \`PIGEON_BUCKET\`, \`PIGEON_ENDPOINT\`, and \`PIGEON_PUBLIC_BASE_URL\`.

2. Choose a random UUID object key that keeps the file's original extension.

3. Upload with a single authenticated S3 \`PUT\` request to
   \`$PIGEON_ENDPOINT/$PIGEON_BUCKET/<key>\`, signed with AWS SigV4 using the loaded
   credentials and region \`auto\`, with \`Content-Type\` set to the file's MIME type.

   Do a **direct signed HTTP PUT**. This is the primary method: write the handful
   of SigV4 lines in whatever runtime is already available (Python, Node, Go, a
   curl invocation, etc.). Do not assume the \`aws\` CLI or any other tool is
   installed — only reach for something like \`aws s3 cp\` if it already exists and
   is genuinely simpler.

4. Return the public URL \`$PIGEON_PUBLIC_BASE_URL/<key>\` and the local file path.

Set the real extension and MIME type. Clear the credentials from the environment
when done. Never upload files that carry secrets (\`.env\`, keys, tokens).
`;

const screenshotSkill = `---
name: take-screenshot
description: >
  Capture a screenshot of the screen, a window, or a web page, then share it
  with the user through Pigeon. Use when asked to take, grab, capture, or show a
  screenshot.
---

# Take a screenshot

Capture an image, then upload it with the \`pigeon\` skill and return the URL.

## First, reuse what already worked

This skill remembers what works on each platform. Before anything else, look in
the \`reference/\` directory next to this file for a note matching the current
platform — for example \`reference/macos.md\`, \`reference/windows.md\`,
\`reference/linux-wayland.md\`, \`reference/linux-x11.md\`, or \`reference/headless.md\`.
If a matching note exists, follow it verbatim instead of re-deriving the method.

## When there is no matching note

1. Identify the target: the whole screen, a specific window, or a URL / headless
   page. For a URL, drive a headless browser; for a desktop, use whatever capture
   tool the platform provides.
2. Try the available options until one produces a valid, non-empty image. Verify
   the result is a real image (sensible file size and expected dimensions).
3. On the **first** success, immediately record how you did it: write a concise
   note to \`reference/<platform>.md\` in this skill's directory, named after the
   platform you succeeded on. Create \`reference/\` if it does not exist. Keep it
   short — the exact command(s), the tool used, any authorization quirk, and how
   you targeted a specific window. This makes the next capture instant.

## Then share it

Hand the saved image to the \`pigeon\` skill to upload it, then return the public
URL and the local file path.

Never capture or share screens that expose secrets without the user's go-ahead.
`;

interface Skill {
  /** Directory name under each skills root. */
  name: string;
  /** SKILL.md body written to disk. */
  content: string;
}

const skills: Skill[] = [
  { name: "pigeon", content: pigeonSkill },
  { name: "take-screenshot", content: screenshotSkill },
];

const marker = ".pigeon-managed";

/** Root of the source-of-truth skills copy, e.g. `~/.agents/skills`. */
const skillsRoot = (home = homedir()): string => join(home, ".agents", "skills");

/** Absolute path to a managed skill's source-of-truth directory. */
export const skillPath = (name = "pigeon", home = homedir()): string =>
  join(skillsRoot(home), name);

interface Agent {
  /** Human-readable name, surfaced to the user. */
  name: string;
  /** Directory whose presence signals the agent is installed. */
  configDir: (home: string) => string;
  /** Directory this agent scans for skills. */
  skillsDir: (home: string) => string;
}

/**
 * Known agents and the conventions they use. An agent is considered installed
 * when its `configDir` exists on disk.
 */
const agents: Agent[] = [
  {
    name: "Claude Code",
    configDir: (home) => join(home, ".claude"),
    skillsDir: (home) => join(home, ".claude", "skills"),
  },
  {
    name: "opencode",
    configDir: (home) => join(home, ".config", "opencode"),
    skillsDir: (home) => join(home, ".config", "opencode", "skills"),
  },
];

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return false;
  }
};

/** Agents whose config directory is present on the machine. */
export const detectAgents = async (home = homedir()): Promise<Agent[]> => {
  const detected: Agent[] = [];
  for (const agent of agents) {
    if (await exists(agent.configDir(home))) detected.push(agent);
  }
  return detected;
};

const linkAgent = async (
  destination: string,
  source: string,
  content: string,
  force = false
): Promise<string | undefined> => {
  await mkdir(dirname(destination), { recursive: true });
  try {
    const stat = await lstat(destination);
    if (
      stat.isSymbolicLink() &&
      (await readlink(destination)) === relative(dirname(destination), source)
    ) {
      return destination;
    }
    // Something else already lives here.
    if (!force) return undefined; // Leave it untouched.
    await rm(destination, { recursive: true, force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    await symlink(relative(dirname(destination), source), destination, "dir");
  } catch (linkError) {
    if (["EPERM", "EACCES"].includes((linkError as NodeJS.ErrnoException).code ?? "")) {
      await mkdir(destination, { recursive: true });
      await writeFile(join(destination, "SKILL.md"), content, "utf8");
      await writeFile(join(destination, marker), "", "utf8");
      return destination;
    }
    throw linkError;
  }
  return destination;
};

const unlinkAgent = async (destination: string, source: string): Promise<void> => {
  try {
    const destinationStat = await lstat(destination);
    if (destinationStat.isSymbolicLink()) {
      if ((await readlink(destination)) === relative(dirname(destination), source)) {
        await rm(destination);
      }
    } else {
      await access(join(destination, marker));
      await rm(destination, { recursive: true });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
};

const installOne = async (skill: Skill, home: string, force = false): Promise<string[]> => {
  const source = skillPath(skill.name, home);
  try {
    await access(join(source, marker));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (!force && (await exists(source)))
      throw new Error(`Refusing to replace unmanaged skill at ${source}`);
  }
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "SKILL.md"), skill.content, "utf8");
  await writeFile(join(source, marker), "", "utf8");

  // The `~/.agents/skills` copy is always installed as the source of truth,
  // regardless of which agents are detected.
  const links: string[] = [source];
  for (const agent of await detectAgents(home)) {
    // Linking into an agent is best-effort: a broken or unwritable skills
    // directory for one agent must not abort installing the rest.
    try {
      const link = await linkAgent(
        join(agent.skillsDir(home), skill.name),
        source,
        skill.content,
        force
      );
      if (link) links.push(link);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      process.stderr.write(`pigeon: skipped ${agent.name} skill (${reason})\n`);
    }
  }
  return links;
};

export const installSkill = async (home = homedir(), force = false): Promise<string[]> => {
  const links: string[] = [];
  for (const skill of skills) {
    links.push(...(await installOne(skill, home, force)));
  }
  return links;
};

export const removeSkill = async (home = homedir()): Promise<void> => {
  for (const skill of skills) {
    const source = skillPath(skill.name, home);
    for (const agent of agents) {
      await unlinkAgent(join(agent.skillsDir(home), skill.name), source);
    }
    try {
      await access(join(source, marker));
      await rm(source, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
};
