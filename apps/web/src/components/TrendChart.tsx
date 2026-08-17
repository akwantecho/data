import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { MetricUnit, MetricValuePoint } from '@sip/shared-types';
import { formatMetricValue } from '../lib/format';

interface TrendChartProps {
  points: MetricValuePoint[];
  unit: MetricUnit;
  currencyCode: string;
  /** Drawn as a horizontal reference line when the metric has one. */
  target?: string | null;
  height?: number;
}

/**
 * One metric over time.
 *
 * The chart renders values the API calculated; it never derives them (plan §5.4).
 * Colours come from the design tokens rather than ECharts' defaults, so charts
 * match the rest of the product and stay readable in both themes.
 */
export function TrendChart({ points, unit, currencyCode, target, height = 260 }: TrendChartProps) {
  const option = useMemo(() => {
    const style = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) =>
      style.getPropertyValue(name).trim() || fallback;

    const accent = token('--color-accent', '#1f5f9e');
    const text = token('--color-text-muted', '#5b6672');
    const grid = token('--color-border', '#dfe3e8');

    return {
      // Animation off: an executive chart is read, not watched, and a static
      // render is also what makes a screenshot in a test deterministic.
      animation: false,
      grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'axis',
        valueFormatter: (value: number) => formatMetricValue(String(value), unit, currencyCode),
      },
      xAxis: {
        type: 'category',
        data: points.map((point) => point.periodStart),
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
      series: [
        {
          type: 'line',
          smooth: false,
          showSymbol: points.length <= 24,
          symbolSize: 6,
          data: points.map((point) => Number(point.value)),
          lineStyle: { color: accent, width: 2 },
          itemStyle: { color: accent },
          areaStyle: { color: accent, opacity: 0.08 },
          ...(target
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
        },
      ],
    };
  }, [points, unit, currencyCode, target]);

  if (points.length === 0) {
    return <p className="state">No values yet, so there is nothing to plot.</p>;
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
