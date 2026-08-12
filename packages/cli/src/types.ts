export type PigeonConfig = {
  accountId: string;
  bucket: string;
  endpoint: string;
  publicBaseUrl: string;
  accessKeyId: string;
  secretAccessKey: string;
  retentionDays: number;
  tokenId?: string;
};

export type CloudflareError = { code: number; message: string };

export type CloudflareResponse<T> = {
  success: boolean;
  result: T;
  errors: CloudflareError[];
};
