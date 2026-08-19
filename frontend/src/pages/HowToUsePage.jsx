// ---------------------------------------------------------------------------
// src/pages/HowToUsePage.jsx — route /how-to-use
//
// Section 1 of 3 in the workflow: How To Use → New Project → Competitive
// Intelligence Engine.
//
// Training and onboarding. Static content by design — this explains the platform
// rather than doing anything, so it has no data dependencies and cannot fail to
// load.
//
// ---------------------------------------------------------------------------
// THE RULE THIS PAGE FOLLOWS
//
// Every capability below carries a build status from lib/buildStatus.js, and
// anything marked Live has a working link. That is deliberate: a training page
// is exactly where an over-claim does the most damage, because a new user reads
// it as the specification and then goes looking for a feature that isn't there.
// Where something is genuinely not built, it says Planned and offers no button
// rather than a link to an empty page.
//
// It also does NOT duplicate WorkflowPage. That page maps the eight teardown
// stages against what's wired up today, which is the build-status view; this one
// explains the process to a human. Cross-linked at the bottom rather than
// re-stated here, so there's one place each fact lives.
// ---------------------------------------------------------------------------

import { Link } from 'react-router-dom';
import {
  BarChart3,
  Boxes,
  Camera,
  FileSpreadsheet,
  FolderPlus,
  Ruler,
  Trophy,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ICON_WRAPPER_CLASS, STATUS_BADGE_VARIANT, STATUS_LABEL } from '@/lib/buildStatus';

/** The three workflow sections, in order. Mirrors GlobalNav in App.jsx. */
const SECTIONS = [
  {
    step: 1,
    title: 'How To Use',
    to: '/how-to-use',
    blurb: 'What the platform does and how a benchmarking study runs end to end. You are here.',
  },
  {
    step: 2,
    title: 'New Project',
    to: '/new-project',
    blurb:
      'Data capture and engineering BOM creation — register a teardown, import or build its BOM, capture measurements and photos.',
  },
  {
    step: 3,
    title: 'Competitive Intelligence Engine',
    to: '/intelligence',
    blurb:
      'Everything analytical: the benchmark repository, product comparison, Best-of-Best leaderboards and the persona reports.',
  },
];

/**
 * The seven topics this page is required to cover, in workflow order.
 *
 * `to` is null wherever the destination genuinely doesn't exist yet — see the
 * header comment on why that matters more here than anywhere else.
 */
const TOPICS = [
  {
    key: 'project',
    icon: FolderPlus,
    title: 'Creating a new benchmark project',
    status: 'partial',
    body:
      'A project is one competitor unit torn down: its brand, model, category and notes. Today products arrive either from the seed script (the five reference air handlers) or as a by-product of importing a CEDARS BOM, which creates the product record and its whole tree in one step. A standalone "new project" form lives in the New Project section and is not built yet.',
    detail:
      'The five reference teardowns are Goodman AMST48CU300, Carrier FJ5ANXA18L, Bosch BVA36WN1-M15, Carrier FJ5ANXC48L and Trane 5TEMCB02.',
    to: '/new-project',
    actionLabel: 'Open New Project',
  },
  {
    key: 'modules',
    icon: Boxes,
    title: 'Selecting modules',
    status: 'live',
    body:
      'Every teardown is organised into Level-1 modules — the functional blocks a benchmarking review actually compares. The reference set uses the eight AHU modules: Packaging, Cabinet, Coil (Evaporator), Blower, Electrical, Condensate Management, Air Filtration and Electric Heater.',
    detail:
      'A module is stored twice on purpose: as the sub-assembly that groups the tree and drives every cost/weight rollup, and as a field on each part underneath it that a BOM export reads. Not every product carries every module — two of the five have no electric heater, which is a real product difference rather than missing data.',
    to: '/intelligence',
    actionLabel: 'See the repository',
  },
  {
    key: 'bom',
    icon: FileSpreadsheet,
    title: 'Importing or creating a BOM',
    status: 'live',
    body:
      'A CEDARS Excel export can be imported directly: pick the file, review what was parsed — the detected format variant, module and commodity counts, and how many placeholder rows were discarded — then confirm. Nothing is written until you do. Building a BOM by hand, module by module, is planned and lives in the New Project section.',
    detail:
      'The importer handles both documented CEDARS layouts, converts imperial source units per column, and reports what it skipped rather than dropping rows silently.',
    to: '/products',
    actionLabel: 'Import a BOM',
  },
  {
    key: 'capture',
    icon: Ruler,
    title: 'Capturing measurements',
    status: 'live',
    body:
      'Measurement capture is built around a keyboard-input (HID) device — the kind of caliper or scale that behaves like a barcode scanner. The capture screen locks focus to one field, commits on Enter and advances automatically through length, width, height and weight before moving to the next part.',
    detail:
      'Captured readings are kept as their own history rather than overwriting the part: the part row holds the agreed value, the measurement rows hold what was actually observed, when and by whom. Collapsing the two would throw away provenance.',
    to: '/intelligence',
    actionLabel: 'Pick a product to capture',
  },
  {
    key: 'photos',
    icon: Camera,
    title: 'Capturing photos',
    status: 'partial',
    body:
      'Any number of images can be attached to a part, visible both on the part itself and in a whole-teardown gallery.',
    detail:
      'Photos are stored in this browser (IndexedDB), not on the server — so they do not travel between machines, and re-running the seed orphans them. Blob or SharePoint storage is the intended home.',
    to: null,
  },
  {
    key: 'benchmarking',
    icon: BarChart3,
    title: 'How benchmarking works',
    status: 'live',
    body:
      'Cost and weight are rolled up from parts to modules to products in one place on the server, and every screen reads those same figures. Comparison is stated against a baseline product: each metric is reported as a delta and as an index where the baseline is 100, so cost and weight share one scale and diverge visibly instead of just looking bigger.',
    detail:
      'No total is ever recomputed in the browser. That is what stops two screens quietly disagreeing about the same number.',
    to: '/compare',
    actionLabel: 'Open comparison',
  },
  {
    key: 'reports',
    icon: Trophy,
    title: 'Generating Competitive Intelligence reports',
    status: 'live',
    body:
      'Three persona reports are generated per product — Cost Engineer, Design Engineer and Executive — each a stored snapshot you can regenerate on demand. Across products, the Best-of-Best view ranks every metric and every module, and computes the composite target you would hit by taking the cheapest version of each module from whichever competitor builds it best.',
    detail:
      'Editing a teardown clears that product\'s cached reports, so a stale report can never render with a fresh-looking timestamp. Excel and PowerPoint exports are available from a product\'s teardown page.',
    to: '/best-of-best',
    actionLabel: 'Open Best-of-Best',
  },
];

