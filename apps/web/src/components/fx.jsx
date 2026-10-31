// Adapted from Magic UI, React Bits and Aceternity UI (all MIT).
import { forwardRef, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useInView, useMotionValue, useSpring } from 'framer-motion';
import { cn } from '@/lib/utils';

/** Children are rendered `repeat` times so the loop is seamless. */
export function Marquee({ children, repeat = 4, duration = 40, pauseOnHover = true, reverse = false, className }) {
  return (
    <div
      className={cn('group flex overflow-hidden [--gap:1rem] [gap:var(--gap)]', className)}
      style={{ '--duration': `${duration}s` }}
    >
      {Array.from({ length: repeat }, (_, i) => (
        <div
          key={i}
          aria-hidden={i > 0}
          className={cn(
            'flex shrink-0 animate-marquee items-center justify-around [gap:var(--gap)]',
            pauseOnHover && 'group-hover:[animation-play-state:paused]',
            reverse && '[animation-direction:reverse]',
          )}
        >
          {children}
        </div>
      ))}
    </div>
  );
}

export function NumberTicker({ value, format = (n) => Math.round(n).toLocaleString('en-IN'), className }) {
  const ref = useRef(null);
  const motionValue = useMotionValue(value);
  const spring = useSpring(motionValue, { damping: 40, stiffness: 300 });
  useEffect(() => {
    motionValue.set(value);
  }, [motionValue, value]);
  useEffect(
    () =>
      spring.on('change', (v) => {
        if (ref.current) ref.current.textContent = format(Math.round(v));
      }),
    [spring, format],
  );
  return (
    <span ref={ref} className={cn('num inline-block tabular-nums', className)}>
      {format(value)}
    </span>
  );
}

/** Parent must be relative and rounded. */
export function BorderBeam({ size = 180, duration = 9, delay = 0, from = '#34d399', to = '#facc15', className }) {
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 rounded-[inherit] [border:calc(var(--bw)*1px)_solid_transparent]',
        '![mask-clip:padding-box,border-box] ![mask-composite:intersect] [mask:linear-gradient(transparent,transparent),linear-gradient(white,white)]',
        'after:absolute after:aspect-square after:w-[calc(var(--size)*1px)] after:animate-border-beam after:[animation-delay:var(--delay)]',
        'after:[background:linear-gradient(to_left,var(--from),var(--to),transparent)] after:[offset-anchor:90%_50%]',
        'after:[offset-path:rect(0_auto_auto_0_round_calc(var(--size)*1px))]',
        className,
      )}
      style={{ '--size': size, '--duration': duration, '--delay': `-${delay}s`, '--from': from, '--to': to, '--bw': 1.5 }}
    />
  );
}

export const ShimmerButton = forwardRef(({ children, className, background = 'hsl(var(--primary))', as: Comp = 'button', ...props }, ref) => (
  <Comp
    ref={ref}
    style={{ '--spread': '90deg', '--shimmer': 'rgba(255,255,255,0.9)', '--radius': '999px', '--speed': '3s', '--cut': '0.08em', '--bg': background }}
    className={cn(
      'group relative z-0 inline-flex cursor-pointer items-center justify-center gap-2 overflow-hidden whitespace-nowrap px-6 py-3 font-bold text-white',
      '[background:var(--bg)] [border-radius:var(--radius)] transition-transform duration-300 active:translate-y-px',
      className,
    )}
    {...props}
  >
    <div className="absolute inset-0 -z-30 overflow-visible blur-[2px] [container-type:size]">
      <div className="absolute inset-0 h-[100cqh] animate-shimmer-slide [aspect-ratio:1] [border-radius:0] [mask:none]">
        <div className="absolute -inset-full w-auto rotate-0 animate-spin-around [background:conic-gradient(from_calc(270deg-(var(--spread)*0.5)),transparent_0,var(--shimmer)_var(--spread),transparent_var(--spread))] [translate:0_0]" />
      </div>
    </div>
    <span className="relative z-10 inline-flex items-center gap-2">{children}</span>
    <div className="absolute inset-0 rounded-[var(--radius)] shadow-[inset_0_-8px_10px_#ffffff1f] transition-all duration-300 group-hover:shadow-[inset_0_-6px_10px_#ffffff3f]" />
    <div className="absolute -z-20 rounded-[var(--radius)] [background:var(--bg)] [inset:var(--cut)]" />
  </Comp>
));
ShimmerButton.displayName = 'ShimmerButton';

export function BlurFade({ children, delay = 0, y = 12, className, as = 'div' }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const Comp = motion[as] ?? motion.div;
  return (
    <Comp
      ref={ref}
      className={className}
      initial={{ opacity: 0, y, filter: 'blur(6px)' }}
      animate={inView ? { opacity: 1, y: 0, filter: 'blur(0px)' } : undefined}
      transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </Comp>
  );
}

export function RotatingText({ words, interval = 2200, className }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % words.length), interval);
    return () => clearInterval(t);
  }, [words.length, interval]);
  return (
    <span className={cn('relative inline-flex overflow-hidden align-bottom', className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={words[i]}
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '-100%', opacity: 0 }}
          transition={{ type: 'spring', damping: 26, stiffness: 320 }}
          className="inline-block whitespace-nowrap"
        >
          {words[i]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function ShinyText({ children, className }) {
  return (
    <span
      className={cn(
        'animate-shine bg-[length:200%_100%] bg-clip-text text-transparent',
        '[background-image:linear-gradient(110deg,currentColor_35%,rgba(255,255,255,0.95)_50%,currentColor_65%)] [-webkit-text-fill-color:transparent]',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function SpotlightCard({ children, className, color = 'rgba(255,255,255,0.22)', ...props }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  return (
    <div
      ref={ref}
      onMouseMove={(e) => {
        const r = ref.current.getBoundingClientRect();
        setPos({ x: e.clientX - r.left, y: e.clientY - r.top });
      }}
      onMouseLeave={() => setPos(null)}
      className={cn('relative overflow-hidden', className)}
      {...props}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 transition-opacity duration-300"
        style={{ opacity: pos ? 1 : 0, background: pos ? `radial-gradient(260px circle at ${pos.x}px ${pos.y}px, ${color}, transparent 70%)` : undefined }}
      />
      {children}
    </div>
  );
}
