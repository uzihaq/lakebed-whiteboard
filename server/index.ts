import { boolean, capsule, mutation, query, string, table } from "lakebed/server";

// Lakebed Whiteboard — shapes-are-rows. Drawing is a mutation; the canvas is a live query.
// The capsule IS the room (each spawned copy is its own program), so no per-room scoping is needed.
//
// Permission model (server-enforced):
//   • First visitor to CLAIM becomes the owner. Ownership is bound to their identity (ctx.auth.userId),
//     NOT to a shareable secret — so sharing the view passcode never leaks owner powers.
//   • Only the owner can undo/redo, set the draw permission, and lock viewing.
//   • drawLock: when true, only the owner may write shapes; otherwise anyone with the link can.
//   • viewLock + viewHash: a passcode gate for *viewing*. It's a soft/client gate (the live query can't
//     withhold rows per-subscriber) — honest, low-stakes: each board is its own throwaway capsule.

const SHAPE_FIELDS = ["type", "x", "y", "w", "h", "points", "color", "strokeWidth", "text", "fill", "rotation", "z", "createdBy"];
function dataOf(row: any) { const o: any = {}; SHAPE_FIELDS.forEach((k) => { o[k] = row[k] ?? ""; }); return o; }
function isOwner(ctx: any, room: any) { return !!room && !!room.ownerId && room.ownerId === ctx.auth.userId; }
function canWrite(ctx: any, room: any) { return !room || !room.drawLock || isOwner(ctx, room); }
function logOp(ctx: any, kind: string, shapeId: string, before: string, after: string) {
  ctx.db.ops.insert({ userId: ctx.auth.userId, kind, shapeId, before, after, undone: false });
  const all = ctx.db.ops.orderBy("createdAt", "asc").all();
  if (all.length > 160) all.slice(0, all.length - 160).forEach((o: any) => ctx.db.ops.delete(o.id));
}

export default capsule({
  name: "Whiteboard",
  schema: {
    shapes: table({
      type: string(), x: string(), y: string(), w: string(), h: string(),
      points: string(), color: string(), strokeWidth: string(), text: string(),
      fill: string(), rotation: string(), z: string(), createdBy: string(),
    }),
    ops: table({ userId: string(), kind: string(), shapeId: string(), before: string(), after: string(), undone: boolean().default(false) }),
    room: table({ ownerId: string(), viewHash: string(), drawLock: boolean().default(false), viewLock: boolean().default(false) }),
  },
  queries: {
    shapes: query((ctx) => ctx.db.shapes.orderBy("createdAt", "asc").all()),
    room: query((ctx) => ctx.db.room.all()),
  },
  mutations: {
    addShape: mutation((ctx, payload: string) => {
      const { shape } = JSON.parse(payload || "{}");
      const room = ctx.db.room.all()[0];
      if (!canWrite(ctx, room) || !shape) return;
      const row = ctx.db.shapes.insert({ ...dataOf(shape), createdBy: ctx.auth.userId });
      logOp(ctx, "add", row.id, "", JSON.stringify(dataOf(row)));
    }),
    updateShape: mutation((ctx, payload: string) => {
      const { id, patch } = JSON.parse(payload || "{}");
      const room = ctx.db.room.all()[0];
      if (!canWrite(ctx, room)) return;
      const cur = ctx.db.shapes.get(id); if (!cur || !patch) return;
      ctx.db.shapes.update(id, patch);
      logOp(ctx, "update", id, JSON.stringify(dataOf(cur)), JSON.stringify({ ...dataOf(cur), ...patch }));
    }),
    deleteShape: mutation((ctx, payload: string) => {
      const { id } = JSON.parse(payload || "{}");
      const room = ctx.db.room.all()[0];
      if (!canWrite(ctx, room)) return;
      const cur = ctx.db.shapes.get(id); if (!cur) return;
      ctx.db.shapes.delete(id);
      logOp(ctx, "delete", id, JSON.stringify(dataOf(cur)), "");
    }),
    // undo / redo — OWNER ONLY, board-level (most recent action by anyone)
    undo: mutation((ctx) => {
      const room = ctx.db.room.all()[0];
      if (room && room.ownerId && !isOwner(ctx, room)) return;     // claimed → owner only; unclaimed → anyone
      const live = ctx.db.ops.orderBy("createdAt", "asc").all().filter((o: any) => !o.undone);
      const op = live[live.length - 1]; if (!op) return;
      let shapeId = op.shapeId;
      if (op.kind === "add") ctx.db.shapes.delete(op.shapeId);
      else if (op.kind === "delete") { const r = ctx.db.shapes.insert({ ...JSON.parse(op.before), createdBy: op.before ? JSON.parse(op.before).createdBy : ctx.auth.userId }); shapeId = r.id; }
      else ctx.db.shapes.update(op.shapeId, JSON.parse(op.before));
      ctx.db.ops.update(op.id, { undone: true, shapeId });
    }),
    redo: mutation((ctx) => {
      const room = ctx.db.room.all()[0];
      if (room && room.ownerId && !isOwner(ctx, room)) return;
      const done = ctx.db.ops.orderBy("createdAt", "asc").all().filter((o: any) => o.undone);
      const op = done[done.length - 1]; if (!op) return;
      let shapeId = op.shapeId;
      if (op.kind === "add") { const r = ctx.db.shapes.insert({ ...JSON.parse(op.after), createdBy: ctx.auth.userId }); shapeId = r.id; }
      else if (op.kind === "delete") ctx.db.shapes.delete(op.shapeId);
      else ctx.db.shapes.update(op.shapeId, JSON.parse(op.after));
      ctx.db.ops.update(op.id, { undone: false, shapeId });
    }),
    claim: mutation((ctx, payload: string) => {
      const { viewHash } = JSON.parse(payload || "{}");
      const room = ctx.db.room.all()[0];
      if (room && room.ownerId) return;     // already claimed — no takeovers
      if (room) ctx.db.room.update(room.id, { ownerId: ctx.auth.userId, viewHash: viewHash || "", drawLock: false, viewLock: false });
      else ctx.db.room.insert({ ownerId: ctx.auth.userId, viewHash: viewHash || "", drawLock: false, viewLock: false });
    }),
    setDrawLock: mutation((ctx, payload: string) => {
      const { value } = JSON.parse(payload || "{}");
      const room = ctx.db.room.all()[0];
      if (!isOwner(ctx, room)) return;
      ctx.db.room.update(room.id, { drawLock: !!value });
    }),
    setViewLock: mutation((ctx, payload: string) => {
      const { value, viewHash } = JSON.parse(payload || "{}");
      const room = ctx.db.room.all()[0];
      if (!isOwner(ctx, room)) return;
      const patch: any = { viewLock: !!value };
      if (typeof viewHash === "string") patch.viewHash = viewHash;
      ctx.db.room.update(room.id, patch);
    }),
  },
});
