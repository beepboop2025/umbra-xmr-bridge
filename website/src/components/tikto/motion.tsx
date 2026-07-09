'use client';

/** Scroll-reveal + number-roll primitives. Apple easing, reduced-motion safe. */
import { motion, type Variants } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

// Apple's signature decisive ease-out.
export const EASE = [0.16, 1, 0.3, 1] as const;

export function Reveal({
  children,
  delay = 0,
  y = 20,
  className,
  as = 'div',
}: {
  children: React.ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  as?: 'div' | 'section' | 'li' | 'span';
}) {
  const M = (motion as any)[as];
  return (
    <M
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-70px' }}
      transition={{ duration: 0.7, delay, ease: EASE }}
    >
      {children}
    </M>
  );
}

const staggerParent: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};
const staggerChild: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
};

export function Stagger({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={staggerParent} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-70px' }}>
      {children}
    </motion.div>
  );
}
export function StaggerItem({ children, className }: { children: React.ReactNode; className?: string }) {
  return <motion.div className={className} variants={staggerChild}>{children}</motion.div>;
}

/** Rolls a number only when it actually changes (motion = signal). */
export function NumberRoll({
  value,
  format,
  className,
  duration = 0.9,
}: {
  value: number;
  format?: (v: number) => string;
  className?: string;
  duration?: number;
}) {
  const [disp, setDisp] = useState(value);
  const fromRef = useRef(value);
  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const from = fromRef.current;
    const to = value;
    if (reduced || from === to) {
      setDisp(to);
      fromRef.current = to;
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      let k = Math.min(1, (now - t0) / (duration * 1000));
      k = 1 - Math.pow(1 - k, 3); // easeOutCubic
      setDisp(from + (to - from) * k);
      if (k < 1) raf = requestAnimationFrame(step);
      else fromRef.current = to;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span className={className}>{format ? format(disp) : disp.toFixed(2)}</span>;
}
