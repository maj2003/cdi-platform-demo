// ---------------------------------------------------------------------------
// src/components/reports/ExecutiveReport.jsx
//
// Four numbers, one chart, four sentences.
//
// The restraint is the design. The backend builds this view by reusing the cost
// and design builders rather than recomputing, so these figures cannot disagree
// with the other two tabs — which matters because this is the tab people
// screenshot.
// ---------------------------------------------------------------------------

import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import ChartCard from './ChartCard';
import { Card, CardContent } from '@/components/ui/card';
import { colorAt, truncateLabel } from '@/lib/chartData';
import { formatCount, formatCurrency, formatWeight } from '@/lib/format';

function HeadlineStat({ label, value, hint }) {
  return (
    <Card>
      <CardContent className="space-y-1 py-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export default function ExecutiveReport({ payload }) {
  const { headline, headlineChart, keyPoints = [] } = payload;
  const currency = payload.currency;
  const chartData = headlineChart?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <HeadlineStat label="Total cost" value={formatCurrency(headline.totalCost, currency)} />
        <HeadlineStat label="Total weight" value={formatWeight(headline.totalWeightKg)} />
        <HeadlineStat label="Part units" value={formatCount(headline.partUnits)} />
        <HeadlineStat
          label="Cost per kg"
          value={formatCurrency(headline.costPerKg, currency)}
          // Worth spelling out: this is the only derived ratio in the whole
          // backend, and it exists so units of different sizes can be compared
          // without pretending they're the same product.
          hint="Normalises across unit sizes"
        />
      </div>

      <ChartCard
        title={headlineChart?.title ?? 'Cost by sub-assembly'}
        description="The one chart for this view"
        height={300}
        isEmpty={chartData.length === 0}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <XAxis
              dataKey="label"
              tickFormatter={(v) => truncateLabel(v, 16)}
              fontSize={11}
              interval={0}
            />
            <YAxis
              fontSize={11}
              width={64}
              tickFormatter={(v) => formatCurrency(v, currency)}
            />
            <Tooltip formatter={(v) => formatCurrency(v, currency)} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {chartData.map((row, i) => (
                <Cell key={row.label} fill={colorAt(i)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <Card>
        <CardContent className="py-6">
          <p className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">Key points</p>
          <ul className="space-y-2">
            {keyPoints.map((point) => (
              <li key={point} className="flex gap-2 text-sm">
                <span aria-hidden className="text-muted-foreground">
                  •
                </span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}