import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// enqueue は Supabase 未設定だと積まない。ここでは設定済みとして扱う。
vi.mock("./supabase.ts", () => ({ isSupabaseConfigured: true, supabase: {} }));
import { db, type OutboxRow, type RecipeRow } from "../db/schema.ts";
import {
  backoffDelayMs,
  coalesceOutbox,
  enqueue,
  flushOutbox,
  pendingCount,
  type OutboxSender,
  type SyncTable,
} from "./outbox.ts";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

const entry = (partial: Partial<OutboxRow> = {}): OutboxRow => ({
  seq: 1,
  table_name: "recipes",
  record_id: ID_A,
  op: "put",
  created_at: "2026-08-17T00:00:00.000Z",
  ...partial,
});

const recipe = (id: string, title: string): RecipeRow => ({
  id,
  source_id: null,
  title,
  source_url: null,
  thumbnail_url: null,
  dish_roles: ["main"],
  cook_time_min: null,
  servings: 2,
  main_ingredient_category: null,
  cooking_method: null,
  tags: [],
  is_favorite: false,
  is_excluded: false,
  cook_count: 0,
  last_cooked_at: null,
  reject_count: 0,
  created_at: "2026-08-17T00:00:00.000Z",
  updated_at: "2026-08-17T00:00:00.000Z",
});

/** 送信内容を記録するだけの sender。失敗させたいときは `failOn` を指定する。 */
function fakeSender(failOn?: string) {
  const puts: { table: SyncTable; id: string }[] = [];
  const removes: { table: SyncTable; id: string }[] = [];
  const sender: OutboxSender = {
    async put(table, row) {
      const id = row.id as string;
      if (id === failOn) throw new Error("network down");
      puts.push({ table, id });
    },
    async remove(table, id) {
      if (id === failOn) throw new Error("network down");
      removes.push({ table, id });
    },
  };
  return { sender, puts, removes };
}

describe("coalesceOutbox", () => {
  it("keeps the latest operation per row but the earliest position", () => {
    const result = coalesceOutbox([
      entry({ seq: 1, record_id: ID_A, op: "put" }),
      entry({ seq: 2, record_id: ID_B, op: "put" }),
      entry({ seq: 3, record_id: ID_A, op: "delete" }),
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ record_id: ID_A, op: "delete", seq: 1 });
    expect(result[1]).toMatchObject({ record_id: ID_B, op: "put", seq: 2 });
  });

  it("treats the same id in different tables as different rows", () => {
    const result = coalesceOutbox([
      entry({ seq: 1, table_name: "recipes", record_id: ID_A }),
      entry({ seq: 2, table_name: "ingredients", record_id: ID_A }),
    ]);
    expect(result).toHaveLength(2);
  });

  it("returns an empty list for an empty queue", () => {
    expect(coalesceOutbox([])).toEqual([]);
  });
});

describe("backoffDelayMs", () => {
  it("grows exponentially and stops at the cap", () => {
    expect(backoffDelayMs(0)).toBe(1000);
    expect(backoffDelayMs(1)).toBe(2000);
    expect(backoffDelayMs(3)).toBe(8000);
    expect(backoffDelayMs(99)).toBe(5 * 60 * 1000);
  });
});

describe("enqueue / flushOutbox", () => {
  beforeEach(async () => {
    await db.outbox.clear();
    await db.recipes.clear();
  });

  it("ignores rows that cannot exist in Supabase (dev seed ids)", async () => {
    await enqueue("recipes", "r-seed-nikujaga", "put");
    expect(await pendingCount()).toBe(0);
  });

  it("keeps working when the same row is queued for delete after a put", async () => {
    await db.recipes.add(recipe(ID_A, "肉じゃが"));
    await enqueue("recipes", ID_A, "put");
    await db.recipes.delete(ID_A);
    await enqueue("recipes", ID_A, "delete");

    const { sender, puts, removes } = fakeSender();
    await flushOutbox(sender, () => true);

    expect(puts).toEqual([]);
    expect(removes).toEqual([{ table: "recipes", id: ID_A }]);
    expect(await pendingCount()).toBe(0);
  });

  it("sends the current row and clears the queue", async () => {
    await db.recipes.add(recipe(ID_A, "肉じゃが"));
    await enqueue("recipes", ID_A, "put");

    const { sender, puts } = fakeSender();
    const result = await flushOutbox(sender, () => true);

    expect(puts).toEqual([{ table: "recipes", id: ID_A }]);
    expect(result).toMatchObject({ sent: 1, remaining: 0, stoppedBy: null });
    expect(await pendingCount()).toBe(0);
  });

  it("sends a row once even after repeated edits", async () => {
    await db.recipes.add(recipe(ID_A, "肉じゃが"));
    await enqueue("recipes", ID_A, "put");
    await enqueue("recipes", ID_A, "put");
    await enqueue("recipes", ID_A, "put");
    expect(await pendingCount()).toBe(3);

    const { sender, puts } = fakeSender();
    await flushOutbox(sender, () => true);

    expect(puts).toHaveLength(1);
    expect(await pendingCount()).toBe(0);
  });

  it("keeps everything queued while offline", async () => {
    await db.recipes.add(recipe(ID_A, "肉じゃが"));
    await enqueue("recipes", ID_A, "put");

    const { sender, puts } = fakeSender();
    const result = await flushOutbox(sender, () => false);

    expect(puts).toEqual([]);
    expect(result).toMatchObject({ sent: 0, remaining: 1, stoppedBy: "offline" });
    expect(await pendingCount()).toBe(1);
  });

  it("stops at the first failure and keeps the rest queued", async () => {
    await db.recipes.bulkAdd([recipe(ID_A, "肉じゃが"), recipe(ID_B, "唐揚げ")]);
    await enqueue("recipes", ID_A, "put");
    await enqueue("recipes", ID_B, "put");

    const { sender, puts } = fakeSender(ID_B);
    const result = await flushOutbox(sender, () => true);

    expect(puts).toEqual([{ table: "recipes", id: ID_A }]);
    expect(result.sent).toBe(1);
    expect(result.stoppedBy).toContain("network down");
    // 失敗した行だけが残る（成功した行は消えている）。
    const rest = await db.outbox.toArray();
    expect(rest.map((r) => r.record_id)).toEqual([ID_B]);
  });

  it("sends a delete even though the row is gone from Dexie", async () => {
    await enqueue("recipes", ID_A, "delete");

    const { sender, removes } = fakeSender();
    await flushOutbox(sender, () => true);

    expect(removes).toEqual([{ table: "recipes", id: ID_A }]);
    expect(await pendingCount()).toBe(0);
  });

  it("drops a queued put whose row no longer exists locally", async () => {
    await enqueue("recipes", ID_A, "put"); // 行は Dexie に無い

    const { sender, puts } = fakeSender();
    const result = await flushOutbox(sender, () => true);

    expect(puts).toEqual([]);
    expect(result).toMatchObject({ sent: 1, remaining: 0 });
    expect(await pendingCount()).toBe(0);
  });

  it("does nothing when the queue is empty, even offline", async () => {
    const { sender } = fakeSender();
    expect(await flushOutbox(sender, () => false)).toEqual({
      sent: 0,
      remaining: 0,
      stoppedBy: null,
    });
  });
});
