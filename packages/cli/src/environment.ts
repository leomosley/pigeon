import type { PigeonConfig } from "./types";

const quoteSh = (value: string): string => `'${value.replaceAll("'", `'"'"'`)}'`;
const quotePowerShell = (value: string): string => `'${value.replaceAll("'", "''")}'`;

const values = (config: PigeonConfig): Record<string, string> => ({
  AWS_ACCESS_KEY_ID: config.accessKeyId,
  AWS_SECRET_ACCESS_KEY: config.secretAccessKey,
  AWS_REGION: "auto",
  PIGEON_BUCKET: config.bucket,
  PIGEON_ENDPOINT: config.endpoint,
  PIGEON_PUBLIC_BASE_URL: config.publicBaseUrl,
});

export const renderEnvironment = (config: PigeonConfig, shell: "sh" | "powershell"): string =>
  Object.entries(values(config))
    .map(([key, value]) =>
      shell === "powershell"
        ? `$env:${key} = ${quotePowerShell(value)}`
        : `export ${key}=${quoteSh(value)}`
    )
    .join("\n");
