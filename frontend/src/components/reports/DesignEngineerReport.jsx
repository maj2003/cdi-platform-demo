// ---------------------------------------------------------------------------
// src/components/reports/DesignEngineerReport.jsx
//
// Mass, materials, dimensions and part count (numerosity).
//
// Note what is NOT here: density. The backend reports a bounding-box envelope
// volume but deliberately never divides weight by it, because these are moulded
// shells and finned coils — mostly air. A density figure would look
// authoritative and mean nothing, so it isn't offered here either.
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
import { formatGrams, formatMm, formatWeight } from '@/lib/format';

export default function DesignEngineerReport({ payload }) {
  const bySubAssembly = payload.bySubAssembly ?? [];
  const heaviest = payload.heaviestParts ?? [];
  const envelope = payload.largestPartEnvelopeMm;

  const materialSlices = topNWithOther(payload.byMaterial ?? [], 'weightG', 'material');

  // Part count per sub-assembly. Lines and units are different questions —
  // "how many distinct components to source" vs "how many pieces to fit" — so
  // both are plotted rather than picking one and hoping nobody asks.
  const countData = bySubAssembly.map((row) => ({
    name: row.name,
    lines: row.partLines,
    units: row.partUnits,
  }));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Totals</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {[
            ['Total weight', formatWeight(payload.totals.totalWeightKg)],
            ['Part lines', payload.totals.partLines],
            ['Part units', payload.totals.partUnits],
            ['Materials', payload.totals.distinctMaterials],
            ['Sub-assemblies', payload.totals.subAssemblies],
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
          title="Weight by sub-assembly"
          description="Where the mass sits"
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
              <YAxis fontSize={11} width={60} tickFormatter={(v) => `${v} g`} />
              <Tooltip formatter={(v) => formatGrams(v)} />
              <Bar dataKey="weightG" radius={[4, 4, 0, 0]}>
                {bySubAssembly.map((row, i) => (
                  <Cell key={row.subAssemblyId} fill={colorAt(i)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Weight by material"
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
              <Tooltip formatter={(v) => formatGrams(v)} />
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
        title="Part count by sub-assembly"
        description="Distinct lines vs total physical units"
        isEmpty={countData.length === 0}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={countData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <XAxis
              dataKey="name"
              tickFormatter={(v) => truncateLabel(v, 16)}
              fontSize={11}
              interval={0}
            />
            <YAxis fontSize={11} width={32} allowDecimals={false} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="lines" name="Part lines" fill={colorAt(0)} radius={[4, 4, 0, 0]} />
            <Bar dataKey="units" name="Part units" fill={colorAt(1)} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Heaviest parts</CardTitle>
            <p className="text-xs text-muted-foreground">Extended weight — unit mass × quantity</p>
          </CardHeader>
          <CardContent>
            {heaviest.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No parts recorded.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Part</TableHead>
                    <TableHead>Material</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit</TableHead>
                    <TableHead className="text-right">Extended</TableHead>
                    <TableHead className="text-right">Share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {heaviest.map((row) => (
                    <TableRow key={row.partId}>
                      <TableCell className="font-medium">{row.partName}</TableCell>
                      <TableCell className="text-muted-foreground">{row.material}</TableCell>
                      <TableCell className="text-right tabular-nums">×{row.quantity}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatGrams(row.unitWeightG)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatGrams(row.extendedWeightG)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.sharePct}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Largest part envelope</CardTitle>
            <p className="text-xs text-muted-foreground">
              Biggest single part on each axis — not the assembled unit, which nobody measured
            </p>
          </CardHeader>
          <CardContent>
            {envelope ? (
              <dl className="space-y-2 text-sm">
                {[
                  ['Length', envelope.maxLengthMm],
                  ['Width', envelope.maxWidthMm],
                  ['Height', envelope.maxHeightMm],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-medium tabular-nums">{formatMm(value)} mm</dd>
                  </div>
                ))}
                <div className="flex items-baseline justify-between border-t pt-2">
                  <dt className="text-muted-foreground">Dimensioned lines</dt>
                  <dd className="font-medium tabular-nums">
                    {payload.totals.dimensionedPartLines} / {payload.totals.partLines}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No dimensioned parts yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}