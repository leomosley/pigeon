import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { CloudflareClient } from "../src/cloudflare";

describe("CloudflareClient", () => {
  test("scopes a derived S3 key to one bucket", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      const result = url.includes("permission_groups")
        ? [{ id: "permission", name: "Workers R2 Storage Bucket Item Write" }]
        : { id: "token-id", value: "token-value" };
      return Response.json({ success: true, result, errors: [] });
    }) as typeof fetch;
    const client = new CloudflareClient("bootstrap", fetcher);
    const key = await client.createBucketToken("account", "pigeon-test");
    expect(key.secretAccessKey).toBe(createHash("sha256").update("token-value").digest("hex"));
    const body = JSON.parse(String(requests[1]?.init?.body));
    expect(body.policies[0].resources).toEqual({
      "com.cloudflare.edge.r2.bucket.account_default_pigeon-test": "*",
    });
  });

  test("reports Cloudflare API errors", async () => {
    const fetcher = (async () =>
      Response.json(
        { success: false, result: null, errors: [{ code: 1000, message: "bad" }] },
        { status: 400 }
      )) as unknown as typeof fetch;
    await expect(
      new CloudflareClient("token", fetcher).createBucket("account", "bucket")
    ).rejects.toThrow("1000: bad");
  });
});
