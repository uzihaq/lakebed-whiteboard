import { SignInWithGoogle, signOut, useAuth, useMutation, useQuery } from "lakebed/client";
import { useEffect, useRef, useState } from "preact/hooks";

/* Lakebed Whiteboard — shapes are rows, drawing is a mutation, the canvas is a live query.
   Light/dark themed via CSS vars; optimistic draw so shapes appear the instant you release.
   Select an item for resize + rotate handles, layer order, and a custom colour picker. */

type Shape = { id: string; type: string; x: string; y: string; w: string; h: string; points: string; color: string; strokeWidth: string; text: string; fill: string; rotation: string; z: string; createdBy: string; createdAt: string };
type Pt = [number, number];

const N = (v: any) => { const n = Number(v); return isFinite(n) ? n : 0; };
const FONT = "system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
const PURPLE = "#6965db", SELBG = "#e3e2fc", SELFG = "#4a47c2";
const LIGHT_COLORS = ["#1e1e1e", "#e03131", "#2f9e44", "#1971c2", "#f08c00", "#9c36b5"];
const DARK_COLORS = ["#e9e9ee", "#ff8787", "#69db7c", "#74c0fc", "#ffd43b", "#da77f2"];
const FILLS = ["transparent", "#ffc9c9", "#b2f2bb", "#a5d8ff", "#ffec99"];
const WIDTHS = [2, 4, 7];
const TINTS_LIGHT = ["", "#f8f9fa", "#fff9db", "#e7f5ff", "#ffe3e3"];
const TINTS_DARK = ["", "#202024", "#1b1e2c", "#16201a"];
const THEME = (dark: boolean) => dark
  ? { panel: "#26262b", line: "#3a3a42", ink: "#e7e7ea", sub: "#9a9aa2", soft: "#33333b", canvas: "#19191d", dot: "#ffffff14", shadow: "0 6px 20px -8px rgba(0,0,0,0.65)" }
  : { panel: "#ffffff", line: "#e9e9ee", ink: "#1e1e1e", sub: "#868e96", soft: "#f1f3f5", canvas: "#ffffff", dot: "#0000000d", shadow: "0 4px 18px -6px rgba(0,0,0,0.16)" };
const TOOLS = [
  { k: "select", label: "Select", key: "1" }, { k: "hand", label: "Pan", key: "H" },
  { k: "rect", label: "Rectangle", key: "2" }, { k: "diamond", label: "Diamond", key: "3" },
  { k: "ellipse", label: "Ellipse", key: "4" }, { k: "arrow", label: "Arrow", key: "5" },
  { k: "line", label: "Line", key: "6" }, { k: "draw", label: "Draw", key: "7" }, { k: "text", label: "Text", key: "8" },
];

const ROT = (a: number, x: number, y: number): Pt => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
const byZ = (a: Shape, b: Shape) => (N(a.z) - N(b.z)) || ((a.createdAt || "￿") < (b.createdAt || "￿") ? -1 : 1);

function Icon({ k, s = 18 }: { k: string; s?: number }) {
  const p: any = { width: s, height: s, viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", "stroke-width": 1.5, "stroke-linecap": "round", "stroke-linejoin": "round" };
  if (k === "select") return <svg {...p}><path d="M5 3l11 6-4.6 1.1L9.4 16z" /></svg>;
  if (k === "hand") return <svg {...p}><path d="M7 10V5.2a1.1 1.1 0 0 1 2.2 0V9m0-.5V4.4a1.1 1.1 0 0 1 2.2 0V9m0-.4V5.4a1.1 1.1 0 0 1 2.2 0V12c0 2.6-1.8 4.5-4.3 4.5-1.6 0-2.6-.7-3.4-1.9L4 11.3a1.1 1.1 0 0 1 1.8-1.2L7 11.5" /></svg>;
  if (k === "rect") return <svg {...p}><rect x="3.5" y="4.8" width="13" height="10.4" rx="1.5" /></svg>;
  if (k === "diamond") return <svg {...p}><path d="M10 3.5l6.3 6.5L10 16.5 3.7 10z" /></svg>;
  if (k === "ellipse") return <svg {...p}><circle cx="10" cy="10" r="6.4" /></svg>;
  if (k === "arrow") return <svg {...p}><path d="M4 14.5L15.5 5M15.5 5h-5.2M15.5 5v5.2" /></svg>;
  if (k === "line") return <svg {...p}><path d="M4.5 15L15.5 5" /></svg>;
  if (k === "draw") return <svg {...p}><path d="M3 16.5l1.6-4.2 7.6-7.6 2.6 2.6-7.6 7.6z" /></svg>;
  if (k === "text") return <svg {...p}><path d="M5 6V4.6h10V6M10 4.6V16M8 16h4" /></svg>;
  return null;
}

async function sha256(s: string): Promise<string> {
  try { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
  catch { return "plain:" + s; }
}
function simplify(pts: Pt[], tol = 1.4): Pt[] {
  if (pts.length <= 2) return pts;
  const sq = tol * tol, keep = new Array(pts.length).fill(false); keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) { const [a, b] = stack.pop()!; let md = -1, mi = -1; for (let i = a + 1; i < b; i++) { const d = segDist(pts[i], pts[a], pts[b]); if (d > md) { md = d; mi = i; } } if (md > sq && mi > -1) { keep[mi] = true; stack.push([a, mi], [mi, b]); } }
  return pts.filter((_, i) => keep[i]);
}
function segDist(p: Pt, a: Pt, b: Pt) { let x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y; if (dx || dy) { const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy); if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; } } return (p[0] - x) ** 2 + (p[1] - y) ** 2; }
function bbox(s: Shape) {
  if (s.type === "draw" || s.type === "line" || s.type === "arrow") { const pts: Pt[] = JSON.parse(s.points || "[]"); if (!pts.length) return { x: N(s.x), y: N(s.y), w: N(s.w), h: N(s.h) }; const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); const x = Math.min(...xs), y = Math.min(...ys); return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }; }
  let x = N(s.x), y = N(s.y), w = N(s.w), h = N(s.h); if (w < 0) { x += w; w = -w; } if (h < 0) { y += h; h = -h; } return { x, y, w, h };
}
const sig = (s: Shape) => [s.type, s.x, s.y, s.w, s.h, s.points, s.color, s.strokeWidth, s.text, s.fill, s.rotation, s.z].join("|");

