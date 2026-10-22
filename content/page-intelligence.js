// Browser-independent observation and target resolution. No Chrome APIs.
(() => {
  const runtime = globalThis.GuideMeRuntime ||= {};
  if (runtime.PageIntelligence) return;

  const INTERACTIVE = 'a[href], button, input:not([type="hidden"]), textarea, select, summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"], [role="checkbox"], [role="switch"], [role="combobox"], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const equal = (a, b) => normalize(a).toLowerCase() === normalize(b).toLowerCase();

  class PageIntelligence {
    constructor(doc = document) {
      this.document = doc;
      this.window = doc.defaultView;
      this.session = this.window.crypto.randomUUID().replaceAll('-', '').slice(0, 12);
      this.ids = new WeakMap();
      this.elements = new Map();
      this.sequence = 0;
      this.revision = 0;
    }

    queryAll(selector, scope = this.document) {
      const found = [];
      const visit = root => {
        try { found.push(...root.querySelectorAll(selector)); } catch { return; }
        for (const element of root.querySelectorAll('*')) {
          if (element.shadowRoot) visit(element.shadowRoot);
        }
      };
      visit(scope);
      return found.filter(element => !this.isOwnElement(element));
    }

    parent(element) {
      return element.parentElement || element.getRootNode()?.host || null;
    }

    isOwnElement(element) {
      for (let current = element; current; current = this.parent(current)) {
        if (current.matches?.('[data-guideme-ui], [id^="guideme-"], [class^="guideme-"]')) return true;
      }
      return false;
    }

    isVisible(element) {
      if (!element?.isConnected || this.isOwnElement(element)) return false;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || !element.getClientRects().length) return false;
      for (let current = element; current; current = this.parent(current)) {
        const style = this.window.getComputedStyle(current);
        if (current.hidden || current.inert || current.getAttribute('aria-hidden') === 'true' ||
            style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) return false;
      }
      return true;
    }

    isEnabled(element) {
      if (element.matches(':disabled')) return false;
      for (let current = element; current; current = this.parent(current)) {
        if (current.inert || current.getAttribute('aria-disabled') === 'true') return false;
      }
      return true;
    }

    contextText(element) {
      if (!element) return '';
      const walker = this.document.createTreeWalker(element, this.window.NodeFilter.SHOW_TEXT);
      const parts = [];
      while (walker.nextNode()) {
        if (!walker.currentNode.parentElement?.closest('input, textarea, select, [contenteditable="true"], script, style')) parts.push(walker.currentNode.textContent);
      }
      return normalize(parts.join(' '));
    }

    name(element) {
      const root = element.getRootNode();
      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy) {
        const label = labelledBy.split(/\s+/).map(id => root.getElementById?.(id)?.textContent || '').join(' ');
        if (normalize(label)) return normalize(label);
      }
      if (element.getAttribute('aria-label')) return normalize(element.getAttribute('aria-label'));
      if (element.labels?.length) return normalize(Array.from(element.labels, label => label.textContent).join(' '));
      if (element.matches('input, textarea, select, [contenteditable="true"]')) {
        // Never serialize field values (including passwords and hidden inputs).
        return normalize(element.getAttribute('placeholder') || element.getAttribute('title') || element.getAttribute('name'));
      }
      return normalize(element.textContent || element.getAttribute('title') || element.querySelector('img[alt]')?.alt);
    }

    role(element) {
      if (element.getAttribute('role')) return element.getAttribute('role');
      if (element.matches('button, summary, input[type="submit"], input[type="button"], input[type="reset"]')) return 'button';
      if (element.matches('a[href]')) return 'link';
      if (element.matches('input[type="checkbox"]')) return 'checkbox';
      if (element.matches('input[type="radio"]')) return 'radio';
      if (element.matches('select')) return 'combobox';
      if (element.matches('dialog')) return 'dialog';
      if (element.matches('form')) return 'form';
      if (element.matches('input, textarea, [contenteditable="true"]')) return 'textbox';
      if (element.matches('h1, h2, h3, h4, h5, h6')) return 'heading';
      return 'generic';
    }

    id(element) {
      if (!this.ids.has(element)) this.ids.set(element, `gm-${this.session}-${this.sequence++}`);
      const id = this.ids.get(element);
      this.elements.set(id, element);
      return id;
    }

    fieldState(element) {
      if (!element?.matches('input, textarea, select, [contenteditable="true"]') ||
          element.matches('input[type="password"], input[type="hidden"], input[type="file"], input[type="checkbox"], input[type="radio"], input[type="button"], input[type="submit"], input[type="reset"], input[type="image"], input[type="range"], input[type="color"]') ||
          /password|one-time-code|cc-/.test(element.getAttribute('autocomplete') || '')) return null;
      const editable = !element.readOnly && this.isEnabled(element);
      return {
        editable,
        kind: element.isContentEditable ? 'rich-text' : element.matches('textarea') ? 'multiline' : element.matches('select') ? 'select' : element.type || 'text',
        required: !!element.required || element.getAttribute('aria-required') === 'true',
        // Presence only: actual field contents never leave the page.
        filled: !!String(element.isContentEditable ? element.textContent : element.value || '').trim(),
        valid: element.validity ? element.validity.valid : element.getAttribute('aria-invalid') !== 'true'
      };
    }

    formSurfaces() {
      return this.queryAll('dialog[open], [role="dialog"], [aria-modal="true"], form, [role="form"]').filter(element => this.isVisible(element));
    }

    surfaceContext(surface) {
      return {
        id: this.id(surface), focused: surface.contains(this.document.activeElement), role: this.role(surface), name: normalize(surface.getAttribute('aria-label') || (surface.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => surface.getRootNode().getElementById?.(id)?.textContent || '').join(' ') || surface.querySelector('h1, h2, h3, legend')?.textContent).slice(0, 120),
        fields: this.queryAll('input, textarea, select, [contenteditable="true"]', surface).filter(element => this.isVisible(element) && this.fieldState(element))
          .slice(0, 16).map(element => ({ id: this.id(element), name: this.name(element).slice(0, 120), ...this.fieldState(element) }))
      };
    }

    describe(element) {
      const region = element.closest('[role="dialog"], [aria-modal="true"], dialog[open], main, [role="main"], nav, [role="navigation"], aside, header, form, section');
      const modal = element.closest('[role="dialog"], [aria-modal="true"], dialog[open]');
      const location = modal ? 'modal' : element.closest('main, [role="main"]') ? 'main' : element.closest('nav, aside, [role="navigation"]') ? 'sidebar' : element.closest('header') ? 'header' : 'page';
      const context = element.closest('tr, [role="row"], li, article, fieldset, section, form');
      const rect = element.getBoundingClientRect();
      const hints = [];
      if (modal) hints.push('in-modal');
      if (element.hasAttribute('aria-expanded') || element.hasAttribute('aria-haspopup')) hints.push('dropdown');
      if (element.closest('form')) hints.push('form');
      const heading = region?.querySelector('h1, h2, h3, h4, legend');
      return {
        id: this.id(element),
        name: this.name(element).slice(0, 180),
        text: this.name(element).slice(0, 180), // Legacy prompt/guide compatibility.
        role: this.role(element),
        type: this.role(element),
        tagName: element.tagName.toLowerCase(),
        location,
        region: normalize(region?.getAttribute('aria-label') || heading?.textContent).slice(0, 120),
        context: this.contextText(context).slice(0, 180),
        near: normalize(heading?.textContent).slice(0, 120),
        hints: hints.join(', '),
        visible: this.isVisible(element),
        enabled: this.isEnabled(element),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        scrollContainers: this.scrollContainers(element).map(container => container === this.document.scrollingElement ? 'document' : this.id(container)),
        field: this.fieldState(element),
        attributes: {
          testId: element.getAttribute('data-testid') || element.getAttribute('data-test-id'),
          id: element.id || null,
          name: element.getAttribute('name'),
          expanded: element.getAttribute('aria-expanded'),
          checked: element.getAttribute('aria-checked'),
          selected: element.getAttribute('aria-selected')
        }
      };
    }

    snapshot(limit = 150) {
      // Prune detached nodes without ever reusing their IDs.
      for (const [id, element] of this.elements) if (!element.isConnected) this.elements.delete(id);
      const candidates = this.queryAll(`${INTERACTIVE}, h1, h2, h3, [role="status"], [role="alert"]`).filter(element => this.isVisible(element));
      const activeSurface = this.document.activeElement?.closest('[role="dialog"], dialog[open], form');
      candidates.sort((a, b) => Number(!!activeSurface?.contains(b)) - Number(!!activeSurface?.contains(a)) || Number(!!b.closest('[role="dialog"], [aria-modal="true"], dialog[open]')) - Number(!!a.closest('[role="dialog"], [aria-modal="true"], dialog[open]')));
      const elements = candidates.slice(0, limit).map(element => this.describe(element));
      return {
        schemaVersion: 2,
        snapshotId: `${this.session}:${++this.revision}`,
        url: this.window.location.href,
        title: this.document.title,
        elements,
        truncated: candidates.length > limit,
        pageContext: {
          surfaces: this.formSurfaces().slice(0, 8).map(surface => this.surfaceContext(surface)),
          hasModal: elements.some(element => element.location === 'modal'),
          hasDropdownOpen: elements.some(element => element.attributes.expanded === 'true'),
          isLoading: this.queryAll('[aria-busy="true"]').some(element => this.isVisible(element))
        }
      };
    }

    resolve(step, { allowDisabled = false } = {}) {
      const descriptor = step.targetDescriptor;
      const selector = step.element || step.selector;
      const eligible = element => this.isVisible(element) && (allowDisabled || this.isEnabled(element));
      const direct = this.elements.get(selector);
      if (descriptor && direct && eligible(direct) && equal(this.name(direct), descriptor.name) && this.role(direct) === descriptor.role &&
          (!descriptor.context || equal(this.describe(direct).context, descriptor.context))) {
        return { element: direct, status: 'matched', score: 1000 };
      }
      const selectors = step.robustSelectors || {};
      const expectedName = descriptor?.name || selectors.accessibleName || selectors.ariaLabel || selectors.textContent;
      let cssMatches = [];
      if (selectors.cssSelector) cssMatches = this.queryAll(selectors.cssSelector);
      if (selector && !selector.startsWith('gm-') && /^[#.[a-z]/i.test(selector)) {
        cssMatches.push(...this.queryAll(selector));
      }
      const keywords = normalize(selectors.description || step.description || selector).toLowerCase().split(/\W+/)
        .filter(word => word.length > 2 && !['click', 'the', 'button', 'link', 'then', 'select', 'please', 'open', 'your', 'with', 'from'].includes(word));
      const ranked = [];
      const candidates = allowDisabled ? `${INTERACTIVE}, dialog, form, [role="form"], [role="dialog"], [role="alert"], [role="status"], h1, h2, h3, h4` : INTERACTIVE;
      for (const element of this.queryAll(candidates)) {
        if (!eligible(element)) continue;
        const actual = this.describe(element);
        if (descriptor?.role && actual.role !== descriptor.role) continue;
        if (selectors.role && actual.role !== selectors.role) continue;
        if (selectors.tagName && actual.tagName !== selectors.tagName.toLowerCase()) continue;
        const context = descriptor?.context || selectors.context;
        if (context && !equal(actual.context, context)) continue;
        let score = 0;
        if (expectedName) {
          if (equal(actual.name, expectedName)) score += 100;
          else if (actual.name && actual.name.toLowerCase().includes(expectedName.toLowerCase())) score += 45;
          else continue; // A selector alone cannot override a semantic mismatch.
        }
        if (selectors.dataTestId && actual.attributes.testId === selectors.dataTestId) score += 120;
        if (selectors.id && element.id === selectors.id) score += 100;
        if (selectors.name && element.getAttribute('name') === selectors.name) score += 80;
        if (cssMatches.includes(element)) score += 65;
        if (descriptor?.attributes?.testId && actual.attributes.testId === descriptor.attributes.testId) score += 100;
        if ((descriptor?.region || selectors.region) && equal(actual.region, descriptor?.region || selectors.region)) score += 35;
        if (descriptor?.context && equal(actual.context, descriptor.context)) score += 45;
        if (descriptor?.location && actual.location === descriptor.location) score += 10;
        if (!expectedName && actual.name) {
          if (equal(actual.name, selector)) score += 100;
          const words = actual.name.toLowerCase().split(/\W+/);
          score += keywords.filter(word => words.includes(word)).length * 20;
        }
        if (score >= 40) ranked.push({ element, score });
      }
      ranked.sort((a, b) => b.score - a.score);
      if (!ranked.length) return { element: null, status: 'missing' };
      if (ranked[1] && ranked[0].score - ranked[1].score < 20) return { element: null, status: 'ambiguous' };
      return { ...ranked[0], status: 'matched' };
    }

    scrollContainers(element) {
      const containers = [];
      for (let parent = this.parent(element); parent; parent = this.parent(parent)) {
        const style = this.window.getComputedStyle(parent);
        if (/(auto|scroll|overlay)/.test(`${style.overflowX} ${style.overflowY}`) &&
            (parent.scrollHeight > parent.clientHeight || parent.scrollWidth > parent.clientWidth)) containers.push(parent);
      }
      if (this.document.scrollingElement && !containers.includes(this.document.scrollingElement)) containers.push(this.document.scrollingElement);
      return containers;
    }

    isReachable(element) {
      if (!this.isVisible(element) || !this.isEnabled(element)) return false;
      const rect = element.getBoundingClientRect();
      let left = Math.max(0, rect.left), top = Math.max(0, rect.top);
      let right = Math.min(this.window.innerWidth, rect.right), bottom = Math.min(this.window.innerHeight, rect.bottom);
      for (let parent = this.parent(element); parent; parent = this.parent(parent)) {
        const style = this.window.getComputedStyle(parent);
        const bounds = parent.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); }
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
      }
      if (right <= left || bottom <= top) return false;
      const points = [[(left + right) / 2, (top + bottom) / 2], [left + 2, top + 2], [right - 2, bottom - 2]];
      return points.some(([x, y]) => {
        let hit = this.document.elementFromPoint(x, y);
        while (hit?.shadowRoot?.elementFromPoint) {
          const inner = hit.shadowRoot.elementFromPoint(x, y);
          if (!inner || inner === hit) break;
          hit = inner;
        }
        return hit === element || element.contains(hit);
      });
    }

    async reveal(element, { signal, timeout = 1500 } = {}) {
      if (signal?.aborted) return false;
      element.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
      const start = Date.now();
      let previous = '', stable = 0;
      while (Date.now() - start < timeout && !signal?.aborted && element.isConnected) {
        const rect = element.getBoundingClientRect();
        const position = [rect.x, rect.y, rect.width, rect.height].map(Math.round).join(',');
        stable = position === previous ? stable + 1 : 0;
        previous = position;
        if (stable >= 2) return this.isReachable(element);
        await new Promise(resolve => this.window.setTimeout(resolve, 50));
      }
      return false;
    }
  }

  runtime.PageIntelligence = PageIntelligence;
})();
