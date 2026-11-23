/** Where a season's replay file lives, and how it gets there. */
export interface ReplayStore {
  /** Uploads (or replaces) the file and returns its public URL. */
  put(name: string, text: string): Promise<string>;
  /** What the public URL serves. */
  get(url: string): Promise<string>;
}

/**
 * Supabase Storage (SPEC §6.5: "Supabase public storage"). The bucket has to exist and be public.
 * UNVERIFIED against a real Supabase project (#34).
 */
export function supabaseStore(opts: { url: string; serviceKey: string; bucket: string; fetchImpl?: typeof fetch }): ReplayStore {
  const base = opts.url.replace(/\/+$/, "");
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    async put(name, text) {
      const res = await doFetch(`${base}/storage/v1/object/${opts.bucket}/${encodeURIComponent(name)}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${opts.serviceKey}`,
          apikey: opts.serviceKey,
          "content-type": "application/x-ndjson",
          "x-upsert": "true",
          "cache-control": "no-cache",
        },
        body: text,
        signal: AbortSignal.timeout(30_000),
      });
      // Not the body: a storage error can quote the request.
      if (!res.ok) throw new Error(`replay upload failed: HTTP ${res.status}`);
      return `${base}/storage/v1/object/public/${opts.bucket}/${encodeURIComponent(name)}`;
    },
    async get(url) {
      const res = await doFetch(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`replay download failed: HTTP ${res.status}`);
      return res.text();
    },
  };
}
