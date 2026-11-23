import { describe, expect, it, vi } from "vitest";
import { supabaseStore } from "../../src/season/storage";

describe("supabaseStore", () => {
  it("upserts with the service key and returns the public URL", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const store = supabaseStore({ url: "https://abc.supabase.co/", serviceKey: "service-key-for-tests", bucket: "replay", fetchImpl });
    const url = await store.put("season-0.jsonl", "line\n");
    expect(url).toBe("https://abc.supabase.co/storage/v1/object/public/replay/season-0.jsonl");
    const [target, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    expect(target).toBe("https://abc.supabase.co/storage/v1/object/replay/season-0.jsonl");
    expect(init.headers).toMatchObject({ authorization: "Bearer service-key-for-tests", "x-upsert": "true" });
  });

  it("fails without repeating what the server said", async () => {
    const fetchImpl = vi.fn(async () => new Response("bucket replay not found, key=service-key-for-tests", { status: 404 }));
    const store = supabaseStore({ url: "https://abc.supabase.co", serviceKey: "service-key-for-tests", bucket: "replay", fetchImpl });
    await expect(store.put("season-0.jsonl", "x")).rejects.toThrow(/^replay upload failed: HTTP 404$/);
  });
});
