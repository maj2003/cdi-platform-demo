// ---------------------------------------------------------------------------
// src/pages/AiBomParsePage.jsx — route /products/:id/ai-parse
//
// Demonstrates the "Processing + AI Layer" from CONTEXT.md: paste a raw BOM
// description (a spec sheet excerpt, a supplier parts list) and get back
// classified parts with material, category and a confidence score.
//
// aiService.parseBOM is a stub today — canned results, an artificial delay —
// but the call shape here (rawText in, {parts, summary} out) is exactly what
// a real Azure OpenAI request will look like, so only lib/api.js's request
// body changes when that swap happens.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Sparkles } from 'lucide-react';

import api from '@/lib/api';
import { useApi, useApiAction } from '@/lib/useApi';
import ProductSubNav from '@/components/ProductSubNav';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

const SAMPLE_PLACEHOLDER = `Paste a parts list or spec-sheet excerpt, e.g.:

1. Cross-flow fan barrel, moulded plastic
2. Fan motor assembly
3. Evaporator coil, copper/aluminium
4. Main control PCB
5. Front panel`;

/** Confidence -> Badge variant. Thresholds are presentation only, not a model output. */
function confidenceVariant(confidence) {
  if (confidence >= 0.9) return 'secondary';
  if (confidence >= 0.75) return 'outline';
  return 'destructive';
}

export default function AiBomParsePage() {
  const { id } = useParams();

  const { data: product, loading, error, refetch } = useApi(
    ({ signal }) => api.products.get(id, { signal }),
    [id],
  );

  const [rawText, setRawText] = useState('');
  const parse = useApiAction((body) => api.ai.parseBom(body));

  const canSubmit = rawText.trim().length > 0 && !parse.loading;

  async function handleParse() {
    if (!canSubmit) return;
    try {
      await parse.run({ rawText });
    } catch {
      // parse.error renders below.
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>
          {error.status === 404
            ? 'Product not found'
            : error.isNetworkError
              ? 'Cannot reach the API'
              : 'Could not load product'}
        </AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{error.message}</p>
          <div className="flex gap-2">
            {error.status !== 404 && (
              <Button variant="outline" size="sm" onClick={refetch}>
                Try again
              </Button>
            )}
            <Button asChild variant="outline" size="sm">
              <Link to={error.status === 404 ? '/products' : `/products/${id}`}>
                {error.status === 404 ? 'All products' : 'Back to teardown'}
              </Link>
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  const result = parse.data;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to="/products">
            <ArrowLeft className="mr-1 size-4" />
            All products
          </Link>
        </Button>
        <div>
          <h2 className="text-xl font-semibold tracking-tight">AI BOM Parse — {product.name}</h2>
          <p className="text-sm text-muted-foreground">
            Paste a raw parts list and classify it into parts, materials and categories. Stubbed
            for this build — canned, realistic output standing in for a real model call.
          </p>
        </div>
        <ProductSubNav productId={id} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Input</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder={SAMPLE_PLACEHOLDER}
            className="min-h-40 font-mono text-sm"
          />
          <div className="flex items-center gap-3">
            <Button size="sm" disabled={!canSubmit} onClick={handleParse}>
              <Sparkles className="mr-1.5 size-4" />
              {parse.loading ? 'Parsing…' : 'Parse with AI'}
            </Button>
            {parse.loading && (
              <span className="text-sm text-muted-foreground">Classifying parts…</span>
            )}
          </div>

          {parse.error && (
            <Alert variant="destructive">
              <AlertTitle>Parsing failed</AlertTitle>
              <AlertDescription>{parse.error.message}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Results</CardTitle>
            <p className="text-sm text-muted-foreground">{result.summary}</p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Part</TableHead>
                  <TableHead>Material</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Confidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.parts.map((part) => (
                  <TableRow key={part.name}>
                    <TableCell className="font-medium">{part.name}</TableCell>
                    <TableCell className="text-muted-foreground">{part.material}</TableCell>
                    <TableCell className="text-muted-foreground">{part.category}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={confidenceVariant(part.confidence)}>
                        {Math.round(part.confidence * 100)}%
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
