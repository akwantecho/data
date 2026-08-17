import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { MetricUnit, SeriesPoint } from '@sip/shared-types';
import { formatMetricValue } from '../lib/format';

export interface ChartSeries {
  name: string;
  points: SeriesPoint[];
  /** Drawn dashed and dimmed — used for the preceding window. */
  muted?: boolean;
  /**
   * Plot this series against the first series' positions rather than its own
   * dates. A previous-period line belongs beside the period it is compared with,
   * not a year to the left of it.
   */
  alignByIndex?: boolean;
}

interface SeriesChartProps {
  series: ChartSeries[];
  unit: MetricUnit;
  currencyCode: string;
  target?: string | null;
  height?: number;
  type?: 'line' | 'bar';
}

/**
 * Several series on one pair of axes: this window against the last, or one metric
 * across branches (plan §22 `ComparisonChart`).
 *
 * Every value comes from the API already aggregated; the chart plots and never
 * derives (plan §5.4). Colours are read from the design tokens so charts match the
 * rest of the product rather than ECharts' defaults.
 */
export function SeriesChart({
  series,
  unit,
  currencyCode,
  target,
  height = 280,
  type = 'line',
}: SeriesChartProps) {
  const option = useMemo(() => {
    const style = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) =>
      style.getPropertyValue(name).trim() || fallback;

    const text = token('--color-text-muted', '#5b6672');
    const grid = token('--color-border', '#dfe3e8');
    const palette = [
      token('--color-accent', '#1f5f9e'),
      token('--color-positive', '#1f7a4d'),
      token('--color-negative', '#a52a2a'),
      token('--color-warning', '#946200'),
      text,
    ];

    // The axis is the union of the periods of every series plotted on its own
    // dates; index-aligned series borrow those positions.
    const categories = [
      ...new Set(
        series
          .filter((entry) => !entry.alignByIndex)
          .flatMap((entry) => entry.points.map((point) => point.periodStart)),
      ),
    ].sort();

    return {
      // Animation off: an executive chart is read, not watched, and a static
      // render is also what makes a screenshot in a test deterministic.
      animation: false,
      grid: { left: 8, right: 16, top: 32, bottom: 8, containLabel: true },
      legend:
        series.length > 1
          ? { top: 0, textStyle: { color: text, fontSize: 11 }, icon: 'roundRect' }
          : undefined,
      tooltip: {
        trigger: 'axis',
        valueFormatter: (value: number) =>
          value === null || value === undefined
            ? '—'
            : formatMetricValue(String(value), unit, currencyCode),
      },
      xAxis: {
        type: 'category',
        data: categories,
        axisLine: { lineStyle: { color: grid } },
        axisLabel: { color: text, fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: grid, type: 'dashed' } },
        axisLabel: {
          color: text,
          fontSize: 11,
          formatter: (value: number) => formatMetricValue(String(value), unit, currencyCode, true),
        },
      },
      series: series.map((entry, index) => {
        const colour = palette[index % palette.length];
        const byPeriod = new Map(entry.points.map((point) => [point.periodStart, point.value]));

        return {
          name: entry.name,
          type,
          smooth: false,
          showSymbol: categories.length <= 24,
          symbolSize: 6,
          connectNulls: false,
          data: entry.alignByIndex
            ? categories.map((_, position) => {
                const point = entry.points[position];
                return point === undefined ? null : Number(point.value);
              })
            : categories.map((period) => {
                const value = byPeriod.get(period);
                return value === undefined ? null : Number(value);
              }),
          lineStyle: {
            color: colour,
            width: entry.muted ? 1.5 : 2,
            type: entry.muted ? 'dashed' : 'solid',
            opacity: entry.muted ? 0.7 : 1,
          },
          itemStyle: { color: colour, opacity: entry.muted ? 0.7 : 1 },
          ...(series.length === 1 && type === 'line'
            ? { areaStyle: { color: colour, opacity: 0.08 } }
            : {}),
          ...(index === 0 && target
            ? {
                markLine: {
                  silent: true,
                  symbol: 'none',
                  label: {
                    formatter: 'Target',
                    position: 'insideStartTop',
                    color: text,
                    fontSize: 11,
                  },
                  lineStyle: { color: text, type: 'dashed' },
                  data: [{ yAxis: Number(target) }],
                },
              }
            : {}),
        };
      }),
    };
  }, [series, unit, currencyCode, target, type]);

  if (series.every((entry) => entry.points.length === 0)) {
    return <p className="state">No values in this range, so there is nothing to plot.</p>;
  }

  return (
    <ReactECharts
      option={option}
      style={{ height, width: '100%' }}
      opts={{ renderer: 'svg' }}
      notMerge
    />
  );
}
