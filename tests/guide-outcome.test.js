import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGuidanceHandoff, normalizeGuidanceOutcome } from '../lib/guide-outcome.js';
import { bindGuideToSnapshot } from '../lib/guide-planner.js';
const field = { id: 'field-1', name: 'Invoice reference', role: 'textbox', enabled: true, visible: true, field: { editable: true, filled: false } };
const dom = { snapshotId: 'page:1', elements: [field], pageContext: { surfaces: [{ id: 'form-1', name: 'Create invoice', focused: true, fields: [{ id: field.id, name: field.name, editable: true, filled: false }] }] } };

test('generic fallback uses current form labels for non-mail workflows and never claims success', () => {
  const result = buildGuidanceHandoff('How do I create an invoice?', dom);
  assert.equal(result.status, 'handoff'); assert.equal(result.completed, false);
  assert.match(result.summary, /Create invoice/);
  assert.match(result.remainingActions[0].text, /Invoice reference/);
  assert.equal(JSON.stringify(result).includes('Compose'), false);
  assert.equal(JSON.stringify(result).includes('Send'), false);
});

test('a model handoff retains task-specific instructions and filters invented target IDs', () => {
  const result = normalizeGuidanceOutcome({ status: 'handoff', summary: 'The invoice form is ready. Enter the invoice details, review them, and use Create.', remainingActions: [{ text: 'Enter the invoice reference.', elementId: field.id }, { text: 'Use an invented control.', elementId: 'not-observed' }, { text: 'Review the details before submitting.' }] }, dom);
  assert.match(result.summary, /invoice form is ready/);
  assert.equal(result.remainingActions.length, 2);
  assert.equal(result.source, 'model');
});

test('complete needs actual visible outcome evidence; a form or predicted click cannot prove completion', () => {
  const claim = { status: 'complete', summary: 'Invoice created.', steps: [], completed: true, evidenceIds: [field.id] };
  const invalid = normalizeGuidanceOutcome(claim, dom);
  assert.equal(invalid.status, 'handoff'); assert.equal(invalid.completed, false);
  assert.doesNotMatch(invalid.summary, /Invoice created\./);
  const legacy = normalizeGuidanceOutcome({ steps: [], completed: true, summary: 'Invoice created.' }, dom);
  assert.equal(legacy.status, 'handoff'); assert.doesNotMatch(legacy.summary, /Invoice created\./);
  const reported = { ...dom, elements: [...dom.elements, { id: 'confirmation', role: 'status', name: 'Invoice created', visible: true }] };
  const valid = normalizeGuidanceOutcome({ ...claim, evidenceIds: ['confirmation'] }, reported);
  assert.equal(valid.status, 'complete'); assert.equal(valid.completed, true);
  assert.deepEqual(valid.remainingActions, []);
  const predicted = bindGuideToSnapshot({ steps: [{ element: field.id, action: 'type', description: 'Enter the invoice reference' }], completed: true }, dom);
  assert.equal(predicted.status, 'next_step'); assert.equal(predicted.completed, false);
});

test('uncertainty is an explicit ending with useful context rather than a blank error', () => {
  const result = bindGuideToSnapshot({ steps: [], completed: false }, { elements: [], pageContext: {} }, [], 'Find the invoice');
  assert.equal(result.status, 'blocked');
  assert.match(result.summary, /Find the invoice/);
  assert.ok(result.remainingActions.length);
});
