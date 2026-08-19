// ---------------------------------------------------------------------------
// scripts/verify-capture.mjs
//
//   npm run verify:capture        (from backend/, server must be running)
//
// The capture foundation the BOM Capture workstation is built on:
//   * the photo-label ALLOCATOR — a part owns a family of labels, one per shot,
//     and two allocations must never return the same sticker
//   * Part.photoId as the family LEAD, re-mirrored when the family changes, since
//     the Engineering BOM column and its Missing-Photo-ID filter both read it
//   * the four measurement types added for the workstation, each resolving onto
//     its Part column so a captured thickness cannot store a row and then vanish
//
// Cleans up after itself: every label it creates is removed and the part it
// borrowed is reset, so the seeded five are left exactly as found.
// ---------------------------------------------------------------------------


const API = 'http://localhost:4000/api';
const call = async (p, init) => {
  const r = await fetch(`${API}${p}`, { ...init, headers: init?.body ? { 'Content-Type': 'application/json' } : undefined });
  let b = null; try { b = await r.json(); } catch {}
  return { status: r.status, body: b };
};
let fail = 0, n = 0;
const ok = (c, l, extra='') => { n++; if (!c) { fail++; console.log(`  FAIL ${l} ${extra}`); } else console.log(`  ok   ${l}`); };

const td = (await call('/products/14/teardown')).body.data;
const part = td.subAssemblies[0].parts[0];
console.log(`part ${part.id} — ${part.name}\n`);

// Sweep any labels left on the borrowed part by an interrupted earlier run. The
// assertions below are about the family THIS run creates ("two labels allocated",
// "positions sequential"), and a leftover would shift every number — a suite that
// only passes on a pristine database isn't much of a suite.
const stale = (await call(`/photo-labels/part/${part.id}`)).body.data.labels;
for (const l of stale) await call(`/photo-labels/${l.id}`, { method: 'DELETE' });
if (stale.length) console.log(`swept ${stale.length} leftover label(s) from an earlier run\n`);

console.log('ALLOCATOR');
const a1 = await call(`/photo-labels/part/${part.id}/allocate`, { method: 'POST', body: '{}' });
const a2 = await call(`/photo-labels/part/${part.id}/allocate`, { method: 'POST', body: JSON.stringify({ view: 'Front' }) });
ok(a1.status === 201 && a2.status === 201, 'two labels allocated');
ok(a1.body.data.label !== a2.body.data.label, `labels differ (${a1.body.data.label}, ${a2.body.data.label})`);
ok(a2.body.data.view === 'Front', 'view stored on allocation');
ok(a1.body.data.position === 0 && a2.body.data.position === 1, 'positions sequential');

const listed = (await call(`/photo-labels/part/${part.id}`)).body.data;
ok(listed.labels.length === 2, 'family lists both');
ok(listed.views.includes('Detail'), 'Detail is an offered view');
ok(listed.suggestedPrefix === 'AMS', `prefix continues the series (${listed.suggestedPrefix})`);

console.log('\nLEAD LABEL MIRROR');
let fresh = (await call('/products/14/teardown')).body.data.subAssemblies[0].parts[0];
ok(fresh.photoId === a1.body.data.label, `Part.photoId mirrors the lead (${fresh.photoId})`);

console.log('\nDUPLICATE + VIEW VALIDATION');
const dup = await call(`/photo-labels/part/${part.id}`, { method: 'POST', body: JSON.stringify({ label: a1.body.data.label }) });
ok(dup.status === 409, `same label twice on one part is 409 (${dup.status})`);
const badView = await call(`/photo-labels/part/${part.id}`, { method: 'POST', body: JSON.stringify({ label: 'ZZ9001', view: 'Sideways' }) });
ok(badView.status === 400, `an unknown view is 400 (${badView.status})`);

console.log('\nNEW MEASUREMENT TYPES');
// Baseline first. Measurement rows are PROVENANCE — nothing deletes them, and
// nothing should — so this suite must assert the rows IT added rather than the
// total. Counting the total passed exactly once and then failed on every re-run.
const isNewType = (m) => /thickness|diameter|unfolded/.test(m.type);
const beforeRows = (
  (await call('/products/14/teardown')).body.data.subAssemblies[0].parts[0].measurements ?? []
).filter(isNewType).length;

for (const [type, unit, field] of [['dimension_thickness','mm','thicknessMm'],['dimension_diameter','mm','diameterOuterMm'],['unfolded_length','mm','unfoldedLengthMm'],['unfolded_width','mm','unfoldedWidthMm']]) {
  const r = await call(`/capture/part/${part.id}`, { method: 'POST', body: JSON.stringify({ measurements: [{ type, value: 12.34, unit }] }) });
  ok(r.status === 201 || r.status === 200, `${type} accepted (${r.status})`);
}
fresh = (await call('/products/14/teardown')).body.data.subAssemblies[0].parts[0];
for (const f of ['thicknessMm','diameterOuterMm','unfoldedLengthMm','unfoldedWidthMm']) {
  ok(fresh[f] === 12.34, `resolved onto Part.${f} (${fresh[f]})`);
}
const added = (fresh.measurements ?? []).filter(isNewType).length - beforeRows;
ok(added === 4, `four provenance rows added this run (${added})`);
const badUnit = await call(`/capture/part/${part.id}`, { method: 'POST', body: JSON.stringify({ measurements: [{ type: 'dimension_thickness', value: 1, unit: 'g' }] }) });
ok(badUnit.status === 400, `wrong unit for thickness is rejected (${badUnit.status})`);

console.log('\nDELETE CASCADE + RESEQUENCE');
await call(`/photo-labels/${a1.body.data.id}`, { method: 'DELETE' });
const after = (await call(`/photo-labels/part/${part.id}`)).body.data;
ok(after.labels.length >= 1, 'family shrank');
ok(after.labels[0].position === 0, 'positions resequenced after removing the lead');
fresh = (await call('/products/14/teardown')).body.data.subAssemblies[0].parts[0];
ok(fresh.photoId === after.labels[0].label, `lead label re-mirrored (${fresh.photoId})`);

// cleanup: remove every label we made and reset the part's dimensions
for (const l of after.labels) await call(`/photo-labels/${l.id}`, { method: 'DELETE' });
await call(`/parts/${part.id}`, { method: 'PATCH', body: JSON.stringify({ thicknessMm: null, diameterOuterMm: null, unfoldedLengthMm: null, unfoldedWidthMm: null }) });
const final = (await call('/products/14/teardown')).body.data.subAssemblies[0].parts[0];
ok(final.photoId === null, 'cleanup left photoId null');
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${n - fail}/${n}`);
process.exit(fail === 0 ? 0 : 1);
