// Evidence-based step verification. Unrelated DOM mutations are not success.
(() => {
  const runtime = globalThis.GuideMeRuntime ||= {};
  if (runtime.StepVerifier) return;

  class StepVerifier {
    constructor(page) { this.page = page; this.edits = new WeakMap(); }

    recordEdit(element) { this.edits.set(element, (this.edits.get(element) || 0) + 1); }

    state(element) {
      return {
        expanded: element?.getAttribute('aria-expanded'),
        checked: element?.getAttribute('aria-checked'),
        selected: element?.getAttribute('aria-selected'),
        pressed: element?.getAttribute('aria-pressed'),
        dataState: element?.getAttribute('data-state'),
        nativeChecked: element?.matches('input[type="checkbox"], input[type="radio"]') ? element.checked : null,
        open: element?.matches('summary') ? element.parentElement.open : null
      };
    }

    capture(step, element) {
      return {
        url: this.page.window.location.href,
        surfaces: new Set(this.page.formSurfaces()),
        editRevision: this.edits.get(element) || 0,
        state: this.state(element),
        conditionMet: this.condition(step.expectedResult, element),
        element
      };
    }

    condition(expected, element) {
      if (!expected || expected.type === 'manual' || expected.type === 'url-changed') return false;
      const resolution = expected.targetDescriptor
        ? this.page.resolve({ element: expected.targetDescriptor.id, targetDescriptor: expected.targetDescriptor }, { allowDisabled: true })
        : null;
      if (resolution?.status === 'ambiguous') return false;
      const target = resolution ? resolution.element : element;
      if (expected.type === 'visible') return !!target && this.page.isVisible(target);
      if (expected.type === 'hidden') return expected.targetDescriptor ? !target : !this.page.isVisible(element);
      if (expected.type === 'attribute') return !!target && target.getAttribute(expected.attribute) === expected.value;
      return false;
    }

    check(step, before) {
      const expected = step.expectedResult;
      if (expected?.type === 'field-edited') {
        const field = this.page.fieldState(before.element);
        return !!field?.editable && field.filled && field.valid && (this.edits.get(before.element) || 0) > before.editRevision;
      }
      if ((!expected || expected.type === 'manual') && (step.action || 'click') === 'click') {
        // A focused, newly revealed form is strong UI-transition evidence even
        // when the planner could not know its accessible name in advance.
        const opened = before.surfaces && this.page.formSurfaces().some(surface => !before.surfaces.has(surface) && !surface.contains(before.element) &&
          surface.contains(this.page.document.activeElement) && this.page.surfaceContext(surface).fields.some(field => field.editable));
        if (opened) return true;
      }
      if (expected?.type === 'manual') return false;
      const navigated = this.page.window.location.href !== before.url;
      if (expected?.type === 'url-changed') return navigated;
      if (expected && ['visible', 'hidden', 'attribute'].includes(expected.type)) {
        return !before.conditionMet && this.condition(expected, before.element);
      }
      if (navigated) return true;
      const after = this.state(before.element);
      return Object.keys(after).some(key => before.state[key] !== null && after[key] !== null && before.state[key] !== after[key]);
    }

    async wait(step, before, { signal, timeout = 5000, interval = 100 } = {}) {
      const start = Date.now();
      do {
        if (signal?.aborted) return { status: 'cancelled' };
        if (this.check(step, before)) return { status: 'verified' };
        if (step.expectedResult?.type === 'manual' && Date.now() - start >= Math.min(timeout, 1500)) break;
        await new Promise(resolve => this.page.window.setTimeout(resolve, interval));
      } while (Date.now() - start < timeout);
      return { status: 'unconfirmed' };
    }
  }

  runtime.StepVerifier = StepVerifier;
})();