function TopicCard({ topic }) {
  const Icon = topic.icon;
  return (
    <Card>
      <CardContent className="flex gap-4 py-5">
        <span
          aria-hidden
          className={`flex size-9 shrink-0 items-center justify-center rounded-lg border ${ICON_WRAPPER_CLASS}`}
        >
          <Icon className="size-4" />
        </span>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">{topic.title}</h3>
            <Badge variant={STATUS_BADGE_VARIANT[topic.status]} className="shrink-0">
              {STATUS_LABEL[topic.status]}
            </Badge>
          </div>

          <p className="text-sm text-muted-foreground">{topic.body}</p>
          {topic.detail && <p className="text-xs text-muted-foreground">{topic.detail}</p>}

          {topic.to && (
            <Button asChild variant="outline" size="sm">
              <Link to={topic.to}>{topic.actionLabel}</Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function HowToUsePage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">How to use this platform</h2>
        <p className="text-sm text-muted-foreground">
          A competitive teardown study, from registering a unit to the Competitive Intelligence
          report an executive reads.
        </p>
      </div>

      {/* ---- the three sections, as the workflow ---- */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">The workflow</h3>
        <div className="grid gap-3 lg:grid-cols-3">
          {SECTIONS.map((section, i) => (
            <Card
              key={section.to}
              className={i === 0 ? 'border-accent/60 bg-accent/5' : undefined}
            >
              <CardContent className="space-y-2 py-5">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={`flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${ICON_WRAPPER_CLASS}`}
                  >
                    {section.step}
                  </span>
                  <p className="text-sm font-semibold">{section.title}</p>
                </div>
                <p className="text-sm text-muted-foreground">{section.blurb}</p>
                {i !== 0 && (
                  <Button asChild variant="outline" size="sm">
                    <Link to={section.to}>Go to {section.title}</Link>
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* ---- what the platform is ---- */}
      <Alert>
        <AlertTitle>What this application is</AlertTitle>
        <AlertDescription className="space-y-2 text-sm">
          <p>
            A competitive benchmarking platform for HVAC products. A competitor unit is physically
            torn down; every part is weighed, measured, costed and classified into a module; and the
            resulting bill of materials is compared against every other teardown in the repository —
            by product, by module and by part.
          </p>
          <p>
            The output is the answer to three questions: what does a competitor&apos;s unit actually
            cost to build, where is our cost or mass higher than theirs, and what would the
            best-in-class target be if we matched the best competitor in every module at once.
          </p>
        </AlertDescription>
      </Alert>

      {/* ---- the seven topics ---- */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">How each step works</h3>
        <div className="space-y-3">
          {TOPICS.map((topic) => (
            <TopicCard key={topic.key} topic={topic} />
          ))}
        </div>
      </section>

      {/* ---- honesty footer, and the cross-link to the build-status view ---- */}
      <Alert>
        <AlertTitle>Two things to know about the data</AlertTitle>
        <AlertDescription className="space-y-2 text-sm">
          <p>
            <strong>The reference teardowns are illustrative.</strong> They carry real competitor
            model numbers but every weight, cost and part number in them is fabricated. Each
            product&apos;s notes say so on screen, and that text should stay there until real
            teardown data replaces the numbers.
          </p>
          <p>
            For a stage-by-stage view of exactly what is wired up today versus stubbed for the demo
            versus not started, see the build status map.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link to="/workflow">Open the build status map</Link>
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  );
}
