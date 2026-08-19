// ---------------------------------------------------------------------------
// src/pages/AskPage.jsx — route /intelligence/ask
//
// "Ask the Competitive Intelligence Engine": type a question, get an answer
// built from the live benchmark data.
//
// ---------------------------------------------------------------------------
// LOOKS LIKE AN AI SURFACE, ISN'T ONE — AND SAYS SO
//
// The layout is deliberately Copilot-shaped (prompt box, example chips, a single
// answer panel) because that's the interaction stakeholders asked for. The
// answers are produced by a rule-based router on the backend
// (services/askService.js), not a model: same question, same answer, every time,
// and no figure that isn't read from the database.
//
// That's a feature worth stating rather than hiding, so the card carries a
// "Deterministic — no model" badge. A prompt box that looks like a chatbot but
// only handles eight question shapes will otherwise be tried with a ninth, and
// the user needs to know why it declined rather than assuming the model is weak.
//
// NOTHING IS COMPUTED HERE. The page renders `headline`, `stats`, `table`,
// `narrative`, `notes` and `sources` exactly as the service returns them. Even
// the example questions come from the backend, so they cannot drift out of sync
// with the question shapes the parser actually handles.
// ---------------------------------------------------------------------------

import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CornerDownLeft, Sparkles } from 'lucide-react';

import api from '@/lib/api';
import { useApi, useApiAction } from '@/lib/useApi';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/** Shown only if the examples request fails — the box stays usable either way. */
const FALLBACK_EXAMPLES = ['Which product is the cheapest?', 'Generate an executive summary'];

/** The three animated dots of a "thinking" state. */
function Thinking() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Sparkles className="size-4 animate-pulse" aria-hidden />
        Reading the benchmark data…
      </div>
      <Skeleton className="h-6 w-2/3" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
      <Skeleton className="h-24" />
    </div>
  );
}

