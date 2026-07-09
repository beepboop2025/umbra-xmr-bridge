'use client';

/**
 * Tiktó — the Tick (navigable time), ported to React.
 * Past = solid actuals, NOW = glowing line, future = a confidence cone that
 * widens with the horizon and you can scrub into (drag / ← →). Reduced-motion
 * safe; keyboard scrubbable.
 */
import { useEffect, useRef } from 'react';

function cssVar(name: string, fb: string) {
  if (typeof window === 'undefined') return fb;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb;
}
function hexA(hex: string, a: number) {
  let h = (hex || '#06d6e0').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function Tick({
  past,
  base,
  drift = -0.04,
  volatility = 1,
  height = 150,
  floor,
  onScrub,
}: {
  past?: number[];
  base?: number;
  drift?: number;
  volatility?: number;
  height?: number;
  floor?: number;
  onScrub?: (v: number, future: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({ playT: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let w = 0, h = 0, ctx: CanvasRenderingContext2D;

    let seed = past;
    if (!seed) {
      seed = [];
      let v = base ?? 1;
      for (let i = 0; i < 40; i++) { v += Math.sin(i * 0.5) * 0.008 + (i % 7 === 0 ? -0.01 : 0.002); seed.push(v); }
    }
    const b = base ?? seed[seed.length - 1];
    const lastV = seed[seed.length - 1];
    const shifted = seed.map((p) => p + (b - lastV));

    const bounds = () => {
      let min = Infinity, max = -Infinity;
      for (const v of shifted) { min = Math.min(min, v); max = Math.max(max, v); }
      for (let s = 0; s <= 24; s++) {
        const f = s / 24, mean = b + drift * b * f, spread = (0.01 + 0.1 * Math.sqrt(f)) * volatility * b;
        min = Math.min(min, mean - spread); max = Math.max(max, mean + spread);
      }
      if (floor != null) min = Math.min(min, floor);
      const pad = Math.max((max - min) * 0.12, b * 0.02);
      return { min: min - pad, max: max + pad };
    };
    const X = (t: number) => 20 + ((t + 1) / 2) * (w - 40);
    const Y = (v: number) => { const bd = bounds(); return h - 22 - ((v - bd.min) / (bd.max - bd.min)) * (h - 40); };

    const sample = () => {
      const pt = stateRef.current.playT;
      if (pt <= 0) {
        let idx = Math.round((shifted.length - 1) * (1 + pt));
        idx = Math.max(0, Math.min(shifted.length - 1, idx));
        return { value: shifted[idx], future: false };
      }
      const mean = b + drift * b * pt;
      return { value: mean, future: true };
    };

    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      const c = canvas.getContext('2d')!; c.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx = c; w = r.width; h = r.height;
    };

    const draw = () => {
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      const live = cssVar('--tk-live', '#06d6e0'), warn = cssVar('--tk-warning', '#ffb020'), crit = cssVar('--tk-critical', '#ff5b52');
      const nowX = X(0);

      if (floor != null) {
        const fy = Y(floor);
        ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(20, fy); ctx.lineTo(w - 20, fy);
        ctx.strokeStyle = hexA(crit, 0.5); ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
      }

      // past actuals
      ctx.beginPath();
      shifted.forEach((v, i) => { const x = X(-1 + i / (shifted.length - 1)), y = Y(v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.strokeStyle = hexA(cssVar('--tk-text-1', '#e2e8f0'), 0.85); ctx.lineWidth = 1.6; ctx.stroke();

      // future cone
      const steps = 48, top: number[][] = [], bot: number[][] = [];
      for (let s = 0; s <= steps; s++) {
        const f = s / steps, mean = b + drift * b * f, spread = (0.01 + 0.1 * Math.sqrt(f)) * volatility * b, x2 = X(f);
        top.push([x2, Y(mean + spread)]); bot.push([x2, Y(mean - spread)]);
      }
      ctx.beginPath(); ctx.moveTo(top[0][0], top[0][1]);
      top.slice(1).forEach((p) => ctx.lineTo(p[0], p[1]));
      for (let i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1]);
      ctx.closePath();
      const grad = ctx.createLinearGradient(nowX, 0, w, 0);
      grad.addColorStop(0, hexA(live, 0.32)); grad.addColorStop(1, hexA(live, 0.04));
      ctx.fillStyle = grad; ctx.fill();
      ctx.setLineDash([4, 3]); ctx.beginPath();
      for (let m = 0; m <= steps; m++) { const f = m / steps, x = X(f), y = Y(b + drift * b * f); m ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.strokeStyle = hexA(live, 0.8); ctx.lineWidth = 1.4; ctx.stroke(); ctx.setLineDash([]);

      // NOW
      ctx.beginPath(); ctx.moveTo(nowX, 8); ctx.lineTo(nowX, h - 16);
      ctx.strokeStyle = hexA(live, 0.9); ctx.lineWidth = 1.4; ctx.shadowColor = live; ctx.shadowBlur = 9; ctx.stroke(); ctx.shadowBlur = 0;
      ctx.font = '9px "JetBrains Mono", ui-monospace, monospace'; ctx.fillStyle = live; ctx.textAlign = 'center'; ctx.fillText('NOW', nowX, h - 3);

      // playhead
      const ph = X(stateRef.current.playT), samp = sample();
      ctx.beginPath(); ctx.moveTo(ph, 8); ctx.lineTo(ph, h - 16);
      ctx.strokeStyle = hexA(samp.future ? warn : cssVar('--tk-text-0', '#fff'), 0.9); ctx.lineWidth = 1.1; ctx.stroke();
      ctx.beginPath(); ctx.arc(ph, Y(samp.value), 5, 0, 6.2832);
      ctx.fillStyle = samp.future ? warn : cssVar('--tk-text-0', '#fff'); ctx.fill();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1.4; ctx.stroke();
      onScrub?.(samp.value, samp.future);
    };

    fit(); draw();
    const onResize = () => { fit(); draw(); };
    window.addEventListener('resize', onResize);

    let dragging = false;
    const setFromX = (clientX: number) => {
      const r = canvas.getBoundingClientRect();
      stateRef.current.playT = Math.max(-1, Math.min(1, ((clientX - r.left - 20) / (r.width - 40)) * 2 - 1));
      draw();
    };
    const down = (e: PointerEvent) => { dragging = true; canvas.setPointerCapture(e.pointerId); setFromX(e.clientX); };
    const move = (e: PointerEvent) => { if (dragging) setFromX(e.clientX); };
    const upFn = () => { dragging = false; };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') { stateRef.current.playT = Math.min(1, stateRef.current.playT + 0.05); draw(); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { stateRef.current.playT = Math.max(-1, stateRef.current.playT - 0.05); draw(); e.preventDefault(); }
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', upFn);
    canvas.addEventListener('keydown', key);
    canvas.tabIndex = 0;

    return () => {
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', upFn);
      canvas.removeEventListener('keydown', key);
    };
  }, [past, base, drift, volatility, floor, onScrub]);

  return (
    <div className="tk-tick">
      <canvas ref={canvasRef} className="tk-tick__canvas" style={{ height }} />
      <div className="tk-tick__axis"><span>−past</span><span>now</span><span>+horizon</span></div>
    </div>
  );
}
