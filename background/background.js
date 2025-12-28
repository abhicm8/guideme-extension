// GuideMe Background Service Worker
// Handles AI API communication

// Import GuideMe file format utilities
import { GuideMeFormat } from '../lib/guideme-format.js';

class GuideMeBackground {
  constructor() {
    this.init();
  }

  init() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'GENERATE_GUIDE') {
        this.generateGuide(message.payload)
          .then(result => sendResponse(result))
          .catch(error => sendResponse({ error: error.message }));
        return true;
      }
      
      if (message.type === 'CONTINUE_GUIDE') {
        this.continueGuide(message.payload)
          .then(result => sendResponse(result))
          .catch(error => sendResponse({ error: error.message }));
        return true;
      }

      // Macro Management
      if (message.type === 'SAVE_MACRO') {
        this.saveMacro(message.payload)
          .then(result => sendResponse(result))
          .catch(error => sendResponse({ error: error.message }));
        return true;
      }

      if (message.type === 'GET_MACROS') {
        this.getMacros()
          .then(result => sendResponse(result))
          .catch(error => sendResponse({ error: error.message }));
        return true;
      }

      if (message.type === 'DELETE_MACRO') {
        this.deleteMacro(message.payload)
          .then(result => sendResponse(result))
          .catch(error => sendResponse({ error: error.message }));
        return true;
      }

      if (message.type === 'UPDATE_MACRO') {
        this.updateMacro(message.payload)
          .then(result => sendResponse(result))
          .catch(error => sendResponse({ error: error.message }));
        return true;
      }
      
      // Export guide to .guideme format
      if (message.type === 'EXPORT_GUIDE') {
        this.exportGuide(message.payload)
          .then(result => sendResponse(result))
          .catch(error => sendResponse({ error: error.message }));
        return true;
      }
      
      // Import guide from .guideme format
      if (message.type === 'IMPORT_GUIDE') {
        this.importGuide(message.payload)
          .then(result => sendResponse(result))
          .catch(error => sendResponse({ error: error.message }));
        return true;
      }
      
      // Get AI template for guide generation
      if (message.type === 'GET_AI_TEMPLATE') {
        sendResponse({ template: GuideMeFormat.getAITemplate() });
        return true;
      }
    });
  }

  // ============ MACRO MANAGEMENT ============
  async saveMacro(payload) {
    const { name, steps, startUrl, task, category, isRecorded } = payload;
    
    console.log('GuideMe BG: saveMacro called with', steps?.length, 'steps', isRecorded ? '(recorded)' : '(AI-generated)');
    steps?.forEach((step, i) => {
      console.log(`GuideMe BG: Step ${i + 1}:`, {
        desc: step.description?.substring(0, 30),
        hasRobustSelectors: !!step.robustSelectors,
        selectorKeys: step.robustSelectors ? Object.keys(step.robustSelectors) : []
      });
    });
    
    const macros = await this.getMacros();
    
    const macro = {
      id: `macro_${Date.now()}`,
      name: name,
      task: task,
      steps: steps,
      startUrl: startUrl,
      startUrlPattern: new URL(startUrl).hostname,
      category: category || 'other',
      isRecorded: isRecorded || false,
      createdAt: Date.now()
    };
    
    macros.push(macro);
    await chrome.storage.local.set({ guideme_macros: macros });
    
    return { success: true, macro };
  }

  async getMacros() {
    const result = await chrome.storage.local.get(['guideme_macros']);
    return result.guideme_macros || [];
  }

  async deleteMacro(payload) {
    const { macroId } = payload;
    const macros = await this.getMacros();
    const filtered = macros.filter(m => m.id !== macroId);
    await chrome.storage.local.set({ guideme_macros: filtered });
    return { success: true };
  }

  async updateMacro(payload) {
    const { macroId, updates } = payload;
    const macros = await this.getMacros();
    const index = macros.findIndex(m => m.id === macroId);
    
    if (index === -1) {
      throw new Error('Guide not found');
    }
    
    // Apply updates
    macros[index] = {
      ...macros[index],
      ...updates,
      updatedAt: Date.now()
    };
    
    await chrome.storage.local.set({ guideme_macros: macros });
    return { success: true, macro: macros[index] };
  }

  // ============ EXPORT/IMPORT (.guideme format) ============
  async exportGuide(payload) {
    const { guideId } = payload;
    const macros = await this.getMacros();
    const guide = macros.find(m => m.id === guideId);
    
    if (!guide) {
      throw new Error('Guide not found');
    }
    
    // Convert to .guideme format with checksum
    const exported = await GuideMeFormat.exportGuide(guide);
    
    // Generate filename
    const safeName = guide.name.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const filename = `${safeName}.guideme`;
    
    return { 
      success: true, 
      data: exported,
      filename: filename,
      summary: GuideMeFormat.generateSummary(exported)
    };
  }
  
  async importGuide(payload) {
    const { jsonContent } = payload;
    
    // Validate and parse the .guideme file
    const result = await GuideMeFormat.importGuide(jsonContent);
    
    if (!result.success) {
      throw new Error(result.error);
    }
    
    // Check for duplicate (same importedFrom ID)
    const macros = await this.getMacros();
    const existingImport = macros.find(m => 
      m.importedFrom && m.importedFrom === result.guide.importedFrom
    );
    
    if (existingImport) {
      return {
        success: false,
        error: 'This guide has already been imported',
        existingGuide: existingImport.name
      };
    }
    
    // Save the imported guide
    macros.push(result.guide);
    await chrome.storage.local.set({ guideme_macros: macros });
    
    return { 
      success: true, 
      guide: result.guide,
      metadata: result.metadata,
      warnings: result.warnings
    };
  }

  async continueGuide(payload) {
    const { task, completedSteps, dom, url, title } = payload;
    
    // Get API settings from chrome.storage.local (same as popup uses)
    const settings = await chrome.storage.local.get(['apiProvider', 'apiKey']);
    const apiProvider = settings.apiProvider || 'gemini';
    const apiKey = settings.apiKey;
    
    if (!apiKey) {
      throw new Error('No API key configured. Please set your API key in the extension settings.');
    }

    console.log('GuideMe: Continuing guide with provider:', apiProvider);

    // Build continuation prompt
    const systemPrompt = this.buildContinuationSystemPrompt();
    const userPrompt = this.buildContinuationUserPrompt(task, completedSteps, url, title, dom);

    // Call API
    if (apiProvider === 'gemini') {
      return await this.callGemini(apiKey, systemPrompt, userPrompt);
    } else if (apiProvider === 'openai') {
      return await this.callOpenAI(apiKey, systemPrompt, userPrompt);
    } else if (apiProvider === 'anthropic') {
      return await this.callAnthropic(apiKey, systemPrompt, userPrompt);
    } else {
      throw new Error('Unknown API provider');
    }
  }

  buildContinuationSystemPrompt() {
    return `You are a website navigation assistant continuing a MULTI-PAGE task. The user has navigated to a new page and needs the next steps.

YOUR JOB: Guide the user through EACH PAGE until they reach the final destination where they can complete their task.

OUTPUT FORMAT (JSON only, no markdown):
{
  "steps": [
    {"elementId": "gm-5", "action": "click", "description": "Click the 'Submit' button"}
  ],
  "completed": false,
  "willNavigate": true,
  "reason": "Brief explanation - what page are we on and what's next"
}

CRITICAL - WHEN TO SET completed:
- completed: FALSE → User still needs to navigate more pages OR final action button NOT visible yet
- completed: TRUE → User has reached the FINAL page AND can complete the task with visible elements

FOR "CREATE/ADD/NEW" TASKS - BE STRICT:
- NEVER mark complete just because you found an element with matching text
- "create branch" is NOT complete until the branch creation input/form is visible
- "create repository" is NOT complete until on the repository creation page
- Must see actual form fields or creation buttons, not just navigation links!

EXAMPLE FLOW - "protect main branch":
- On Settings page → completed: false, find "Branches" link
- On Branches page → completed: false, find "Add rule" button  
- On Rule creation page → completed: true, user can now configure

EXAMPLE FLOW - "create a branch":
- On repo page → completed: false, click branch dropdown  
- Dropdown open → completed: false, look for "Create branch" option
- Creation form visible → completed: true

RULES:
1. Use ONLY element IDs from the provided list (gm-0, gm-1, etc.)
2. Maximum 3-5 steps per response
3. Set willNavigate: true when clicking will change the page/view
4. Each step description should be clear: "Click [element name]"
5. If needed element isn't visible, provide steps to reveal it
6. DON'T complete early - guide user all the way to the final page!

ELEMENT SELECTION:
- Prefer buttons over links for actions
- Prefer {primary-action} elements for main tasks  
- Prefer {dropdown} elements when looking for hidden options
- For GitHub: Settings tabs, sidebar links, "Add" buttons`;
  }

  buildContinuationUserPrompt(task, completedSteps, url, title, dom) {
    // Format elements concisely but with enough context
    const elementList = dom.elements
      .filter(e => e.type !== 'heading')
      .map(e => {
        let desc = `${e.id}: "${e.text}" [${e.type}]`;
        if (e.location && e.location !== 'page') desc += ` (${e.location})`;
        if (e.hints) desc += ` {${e.hints}}`;
        return desc;
      })
      .join('\n');
    
    const stepCount = completedSteps ? completedSteps.length : 0;
    const recentSteps = completedSteps && completedSteps.length > 0
      ? completedSteps.slice(-3).map((s, i) => `- ${s.description}`).join('\n')
      : 'None';

    // Detect site and provide context
    let siteContext = '';
    if (url.includes('github.com')) {
      if (url.includes('/settings/branch_protection_rules/new') || 
          url.includes('/settings/rules/') ||
          title.toLowerCase().includes('branch protection rule') ||
          title.toLowerCase().includes('ruleset')) {
        siteContext = 'ON BRANCH PROTECTION RULE PAGE - User can now configure protection settings. Set completed: true!';
      } else if (url.includes('/settings/branches')) {
        siteContext = 'On Branches settings page. Look for "Add rule" or "Add branch protection rule" button.';
      } else if (url.includes('/settings')) {
        siteContext = 'Currently in GitHub Settings. Look for specific setting categories in sidebar.';
      } else if (url.includes('/new')) {
        siteContext = 'ON A CREATION PAGE - User can fill out the form. Set completed: true if create/new form is visible!';
      }
    }

    // Check if task appears to be satisfied based on page content
    let taskHint = '';
    const taskLower = task.toLowerCase();
    const titleLower = title.toLowerCase();
    if (taskLower.includes('protect') && (titleLower.includes('protection') || titleLower.includes('ruleset'))) {
      taskHint = '\n\n⚠️ COMPLETION HINT: User asked to "protect" and is now on a protection/ruleset page. Set completed: true!';
    } else if (taskLower.includes('create') && (url.includes('/new') || titleLower.includes('create') || titleLower.includes('new'))) {
      taskHint = '\n\n⚠️ COMPLETION HINT: User asked to "create" and is now on a creation page. Set completed: true if form is visible!';
    }

    return `ORIGINAL TASK: "${task}"

CURRENT PAGE: ${title}
URL: ${url}
${siteContext ? `CONTEXT: ${siteContext}` : ''}

PROGRESS SO FAR (${stepCount} steps completed):
${recentSteps}

AVAILABLE ELEMENTS ON THIS PAGE:
${elementList}

Provide the NEXT steps to continue toward: "${task}"

IMPORTANT:
- If user is NOT on the final page yet, set completed: false and guide them further
- If clicking will navigate to another page, set willNavigate: true
- Only set completed: true when the final action/form is visible on THIS page
- For "create/add/new" tasks: completed: true ONLY when the creation form/dialog is visible!
- Finding a link with matching text is NOT completion - guide user TO the form!${taskHint}`;
  }

  async generateGuide(payload) {
    const { task, url, title, dom, apiProvider, apiKey } = payload;

    // Build prompt
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(task, url, title, dom);

    // Call appropriate API
    if (apiProvider === 'gemini') {
      return await this.callGemini(apiKey, systemPrompt, userPrompt);
    } else if (apiProvider === 'openai') {
      return await this.callOpenAI(apiKey, systemPrompt, userPrompt);
    } else if (apiProvider === 'anthropic') {
      return await this.callAnthropic(apiKey, systemPrompt, userPrompt);
    } else {
      throw new Error('Unknown API provider');
    }
  }

  buildSystemPrompt() {
    return `You are a website navigation assistant. Your job is to identify which elements the user should click to accomplish their task.

INPUT: A list of clickable elements with unique IDs (gm-0, gm-1, etc.)
OUTPUT: JSON with steps referencing these exact IDs

RESPONSE FORMAT (JSON only, no markdown):
{
  "steps": [
    {"elementId": "gm-5", "action": "click", "description": "Click the 'Sign In' button"}
  ],
  "completed": false,
  "willNavigate": true
}

CRITICAL RULES:
1. ONLY use element IDs from the provided list - never make up IDs
2. Maximum 3-5 steps per response
3. Each step = ONE click
4. Be specific in descriptions: "Click 'Settings' in the sidebar" not just "Click Settings"
5. ALWAYS provide at least 1 step that moves toward the goal, even if indirectly

NAVIGATION STRATEGY - When the target isn't directly visible:
- For GitHub: Look for "Settings" tab/link, user menu, repository tabs
- For settings/configuration: Find "Settings", "Options", "Preferences", gear icons
- For creating new items: Look for "New", "Create", "Add", "+" buttons
- DON'T say you can't help - find the CLOSEST element that leads toward the goal

ELEMENT SELECTION PRIORITY:
When multiple elements have similar text, choose based on:
1. TYPE: For actions, prefer [button] over [link]
2. HINTS: Prefer {primary-action} or {dropdown} over {navigation}
3. LOCATION: For main tasks, prefer (main) over (sidebar) or (header)

GITHUB-SPECIFIC NAVIGATION:
- "protect branch" → Settings tab → Branches → Add rule
- "create repository" → "+" icon in header OR "New" button OR user menu → "New repository"
- "create issue" → Issues tab → "New issue" button
- "create pull request" → Pull requests tab → "New pull request" button
- "fork repository" → "Fork" button (usually in header near Star/Watch)

WHEN TO SET completed: false (KEEP GOING):
- User is NOT on the final page yet
- There are more navigation steps needed (Settings → Branches → Add rule)
- The final "submit"/"create"/"save" button is NOT visible yet
- You just pointed to a navigation link (Settings, tabs, menu items)
- Task says "create/add/new" but no creation form is visible yet
- You're pointing to a link/button that LEADS TO the action, not the action itself

WHEN TO SET completed: true (STOP):
- The FINAL action button/form is visible AND user can complete the task NOW
- User can see input fields, submit buttons, or configuration options
- Simple "find/show/locate" tasks - after pointing to the target element
- User has reached the destination page with all needed elements visible

CRITICAL - "CREATE" TASKS:
- "create branch" → Must reach the branch creation dropdown/form, NOT just the branch link
- "create repository" → Must reach the "New repository" form page
- "create issue" → Must reach the issue creation form
- NEVER mark "create X" as complete until the creation form/dialog is visible!

WHEN TO SET willNavigate: true:
- When clicking will load a new page or significantly change the view
- Settings links, tab switches, menu navigation, form submissions
- Dropdowns that reveal forms count as navigation too!
- This tells the extension to continue the guide after the page changes!

EXAMPLE - "protect main branch" (multi-page):
Page 1 (repo home): completed: false, willNavigate: true → click Settings
Page 2 (settings): completed: false, willNavigate: true → click Branches  
Page 3 (branches): completed: false → click Add rule
Page 4 (rule form): completed: true → user can now configure protection

EXAMPLE - "create a branch":
Step 1: completed: false → click branch dropdown (shows "1 Branch" or branch name)
Step 2: completed: false → type in "Find or create a branch" input  
Step 3: completed: true → click "Create branch: X" button when it appears

NEVER return empty steps array - always provide guidance toward the goal.`;
  }

  buildUserPrompt(task, url, title, dom) {
    // Format elements concisely with relevant hints
    const elementList = dom.elements
      .filter(e => e.type !== 'heading')
      .map(e => {
        let desc = `${e.id}: "${e.text}" [${e.type}]`;
        if (e.location && e.location !== 'page') desc += ` (${e.location})`;
        if (e.hints) desc += ` {${e.hints}}`;
        return desc;
      })
      .join('\n');
    
    // Get page headings for context
    const headings = dom.elements
      .filter(e => e.type === 'heading')
      .map(e => e.text)
      .slice(0, 3) // Limit to first 3 headings
      .join(' > ');

    // Detect modal state
    let stateInfo = '';
    if (dom.pageContext?.hasModal) {
      stateInfo = '\n⚠️ A MODAL/DIALOG IS OPEN - prioritize {in-modal} elements!';
    }
    
    // Identify likely navigation elements for the AI
    const navElements = dom.elements
      .filter(e => {
        const text = (e.text || '').toLowerCase();
        const hints = (e.hints || '').toLowerCase();
        return text.includes('settings') || text.includes('new') || 
               text.includes('create') || text === '+' ||
               hints.includes('dropdown') || hints.includes('menu') ||
               e.location === 'header' || e.location === 'nav';
      })
      .slice(0, 10)
      .map(e => `${e.id}: "${e.text}"`)
      .join(', ');
    
    // Detect site type for better guidance
    let siteHint = '';
    if (url.includes('github.com')) {
      siteHint = '\nSITE: GitHub - Settings tab has branch protection, "+" icon or user menu has "New repository"';
    } else if (url.includes('gitlab.com')) {
      siteHint = '\nSITE: GitLab - Settings in left sidebar';
    }

    return `PAGE: ${title}
URL: ${url}
CONTEXT: ${headings || 'Main page'}${stateInfo}${siteHint}

TASK: "${task}"

KEY NAVIGATION ELEMENTS: ${navElements || 'None identified'}

ALL ELEMENTS (use these IDs):
${elementList}

Provide steps to accomplish: "${task}"
If the direct action element isn't visible, guide the user to navigate closer (e.g., click Settings first).
ALWAYS provide at least 1 actionable step - never return empty steps.`;
  }

  condenseDom(dom) {
    // No longer needed - buildUserPrompt handles this
    return dom;
  }

  async callOpenAI(apiKey, systemPrompt, userPrompt) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.2,  // Low but not zero for better reasoning
        max_tokens: 1500,
        response_format: { type: "json_object" }  // Force JSON output
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'OpenAI API error');
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;

    return this.parseAIResponse(content);
  }

  async callGemini(apiKey, systemPrompt, userPrompt) {
    // Use stable Gemini models - try multiple in case of issues
    const models = [
      'gemini-2.5-flash',        // Primary: Fast and capable
      'gemini-flash-latest', // Fallback: Latest flash version
    ];
    
    let lastError = null;
    
    for (const model of models) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: `${systemPrompt}\n\n${userPrompt}` }
                ]
              }
            ],
            generationConfig: {
              temperature: 0.1,  // Small temperature for slight creativity while being consistent
              maxOutputTokens: 2048,
              responseMimeType: "application/json"
            }
          })
        });

        if (!response.ok) {
          const error = await response.json();
          const errorMsg = error.error?.message || 'Unknown error';
          
          // If model not found or quota exceeded, try next model
          if (errorMsg.includes('not found') || 
              errorMsg.includes('quota') || 
              errorMsg.includes('exceeded') ||
              error.error?.code === 404 ||
              error.error?.code === 429) {
            lastError = errorMsg;
            console.log(`GuideMe: Model ${model} unavailable, trying next...`);
            continue;
          }
          throw new Error(errorMsg);
        }

        const data = await response.json();
        
        // Check for blocked content
        if (data.candidates?.[0]?.finishReason === 'SAFETY') {
          throw new Error('Response blocked by safety filters. Try rephrasing your request.');
        }
        
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!content) {
          throw new Error('No response from Gemini. Please try again.');
        }

        console.log(`GuideMe: Success with model: ${model}`);
        return this.parseAIResponse(content);
        
      } catch (error) {
        lastError = error.message;
        // If quota/rate limit error, try next model
        if (error.message?.includes('quota') || error.message?.includes('exceeded')) {
          console.log(`GuideMe: Quota issue with ${model}, trying next...`);
          continue;
        }
        // For other errors, throw immediately
        if (!error.message?.includes('not found')) {
          throw error;
        }
      }
    }
    
    // If all models failed, add helpful message
    console.error('GuideMe: All Gemini models exhausted. Last error:', lastError);
    throw new Error(`API rate limited. Please wait 10-15 seconds and try again. (${lastError})`);
  }

  async callAnthropic(apiKey, systemPrompt, userPrompt) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1000,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userPrompt }
        ]
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Anthropic API error');
    }

    const data = await response.json();
    const content = data.content[0]?.text;

    return this.parseAIResponse(content);
  }

  parseAIResponse(content) {
    try {
      console.log('Raw AI response:', content);
      
      if (!content || content.length === 0) {
        throw new Error('Empty response from AI');
      }
      
      let jsonStr = content;
      
      // Method 1: Remove markdown code blocks - handle various formats
      // Match ```json or ``` at start and ``` at end
      jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
      
      // Also handle case where ``` is in the middle
      if (jsonStr.includes('```')) {
        const parts = jsonStr.split('```');
        // Find the part that looks like JSON
        for (const part of parts) {
          const trimmed = part.replace(/^json\s*/i, '').trim();
          if (trimmed.startsWith('{')) {
            jsonStr = trimmed;
            break;
          }
        }
      }

      // Method 2: Find JSON object by looking for opening brace
      if (!jsonStr.trim().startsWith('{')) {
        const braceIndex = jsonStr.indexOf('{');
        if (braceIndex !== -1) {
          jsonStr = jsonStr.substring(braceIndex);
        }
      }
      
      // Find the matching closing brace
      let depth = 0;
      let endIndex = -1;
      let inString = false;
      let escape = false;
      
      for (let i = 0; i < jsonStr.length; i++) {
        const char = jsonStr[i];
        
        if (escape) {
          escape = false;
          continue;
        }
        
        if (char === '\\') {
          escape = true;
          continue;
        }
        
        if (char === '"') {
          inString = !inString;
          continue;
        }
        
        if (!inString) {
          if (char === '{') depth++;
          if (char === '}') {
            depth--;
            if (depth === 0) {
              endIndex = i;
              break;
            }
          }
        }
      }
      
      if (endIndex !== -1) {
        jsonStr = jsonStr.substring(0, endIndex + 1);
      }

      // Clean up common issues
      jsonStr = jsonStr
        .replace(/,\s*}/g, '}')  // Remove trailing commas
        .replace(/,\s*]/g, ']')  // Remove trailing commas in arrays
        .replace(/[\x00-\x1F\x7F]/g, ' ') // Remove control characters
        .trim();

      console.log('Cleaned JSON:', jsonStr.substring(0, 500) + (jsonStr.length > 500 ? '...' : ''));
      
      const parsed = JSON.parse(jsonStr);

      // Validate structure
      if (!parsed.steps || !Array.isArray(parsed.steps)) {
        console.error('Missing steps array in parsed response:', parsed);
        throw new Error('Invalid response format - missing steps');
      }

      // Validate each step has required fields
      const validatedSteps = parsed.steps.map((step, index) => ({
        element: step.elementId || step.element || step.selector || 'body',
        action: step.action || 'click',
        description: step.description || step.instruction || `Step ${index + 1}`
      }));

      console.log('GuideMe: Parsed steps:', validatedSteps);
      console.log('GuideMe: completed:', parsed.completed, 'willNavigate:', parsed.willNavigate);

      // CRITICAL: If AI returns 0 steps on initial request, that's an error
      // (Empty steps on continuation with completed:true is OK)
      if (validatedSteps.length === 0 && !parsed.completed) {
        // Check if there's a reason provided
        const reason = parsed.reason || parsed.message || parsed.note;
        if (reason) {
          // Provide a helpful step with the reason instead of failing
          return {
            steps: [{
              element: 'body',
              action: 'info',
              description: `Navigation hint: ${reason}. Look for Settings, menus, or navigation tabs to proceed.`
            }],
            canComplete: false,
            note: reason
          };
        }
        throw new Error('AI returned no steps. Try rephrasing your question or being more specific.');
      }

      return {
        steps: validatedSteps,
        canComplete: parsed.canComplete !== false,
        completed: parsed.completed === true,  // Must explicitly be true
        willNavigate: parsed.willNavigate === true,
        progress: parsed.progress || parsed.navigationHint || null,
        note: parsed.note || parsed.message || null
      };
    } catch (error) {
      console.error('Failed to parse AI response:', error.message);
      console.error('Original content:', content);
      
      // Last resort: try to extract any useful steps from partial JSON
      if (content && content.length > 0) {
        // Try to extract elementId AND description from broken JSON
        const elementMatches = content.match(/"elementId"\s*:\s*"(gm-\d+)"/g);
        const descMatches = content.match(/"description"\s*:\s*"([^"]+)"/g);
        
        if (elementMatches && elementMatches.length > 0) {
          const extractedSteps = elementMatches.map((match, index) => {
            const elemId = match.match(/"elementId"\s*:\s*"(gm-\d+)"/);
            const desc = descMatches && descMatches[index] ? 
              descMatches[index].match(/"description"\s*:\s*"([^"]+)"/)?.[1] : 
              `Click element ${index + 1}`;
            return {
              element: elemId ? elemId[1] : 'body',
              action: 'click',
              description: desc || `Step ${index + 1}`
            };
          });
          console.log('GuideMe: Recovered', extractedSteps.length, 'steps from broken JSON');
          return {
            steps: extractedSteps,
            canComplete: true,
            note: 'Guide recovered from partial response'
          };
        }
        
        // Fallback: just extract descriptions
        if (descMatches && descMatches.length > 0) {
          const extractedSteps = descMatches.map((match, index) => {
            const desc = match.match(/"description"\s*:\s*"([^"]+)"/);
            return {
              element: 'body',
              action: 'info',
              description: desc ? desc[1] : `Step ${index + 1}`
            };
          });
          console.log('GuideMe: Recovered partial steps (no element IDs) from broken JSON');
          return {
            steps: extractedSteps,
            canComplete: true,
            note: 'Guide recovered - elements may not highlight correctly'
          };
        }
        
        // Check if AI said it can't do something
        const lowerContent = content.toLowerCase();
        if (lowerContent.includes("can't") || lowerContent.includes("cannot") || lowerContent.includes("unable")) {
          return {
            steps: [{
              element: 'body',
              action: 'info',
              description: 'The AI was unable to create a guide for this task. Try rephrasing your request or being more specific.'
            }],
            canComplete: false,
            note: content.substring(0, 200)
          };
        }
      }
      
      throw new Error('Failed to parse AI response. The AI may have returned an incomplete response. Please try again.');
    }
  }
}

// Initialize background service
const guideme = new GuideMeBackground();