/** The answer panel. Pure rendering of the service payload. */
function Answer({ answer, onAsk }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={answer.understood ? 'default' : 'outline'}>
          {answer.understood ? 'Answer' : 'Not understood'}
        </Badge>
        <span className="text-xs text-muted-foreground">
          asked: &ldquo;{answer.question}&rdquo;
        </span>
      </div>

      <p className="text-base font-semibold leading-snug">{answer.headline}</p>

      {answer.stats.length > 0 && (
        <dl className="grid grid-cols-2 gap-4 border-t pt-4 sm:grid-cols-4">
          {answer.stats.map((stat) => (
            <div key={stat.label} className="space-y-1">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                {stat.label}
              </dt>
              <dd className="text-lg font-semibold tabular-nums">{stat.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {answer.narrative.length > 0 && (
        <div className="space-y-2 border-t pt-4">
          {answer.narrative.map((line) => (
            <p key={line} className="text-sm leading-relaxed text-muted-foreground">
              {line}
            </p>
          ))}
        </div>
      )}

      {answer.table && (
        <div className="overflow-x-auto border-t pt-4">
          <Table>
            <TableHeader>
              <TableRow>
                {answer.table.columns.map((col, i) => (
                  <TableHead key={col} className={i === 0 ? '' : 'text-right'}>
                    {col}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {answer.table.rows.map((row) => (
                <TableRow key={row.join('|')}>
                  {row.map((cell, i) => (
                    <TableCell
                      key={`${row[0]}-${i}`}
                      className={i === 0 ? 'font-medium' : 'text-right tabular-nums'}
                    >
                      {cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Caveats travel with the answer — the composite target in particular is
          meaningless without them. */}
      {answer.notes.length > 0 && (
        <div className="space-y-1 border-t pt-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Worth knowing</p>
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            {answer.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Every answer leads somewhere: the prompt layer summarises the existing
          pages, it doesn't replace them. */}
      {answer.sources.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t pt-4">
          {answer.sources.map((source) => (
            <Button key={source.to} asChild variant="outline" size="sm">
              <Link to={source.to}>
                {source.label}
                <ArrowRight className="ml-1 size-4" />
              </Link>
            </Button>
          ))}
        </div>
      )}

      {/* When the router declined, offer the shapes it does handle rather than
          leaving the user to guess. */}
      {!answer.understood && answer.suggestions.length > 0 && (
        <div className="space-y-2 border-t pt-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Try one of these</p>
          <div className="flex flex-wrap gap-2">
            {answer.suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onAsk(s)}
                className="rounded-full border px-3 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent/15 hover:text-foreground"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AskPage() {
  const [question, setQuestion] = useState('');
  const inputRef = useRef(null);

  // Examples come from the backend so they can't advertise a question shape the
  // parser doesn't handle.
  const {
    data: examples,
    loading: examplesLoading,
    error: examplesError,
  } = useApi(({ signal }) => api.ai.askExamples({ signal }), []);

  const answerAction = useApiAction((q) => api.ai.ask(q));

  const submit = async (raw) => {
    const q = String(raw ?? '').trim();
    if (!q) return;
    setQuestion(q);
    try {
      await answerAction.run(q);
    } catch {
      // useApiAction already captured it into answerAction.error; the alert below
      // renders it. Swallowed here so a failed ask doesn't surface as an
      // unhandled rejection in the console.
    }
    inputRef.current?.focus();
  };

  // Fallbacks are for FAILURE, not for the loading gap. Showing two placeholder
  // chips that get replaced by eight a moment later is a visible flicker, and it
  // briefly advertises a shorter list than the parser handles.
  const list = examples?.length ? examples : examplesError ? FALLBACK_EXAMPLES : [];

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">
          Ask the Competitive Intelligence Engine
        </h2>
        <p className="text-sm text-muted-foreground">
          Ask a question in plain English and get an answer from the live benchmark data.
        </p>
      </div>

      <Card className="border-l-4 border-l-primary">
        <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4 text-muted-foreground" aria-hidden />
            Ask a question
          </CardTitle>
          {/* Stated up front, not buried: this is not a language model. */}
          <Badge variant="outline" className="shrink-0 font-normal">
            Deterministic — no model
          </Badge>
        </CardHeader>

        <CardContent className="space-y-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(question);
            }}
            className="flex flex-wrap gap-2"
          >
            <Input
              ref={inputRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. Which product has the best blower assembly?"
              aria-label="Your question"
              maxLength={500}
              className="min-w-0 flex-1"
            />
            <Button type="submit" disabled={answerAction.loading || !question.trim()}>
              {answerAction.loading ? 'Thinking…' : 'Ask'}
              {!answerAction.loading && <CornerDownLeft className="ml-1 size-4" />}
            </Button>
          </form>

          {/* Clickable examples — one click fills the box and asks. */}
          <div className="space-y-1.5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Try asking</p>
            <div className="flex flex-wrap gap-2">
              {examplesLoading &&
                [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-7 w-44 rounded-full" />)}
              {list.map((example) => (
                <button
                  key={example}
                  type="button"
                  disabled={answerAction.loading}
                  onClick={() => submit(example)}
                  className="rounded-full border px-3 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent/15 hover:text-foreground disabled:opacity-50"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>

          {/* ---- the answer panel ---- */}
          <div className="border-t pt-5">
            {answerAction.loading && <Thinking />}

            {!answerAction.loading && answerAction.error && (
              <Alert variant="destructive">
                <AlertTitle>Could not answer that</AlertTitle>
                <AlertDescription>{answerAction.error.message}</AlertDescription>
              </Alert>
            )}

            {!answerAction.loading && !answerAction.error && answerAction.data && (
              <Answer answer={answerAction.data} onAsk={submit} />
            )}

            {!answerAction.loading && !answerAction.error && !answerAction.data && (
              <div className="space-y-2 py-4 text-center">
                <p className="text-sm font-medium">No question asked yet</p>
                <p className="mx-auto max-w-md text-sm text-muted-foreground">
                  Ask about cost, weight, part count, modules, a comparison between products, the
                  best-of-best target, or request an executive summary. Pick an example above to
                  start.
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Answers are assembled from the same stored rollups the Compare, Best-of-Best and persona
        report pages use — nothing here is recomputed, and nothing is generated by a language model.
        Question matching is rule-based, so an unrecognised question is declined rather than guessed
        at.
      </p>
    </div>
  );
}
