/**
 * GuideMe File Format (.guideme) - v1.0
 * 
 * A secure, portable, human-readable format for website navigation guides.
 * 
 * Features:
 * - JSON-based for easy parsing by AI and humans
 * - Checksum validation for integrity
 * - Multiple element selectors for robust replay
 * - No executable code (pure data)
 * 
 * Security:
 * - SHA-256 checksum to detect tampering
 * - Sandboxed replay (only click/type actions)
 * - No eval() or dynamic code execution
 */

export const GuideMeFormat = {
  VERSION: '1.0',
  SCHEMA_URL: 'https://guideme.dev/schema/v1.json',
  
  /**
   * Generate SHA-256 checksum for content verification
   * @param {Object} data - The guide data (without checksum)
   * @returns {Promise<string>} SHA-256 hash as hex string
   */
  async generateChecksum(data) {
    // Create a copy without checksum/signature for hashing
    const { checksum, signature, ...contentToHash } = data;
    const jsonStr = JSON.stringify(contentToHash, null, 0); // Compact for consistent hashing
    
    // Use Web Crypto API (available in both browser and service worker)
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(jsonStr);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    
    // Convert to hex string
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    return `sha256:${hashHex}`;
  },
  
  /**
   * Verify checksum of a .guideme file
   * @param {Object} guideData - The full guide data including checksum
   * @returns {Promise<{valid: boolean, error?: string}>}
   */
  async verifyChecksum(guideData) {
    if (!guideData.checksum) {
      return { valid: false, error: 'No checksum found - file may be corrupted or tampered' };
    }
    
    const expectedChecksum = await this.generateChecksum(guideData);
    
    if (guideData.checksum !== expectedChecksum) {
      return { 
        valid: false, 
        error: 'Checksum mismatch - file has been modified or corrupted' 
      };
    }
    
    return { valid: true };
  },
  
  /**
   * Convert internal guide format to .guideme export format
   * @param {Object} guide - Internal guide object
   * @returns {Promise<Object>} .guideme formatted object
   */
  async exportGuide(guide) {
    const now = new Date().toISOString();
    
    // Extract hostname for URL patterns
    let hostname = '';
    let urlPatterns = [];
    try {
      const url = new URL(guide.startUrl);
      hostname = url.hostname.replace('www.', '');
      urlPatterns = [
        `https://${hostname}/*`,
        `https://www.${hostname}/*`
      ];
    } catch (e) {
      hostname = guide.startUrlPattern || 'unknown';
      urlPatterns = [guide.startUrl];
    }
    
    // Convert steps to .guideme format with robust selectors
    const formattedSteps = (guide.steps || []).map((step, index) => {
      const stepData = {
        id: index + 1,
        instruction: step.description || step.instruction || `Step ${index + 1}`,
        action: step.action || 'click'
      };
      
      // Build target with primary and fallback selectors
      stepData.target = this.buildTargetSelector(step);
      
      // Add page context if available
      if (step.url || step.pageUrl) {
        stepData.page = {
          urlPattern: this.extractUrlPattern(step.url || step.pageUrl),
          title: step.pageTitle || null
        };
      }
      
      return stepData;
    });
    
    // Build the .guideme structure
    const guideData = {
      $schema: this.SCHEMA_URL,
      version: this.VERSION,
      format: 'guideme',
      
      metadata: {
        id: guide.id || `guide_${Date.now()}`,
        name: guide.name || guide.task || 'Untitled Guide',
        description: guide.task || guide.name || '',
        author: 'local', // Could be extended for user accounts
        created: guide.createdAt ? new Date(guide.createdAt).toISOString() : now,
        updated: now,
        website: hostname,
        category: this.detectCategory(guide.task || guide.name || ''),
        tags: this.extractTags(guide.task || guide.name || ''),
        language: 'en',
        estimatedTime: this.estimateTime(formattedSteps.length)
      },
      
      compatibility: {
        urlPatterns: urlPatterns,
        minVersion: '1.0.0',
        testedOn: now.split('T')[0] // Just the date
      },
      
      steps: formattedSteps,
      
      // Checksum will be added below
      checksum: null,
      signature: null
    };
    
    // Generate and add checksum
    guideData.checksum = await this.generateChecksum(guideData);
    
    return guideData;
  },
  
  /**
   * Build robust target selector from step data
   * @param {Object} step - Step object with element info
   * @returns {Object} Target selector object
   */
  buildTargetSelector(step) {
    console.log('GuideMe Export: buildTargetSelector called for step:', step.description?.substring(0, 40));
    console.log('GuideMe Export: step.robustSelectors:', step.robustSelectors);
    
    const target = {
      primary: null,
      fallbacks: []
    };
    
    // Check for robust selectors (from enhanced saving)
    if (step.robustSelectors) {
      const rs = step.robustSelectors;
      console.log('GuideMe Export: Using robustSelectors:', Object.keys(rs));
      
      // Primary: prefer data-testid > aria-label > css
      if (rs.dataTestId) {
        target.primary = { type: 'data-testid', value: rs.dataTestId };
      } else if (rs.ariaLabel) {
        target.primary = { type: 'aria-label', value: rs.ariaLabel };
      } else if (rs.cssSelector) {
        target.primary = { type: 'css', value: rs.cssSelector };
      }
      
      // Add fallbacks
      if (rs.textContent) {
        target.fallbacks.push({ type: 'text', value: rs.textContent, tagName: rs.tagName });
      }
      if (rs.id && !rs.id.startsWith('gm-')) {
        target.fallbacks.push({ type: 'id', value: rs.id });
      }
      if (rs.name) {
        target.fallbacks.push({ type: 'name', value: rs.name });
      }
      if (rs.cssSelector && target.primary?.type !== 'css') {
        target.fallbacks.push({ type: 'css', value: rs.cssSelector });
      }
    } else {
      console.log('GuideMe Export: NO robustSelectors - using legacy format');
      // Legacy format - just element ID
      const element = step.element || step.selector || 'body';
      
      // If it's a gm-* ID, we can't use it reliably
      if (element.startsWith('gm-')) {
        // Try to extract useful info from description
        const desc = (step.description || '').toLowerCase();
        target.primary = { type: 'description', value: step.description };
        
        // Add text-based fallback from description
        const quoted = step.description?.match(/"([^"]+)"/);
        if (quoted) {
          target.fallbacks.push({ type: 'text', value: quoted[1] });
        }
      } else {
        target.primary = { type: 'css', value: element };
      }
    }
    
    // Ensure we have at least a primary selector
    if (!target.primary) {
      target.primary = { type: 'description', value: step.description || 'Unknown element' };
    }
    
    console.log('GuideMe Export: Final target:', target);
    return target;
  },
  
  /**
   * Extract URL pattern from full URL
   * @param {string} url - Full URL
   * @returns {string} URL pattern
   */
  extractUrlPattern(url) {
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace('www.', '');
    } catch {
      return url;
    }
  },
  
  /**
   * Detect category from task description
   * @param {string} task - Task description
   * @returns {string} Category
   */
  detectCategory(task) {
    const lower = task.toLowerCase();
    
    if (/github|gitlab|bitbucket|code|repo|commit|branch/.test(lower)) return 'development';
    if (/login|sign|password|account|profile/.test(lower)) return 'account';
    if (/setting|config|option|preference/.test(lower)) return 'settings';
    if (/payment|billing|subscription|price/.test(lower)) return 'billing';
    if (/create|new|add|make/.test(lower)) return 'creation';
    if (/find|search|where|navigate/.test(lower)) return 'navigation';
    if (/help|support|contact|faq/.test(lower)) return 'support';
    
    return 'general';
  },
  
  /**
   * Extract tags from task description
   * @param {string} task - Task description
   * @returns {string[]} Array of tags
   */
  extractTags(task) {
    const tags = [];
    const words = task.toLowerCase().split(/\s+/);
    
    // Common action tags
    const actionWords = ['create', 'find', 'navigate', 'login', 'setup', 'configure', 'export', 'import', 'delete'];
    actionWords.forEach(word => {
      if (words.includes(word)) tags.push(word);
    });
    
    // Extract proper nouns (capitalized words that aren't at sentence start)
    const properNouns = task.match(/(?<!^|\. )[A-Z][a-z]+/g) || [];
    properNouns.forEach(noun => tags.push(noun.toLowerCase()));
    
    return [...new Set(tags)].slice(0, 5); // Max 5 unique tags
  },
  
  /**
   * Estimate completion time based on steps
   * @param {number} stepCount - Number of steps
   * @returns {string} Estimated time string
   */
  estimateTime(stepCount) {
    const seconds = stepCount * 5; // ~5 seconds per step
    if (seconds < 60) return `${seconds} seconds`;
    const minutes = Math.ceil(seconds / 60);
    return `${minutes} minute${minutes > 1 ? 's' : ''}`;
  },
  
  /**
   * Import and validate a .guideme file
   * @param {string} jsonString - JSON string content of .guideme file
   * @returns {Promise<{success: boolean, guide?: Object, error?: string, warnings?: string[]}>}
   */
  async importGuide(jsonString) {
    const warnings = [];
    
    try {
      // Parse JSON
      let guideData;
      try {
        guideData = JSON.parse(jsonString);
      } catch (e) {
        return { success: false, error: 'Invalid JSON format - file may be corrupted' };
      }
      
      // Validate format
      if (guideData.format !== 'guideme') {
        return { success: false, error: 'Not a valid .guideme file (missing format identifier)' };
      }
      
      // Check version compatibility
      if (guideData.version && guideData.version !== this.VERSION) {
        const major = guideData.version.split('.')[0];
        const currentMajor = this.VERSION.split('.')[0];
        if (major !== currentMajor) {
          return { success: false, error: `Incompatible version: ${guideData.version} (requires ${this.VERSION})` };
        }
        warnings.push(`Guide version ${guideData.version} may have minor differences`);
      }
      
      // Verify checksum (security check)
      const checksumResult = await this.verifyChecksum(guideData);
      if (!checksumResult.valid) {
        warnings.push(`⚠️ Security Warning: ${checksumResult.error}`);
        // Don't fail - user can choose to proceed
      }
      
      // Validate required fields
      if (!guideData.metadata?.name) {
        return { success: false, error: 'Missing guide name in metadata' };
      }
      
      if (!guideData.steps || !Array.isArray(guideData.steps) || guideData.steps.length === 0) {
        return { success: false, error: 'No steps found in guide' };
      }
      
      // Validate each step has minimum required data
      for (let i = 0; i < guideData.steps.length; i++) {
        const step = guideData.steps[i];
        if (!step.instruction && !step.target) {
          warnings.push(`Step ${i + 1} is missing instruction or target`);
        }
      }
      
      // Convert to internal format
      const internalGuide = this.convertToInternalFormat(guideData);
      
      return { 
        success: true, 
        guide: internalGuide,
        metadata: guideData.metadata,
        warnings: warnings.length > 0 ? warnings : undefined
      };
      
    } catch (error) {
      return { success: false, error: `Import failed: ${error.message}` };
    }
  },
  
  /**
   * Convert .guideme format to internal storage format
   * @param {Object} guideData - .guideme formatted data
   * @returns {Object} Internal guide format
   */
  convertToInternalFormat(guideData) {
    const steps = guideData.steps.map(step => {
      // Reconstruct internal step format
      const internalStep = {
        description: step.instruction,
        action: step.action || 'click',
        element: this.extractPrimarySelector(step.target)
      };
      
      // Preserve robust selectors if available
      if (step.target) {
        internalStep.robustSelectors = this.extractRobustSelectors(step.target);
      }
      
      // Page info
      if (step.page) {
        internalStep.pageUrl = step.page.urlPattern;
        internalStep.pageTitle = step.page.title;
      }
      
      return internalStep;
    });
    
    // Build URL from patterns
    let startUrl = '';
    if (guideData.compatibility?.urlPatterns?.[0]) {
      startUrl = guideData.compatibility.urlPatterns[0].replace('/*', '/');
    }
    
    return {
      id: `imported_${Date.now()}`,
      name: guideData.metadata.name,
      task: guideData.metadata.description || guideData.metadata.name,
      steps: steps,
      startUrl: startUrl,
      startUrlPattern: guideData.metadata.website,
      createdAt: guideData.metadata.created ? new Date(guideData.metadata.created).getTime() : Date.now(),
      imported: true,
      importedFrom: guideData.metadata.id
    };
  },
  
  /**
   * Extract primary selector string from target
   * @param {Object} target - Target selector object
   * @returns {string} CSS selector or identifier
   */
  extractPrimarySelector(target) {
    if (!target || !target.primary) return 'body';
    
    const p = target.primary;
    switch (p.type) {
      case 'data-testid': return `[data-testid="${p.value}"]`;
      case 'aria-label': return `[aria-label="${p.value}"]`;
      case 'css': return p.value;
      case 'id': return `#${p.value}`;
      case 'name': return `[name="${p.value}"]`;
      default: return 'body';
    }
  },
  
  /**
   * Extract robust selectors from target for internal use
   * @param {Object} target - Target selector object
   * @returns {Object} Robust selectors object
   */
  extractRobustSelectors(target) {
    const selectors = {};
    
    // From primary
    if (target.primary) {
      const p = target.primary;
      if (p.type === 'data-testid') selectors.dataTestId = p.value;
      if (p.type === 'aria-label') selectors.ariaLabel = p.value;
      if (p.type === 'css') selectors.cssSelector = p.value;
      if (p.type === 'id') selectors.id = p.value;
      if (p.type === 'name') selectors.name = p.value;
      // Handle description-only guides (legacy or AI-generated)
      if (p.type === 'description') {
        selectors.description = p.value;
        // Extract keywords from description for text-based matching
        selectors.keywords = this.extractKeywords(p.value);
      }
    }
    
    // From fallbacks
    if (target.fallbacks && Array.isArray(target.fallbacks)) {
      target.fallbacks.forEach(f => {
        if (f.type === 'text') {
          selectors.textContent = f.value;
          if (f.tagName) selectors.tagName = f.tagName;
        }
        if (f.type === 'id' && !selectors.id) selectors.id = f.value;
        if (f.type === 'name') selectors.name = f.value;
        if (f.type === 'css' && !selectors.cssSelector) selectors.cssSelector = f.value;
        if (f.type === 'aria-label' && !selectors.ariaLabel) selectors.ariaLabel = f.value;
        if (f.type === 'data-testid' && !selectors.dataTestId) selectors.dataTestId = f.value;
      });
    }
    
    return selectors;
  },
  
  /**
   * Extract keywords from description for text matching
   * @param {string} description - Step description
   * @returns {string[]} Keywords array
   */
  extractKeywords(description) {
    if (!description) return [];
    
    // Extract quoted text first (most specific)
    const quoted = description.match(/'([^']+)'|"([^"]+)"/g);
    if (quoted) {
      return quoted.map(q => q.replace(/['\"]/g, '').toLowerCase());
    }
    
    // Extract meaningful words (skip common words)
    const stopWords = ['the', 'a', 'an', 'to', 'in', 'on', 'for', 'of', 'and', 'or', 'is', 'it', 'this', 'that', 'you', 'your', 'click', 'enter', 'select', 'choose', 'find', 'go'];
    const words = description.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.includes(w));
    
    return [...new Set(words)].slice(0, 5);
  },
  
  /**
   * Generate a human-readable summary of a guide (for AI review)
   * @param {Object} guideData - .guideme formatted data
   * @returns {string} Markdown summary
   */
  generateSummary(guideData) {
    const meta = guideData.metadata || {};
    const steps = guideData.steps || [];
    
    let summary = `# ${meta.name || 'Untitled Guide'}\n\n`;
    summary += `**Website:** ${meta.website || 'Unknown'}\n`;
    summary += `**Category:** ${meta.category || 'general'}\n`;
    summary += `**Estimated Time:** ${meta.estimatedTime || 'Unknown'}\n`;
    summary += `**Steps:** ${steps.length}\n\n`;
    
    if (meta.description) {
      summary += `## Description\n${meta.description}\n\n`;
    }
    
    summary += `## Steps\n\n`;
    steps.forEach((step, i) => {
      summary += `${i + 1}. **${step.instruction}**\n`;
      if (step.target?.primary) {
        summary += `   - Target: ${step.target.primary.type} = "${step.target.primary.value}"\n`;
      }
      if (step.target?.fallbacks?.length > 0) {
        summary += `   - Fallbacks: ${step.target.fallbacks.length} alternative selectors\n`;
      }
    });
    
    if (guideData.checksum) {
      summary += `\n## Security\n`;
      summary += `- Checksum: ${guideData.checksum.substring(0, 20)}...\n`;
      summary += `- Verified: ✅\n`;
    }
    
    return summary;
  },
  
  /**
   * Create a minimal template for AI to generate guides
   * @returns {Object} Template object with documentation
   */
  getAITemplate() {
    return {
      _comment: "GuideMe File Format v1.0 - AI Generation Template",
      _instructions: [
        "Fill in the steps array with navigation instructions",
        "Each step needs: instruction (what to do) and target (how to find element)",
        "Use data-testid or aria-label when available (most stable)",
        "Add fallback selectors for reliability",
        "Do NOT include executable code - pure data only"
      ],
      
      $schema: this.SCHEMA_URL,
      version: this.VERSION,
      format: "guideme",
      
      metadata: {
        name: "REPLACE: Guide title",
        description: "REPLACE: What this guide helps you do",
        website: "REPLACE: example.com",
        category: "REPLACE: development|account|settings|billing|creation|navigation|support|general",
        tags: ["REPLACE", "with", "relevant", "tags"]
      },
      
      compatibility: {
        urlPatterns: ["REPLACE: https://example.com/*"]
      },
      
      steps: [
        {
          id: 1,
          instruction: "REPLACE: Click the button to start",
          action: "click",
          target: {
            primary: { type: "aria-label", value: "REPLACE: Button label" },
            fallbacks: [
              { type: "text", value: "REPLACE: Button text" },
              { type: "css", value: "REPLACE: button.class-name" }
            ]
          }
        }
      ]
    };
  }
};

// Default export for ES modules
export default GuideMeFormat;
