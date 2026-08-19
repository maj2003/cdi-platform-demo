// ---------------------------------------------------------------------------
// src/pages/RequestFormPage.jsx — route /request
//
// A Competitive Evaluation Request: someone in product or sales asks the
// benchmarking team to tear a competitor unit down.
//
// ---------------------------------------------------------------------------
// THE SUBMISSION IS SIMULATED, AND SAYS SO
//
// The brief asked for a success notification and an "email sent" notification, and
// explicitly said not to worry about actually sending mail. So nothing is posted
// and nothing is mailed — but the screen does not pretend otherwise. The success
// panel carries a "SIMULATED" badge and one sentence naming what a real submission
// would need (a Requests table and an SMTP or Graph send).
//
// This is the same rule the Compute and Read Scale placeholders in the capture
// station follow, and it is the only honest way to demo an unbuilt integration: a
// convincing fake with no label is indistinguishable from a lie, and the person
// being demoed to is the one who ends up misinformed.
//
// The reference number is generated client-side from the timestamp, and is
// therefore NOT a claim that a record exists somewhere with that id. It is shown
// because a request form that returns nothing to quote feels broken, and it is
// labelled as part of the simulated block so it cannot be mistaken for a ticket.
//
// ---------------------------------------------------------------------------
// WHY THE FORM STILL VALIDATES PROPERLY
//
// A simulated submit is not an excuse for a form that accepts anything. The
// required fields are the ones a real evaluation cannot start without — who is
// asking, which competitor, and why — because the moment this is wired to a real
// queue, a backlog of requests with no requester is unworkable. Validating now
// costs nothing and means the wiring is the only thing left to do.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ClipboardList, Mail, Send } from 'lucide-react';

import { PRODUCT_CATEGORIES } from '@/lib/hvacModules';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/** Where a real submission would land. Named so the demo can say it out loud. */
const ROUTED_TO = 'benchmarking-team@daikincomfort.com';

const PRIORITIES = ['Standard', 'High — supports an active program', 'Urgent — competitive response'];

const BLANK = {
  requester: '',
  email: '',
  program: '',
  brand: '',
  model: '',
  category: PRODUCT_CATEGORIES[0].fullName,
  priority: PRIORITIES[0],
  rationale: '',
};

/**
 * A human-readable reference. Date-derived, so two requests in the same session
 * cannot collide, and obviously not a database id.
 */
function reference() {
  const d = new Date();
  const stamp = [d.getFullYear(), d.getMonth() + 1, d.getDate()]
    .map((n) => String(n).padStart(2, '0'))
    .join('');
  const seq = String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
  return `CER-${stamp}-${seq}`;
}

export default function RequestFormPage() {
  const [values, setValues] = useState(BLANK);
  const [submitted, setSubmitted] = useState(null);

  const set = (key) => (event) => setValues((prev) => ({ ...prev, [key]: event.target.value }));

  // The four a real evaluation cannot be scheduled without.
  const complete =
    values.requester.trim() && values.email.trim() && values.brand.trim() && values.rationale.trim();

  const submit = (event) => {
    event.preventDefault();
    if (!complete) return;
    setSubmitted({ ...values, ref: reference(), at: new Date() });
  };

  if (submitted) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Alert className="border-accent bg-accent/10">
          <CheckCircle2 className="size-5 text-primary" />
          <AlertTitle className="flex flex-wrap items-center gap-2">
            Request submitted
            <Badge variant="outline" className="font-mono text-xs">{submitted.ref}</Badge>
            {/* The badge is not decoration. See the header comment: an unlabelled
                convincing fake misinforms the person being demoed to. */}
            <Badge variant="secondary" className="text-[11px] uppercase tracking-wide">
              Simulated
            </Badge>
          </AlertTitle>
          <AlertDescription className="space-y-1">
            <p>
              <strong>{submitted.brand} {submitted.model || '(model TBC)'}</strong> has been logged
              for competitive evaluation at <em>{submitted.priority.split(' — ')[0]}</em> priority.
            </p>
          </AlertDescription>
        </Alert>

        <Alert>
          <Mail className="size-5" />
          <AlertTitle className="flex flex-wrap items-center gap-2">
            Notification email sent
            <Badge variant="secondary" className="text-[11px] uppercase tracking-wide">
              Simulated
            </Badge>
          </AlertTitle>
          <AlertDescription className="space-y-2">
            <p className="text-sm">
              To <strong>{ROUTED_TO}</strong>, copying <strong>{submitted.email}</strong>.
            </p>
            {/* The generated body, shown rather than described — it is the part a
                reviewer can actually check for the right fields. */}
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs leading-relaxed">
{`Subject: [${submitted.ref}] Competitive evaluation request — ${submitted.brand} ${submitted.model}

Requester   ${submitted.requester} <${submitted.email}>
Program     ${submitted.program || '—'}
Target      ${submitted.brand} ${submitted.model || '(model TBC)'}
Category    ${submitted.category}
Priority    ${submitted.priority}

${submitted.rationale}`}
            </pre>
            <p className="text-xs text-muted-foreground">
              Nothing was sent and nothing was stored. Wiring this up needs a Requests table
              and an SMTP or Microsoft Graph send — the form, the routing address and the
              message body above are already real.
            </p>
          </AlertDescription>
        </Alert>

        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/new-project">Start a project for this unit</Link>
          </Button>
          <Button variant="outline" onClick={() => { setSubmitted(null); setValues(BLANK); }}>
            Submit another request
          </Button>
          <Button asChild variant="ghost">
            <Link to="/">Back to the portal</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ClipboardList className="size-6 text-primary" />
          Competitive Evaluation Request
        </h1>
        <p className="text-sm text-muted-foreground">
          Ask the benchmarking team to tear down a competitor unit. Goes to {ROUTED_TO}.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Who is asking</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="req-name">Requester *</Label>
            <Input id="req-name" value={values.requester} onChange={set('requester')}
              placeholder="Name" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="req-email">Email *</Label>
            <Input id="req-email" type="email" value={values.email} onChange={set('email')}
              placeholder="name@daikincomfort.com" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="req-program">Program or project</Label>
            <Input id="req-program" value={values.program} onChange={set('program')}
              placeholder="e.g. FY27 residential AHU cost-down" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">What to evaluate</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="req-brand">Competitor brand *</Label>
            <Input id="req-brand" value={values.brand} onChange={set('brand')}
              placeholder="Carrier" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="req-model">Model number</Label>
            <Input id="req-model" value={values.model} onChange={set('model')}
              placeholder="FJ5ANXC48L" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="req-category">Product category</Label>
            {/* A native select, matching CreateProjectForm — the app has no Select
                primitive and adding one for two dropdowns is not worth the weight. */}
            <select
              id="req-category"
              value={values.category}
              onChange={set('category')}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {PRODUCT_CATEGORIES.map((c) => (
                <option key={c.key} value={c.fullName}>{c.fullName}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="req-priority">Priority</Label>
            <select
              id="req-priority"
              value={values.priority}
              onChange={set('priority')}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="req-why">Why this unit *</Label>
            <Textarea
              id="req-why"
              value={values.rationale}
              onChange={set('rationale')}
              rows={4}
              placeholder="What decision does this teardown support? Which of our models does it compete with?"
            />
            <p className="text-xs text-muted-foreground">
              The team schedules on this, so specifics beat "for benchmarking".
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={submit} disabled={!complete}>
          <Send className="mr-1.5 size-4" />
          Submit request
        </Button>
        {!complete && (
          <span className="text-xs text-muted-foreground">
            Requester, email, competitor brand and rationale are required.
          </span>
        )}
      </div>
    </div>
  );
}