function ShapeEl({ s }: { s: Shape }) {
  const stroke = s.color || "#888", sw = N(s.strokeWidth) || 2, fill = s.fill && s.fill !== "transparent" ? s.fill : "none";
  const co = { stroke, "stroke-width": sw, fill, "stroke-linecap": "round", "stroke-linejoin": "round" } as any;
  let el: any = null;
  if (s.type === "rect") { const b = bbox(s); el = <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={Math.min(5, b.w / 12, b.h / 12)} {...co} />; }
  else if (s.type === "ellipse") { const b = bbox(s); el = <ellipse cx={b.x + b.w / 2} cy={b.y + b.h / 2} rx={b.w / 2} ry={b.h / 2} {...co} />; }
  else if (s.type === "diamond") { const b = bbox(s); el = <polygon points={`${b.x + b.w / 2},${b.y} ${b.x + b.w},${b.y + b.h / 2} ${b.x + b.w / 2},${b.y + b.h} ${b.x},${b.y + b.h / 2}`} {...co} />; }
  else if (s.type === "draw") { const pts: Pt[] = JSON.parse(s.points || "[]"); el = <polyline points={pts.map((p) => p.join(",")).join(" ")} {...co} fill="none" />; }
  else if (s.type === "line" || s.type === "arrow") {
    const pts: Pt[] = JSON.parse(s.points || "[]"); if (pts.length < 2) return null; const a = pts[0], z = pts[pts.length - 1];
    const head = () => { const an = Math.atan2(z[1] - a[1], z[0] - a[0]), L = 9 + sw * 1.4; return `${z[0] - L * Math.cos(an - 0.5)},${z[1] - L * Math.sin(an - 0.5)} ${z[0]},${z[1]} ${z[0] - L * Math.cos(an + 0.5)},${z[1] - L * Math.sin(an + 0.5)}`; };
    el = <g><polyline points={pts.map((p) => p.join(",")).join(" ")} {...co} fill="none" />{s.type === "arrow" && <polyline points={head()} stroke={stroke} stroke-width={sw} fill="none" stroke-linecap="round" stroke-linejoin="round" />}</g>;
  }
  else if (s.type === "text") el = <text x={N(s.x)} y={N(s.y) + Math.max(16, sw * 7)} fill={stroke} font-size={Math.max(16, sw * 7)} font-family={FONT} style={{ whiteSpace: "pre" }}>{s.text}</text>;
  if (el === null) return null;
  const rot = N(s.rotation);
  if (!rot) return el;
  const b = bbox(s); return <g transform={`rotate(${rot} ${b.x + b.w / 2} ${b.y + b.h / 2})`}>{el}</g>;
}

