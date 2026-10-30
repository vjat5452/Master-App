// Material UI widgets. Import these through ./lazy.jsx, not directly, so MUI loads on demand.
import Slider from '@mui/material/Slider';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import Stepper from '@mui/material/Stepper';
import { BarChart } from '@mui/x-charts/BarChart';
import { LineChart } from '@mui/x-charts/LineChart';
import { PieChart } from '@mui/x-charts/PieChart';
import { CHART_COLORS, MuiScope } from './MuiScope.jsx';

const legend = { direction: 'row', position: { vertical: 'bottom', horizontal: 'middle' }, padding: 0, itemMarkWidth: 10, itemMarkHeight: 10, labelStyle: { fontSize: 12 } };

/** Stacked bars: one category per x value, one series per stack part. */
export function StackedBars({ categories, series, height = 260 }) {
  return (
    <MuiScope>
      <BarChart
        height={height}
        borderRadius={6}
        margin={{ top: 16, right: 12, bottom: 64, left: 44 }}
        xAxis={[{ scaleType: 'band', data: categories, categoryGapRatio: 0.45 }]}
        series={series.map((s, i) => ({ stack: 'total', color: CHART_COLORS[i], ...s }))}
        slotProps={{ legend }}
        grid={{ horizontal: true }}
      />
    </MuiScope>
  );
}

/** Donut with a centred total label. */
export function Donut({ data, height = 230, centerLabel }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <MuiScope>
      <div className="relative">
        <PieChart
          height={height}
          margin={{ top: 8, bottom: 48, left: 8, right: 8 }}
          series={[
            {
              data: data.map((d, i) => ({ id: d.label, color: CHART_COLORS[i], ...d })),
              innerRadius: 62,
              outerRadius: 92,
              // A gap next to an empty slice reads as a notch in a full ring.
              paddingAngle: data.every((d) => d.value > 0) ? 2 : 0,
              cornerRadius: 6,
              cx: '50%',
              highlightScope: { fade: 'global', highlight: 'item' },
            },
          ]}
          slotProps={{ legend }}
        />
        <div className="pointer-events-none absolute inset-x-0 top-[calc(50%-24px-14px)] text-center">
          <div className="num text-2xl font-extrabold">{total}</div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{centerLabel}</div>
        </div>
      </div>
    </MuiScope>
  );
}

/** Area line over ordered x labels. */
export function AreaLine({ labels, values, label, height = 220, format }) {
  return (
    <MuiScope>
      <LineChart
        height={height}
        margin={{ top: 16, right: 16, bottom: 28, left: 56 }}
        xAxis={[{ scaleType: 'point', data: labels }]}
        yAxis={[{ valueFormatter: format }]}
        series={[{ data: values, label, area: true, showMark: true, color: CHART_COLORS[0], curve: 'monotoneX', valueFormatter: format }]}
        slotProps={{ legend: { hidden: true } }}
        grid={{ horizontal: true }}
        sx={{ '& .MuiAreaElement-root': { fillOpacity: 0.18 } }}
      />
    </MuiScope>
  );
}

/**
 * Several price lines over the same dates. `series`: [{ label, values (null = no data) }].
 * Gaps stay gaps: missing days are never joined up or filled in.
 */
export function PriceLines({ dates, series, height = 240, format }) {
  return (
    <MuiScope>
      <LineChart
        height={height}
        margin={{ top: 16, right: 16, bottom: 56, left: 60 }}
        xAxis={[{ scaleType: 'point', data: dates }]}
        yAxis={[{ valueFormatter: format }]}
        series={series.map((s, i) => ({
          data: s.values,
          label: s.label,
          color: CHART_COLORS[i % CHART_COLORS.length],
          curve: 'stepAfter',
          showMark: ({ index }) => s.values[index] !== null && (index === 0 || s.values[index - 1] !== s.values[index]),
          connectNulls: false,
          valueFormatter: (v) => (v == null ? 'no data' : format(v)),
        }))}
        slotProps={{ legend }}
        grid={{ horizontal: true }}
      />
    </MuiScope>
  );
}

/** Order progress. `steps`: [{ label, caption?, error? }], `active`: index of the current step. */
export function ProgressStepper({ steps, active }) {
  return (
    <MuiScope>
      <Stepper activeStep={active} alternativeLabel>
        {steps.map((s) => (
          <Step key={s.label} completed={s.done}>
            <StepLabel error={s.error} optional={s.caption ? <span className="text-xs text-muted-foreground">{s.caption}</span> : undefined}>
              <span className="text-sm font-semibold">{s.label}</span>
            </StepLabel>
          </Step>
        ))}
      </Stepper>
    </MuiScope>
  );
}

/** `onChange` fires while dragging; `onCommit` once the thumb is released (use it to fetch). */
export function RangeSlider({ value, onChange, onCommit, min, max, step, marks, format }) {
  return (
    <MuiScope>
      <Slider
        value={value}
        min={min}
        max={max}
        step={step}
        marks={marks}
        valueLabelDisplay="auto"
        valueLabelFormat={format}
        onChange={(_, v) => onChange(v)}
        onChangeCommitted={(_, v) => onCommit?.(v)}
        sx={{ '& .MuiSlider-markLabel': { fontSize: 11 } }}
      />
    </MuiScope>
  );
}
