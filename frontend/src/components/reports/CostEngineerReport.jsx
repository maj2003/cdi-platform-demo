// ---------------------------------------------------------------------------
// src/components/reports/CostEngineerReport.jsx
//
// Where the money is: cost by sub-assembly, by material, by cost type, and the
// parts driving the total.
//
// Every figure is read straight off the payload. Nothing is summed here.
// ---------------------------------------------------------------------------

import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import ChartCard from './ChartCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { colorAt, sliceColor, topNWithOther, truncateLabel } from '@/lib/chartData';
import { formatCurrency } from '@/lib/format';

export default function CostEngineerReport({ payload }) {
  const currency = payload.currency;
  const money = (v) => formatCurrency(v, currency);

  const bySubAssembly = payload.bySubAssembly ?? [];
  const byCostType = payload.byCostType ?? [];
  const topDrivers = payload.topDrivers ?? [];

  const materialSlices = topNWithOther(payload.byMaterial ?? [], 'cost', 'material');

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Totals</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            ['Total cost', money(payload.totals.totalCost)],
            ['Part lines', payload.totals.partLines],
            ['Part units', payload.totals.partUnits],
            // Surfaced deliberately — a total computed over a partially costed
            // teardown is still useful, but only if the reader knows it's partial.
            ['Uncosted lines', payload.totals.uncostedPartLines],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
              <span className="text-lg font-semibold tabular-nums">{value}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Cost by sub-assembly"
          description="Where the spend concentrates"
          isEmpty={bySubAssembly.length === 0}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bySubAssembly} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <XAxis
                dataKey="name"
                tickFormatter={(v) => truncateLabel(v, 14)}
                fontSize={11}
                interval={0}
              />
              <YAxis fontSize={11} width={56} tickFormatter={(v) => money(v)} />
              <Tooltip formatter={(v) => money(v)} />
              <Bar dataKey="cost" radius={[4, 4, 0, 0]}>
                {bySubAssembly.map((row, i) => (
                  <Cell key={row.subAssemblyId} fill={colorAt(i)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Cost by material"
          description="Top materials; the long tail is grouped"
          isEmpty={materialSlices.length === 0}
        >
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={materialSlices}
                dataKey="value"
                nameKey="label"
                innerRadius="45%"
                outerRadius="75%"
                paddingAngle={2}
              >
                {materialSlices.map((slice, i) => (
                  <Cell key={slice.label} fill={sliceColor(slice.label, i)} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => money(v)} />
              <Legend
                verticalAlign="bottom"
                height={48}
                wrapperStyle={{ fontSize: 11, lineHeight: '16px' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <ChartCard
        title="Material vs process vs labour"
        description="Is this product expensive because of what it's made of, or how it's assembled?"
        height={180}
        isEmpty={byCostType.length === 0}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={byCostType}
            layout="vertical"
            margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
          >
            <XAxis type="number" fontSize={11} tickFormatter={(v) => money(v)} />
            <YAxis type="category" dataKey="type" width={72} fontSize={11} />
            <Tooltip formatter={(v) => money(v)} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]}>
              {byCostType.map((row, i) => (
                <Cell key={row.type} fill={colorAt(i)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Top cost drivers</CardTitle>
          <p className="text-xs text-muted-foreground">
            Extended cost — unit price × quantity in the product
          </p>
        </CardHeader>
        <CardContent>
          {topDrivers.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No costed parts yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Part</TableHead>
                  <TableHead>Sub-assembly</TableHead>
                  <TableHead>Material</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit</TableHead>
                  <TableHead className="text-right">Extended</TableHead>
                  <TableHead className="text-right">Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topDrivers.map((row) => (
                  <TableRow key={row.partId}>
                    <TableCell className="font-medium">{row.partName}</TableCell>
                    <TableCell className="text-muted-foreground">{row.subAssemblyName}</TableCell>
                    <TableCell className="text-muted-foreground">{row.material}</TableCell>
                    <TableCell className="text-right tabular-nums">×{row.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(row.unitCost)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {money(row.extendedCost)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.sharePct}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}