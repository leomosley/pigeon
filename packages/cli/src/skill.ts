import { access, lstat, mkdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";

const skill = `---
name: pigeon
description: >
  Share a local artifact with the user through Pigeon, or capture and share a
  screenshot from macOS, Windows, Linux, or a headless browser. Use when asked
  to share a file, screenshot a page, show visual output, or provide an artifact URL.
---

# Pigeon

Upload artifacts to the user's configured Cloudflare R2 bucket and return the
public URL. Never expose credentials or print the output of \`pigeon env\`.

## Share an existing file

1. Confirm \`aws\` is installed. Run \`pigeon doctor\` if setup is uncertain.
2. Keep the original extension and generate a UUID key. Use a platform-native
   UUID command or generate one with the available runtime.
3. Load credentials and upload in one shell invocation so secrets do not linger:

\`\`\`sh
eval "$(pigeon env --shell sh)"
key="$(uuidgen | tr '[:upper:]' '[:lower:]').png"
aws s3 cp "$file" "s3://$PIGEON_BUCKET/$key" \\
  --endpoint-url "$PIGEON_ENDPOINT" \\
  --content-type "image/png"
printf '%s/%s\\n' "$PIGEON_PUBLIC_BASE_URL" "$key"
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_REGION
\`\`\`

PowerShell:

\`\`\`powershell
Invoke-Expression (& pigeon env --shell powershell | Out-String)
$key = "$(New-Guid).png"
aws s3 cp $file "s3://$env:PIGEON_BUCKET/$key" \
  --endpoint-url $env:PIGEON_ENDPOINT \
  --content-type "image/png"
"$env:PIGEON_PUBLIC_BASE_URL/$key"
Remove-Item Env:AWS_ACCESS_KEY_ID, Env:AWS_SECRET_ACCESS_KEY, Env:AWS_REGION
\`\`\`

Set the actual extension and MIME type. Do not upload secret-bearing files.

## Capture a screenshot

- URL or headless server: use Playwright if installed, otherwise a Chromium
  executable with \`--headless=new --screenshot=<path> --window-size=1440,900 <url>\`.
- macOS desktop: \`screencapture -x <path>.png\`.
- Linux Wayland: \`grim <path>.png\`.
- Linux X11: use \`maim\`, then \`scrot\`, then ImageMagick \`import -window root\`.
- Windows PowerShell: capture \`SystemInformation.VirtualScreen\` with
  \`System.Drawing.Graphics.CopyFromScreen\`.

A headless machine has no desktop to capture. Capture a URL with a headless
browser; only use Xvfb when the target is an actual GUI process.

After upload, return the public URL and local file path.
`;

export const skillPath = (home = homedir()): string => join(home, ".agents", "skills", "pigeon");

const marker = ".pigeon-managed";

interface Agent {
  /** Human-readable name, surfaced to the user. */
  name: string;
  /** Directory whose presence signals the agent is installed. */
  configDir: (home: string) => string;
  /** Where this agent expects the skill to live. */
  skillDir: (home: string) => string;
}

/**
 * Known agents and the conventions they use. An agent is considered installed
 * when its `configDir` exists on disk.
 */
const agents: Agent[] = [
  {
    name: "Claude Code",
    configDir: (home) => join(home, ".claude"),
    skillDir: (home) => join(home, ".claude", "skills", "pigeon"),
  },
  {
    name: "opencode",
    configDir: (home) => join(home, ".config", "opencode"),
    skillDir: (home) => join(home, ".config", "opencode", "skills", "pigeon"),
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

const linkAgent = async (destination: string, source: string): Promise<string | undefined> => {
  await mkdir(dirname(destination), { recursive: true });
  try {
    const stat = await lstat(destination);
    if (
      stat.isSymbolicLink() &&
      (await readlink(destination)) === relative(dirname(destination), source)
    ) {
      return destination;
    }
    // Something else already lives here; leave it untouched.
    return undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    await symlink(relative(dirname(destination), source), destination, "dir");
  } catch (linkError) {
    if (["EPERM", "EACCES"].includes((linkError as NodeJS.ErrnoException).code ?? "")) {
      await mkdir(destination, { recursive: true });
      await writeFile(join(destination, "SKILL.md"), skill, "utf8");
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

export const installSkill = async (home = homedir()): Promise<string[]> => {
  const source = skillPath(home);
  try {
    await access(join(source, marker));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (await exists(source)) throw new Error(`Refusing to replace unmanaged skill at ${source}`);
  }
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "SKILL.md"), skill, "utf8");
  await writeFile(join(source, marker), "", "utf8");

  // The `~/.agents/skills` copy is always installed as the source of truth,
  // regardless of which agents are detected.
  const links: string[] = [source];
  for (const agent of await detectAgents(home)) {
    const link = await linkAgent(agent.skillDir(home), source);
    if (link) links.push(link);
  }
  return links;
};

export const removeSkill = async (home = homedir()): Promise<void> => {
  const source = skillPath(home);
  for (const agent of agents) {
    await unlinkAgent(agent.skillDir(home), source);
  }
  try {
    await access(join(source, marker));
    await rm(source, { recursive: true, force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
};
