import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// enqueue は Supabase 未設定だと積まない。ここでは設定済みとして扱う。
vi.mock("./supabase.ts", () => ({ isSupabaseConfigured: true, supabase: {} }));
import { db, type OutboxRow, type RecipeRow } from "../db/schema.ts";
import {
  backoffDelayMs,
  coalesceOutbox,
  discardFailed,
  enqueue,
  failedEntries,
  flushOutbox,
  isPermanentSyncCode,
  pendingCount,
  PermanentSyncError,
  retryFailed,
  toSyncError,
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
    // 件数は畳んだあとの「実際に送られる数」で数える（UI に出すのもこの数）。
    expect(await pendingCount()).toBe(1);

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
      failed: 0,
    });
  });
});

describe("permanent failures", () => {
  beforeEach(async () => {
    await Promise.all([db.outbox.clear(), db.recipes.clear()]);
  });

  /** 指定した id にだけ恒久エラーを返す sender。 */
  function pickySender(permanentOn: string) {
    const puts: string[] = [];
    const sender: OutboxSender = {
      async put(_table, row) {
        const id = row.id as string;
        if (id === permanentOn) {
          throw new PermanentSyncError("recipes の送信に失敗: column does not exist", "42703");
        }
        puts.push(id);
      },
      async remove() {},
    };
    return { sender, puts };
  }

  it("classifies error codes we know cannot be fixed by retrying", () => {
    expect(isPermanentSyncCode("42703")).toBe(true); // 列が無い
    expect(isPermanentSyncCode("23503")).toBe(true); // 参照先が無い
    expect(isPermanentSyncCode("PGRST204")).toBe(true);
    expect(isPermanentSyncCode("08006")).toBe(false); // 接続エラー
    expect(isPermanentSyncCode(undefined)).toBe(false);
    expect(isPermanentSyncCode("")).toBe(false);
  });

  it("wraps a permanent supabase error, and leaves an unknown one retryable", () => {
    expect(toSyncError("x", { message: "m", code: "42703" })).toBeInstanceOf(PermanentSyncError);
    expect(toSyncError("x", { message: "m", code: "08006" })).not.toBeInstanceOf(
      PermanentSyncError,
    );
    expect(toSyncError("x", { message: "m" }).message).toBe("x: m");
  });

  it("sets aside the stuck change and keeps sending the rest", async () => {
    await db.recipes.bulkAdd([recipe(ID_A, "肉じゃが"), recipe(ID_B, "唐揚げ")]);
    await enqueue("recipes", ID_A, "put");
    await enqueue("recipes", ID_B, "put");

    const { sender, puts } = pickySender(ID_A);
    const result = await flushOutbox(sender, () => true);

    // 詰まった 1 件のせいで後続が止まらない（これが無いと買い物リストのチェックまで
    // 永久に送られなくなる）。
    expect(puts).toEqual([ID_B]);
    expect(result).toMatchObject({ sent: 1, failed: 1, stoppedBy: null });
    expect(await pendingCount()).toBe(0);
    expect(await failedEntries()).toHaveLength(1);
  });

  it("does not try a set-aside change again on the next flush", async () => {
    await db.recipes.add(recipe(ID_A, "肉じゃが"));
    await enqueue("recipes", ID_A, "put");
    await flushOutbox(pickySender(ID_A).sender, () => true);

    const { sender, puts } = pickySender("nothing");
    const result = await flushOutbox(sender, () => true);

    expect(puts).toEqual([]);
    expect(result).toMatchObject({ sent: 0, failed: 0 });
  });

  it("keeps the reason so the settings screen can show what is stuck", async () => {
    await db.recipes.add(recipe(ID_A, "肉じゃが"));
    await enqueue("recipes", ID_A, "put");
    await flushOutbox(pickySender(ID_A).sender, () => true);

    const [stuck] = await failedEntries();
    expect(stuck?.error).toContain("column does not exist");
    expect(stuck?.table_name).toBe("recipes");
  });

  it("retries a set-aside change once the server side is fixed", async () => {
    await db.recipes.add(recipe(ID_A, "肉じゃが"));
    await enqueue("recipes", ID_A, "put");
    await flushOutbox(pickySender(ID_A).sender, () => true);

    expect(await retryFailed()).toBe(1);
    const { sender, puts } = pickySender("nothing");
    await flushOutbox(sender, () => true);

    expect(puts).toEqual([ID_A]);
    expect(await failedEntries()).toHaveLength(0);
  });

  it("forgets the failure when the row is edited again", async () => {
    await db.recipes.add(recipe(ID_A, "肉じゃが"));
    await enqueue("recipes", ID_A, "put");
    await flushOutbox(pickySender(ID_A).sender, () => true);
    expect(await failedEntries()).toHaveLength(1);

    await enqueue("recipes", ID_A, "put");

    expect(await failedEntries()).toHaveLength(0);
    expect(await pendingCount()).toBe(1);
  });

  it("can discard what we have decided not to send", async () => {
    await db.recipes.add(recipe(ID_A, "肉じゃが"));
    await enqueue("recipes", ID_A, "put");
    await flushOutbox(pickySender(ID_A).sender, () => true);

    expect(await discardFailed()).toBe(1);
    expect(await failedEntries()).toHaveLength(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it("still stops at a failure that might heal (通信断は順序を保って待つ)", async () => {
    await db.recipes.bulkAdd([recipe(ID_A, "肉じゃが"), recipe(ID_B, "唐揚げ")]);
    await enqueue("recipes", ID_A, "put");
    await enqueue("recipes", ID_B, "put");

    const { sender, puts } = fakeSender(ID_A);
    const result = await flushOutbox(sender, () => true);

    expect(puts).toEqual([]);
    expect(result.failed).toBe(0);
    expect(result.stoppedBy).toBe("network down");
    expect(await pendingCount()).toBe(2);
  });
});