export function App() {
  const serverShapes = useQuery<Shape[]>("shapes");
  const roomRows = useQuery<any[]>("room");
  const auth = useAuth();
  const addShape = useMutation<[string], void>("addShape");
  const updateShapeM = useMutation<[string], void>("updateShape");
  const deleteShape = useMutation<[string], void>("deleteShape");
  const undoM = useMutation<[string], void>("undo");
  const redoM = useMutation<[string], void>("redo");
  const claimM = useMutation<[string], void>("claim");
  const setDrawLockM = useMutation<[string], void>("setDrawLock");
  const setViewLockM = useMutation<[string], void>("setViewLock");

  const room = roomRows && roomRows[0];
  const claimable = !(room && room.ownerId);
  const owner = !!(room && room.ownerId && room.ownerId === auth.userId);
  const drawLock = !!(room && room.drawLock);
  const viewLock = !!(room && room.viewLock);

  const initDark = typeof localStorage !== "undefined" && localStorage.getItem("wb-dark") === "1";
  const [dark, setDark] = useState(initDark);
  const [canvasBg, setCanvasBg] = useState("");
  const [gridOn, setGridOn] = useState(true);
  const [menu, setMenu] = useState(false);
  const [tool, setTool] = useState("select");
  const [color, setColor] = useState(initDark ? DARK_COLORS[0] : LIGHT_COLORS[0]);
  const [fill, setFill] = useState(FILLS[0]);
  const [width, setWidth] = useState(WIDTHS[1]);
  const [sel, setSel] = useState<string | null>(null);
  const [vp, setVp] = useState({ x: -200, y: -150, zoom: 1 });
  const [draft, setDraft] = useState<Shape | null>(null);
  const [pending, setPending] = useState<Shape[]>([]);
  const [optim, setOptim] = useState<Record<string, Shape>>({});
  const [editing, setEditing] = useState<{ id: string | null; x: number; y: number; value: string } | null>(null);
  const [viewPass, setViewPass] = useState("");
  const [passInput, setPassInput] = useState("");
  const [toast, setToast] = useState("");
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 760);
  const [dims, setDims] = useState(() => ({ w: typeof window !== "undefined" ? window.innerWidth : 1280, h: typeof window !== "undefined" ? window.innerHeight : 800 }));

  const svgRef = useRef<SVGSVGElement>(null);
  const ptr = useRef<any>(null);
  const vpRef = useRef(vp); vpRef.current = vp;
  const pid = useRef(0);

  const T = THEME(dark);
  const canvasColor = canvasBg || T.canvas;
  const colors = dark ? DARK_COLORS : LIGHT_COLORS;
  const tints = dark ? TINTS_DARK : TINTS_LIGHT;
  const canDraw = !room || !drawLock || owner;
  const canUndo = claimable || owner;
  const viewUnlocked = owner || !viewLock || (!!room?.viewHash && viewPass === room.viewHash);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2000); };

  // optimistic: new shapes (pending) AND edits (optim overrides) render instantly; each clears once the server echoes the same data
  const hasOptim = Object.keys(optim).length > 0;
  const baseShapes = hasOptim ? serverShapes.map((s) => optim[s.id] || s) : serverShapes;
  const shapes = pending.length ? [...baseShapes, ...pending] : baseShapes;
  useEffect(() => {
    setPending((p) => { if (!p.length) return p; const have = new Set(serverShapes.map(sig)); const next = p.filter((ps) => !have.has(sig(ps))); return next.length === p.length ? p : next; });
    setOptim((o) => { const ids = Object.keys(o); if (!ids.length) return o; let changed = false; const next: Record<string, Shape> = {}; for (const id of ids) { const sv = serverShapes.find((s) => s.id === id); if (!sv || sig(sv) === sig(o[id])) { changed = true; continue; } next[id] = o[id]; } return changed ? next : o; });
  }, [serverShapes]);
  function commitAdd(shapeData: any) {
    setPending((p) => [...p, { ...shapeData, id: "pend-" + pid.current++, createdBy: "", createdAt: "" }]);
    addShape(JSON.stringify({ shape: shapeData }));
  }
  // optimistic edit: show the patched shape immediately, forward to the server, reconcile on echo. ALL updateShape callers get this.
  function updateShape(payload: string) {
    try { const { id, patch } = JSON.parse(payload); const cur = optim[id] || serverShapes.find((s) => s.id === id); if (cur) setOptim((o) => ({ ...o, [id]: { ...cur, ...patch, id } })); } catch {}
    updateShapeM(payload);
  }

  useEffect(() => { const r = () => { setIsMobile(window.innerWidth < 760); setDims({ w: window.innerWidth, h: window.innerHeight }); }; window.addEventListener("resize", r); return () => window.removeEventListener("resize", r); }, []);

  function setTheme(d: boolean) {
    setDark(d); try { localStorage.setItem("wb-dark", d ? "1" : ""); } catch {}
    setCanvasBg("");
    setColor((c) => (c === (d ? LIGHT_COLORS : DARK_COLORS)[0] ? (d ? DARK_COLORS : LIGHT_COLORS)[0] : c));
  }

  function toWorld(e: { clientX: number; clientY: number }): Pt { const r = svgRef.current!.getBoundingClientRect(), v = vpRef.current; return [v.x + ((e.clientX - r.left) / r.width) * (r.width / v.zoom), v.y + ((e.clientY - r.top) / r.height) * (r.height / v.zoom)]; }
  function hit(p: Pt): Shape | null {
    const ord = serverShapes.map((s) => optim[s.id] || s).sort(byZ);
    for (let i = ord.length - 1; i >= 0; i--) {
      const s = ord[i], b = bbox(s), pad = 6 + N(s.strokeWidth), rot = N(s.rotation);
      let q = p;
      if (rot) { const cx = b.x + b.w / 2, cy = b.y + b.h / 2, a = -rot * Math.PI / 180, r = ROT(a, p[0] - cx, p[1] - cy); q = [cx + r[0], cy + r[1]]; }
      if (q[0] >= b.x - pad && q[0] <= b.x + b.w + pad && q[1] >= b.y - pad && q[1] <= b.y + b.h + pad) return s;
    }
    return null;
  }

  // —— selection-handle drags (resize / rotate / line endpoints). stopPropagation so the canvas doesn't also start.
  function startResize(e: any, s: Shape, corner: [number, number]) { e.stopPropagation(); setSel(s.id); ptr.current = { mode: "resize", id: s.id, base: s, b0: bbox(s), rot: N(s.rotation) * Math.PI / 180, corner }; }
  function startResizeDraw(e: any, s: Shape, corner: [number, number]) { e.stopPropagation(); setSel(s.id); ptr.current = { mode: "resizeDraw", id: s.id, base: s, b0: bbox(s), pts0: JSON.parse(s.points || "[]"), corner }; }
  function startRotate(e: any, s: Shape) { e.stopPropagation(); setSel(s.id); const b = bbox(s); ptr.current = { mode: "rotate", id: s.id, base: s, center: [b.x + b.w / 2, b.y + b.h / 2] }; }
  function startEndpoint(e: any, s: Shape, idx: number) { e.stopPropagation(); setSel(s.id); ptr.current = { mode: "endpoint", id: s.id, base: s, pts0: JSON.parse(s.points || "[]"), idx }; }

  function onDown(e: PointerEvent) {
    if (editing || !viewUnlocked) return;
    if (menu) setMenu(false);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toWorld(e);
    if (tool === "hand" || e.button === 1 || ptr.current?.space) { ptr.current = { mode: "pan", sx: e.clientX, sy: e.clientY, ox: vp.x, oy: vp.y }; return; }
    if (tool === "select") { const h = hit(p); setSel(h ? h.id : null); if (h && canDraw) ptr.current = { mode: "move", id: h.id, start: p, base: h }; return; }
    if (!canDraw) { flash("This board is set to view-only"); return; }
    if (tool === "text") { setEditing({ id: null, x: p[0], y: p[1], value: "" }); return; }
    if (tool === "draw") { ptr.current = { mode: "draw", pts: [p] }; setDraft(mkPath("draw", [p], color, width, fill)); return; }
    ptr.current = { mode: "create", type: tool, start: p }; setDraft(mkDraft(tool, p, p, color, width, fill));
  }
  function onMove(e: PointerEvent) {
    const s = ptr.current; if (!s) return;
    if (s.mode === "pan") { setVp((v) => ({ ...v, x: s.ox - (e.clientX - s.sx) / v.zoom, y: s.oy - (e.clientY - s.sy) / v.zoom })); return; }
    const p = toWorld(e);
    if (s.mode === "draw") { s.pts.push(p); setDraft(mkPath("draw", s.pts, color, width, fill)); return; }
    if (s.mode === "create") { setDraft(mkDraft(s.type, s.start, p, color, width, fill)); return; }
    if (s.mode === "move") { setDraft(moveShape(s.base, p[0] - s.start[0], p[1] - s.start[1])); return; }
    if (s.mode === "resize") {
      const b = s.b0, cx = b.x + b.w / 2, cy = b.y + b.h / 2, [sx, sy] = s.corner;
      const av = ROT(s.rot, -sx * b.w / 2, -sy * b.h / 2), A: Pt = [cx + av[0], cy + av[1]];
      const lv = ROT(-s.rot, p[0] - A[0], p[1] - A[1]);
      const nw = Math.max(8, Math.abs(lv[0])), nh = Math.max(8, Math.abs(lv[1])), C: Pt = [(A[0] + p[0]) / 2, (A[1] + p[1]) / 2];
      setDraft({ ...s.base, id: "draft", x: String(C[0] - nw / 2), y: String(C[1] - nh / 2), w: String(nw), h: String(nh) });
      return;
    }
    if (s.mode === "resizeDraw") {
      const b = s.b0, [sx, sy] = s.corner;
      const ax = sx < 0 ? b.x + b.w : b.x, ay = sy < 0 ? b.y + b.h : b.y;
      const cx0 = sx < 0 ? b.x : b.x + b.w, cy0 = sy < 0 ? b.y : b.y + b.h;
      let kx = (p[0] - ax) / ((cx0 - ax) || 1), ky = (p[1] - ay) / ((cy0 - ay) || 1);
      if (Math.abs(kx) < 0.05) kx = kx < 0 ? -0.05 : 0.05;
      if (Math.abs(ky) < 0.05) ky = ky < 0 ? -0.05 : 0.05;
      const pts = s.pts0.map((q: Pt) => [ax + (q[0] - ax) * kx, ay + (q[1] - ay) * ky]);
      setDraft({ ...s.base, id: "draft", points: JSON.stringify(pts) });
      return;
    }
    if (s.mode === "rotate") {
      let deg = Math.atan2(p[1] - s.center[1], p[0] - s.center[0]) * 180 / Math.PI + 90;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      deg = ((Math.round(deg) % 360) + 360) % 360;
      setDraft({ ...s.base, id: "draft", rotation: String(deg) });
      return;
    }
    if (s.mode === "endpoint") { const pts = s.pts0.slice(); pts[s.idx] = p; setDraft({ ...s.base, id: "draft", points: JSON.stringify(pts) }); return; }
  }
  function onUp() {
    const s = ptr.current; ptr.current = null; if (!s) return;
    if (s.mode === "draw") { const pts = simplify(s.pts); setDraft(null); if (pts.length >= 2) commitAdd({ type: "draw", points: JSON.stringify(pts), color, strokeWidth: String(width), x: "0", y: "0", w: "0", h: "0", text: "", fill: "", rotation: "0", z: "0" }); return; }
    if (s.mode === "create") { const d = draft; setDraft(null); if (d) { const b = bbox(d); if (b.w > 4 || b.h > 4 || d.type === "line" || d.type === "arrow") commitAdd(stripDraft(d)); } return; }
    if (s.mode === "move") { const d = draft; setDraft(null); if (d) updateShape(JSON.stringify({ id: s.id, patch: d.type === "draw" || d.type === "line" || d.type === "arrow" ? { points: d.points } : { x: d.x, y: d.y } })); return; }
    if (s.mode === "resize" || s.mode === "resizeDraw") { const d = draft; setDraft(null); if (d) updateShape(JSON.stringify({ id: s.id, patch: s.mode === "resize" ? { x: d.x, y: d.y, w: d.w, h: d.h } : { points: d.points } })); return; }
    if (s.mode === "rotate") { const d = draft; setDraft(null); if (d) updateShape(JSON.stringify({ id: s.id, patch: { rotation: d.rotation } })); return; }
    if (s.mode === "endpoint") { const d = draft; setDraft(null); if (d) updateShape(JSON.stringify({ id: s.id, patch: { points: d.points } })); return; }
  }
  function commitText() { if (!editing) return; const v = editing.value.replace(/\s+$/, ""); if (v) { if (editing.id) updateShape(JSON.stringify({ id: editing.id, patch: { text: v } })); else commitAdd({ type: "text", x: String(editing.x), y: String(editing.y), w: String(v.length * 9), h: "26", points: "", color, strokeWidth: String(width), text: v, fill: "", rotation: "0", z: "0" }); } setEditing(null); setTool("select"); }

  function setZ(front: boolean) { if (!selShape) return; const zs = serverShapes.map((s) => N(s.z)); const v = front ? Math.max(0, ...zs) + 1 : Math.min(0, ...zs) - 1; updateShape(JSON.stringify({ id: selShape.id, patch: { z: String(v) } })); }

  useEffect(() => {
    function kd(e: KeyboardEvent) { if (editing) return; const t = e.target as HTMLElement; if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.code === "Space") { ptr.current = { ...(ptr.current || {}), space: true }; return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { if (!canUndo) return; e.preventDefault(); e.shiftKey ? redoM("") : undoM(""); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && sel && canDraw) { e.preventDefault(); deleteShape(JSON.stringify({ id: sel })); setSel(null); return; }
      const tt = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase()); if (tt) setTool(tt.k); }
    function ku(e: KeyboardEvent) { if (e.code === "Space" && ptr.current) ptr.current.space = false; }
    window.addEventListener("keydown", kd); window.addEventListener("keyup", ku); return () => { window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); };
  }, [sel, editing, canUndo, canDraw]);

  function onWheel(e: WheelEvent) { e.preventDefault();
    if (e.ctrlKey || e.metaKey) { const r = svgRef.current!.getBoundingClientRect(), v = vpRef.current; const wx = v.x + ((e.clientX - r.left) / r.width) * (r.width / v.zoom), wy = v.y + ((e.clientY - r.top) / r.height) * (r.height / v.zoom); const z = Math.min(6, Math.max(0.15, v.zoom * (e.deltaY < 0 ? 1.12 : 0.89))); setVp({ zoom: z, x: wx - ((e.clientX - r.left) / r.width) * (r.width / z), y: wy - ((e.clientY - r.top) / r.height) * (r.height / z) }); }
    else setVp((v) => ({ ...v, x: v.x + e.deltaX / v.zoom, y: v.y + e.deltaY / v.zoom })); }

  function doClaim() { claimM(JSON.stringify({ viewHash: "" })); flash("You own this board"); }
  async function toggleView() { if (!viewLock) { const pw = window.prompt("Set a passcode people need to VIEW this board:") ?? ""; if (!pw) return; const h = await sha256(pw); setViewLockM(JSON.stringify({ value: true, viewHash: h })); flash("Viewing locked"); } else { setViewLockM(JSON.stringify({ value: false })); flash("Viewing open"); } }
  async function tryUnlock() { const h = await sha256(passInput); if (room?.viewHash && h === room.viewHash) { setViewPass(h); flash("Unlocked"); } else flash("Wrong passcode"); }

  const vbW = dims.w / vp.zoom, vbH = dims.h / vp.zoom;
  const bytes = JSON.stringify(serverShapes).length, pct = Math.min(100, (bytes / 1048576) * 100);
  const ordered = [...shapes].sort(byZ);
  const selShape = sel ? (optim[sel] || serverShapes.find((s) => s.id === sel) || null) : null;
  const liveSel = (sel && draft && draft.id === "draft") ? draft : selShape;
  const showProps = !isMobile && (tool !== "select" && tool !== "hand" || selShape);

  // selection box + resize/rotate/endpoint handles (screen-constant size via /zoom)
  function renderSelection() {
    if (!liveSel || editing || tool !== "select") return null;
    const z = vp.zoom, hs = 9 / z, pad = 5 / z, sw = 1.5 / z, t = liveSel.type;
    if (t === "line" || t === "arrow") {
      const pts: Pt[] = JSON.parse(liveSel.points || "[]"); if (pts.length < 2) return null; const ends = [0, pts.length - 1];
      return <g>
        <line x1={pts[0][0]} y1={pts[0][1]} x2={pts[pts.length - 1][0]} y2={pts[pts.length - 1][1]} stroke={PURPLE} stroke-width={sw} stroke-dasharray={`${5 / z} ${4 / z}`} />
        {canDraw && ends.map((idx, i) => <circle key={i} cx={pts[idx][0]} cy={pts[idx][1]} r={hs * 0.7} fill="var(--panel)" stroke={PURPLE} stroke-width={sw} style={{ cursor: "move" }} onPointerDown={(e) => startEndpoint(e, liveSel, idx)} />)}
      </g>;
    }
    const b = bbox(liveSel), rot = N(liveSel.rotation), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const wrap = (kids: any) => <g transform={rot ? `rotate(${rot} ${cx} ${cy})` : undefined}>{kids}</g>;
    const box = <rect x={b.x - pad} y={b.y - pad} width={b.w + pad * 2} height={b.h + pad * 2} fill="none" stroke={PURPLE} stroke-width={sw} stroke-dasharray={`${5 / z} ${4 / z}`} rx={3 / z} />;
    if (!canDraw) return wrap(box);
    const isDraw = t === "draw", canRot = t === "rect" || t === "ellipse" || t === "diamond" || t === "text", canResize = t === "rect" || t === "ellipse" || t === "diamond" || isDraw;
    const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    return wrap(<>
      {box}
      {canResize && corners.map(([sx, sy], i) => {
        const hx = sx < 0 ? b.x - pad : b.x + b.w + pad, hy = sy < 0 ? b.y - pad : b.y + b.h + pad;
        return <rect key={i} x={hx - hs / 2} y={hy - hs / 2} width={hs} height={hs} rx={2 / z} fill="var(--panel)" stroke={PURPLE} stroke-width={sw} style={{ cursor: sx * sy > 0 ? "nwse-resize" : "nesw-resize" }}
          onPointerDown={(e) => isDraw ? startResizeDraw(e, liveSel, [sx, sy]) : startResize(e, liveSel, [sx, sy])} />;
      })}
      {canRot && <>
        <line x1={cx} y1={b.y - pad} x2={cx} y2={b.y - pad - 22 / z} stroke={PURPLE} stroke-width={sw} />
        <circle cx={cx} cy={b.y - pad - 22 / z} r={hs * 0.72} fill="var(--panel)" stroke={PURPLE} stroke-width={sw} style={{ cursor: "grab" }} onPointerDown={(e) => startRotate(e, liveSel)} />
      </>}
    </>);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: canvasColor, color: "var(--ink)", fontFamily: FONT, overflow: "hidden", userSelect: "none", "--panel": T.panel, "--line": T.line, "--ink": T.ink, "--sub": T.sub, "--soft": T.soft, "--shadow": T.shadow } as any}>
      <svg ref={svgRef} width="100%" height="100%" viewBox={`${vp.x} ${vp.y} ${vbW} ${vbH}`}
        style={{ position: "absolute", inset: 0, cursor: tool === "hand" ? "grab" : tool === "select" ? "default" : "crosshair", touchAction: "none" }}
        onPointerDown={onDown as any} onPointerMove={onMove as any} onPointerUp={onUp} onWheel={onWheel as any}>
        <defs><pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1.4" cy="1.4" r="1.4" fill={T.dot} /></pattern></defs>
        {gridOn && <rect x={vp.x} y={vp.y} width={vbW} height={vbH} fill="url(#dots)" />}
        {viewUnlocked && ordered.map((s) => <g key={s.id} opacity={draft && draft.id === "draft" && s.id === sel ? 0 : 1}><ShapeEl s={s} /></g>)}
        {viewUnlocked && draft && <ShapeEl s={draft} />}
        {viewUnlocked && renderSelection()}
      </svg>

      {/* view-lock gate */}
      {!viewUnlocked && <div style={{ position: "absolute", inset: 0, background: canvasColor, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, zIndex: 90 }}>
        <div style={{ fontSize: 40 }}>🔒</div>
        <div style={{ fontSize: 20, fontWeight: 600, color: "var(--ink)" }}>This board is locked</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input type="password" autoFocus value={passInput} placeholder="passcode" onInput={(e) => setPassInput((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === "Enter") tryUnlock(); }} style={inp} />
          <button style={primaryBtn} onClick={tryUnlock}>Unlock</button>
        </div>
      </div>}

      {viewUnlocked && <>
        {/* text editor */}
        {editing && <textarea autoFocus value={editing.value} onInput={(e) => setEditing({ ...editing, value: (e.target as HTMLTextAreaElement).value })} onBlur={commitText} onKeyDown={(e) => { if (e.key === "Escape") setEditing(null); }}
          style={{ position: "absolute", left: (editing.x - vp.x) * vp.zoom, top: (editing.y - vp.y) * vp.zoom, minWidth: 140, background: "transparent", color, border: "none", outline: "none", resize: "none", font: `${Math.max(16, width * 7) * vp.zoom}px ${FONT}`, lineHeight: 1.1 }} />}

        {/* top toolbar */}
        <div style={{ position: "absolute", top: isMobile ? 58 : 12, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 2, ...card, padding: 5, overflowX: isMobile ? "auto" : "visible", maxWidth: "94vw" }}>
          {TOOLS.map((t) => (
            <button key={t.k} title={`${t.label} — ${t.key}`} onClick={() => setTool(t.k)} disabled={!canDraw && t.k !== "select" && t.k !== "hand"}
              style={{ position: "relative", width: 36, height: 36, borderRadius: 9, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", background: tool === t.k ? SELBG : "transparent", color: tool === t.k ? SELFG : (!canDraw && t.k !== "select" && t.k !== "hand" ? "var(--sub)" : "var(--ink)") }}>
              <Icon k={t.k} />{!isMobile && <span style={{ position: "absolute", right: 3, bottom: 1, fontSize: 8, color: "var(--sub)" }}>{t.key}</span>}
            </button>
          ))}
        </div>

        {/* left properties */}
        {showProps && <div style={{ position: "absolute", left: 12, top: 64, ...card, padding: 12, display: "flex", flexDirection: "column", gap: 10, width: 190 }}>
          <Row label="Stroke">{colors.map((c) => <Sw key={c} c={c} on={color === c} onClick={() => { setColor(c); if (selShape) updateShape(JSON.stringify({ id: selShape.id, patch: { color: c } })); }} />)}<ColorInput value={color[0] === "#" ? color : "#000000"} onChange={(v: string) => { setColor(v); if (selShape) updateShape(JSON.stringify({ id: selShape.id, patch: { color: v } })); }} /></Row>
          <Row label="Background">{FILLS.map((c) => <Sw key={c} c={c} on={fill === c} onClick={() => { setFill(c); if (selShape) updateShape(JSON.stringify({ id: selShape.id, patch: { fill: c } })); }} />)}<ColorInput value={fill && fill !== "transparent" ? fill : "#ffffff"} onChange={(v: string) => { setFill(v); if (selShape) updateShape(JSON.stringify({ id: selShape.id, patch: { fill: v } })); }} /></Row>
          <Row label="Stroke width">{WIDTHS.map((w) => <button key={w} onClick={() => { setWidth(w); if (selShape) updateShape(JSON.stringify({ id: selShape.id, patch: { strokeWidth: String(w) } })); }} style={{ width: 34, height: 30, borderRadius: 8, border: "none", cursor: "pointer", background: width === w ? SELBG : "var(--soft)", display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ width: 18, height: w, background: "var(--ink)", borderRadius: 4 }} /></button>)}</Row>
          {selShape && <Row label="Layer"><button onClick={() => setZ(true)} style={pill(false)} title="Bring to front">⤒ Front</button><button onClick={() => setZ(false)} style={pill(false)} title="Send to back">⤓ Back</button></Row>}
          {selShape && <button onClick={() => { deleteShape(JSON.stringify({ id: selShape.id })); setSel(null); }} style={{ ...ghostBtn, color: "#e03131", justifyContent: "flex-start", boxShadow: "none", border: "1px solid var(--line)" }}>🗑 Delete</button>}
        </div>}

        {/* top-left: menu + title + meter */}
        <div style={{ position: "absolute", top: 14, left: 14, display: "flex", alignItems: "center", gap: 8 }}>
          <button style={{ ...card, width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--ink)", fontSize: 17 }} title="Menu" onClick={() => setMenu((m) => !m)}>☰</button>
          <div style={{ ...card, padding: "7px 12px", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: PURPLE, letterSpacing: "-0.01em" }}>whiteboard</span>
            {!isMobile && <><span style={{ width: 1, height: 16, background: "var(--line)" }} /><span style={{ fontSize: 11, color: "var(--sub)", fontVariantNumeric: "tabular-nums" }}>{(bytes / 1024).toFixed(1)} KB</span><div style={{ width: 56, height: 6, background: "var(--soft)", borderRadius: 4, overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", background: pct > 80 ? "#e03131" : PURPLE }} /></div></>}
          </div>
        </div>

        {/* settings menu */}
        {menu && <div style={{ position: "absolute", top: 60, left: 14, ...card, padding: 14, width: 210, display: "flex", flexDirection: "column", gap: 12, zIndex: 70 }}>
          <Row label="Theme">
            <button onClick={() => setTheme(false)} style={pill(!dark)}>☀ Light</button>
            <button onClick={() => setTheme(true)} style={pill(dark)}>☾ Dark</button>
          </Row>
          <Row label="Canvas background">{tints.map((c) => <Sw key={c || "def"} c={c || T.canvas} on={canvasBg === c} onClick={() => setCanvasBg(c)} />)}</Row>
          <Row label="Grid"><button onClick={() => setGridOn((g) => !g)} style={pill(gridOn)}>{gridOn ? "On" : "Off"}</button></Row>
        </div>}

        {/* top-right */}
        <div style={{ position: "absolute", top: 14, right: 14, display: "flex", alignItems: "center", gap: 8 }}>
          {canUndo && <div style={{ ...card, padding: 4, display: "flex", gap: 2 }}>
            <button style={ghostIcon} title="Undo (⌘Z)" onClick={() => undoM("")}>↶</button>
            <button style={ghostIcon} title="Redo (⇧⌘Z)" onClick={() => redoM("")}>↷</button>
          </div>}
          {claimable ? <button style={primaryBtn} onClick={doClaim} title="You're the first one here">{isMobile ? "Claim" : "Claim this board"}</button>
            : owner ? <div style={{ ...card, padding: 4, display: "flex", gap: 4, alignItems: "center" }}>
              <button style={pill(drawLock)} title="Who can draw" onClick={() => setDrawLockM(JSON.stringify({ value: !drawLock }))}>{drawLock ? "✏️ Only me" : "✏️ Anyone"}</button>
              <button style={pill(viewLock)} title="Lock viewing with a passcode" onClick={toggleView}>{viewLock ? "🔒 View locked" : "🌐 View open"}</button>
            </div>
              : drawLock ? <span style={{ ...card, padding: "7px 12px", fontSize: 12.5, color: "var(--sub)" }}>👁 view only</span> : null}
          {!isMobile && (auth.isGuest ? <SignInWithGoogle style={{ ...ghostBtn } as any} /> : <button style={ghostBtn} onClick={() => signOut()}>Sign out</button>)}
        </div>

        {/* bottom-left zoom */}
        <div style={{ position: "absolute", bottom: 14, left: 14, ...card, padding: 3, display: "flex", alignItems: "center", gap: 1 }}>
          <button style={ghostIcon} onClick={() => setVp((v) => ({ ...v, zoom: Math.max(0.15, v.zoom * 0.9) }))}>−</button>
          <button style={{ ...ghostIcon, width: 50, fontSize: 12, fontWeight: 600 }} onClick={() => setVp((v) => ({ ...v, zoom: 1 }))}>{Math.round(vp.zoom * 100)}%</button>
          <button style={ghostIcon} onClick={() => setVp((v) => ({ ...v, zoom: Math.min(6, v.zoom * 1.1) }))}>+</button>
        </div>
        <div style={{ position: "absolute", bottom: 18, right: 16, fontSize: 11, color: "var(--sub)" }}>live · share the URL · {serverShapes.length} shapes</div>
      </>}
      {toast && <div style={{ position: "absolute", bottom: 56, left: "50%", transform: "translateX(-50%)", ...card, padding: "9px 16px", fontSize: 13, color: "var(--ink)", zIndex: 95 }}>{toast}</div>}
    </div>
  );
}

const card = { background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, boxShadow: "var(--shadow)" } as any;
const inp = { padding: "9px 12px", borderRadius: 9, border: "1px solid var(--line)", fontSize: 14, outline: "none", background: "var(--panel)", color: "var(--ink)" } as any;
const primaryBtn = { padding: "9px 14px", borderRadius: 10, border: "none", cursor: "pointer", background: PURPLE, color: "#fff", fontSize: 13.5, fontWeight: 600 } as any;
const ghostBtn = { padding: "8px 12px", borderRadius: 9, border: "none", cursor: "pointer", background: "var(--panel)", color: "var(--ink)", fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 6, boxShadow: "var(--shadow)" } as any;
const ghostIcon = { minWidth: 30, height: 30, padding: "0 7px", borderRadius: 7, border: "none", cursor: "pointer", background: "transparent", color: "var(--ink)", fontSize: 15 } as any;
function pill(on: boolean): any { return { padding: "6px 10px", borderRadius: 8, border: "none", cursor: "pointer", background: on ? SELBG : "var(--soft)", color: on ? SELFG : "var(--ink)", fontSize: 12, fontWeight: 600 }; }
function Row({ label, children }: any) { return <div><div style={{ fontSize: 11, color: "var(--sub)", marginBottom: 6 }}>{label}</div><div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>{children}</div></div>; }
function Sw({ c, on, onClick }: any) { return <button onClick={onClick} title={c} style={{ width: 26, height: 26, borderRadius: 7, cursor: "pointer", background: c === "transparent" ? "repeating-conic-gradient(#cfcfd4 0% 25%, #fff 0% 50%) 50% / 10px 10px" : c, border: on ? `2px solid ${PURPLE}` : "1px solid #00000022" }} />; }
function ColorInput({ value, onChange }: any) {
  return (
    <label title="Custom colour" style={{ position: "relative", width: 26, height: 26, borderRadius: 7, overflow: "hidden", cursor: "pointer", border: "1px solid #00000022", display: "inline-flex" }}>
      <span style={{ position: "absolute", inset: 0, background: "conic-gradient(from .25turn, #ff5252, #ffd166, #06d6a0, #4cc9f0, #7b61ff, #ff5252)" }} />
      <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#fff", textShadow: "0 1px 2px #0007" }}>+</span>
      <input type="color" value={value} onInput={(e: any) => onChange(e.target.value)} style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", height: "100%", cursor: "pointer", border: "none", padding: 0 }} />
    </label>
  );
}

function mkDraft(type: string, a: Pt, b: Pt, color: string, width: number, fill: string): Shape {
  const base = { id: "draft", color, strokeWidth: String(width), text: "", fill, rotation: "0", z: "0", createdBy: "", createdAt: "" } as any;
  if (type === "line" || type === "arrow") return { ...base, type, points: JSON.stringify([a, b]), x: "0", y: "0", w: "0", h: "0" };
  return { ...base, type, x: String(Math.min(a[0], b[0])), y: String(Math.min(a[1], b[1])), w: String(Math.abs(b[0] - a[0])), h: String(Math.abs(b[1] - a[1])), points: "" };
}
function mkPath(type: string, pts: Pt[], color: string, width: number, fill: string): Shape { return { id: "draft", type, points: JSON.stringify(pts), color, strokeWidth: String(width), x: "0", y: "0", w: "0", h: "0", text: "", fill, rotation: "0", z: "0", createdBy: "", createdAt: "" }; }
function stripDraft(d: Shape): any { return { type: d.type, x: d.x, y: d.y, w: d.w, h: d.h, points: d.points, color: d.color, strokeWidth: d.strokeWidth, text: d.text, fill: d.fill, rotation: d.rotation, z: d.z }; }
function moveShape(s: Shape, dx: number, dy: number): Shape { if (s.type === "draw" || s.type === "line" || s.type === "arrow") { const pts: Pt[] = JSON.parse(s.points || "[]").map((p: Pt) => [p[0] + dx, p[1] + dy]); return { ...s, id: "draft", points: JSON.stringify(pts) }; } return { ...s, id: "draft", x: String(N(s.x) + dx), y: String(N(s.y) + dy) }; }
