// ---------------------------------------------------------------------------
// src/components/reports/ChartCard.jsx
//
// A titled frame with a fixed-height chart area.
//
// The fixed height is not cosmetic. Recharts' ResponsiveContainer measures its
// parent, and a parent whose height is derived from its children is a circular
// dependency — the chart resolves to zero height and renders nothing. Giving
// the wrapper an explicit height is what makes ResponsiveContainer work at all.
// ---------------------------------------------------------------------------

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * @param {object} props
 * @param {string} props.title
 * @param {string} [props.description]
 * @param {number} [props.height=280]
 * @param {boolean} [props.isEmpty]        render the empty message instead
 * @param {string} [props.emptyMessage]
 */
export default function ChartCard({
  title,
  description,
  height = 280,
  isEmpty = false,
  emptyMessage = 'No data to chart.',
  children,
  className,
}) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          // An explicit message rather than an empty box: a blank chart area
          // reads as a rendering failure, and someone will spend ten minutes
          // debugging it before realising there was simply nothing to plot.
          <div
            className="flex items-center justify-center text-sm text-muted-foreground"
            style={{ height }}
          >
            {emptyMessage}
          </div>
        ) : (
          <div style={{ height }} data-testid="chart-area">
            {children}
          </div>
        )}
      </CardContent>
    </Card>
  );
}