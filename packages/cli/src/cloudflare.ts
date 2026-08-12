import { createHash } from "node:crypto";
import type { CloudflareResponse } from "./types";

const baseUrl = "https://api.cloudflare.com/client/v4";
const bucketWritePermission = "Workers R2 Storage Bucket Item Write";

export class CloudflareClient {
  constructor(
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetcher(`${baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
        ...init?.headers,
      },
    });
    const body = (await response.json()) as CloudflareResponse<T>;
    if (!response.ok || !body.success) {
      const detail = body.errors?.map(({ code, message }) => `${code}: ${message}`).join("; ");
      throw new Error(detail || `Cloudflare request failed with ${response.status}`);
    }
    return body.result;
  }

  async createBucket(accountId: string, bucket: string): Promise<void> {
    await this.request(`/accounts/${accountId}/r2/buckets`, {
      method: "POST",
      body: JSON.stringify({ name: bucket }),
    });
  }

  async deleteBucket(accountId: string, bucket: string): Promise<void> {
    await this.request(`/accounts/${accountId}/r2/buckets/${bucket}`, { method: "DELETE" });
  }

  async enablePublicDomain(accountId: string, bucket: string): Promise<string> {
    const result = await this.request<{ domain: string }>(
      `/accounts/${accountId}/r2/buckets/${bucket}/domains/managed`,
      { method: "PUT", body: JSON.stringify({ enabled: true }) }
    );
    return `https://${result.domain}`;
  }

  async setRetention(accountId: string, bucket: string, days: number): Promise<void> {
    await this.request(`/accounts/${accountId}/r2/buckets/${bucket}/lifecycle`, {
      method: "PUT",
      body: JSON.stringify({
        rules: [
          {
            id: "pigeon-delete-expired",
            enabled: true,
            conditions: { prefix: "" },
            deleteObjectsTransition: {
              condition: { type: "Age", maxAge: days * 86_400 },
            },
          },
        ],
      }),
    });
  }

  async createBucketToken(
    accountId: string,
    bucket: string
  ): Promise<{
    accessKeyId: string;
    secretAccessKey: string;
    tokenId: string;
  }> {
    const groups = await this.request<Array<{ id?: string; name?: string }>>(
      `/user/tokens/permission_groups?name=${encodeURIComponent(bucketWritePermission)}`
    );
    const permission = groups.find(({ name }) => name === bucketWritePermission);
    if (!permission?.id)
      throw new Error(`Cloudflare permission not found: ${bucketWritePermission}`);

    const resource = `com.cloudflare.edge.r2.bucket.${accountId}_default_${bucket}`;
    const token = await this.request<{ id?: string; value?: string }>("/user/tokens", {
      method: "POST",
      body: JSON.stringify({
        name: `pigeon-${bucket}`,
        policies: [
          {
            effect: "allow",
            resources: { [resource]: "*" },
            permission_groups: [{ id: permission.id }],
          },
        ],
      }),
    });
    if (!token.id || !token.value) throw new Error("Cloudflare did not return token credentials");
    return {
      accessKeyId: token.id,
      secretAccessKey: createHash("sha256").update(token.value).digest("hex"),
      tokenId: token.id,
    };
  }

  async revokeToken(tokenId: string): Promise<void> {
    await this.request(`/user/tokens/${tokenId}`, { method: "DELETE" });
  }
}
