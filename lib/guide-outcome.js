// Terminal guidance is distinct from an observed business outcome.
// All fallback copy is built from the current snapshot, never site/task rules.
const clean = (value, limit = 1400) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const statuses = new Set(['handoff', 'complete', 'blocked']);

export function buildGuidanceHandoff(task, dom, history = [], reason = '') {
  const surfaces = dom.pageContext?.surfaces || [];
  const surface = surfaces.find(item => item.focused && item.fields?.length) || surfaces.find(item => item.fields?.length);
  const fields = (surface?.fields || dom.elements.filter(item => item.field?.editable).map(item => ({ ...item.field, id: item.id, name: item.name })))
    .filter(field => field.editable !== false && clean(field.name)).slice(0, 8);
  const remainingActions = fields.filter(field => !field.filled).map(field => ({ text: `Fill in “${clean(field.name, 120)}”.`, elementId: field.id }));
  if (fields.length) remainingActions.push({ text: 'Review your entries, then use the appropriate action on this form to continue.' });
  const last = history.at(-1);
  const summary = surface
    ? `“${clean(surface.name, 120) || 'The form'}” is open. You can continue with the remaining instructions below.`
    : fields.length ? 'The page has editable fields. Continue with the remaining instructions below.'
    : last ? `Your action on “${clean(last.targetDescriptor?.name || last.description, 180)}” was recorded. I cannot reliably identify another control from this page.`
    : `I cannot reliably identify a control for “${clean(task, 240)}” from this page.`;
  if (!remainingActions.length) remainingActions.push({ text: 'Review the current page. Add the missing context to your request if you need more specific guidance.' });
  return { steps: [], status: fields.length || last ? 'handoff' : 'blocked', summary, remainingActions, evidenceIds: [], note: clean(reason), completed: false, source: 'page-context' };
}

export function normalizeGuidanceOutcome(result, dom, history = [], task = '') {
  const fallback = buildGuidanceHandoff(task, dom, history, result.note);
  const elements = new Map(dom.elements.map(item => [item.id, item]));
  const evidenceIds = Array.isArray(result.evidenceIds) ? [...new Set(result.evidenceIds)].slice(0, 8) : [];
  let status = statuses.has(result.status) ? result.status : fallback.status;
  // A predicted final click, a filled form, or a made-up ID cannot prove success.
  const validEvidence = evidenceIds.length && evidenceIds.every(id => {
    const element = elements.get(id);
    return element && element.visible !== false && ['status', 'alert', 'heading'].includes(element.role || element.type);
  });
  if (status === 'complete' && !validEvidence) status = 'handoff';
  const remainingActions = Array.isArray(result.remainingActions) ? result.remainingActions.slice(0, 8).map(action => {
    const text = clean(typeof action === 'string' ? action : action?.text, 600);
    const elementId = typeof action === 'object' ? action?.elementId : undefined;
    if (elementId && !elements.has(elementId)) return null;
    return text ? { text, ...(elementId ? { elementId } : {}) } : null;
  }).filter(Boolean) : [];
  const hasModelSummary = clean(result.summary);
  const unsupportedSuccess = !validEvidence && (result.status === 'complete' || (result.completed === true && result.status !== 'handoff'));
  return {
    ...fallback, status,
    summary: unsupportedSuccess ? fallback.summary : hasModelSummary || fallback.summary,
    remainingActions: status === 'complete' ? [] : remainingActions.length ? remainingActions : fallback.remainingActions,
    evidenceIds: status === 'complete' ? evidenceIds : [],
    completed: status === 'complete', source: hasModelSummary && !unsupportedSuccess ? 'model' : 'page-context'
  };
}
