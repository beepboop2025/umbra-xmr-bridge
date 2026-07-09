'use client';

/**
 * Tiktó — the living map (navigable space), ported to React.
 * Nodes/edges render as a glowing topology; small packets travel the edges
 * ("money moving, live"); a shock can propagate outward along edges so risk is
 * something you *watch* spread. Colours come from the Tiktó CSS tokens.
 */
import { useEffect, useRef } from 'react';

export interface MapNode {
  x: number; // 0..1
  y: number; // 0..1
  r?: number;
  label?: string;
  status?: 'ok' | 'warning' | 'critical';
}
export type MapEdge = [number, number, number?]; // [fromIdx, toIdx, weight]

function cssVar(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
function hexA(hex: string, a: number) {
  let h = (hex || '#06d6e0').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function LivingMap({
  nodes,
  edges,
  height = 420,
  autoShock = true,
}: {
  nodes: MapNode[];
  edges: MapEdge[];
  height?: number;
  autoShock?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    let w = 0, h = 0, ctx: CanvasRenderingContext2D;
    let t = 0, last = 0, raf = 0, focused = -1;
    let wave: { from: number; reach: Record<number, number>; t0: number; speed: number } | null = null;

    const px = (nd: MapNode) => ({ x: 40 + nd.x * (w - 80), y: 34 + nd.y * (h - 78) });

    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      const c = canvas.getContext('2d')!;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx = c; w = r.width; h = r.height;
    };

    const propagate = (from: number) => {
      const reach: Record<number, number> = { [from]: 0 };
      let frontier = [from], depth = 0, guard = 0;
      while (frontier.length && guard++ < 50) {
        const next: number[] = [];
        for (const nnode of frontier)
          for (const ed of edges) {
            const other = ed[0] === nnode ? ed[1] : ed[1] === nnode ? ed[0] : -1;
            if (other >= 0 && reach[other] === undefined) { reach[other] = depth + 1; next.push(other); }
          }
        frontier = next; depth++;
      }
      wave = { from, reach, t0: t, speed: 1.1 };
    };

    const draw = () => {
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      const live = cssVar('--tk-live', '#06d6e0');
      const crit = cssVar('--tk-critical', '#ff5b52');
      const warn = cssVar('--tk-warning', '#ffb020');
      const T = t;
      const waveFront = wave ? (T - wave.t0) * wave.speed : -1;

      for (let e = 0; e < edges.length; e++) {
        const aIdx = edges[e][0], bIdx = edges[e][1];
        const a = px(nodes[aIdx]), b = px(nodes[bIdx]);
        const weight = edges[e][2] ?? 0.5;
        const touched = focused >= 0 && (aIdx === focused || bIdx === focused);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = hexA(live, (touched ? 0.26 : 0.06) + weight * (touched ? 0.2 : 0.1));
        ctx.lineWidth = (touched ? 1.4 : 0.7) + weight * 1.1;
        ctx.stroke();
        if (!reduced) {
          const p = (T * (0.1 + weight * 0.14) + e * 0.3) % 1;
          ctx.beginPath();
          ctx.arc(a.x + (b.x - a.x) * p, a.y + (b.y - a.y) * p, touched ? 2.2 : 1.5, 0, 6.2832);
          ctx.fillStyle = hexA(live, touched ? 0.95 : 0.55); ctx.fill();
        }
      }

      for (let i = 0; i < nodes.length; i++) {
        const nd = nodes[i], pt = px(nd);
        const breathe = reduced ? 0 : Math.sin(T * 1.4 + i) * 0.5;
        const lit = !!(wave && wave.reach[i] !== undefined && wave.reach[i] <= waveFront);
        let col = nd.status === 'critical' ? crit : nd.status === 'warning' ? warn : live;
        if (lit) col = crit;
        const r = (nd.r ?? 5) + breathe + (lit ? 2 : 0) + (focused === i ? 2.4 : 0);
        const g = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, r * 4);
        g.addColorStop(0, hexA(col, lit ? 0.5 : 0.3)); g.addColorStop(1, hexA(col, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(pt.x, pt.y, r * 4, 0, 6.2832); ctx.fill();
        ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, 6.2832);
        ctx.fillStyle = lit ? col : hexA(col, 0.94); ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = hexA('#000000', 0.6); ctx.stroke();
        if (nd.label) {
          ctx.font = '10px "JetBrains Mono", ui-monospace, monospace';
          ctx.fillStyle = hexA(cssVar('--tk-text-2', '#94a3b8'), focused === i ? 1 : 0.85);
          ctx.textAlign = 'center';
          ctx.fillText(nd.label, pt.x, pt.y - r - 8);
        }
      }

      if (wave) {
        const src = px(nodes[wave.from]);
        const rr = (T - wave.t0) * 130;
        if (rr < Math.max(w, h)) {
          ctx.beginPath(); ctx.arc(src.x, src.y, rr, 0, 6.2832);
          ctx.strokeStyle = hexA(crit, Math.max(0, 0.5 - rr / Math.max(w, h))); ctx.lineWidth = 2; ctx.stroke();
        } else wave = null;
      }
    };

    const loop = (now: number) => {
      const minDelta = 1000 / (reduced ? 12 : 30);
      if (!last || now - last >= minDelta) {
        t += (now - (last || now)) / 1000;
        draw();
        last = now;
      }
      raf = requestAnimationFrame(loop);
    };

    const nodeAt = (mx: number, my: number) => {
      for (let i = 0; i < nodes.length; i++) {
        const p = px(nodes[i]); const rr = (nodes[i].r ?? 5) + 10;
        if ((p.x - mx) ** 2 + (p.y - my) ** 2 <= rr * rr) return i;
      }
      return -1;
    };
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const idx = nodeAt(e.clientX - r.left, e.clientY - r.top);
      if (idx !== focused) { focused = idx; if (reduced) draw(); }
    };
    const onLeave = () => { if (focused !== -1) { focused = -1; if (reduced) draw(); } };
    const onDown = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const idx = nodeAt(e.clientX - r.left, e.clientY - r.top);
      if (idx >= 0) propagate(idx);
    };

    fit();
    const onResize = () => { fit(); draw(); };
    window.addEventListener('resize', onResize);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('pointerdown', onDown);

    let shockTimer: ReturnType<typeof setInterval> | null = null;
    if (autoShock && !reduced && nodes.length > 1) {
      shockTimer = setInterval(() => propagate(Math.floor(Math.random() * nodes.length) || 0), 9000);
    }

    if (reduced) draw(); else loop(performance.now());

    return () => {
      cancelAnimationFrame(raf);
      if (shockTimer) clearInterval(shockTimer);
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('pointerdown', onDown);
    };
  }, [nodes, edges, autoShock]);

  return (
    <div className="tk-map" style={{ height }}>
      <canvas ref={canvasRef} className="tk-map__canvas" />
      <div className="tk-map__legend">
        <span><i style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--tk-live)', display: 'inline-block' }} /> route active</span>
        <span><i style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--tk-critical)', display: 'inline-block' }} /> shock</span>
      </div>
      <div className="tk-map__zoom">click a node → watch it propagate</div>
    </div>
  );
}
