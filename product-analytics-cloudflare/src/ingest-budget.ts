type Counter = { minute: number; count: number };
type Storage = {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: Counter): Promise<void>;
  transaction<T>(callback: (storage: Storage) => Promise<T>): Promise<T>;
};

export type BudgetNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
};

// One global coordination object is deliberate: the MVP budget is global and
// only 16 events/minute. One overwritten record contains no event/user data.
export class AnalyticsBudget {
  constructor(private readonly state: { storage: Storage }) {}

  async fetch(request: Request): Promise<Response> {
    const count = Number(new URL(request.url).searchParams.get("count"));
    if (request.method !== "POST" || !Number.isInteger(count) || count < 1 || count > 16) {
      return new Response(null, { status: 400 });
    }
    const allowed = await this.state.storage.transaction(async (storage) => {
      const minute = Math.floor(Date.now() / 60_000);
      const previous = await storage.get<Counter>("budget");
      const next = (previous?.minute === minute ? previous.count : 0) + count;
      if (next > 16) return false;
      await storage.put("budget", { minute, count: next });
      return true;
    });
    return new Response(null, { status: allowed ? 204 : 429 });
  }
}

export async function consumeIngestBudget(namespace: BudgetNamespace, count: number) {
  const response = await namespace.get(namespace.idFromName("global")).fetch(new Request(
    `https://budget.internal/consume?count=${count}`,
    { method: "POST", signal: AbortSignal.timeout(3_000) },
  ));
  if (response.status === 429) return false;
  if (response.status !== 204) throw new Error("Analytics budget unavailable");
  return true;
}
