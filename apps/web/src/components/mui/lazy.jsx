import { lazy, Suspense } from 'react';
import { Skeleton } from '@/components/ui/misc';

const load = () => import('./widgets.jsx');
const pick = (name) => lazy(() => load().then((m) => ({ default: m[name] })));

const LazyStackedBars = pick('StackedBars');
const LazyDonut = pick('Donut');
const LazyAreaLine = pick('AreaLine');
const LazyProgressStepper = pick('ProgressStepper');
const LazyRangeSlider = pick('RangeSlider');

const wrap = (Comp, fallbackHeight) =>
  function Lazy(props) {
    return (
      <Suspense fallback={<Skeleton style={{ height: props.height ?? fallbackHeight }} className="w-full" />}>
        <Comp {...props} />
      </Suspense>
    );
  };

export const StackedBars = wrap(LazyStackedBars, 260);
export const Donut = wrap(LazyDonut, 230);
export const AreaLine = wrap(LazyAreaLine, 220);
export const ProgressStepper = wrap(LazyProgressStepper, 72);
export const RangeSlider = wrap(LazyRangeSlider, 40);
