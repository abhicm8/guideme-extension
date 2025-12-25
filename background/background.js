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
    const { name, steps, startUrl, task, category } = payload;
    
    console.log('GuideMe BG: saveMacro called with', steps?.length, 'steps');
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
    return `You are a website navigation assistant guiding a user through a task. After the user clicks something, you provide next steps.

CRITICAL - MULTI-PAGE WORKFLOWS:
Many tasks span multiple pages. Examples:
- Creating a Pull Request from a Fork: fork repo → make changes → go to original repo → click "Pull requests" → click "New pull request" → select "compare across forks" → select your fork → create PR
- Contributing to open source: fork → clone → branch → commit → push → create PR
- Account setup: sign up → verify email → complete profile → configure settings

DO NOT mark these as "completed" until the user reaches the FINAL destination!

CRITICAL - WHEN TO MARK COMPLETED:
Mark "completed": true ONLY when ALL of these are true:

1. ✅ USER IS ON THE FINAL PAGE - The actual destination, not an intermediate page
   - For "create PR from fork": User is on the "Open a pull request" form page
   - For "create repo": User is on the repository creation form
   - NOT complete if user is still navigating to get there!

2. ✅ THE FINAL ACTION IS VISIBLE - You've highlighted the submit/create button
   - Task: "create pull request" → You highlighted "Create pull request" button = DONE
   - BUT if still on "compare" page selecting branches = NOT DONE

3. ✅ FORM/DESTINATION IS READY - User can actually perform the action
   - All required fields are visible
   - The final button is clickable

COMMON MULTI-PAGE TASKS - DO NOT COMPLETE EARLY:
- "Pull request from fork" - needs: navigate to original repo → Pull requests tab → New PR → Compare across forks → Select fork → Fill form → Create
- "Fork and contribute" - needs: fork → make changes → create PR back to original
- "Compare branches" - needs: navigate to compare page → select branches → view diff

IMPORTANT: For pull request tasks:
- If on a repo page but not the PR creation form yet = NOT COMPLETE
- If on "Pull requests" tab but not "New pull request" = NOT COMPLETE  
- If selecting branches/forks in compare view = NOT COMPLETE
- Only complete when on the actual PR creation form with title/description fields

OUTPUT FORMAT (JSON only):
{
  "steps": [
    {"elementId": "gm-5", "action": "click", "description": "Click 'Pull requests' tab to see PR options"}
  ],
  "completed": false,
  "reason": "User needs to navigate to PR creation form first",
  "progress": "On repository page - need to go to Pull requests → New pull request"
}

If task is truly complete with no more steps needed:
{
  "steps": [],
  "completed": true,
  "reason": "User is on PR creation form and can fill in details and click Create"
}

RULES:
- Maximum 4 steps per response (allow more for complex navigation)
- If showing a final action button (Create PR, Submit, etc.), this MUST be the last step with completed: true
- Use ONLY element IDs from the provided list
- ALWAYS include "reason" explaining your decision
- ALWAYS include "progress" to show where user is in the workflow`;
  }

  buildContinuationUserPrompt(task, completedSteps, url, title, dom) {
    const elementList = dom.elements
      .filter(e => e.type !== 'heading')
      .map(e => `${e.id}: "${e.text}" [${e.type}] (${e.location})`)
      .join('\n');
    
    const headings = dom.elements
      .filter(e => e.type === 'heading')
      .map(e => e.text)
      .join(' > ');
    
    const stepCount = completedSteps ? completedSteps.length : 0;
    const completedDesc = completedSteps && completedSteps.length > 0
      ? completedSteps.map((s, i) => `${i + 1}. ${s.description}`).join('\n')
      : 'None yet';
    
    // Check if any completed step was a final action
    const hasFinalAction = completedSteps && completedSteps.some(s => {
      const d = (s.description || '').toLowerCase();
      return d.includes('create pull request') || d.includes('submit pull request') ||
             d.includes('open pull request') || d.includes('merge');
    });
    
    // Detect if this is a multi-page workflow task
    const taskLower = task.toLowerCase();
    const isMultiPageTask = taskLower.includes('pull request') || taskLower.includes('fork') ||
                           taskLower.includes('contribute') || taskLower.includes('pr ');

    // Detect current page context for better guidance
    const urlLower = url.toLowerCase();
    const titleLower = title.toLowerCase();
    let pageContext = '';
    
    if (urlLower.includes('/compare')) {
      pageContext = '\n📍 CURRENT PAGE: Compare/diff view - user may need to select forks or branches';
    } else if (urlLower.includes('/pull/new') || titleLower.includes('open a pull request')) {
      pageContext = '\n📍 CURRENT PAGE: PR creation form - user is ready to create PR!';
    } else if (urlLower.includes('/pulls') || titleLower.includes('pull requests')) {
      pageContext = '\n📍 CURRENT PAGE: Pull requests list - user needs to click "New pull request"';
    } else if (urlLower.includes('/fork')) {
      pageContext = '\n📍 CURRENT PAGE: Fork page - after forking, user needs to navigate back';
    }

    return `ORIGINAL TASK: "${task}"
${isMultiPageTask ? '⚠️ THIS IS A MULTI-PAGE WORKFLOW - do NOT mark complete until on final form/page!' : ''}

COMPLETED STEPS (${stepCount} total):
${completedDesc}
${hasFinalAction ? '\n⚠️ NOTE: A FINAL PR ACTION WAS ALREADY COMPLETED - task is likely DONE!' : ''}
${stepCount >= 10 ? '\n⚠️ NOTE: 10+ steps completed - verify if task is truly complete' : ''}

NOW ON PAGE: ${title}
URL: ${url}${pageContext}
PAGE CONTEXT: ${headings || 'Main page'}

AVAILABLE ELEMENTS ON THIS PAGE:
${elementList}

${isMultiPageTask ? `
FOR PULL REQUEST TASKS:
- If NOT on "Open a pull request" form yet → provide navigation steps, completed: false
- If on compare page selecting branches → provide selection steps, completed: false
- If on PR form with title/description → highlight "Create pull request" button, completed: true
` : ''}

Analyze: Is the task "${task}" complete? Consider the URL and page title.
If more steps needed, provide maximum 4 steps using element IDs from above.`;
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
    return `You are a precise website navigation assistant. Guide users step-by-step through clicking EXACT elements on the page.

INPUT: You receive a list of ACTUAL clickable elements with unique IDs (like "gm-5").
OUTPUT: JSON with steps referencing these exact IDs.

CRITICAL - UNDERSTAND MULTI-PAGE WORKFLOWS:
Many tasks require navigating through MULTIPLE pages. Common examples:

1. "Create Pull Request from Fork":
   - Step 1: Go to original repository (not your fork)
   - Step 2: Click "Pull requests" tab
   - Step 3: Click "New pull request" 
   - Step 4: Click "compare across forks"
   - Step 5: Select your fork as head repository
   - Step 6: Fill in PR details
   - Step 7: Click "Create pull request"

2. "Fork a repository":
   - Find and click "Fork" button
   - Wait for fork creation page
   - Optionally customize fork settings
   - Click "Create fork"

3. "Contribute to a project":
   - Fork → Clone → Branch → Commit → Push → Create PR

CRITICAL - ALWAYS PROVIDE STEPS:
- Even for complex tasks, provide the FIRST step to get started
- NEVER return an empty steps array unless the task is impossible
- If the exact button isn't visible, find the CLOSEST action that moves toward the goal

CRITICAL - THINK ABOUT UI PATTERNS:
Common GitHub UI patterns:
- "Pull requests" is a TAB in the repository navigation
- "New pull request" is a button on the Pull requests page
- "Compare across forks" appears when comparing branches
- "Fork" button is usually in the top-right of a repository
- Dropdown menus ("Code", "...") hide additional options

CRITICAL - FOR FORK/PR TASKS:
- If user is on THEIR fork but wants to create PR to original: guide them to the ORIGINAL repo first
- The "New pull request" workflow: original repo → Pull requests → New PR → compare across forks → select head fork → create
- If user wants to PR FROM their fork TO original: they can also use their fork's "Contribute" dropdown

OUTPUT FORMAT:
{
  "steps": [
    {"elementId": "gm-5", "action": "click", "description": "Click 'Pull requests' tab to access PR options"}
  ],
  "canComplete": true,
  "completed": false,
  "willNavigate": true,
  "progress": "Step 1 of multi-page workflow: accessing Pull requests tab"
}

RULES:
1. ONLY use element IDs from the provided list - never invent IDs
2. Each step = ONE click action
3. Be specific: say WHERE (header, sidebar) and WHAT text to click
4. For multi-page tasks: set willNavigate: true, completed: false
5. Include navigation hints to help user understand the workflow
6. DEFAULT to completed: false for any task involving navigation
7. NEVER suggest going to documentation or external resources`;
  }

  buildUserPrompt(task, url, title, dom) {
    // Format elements with rich context for AI
    const elementList = dom.elements
      .filter(e => e.type !== 'heading')
      .map(e => {
        let desc = `${e.id}: "${e.text}" [${e.type}] (${e.location})`;
        // Add hints if available (dropdown, primary-action, navigation, etc.)
        if (e.hints) desc += ` {${e.hints}}`;
        // Add nearby context if available
        if (e.near) desc += ` near: "${e.near}"`;
        return desc;
      })
      .join('\n');
    
    const headings = dom.elements
      .filter(e => e.type === 'heading')
      .map(e => e.text)
      .join(' > ');
    
    // Detect if this is a GitHub-specific task and provide context
    const taskLower = task.toLowerCase();
    const urlLower = url.toLowerCase();
    const isGitHub = urlLower.includes('github.com');
    
    let taskGuidance = '';
    if (isGitHub) {
      if (taskLower.includes('pull request') || taskLower.includes('pr ')) {
        if (taskLower.includes('fork')) {
          taskGuidance = `
TASK GUIDANCE - PULL REQUEST FROM FORK:
This is a multi-step process:
1. If on YOUR fork: Look for "Contribute" dropdown OR navigate to original repo
2. If on original repo: Click "Pull requests" tab → "New pull request" → "compare across forks"
3. Select your fork as "head repository" 
4. Review changes and click "Create pull request"
Do NOT mark complete until on the PR creation form!`;
        } else {
          taskGuidance = `
TASK GUIDANCE - PULL REQUEST:
1. Click "Pull requests" tab in repo navigation
2. Click "New pull request" button
3. Select branches to compare
4. Click "Create pull request" when ready
Do NOT mark complete until on the PR creation form!`;
        }
      } else if (taskLower.includes('fork')) {
        taskGuidance = `
TASK GUIDANCE - FORK REPOSITORY:
1. Look for "Fork" button (usually top-right, near "Star" and "Watch")
2. Click it to open fork dialog
3. Configure fork options
4. Click "Create fork"`;
      } else if (taskLower.includes('clone')) {
        taskGuidance = `
TASK GUIDANCE - CLONE REPOSITORY:
1. Find the "Code" button (green button, NOT the navigation tab)
2. Click to open dropdown with clone URLs
3. Copy HTTPS or SSH URL`;
      } else if (taskLower.includes('action') || taskLower.includes('workflow') || taskLower.includes('ci/cd')) {
        taskGuidance = `
TASK GUIDANCE - GITHUB ACTIONS:
1. Click "Actions" tab in repository navigation
2. Browse workflow templates or click "set up a workflow yourself"
3. Edit the YAML configuration
4. Click "Commit changes" to save
This spans multiple pages - do NOT mark complete until workflow is configured!`;
      }
    }
    
    // AWS-specific guidance
    if (urlLower.includes('aws.amazon.com') || urlLower.includes('console.aws')) {
      if (taskLower.includes('s3') || taskLower.includes('bucket')) {
        taskGuidance = `
TASK GUIDANCE - AWS S3 BUCKET:
AWS Console has complex nested UI. Follow these steps:
1. Search for "S3" in AWS console search or navigate to S3 service
2. Click "Create bucket" button
3. Configure bucket name and region
4. Scroll down to configure settings (public access, versioning, etc.)
5. Click "Create bucket" at the bottom
IMPORTANT: AWS modals and settings are in nested panels - look for {in-modal} elements!`;
      } else if (taskLower.includes('lambda')) {
        taskGuidance = `
TASK GUIDANCE - AWS LAMBDA:
1. Navigate to Lambda service
2. Click "Create function"
3. Choose "Author from scratch" or use blueprint
4. Configure function name, runtime, permissions
5. Click "Create function"
6. Add code and configure triggers
Multi-step process with nested settings panels!`;
      }
    }
    
    // Vercel-specific guidance
    if (urlLower.includes('vercel.com')) {
      if (taskLower.includes('deploy') || taskLower.includes('project')) {
        taskGuidance = `
TASK GUIDANCE - VERCEL DEPLOYMENT:
1. Click "Add New..." or "New Project"
2. Connect/select GitHub repository
3. Configure build settings (framework, build command)
4. Click "Deploy"
Look for primary action buttons with {primary-action} hint!`;
      }
    }
    
    // Figma-specific guidance
    if (urlLower.includes('figma.com')) {
      if (taskLower.includes('auto layout') || taskLower.includes('autolayout')) {
        taskGuidance = `
TASK GUIDANCE - FIGMA AUTO LAYOUT:
1. Select frame or elements
2. Look for "+" next to "Auto layout" in right panel
3. Or use keyboard shortcut Shift+A
4. Configure spacing, padding, direction
Figma UI has panels - look for {figma-ui} hints!`;
      } else if (taskLower.includes('export')) {
        taskGuidance = `
TASK GUIDANCE - FIGMA EXPORT:
1. Select layer(s) to export
2. Look at right sidebar for "Export" section
3. Click "+" to add export setting
4. Choose format (PNG, SVG, PDF, JPG)
5. Click "Export" button`;
      }
    }
    
    // Stripe-specific guidance
    if (urlLower.includes('stripe.com') || urlLower.includes('dashboard.stripe')) {
      if (taskLower.includes('subscription') || taskLower.includes('product')) {
        taskGuidance = `
TASK GUIDANCE - STRIPE SUBSCRIPTION:
1. Navigate to Products section
2. Click "Add product" or "Create product"
3. Configure product details
4. Add pricing (one-time or recurring)
5. Set billing interval for subscriptions
Stripe uses modals - look for {in-modal} elements!`;
      }
    }
    
    // Shopify-specific guidance
    if (urlLower.includes('shopify.com') || urlLower.includes('myshopify.com')) {
      if (taskLower.includes('product') || taskLower.includes('variant')) {
        taskGuidance = `
TASK GUIDANCE - SHOPIFY PRODUCT:
1. Go to Products section in admin
2. Click "Add product"
3. Fill in product details
4. For variants: scroll to "Variants" section
5. Add size/color options
6. Set prices and inventory per variant
7. Click "Save"`;
      }
    }
    
    // Add page context information if available
    let contextInfo = '';
    if (dom.pageContext) {
      const ctx = dom.pageContext;
      contextInfo = `\n\nPAGE STATE:`;
      if (ctx.hasModal) contextInfo += `\n- Modal/dialog is OPEN (prioritize {in-modal} elements!)`;
      if (ctx.hasDropdownOpen) contextInfo += `\n- Dropdown is OPEN (look for menu items)`;
      if (ctx.isLoading) contextInfo += `\n- Page is LOADING (some elements may not be visible yet)`;
      if (ctx.platform !== 'unknown') contextInfo += `\n- Platform: ${ctx.platform}`;
      if (ctx.pageType !== 'general') contextInfo += `\n- Page type: ${ctx.pageType}`;
    }
    
    return `CURRENT PAGE: ${title}
URL: ${url}
PAGE SECTIONS: ${headings || 'Main page'}${contextInfo}

USER WANTS TO: "${task}"
${taskGuidance}

AVAILABLE CLICKABLE ELEMENTS (use these exact IDs):
${elementList}

ELEMENT HINTS EXPLAINED:
- {dropdown} = Opens a menu/popup with more options
- {primary-action} = Visually prominent button (colored, stands out)
- {navigation} = Part of site navigation tabs/menu
- {form} = Inside a form
- {in-modal} = Inside a modal/dialog (HIGH PRIORITY when modal is open!)
- {aws-ui}, {figma-ui}, {stripe-ui} = Platform-specific UI component

CRITICAL SELECTION RULES:
1. When a MODAL is open: ALWAYS prioritize {in-modal} elements!
2. When multiple elements have SAME TEXT, use hints to pick the right one:
   - For ACTIONS (clone, download, create): prefer {dropdown} or {primary-action} over {navigation}
   - Navigation tabs are for switching views, NOT for actions
   - Action buttons are usually in 'main' location, not 'sidebar'

3. Example: "clone repository" - there might be:
   - "Code" [link] (navigation) {navigation} ← WRONG, this is a nav tab
   - "Code" [button] (main) {dropdown, primary-action} ← CORRECT, this opens clone options

4. ALWAYS prefer: modal > main > header > sidebar for action tasks
5. ALWAYS prefer: {primary-action} or {dropdown} over {navigation} for actions

Use ONLY the element IDs listed above.`;
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
        temperature: 0.3,
        max_tokens: 1000
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
    // Use stable free-tier models
    const models = [
      'gemini-flash-latest',             // Primary free tier model
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
              temperature: 0,  // Zero for consistent, deterministic responses
              maxOutputTokens: 4096,
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
        // Try to extract step descriptions even from broken JSON
        const stepMatches = content.match(/"description"\s*:\s*"([^"]+)"/g);
        if (stepMatches && stepMatches.length > 0) {
          const extractedSteps = stepMatches.map((match, index) => {
            const desc = match.match(/"description"\s*:\s*"([^"]+)"/);
            return {
              element: 'body',
              action: 'info',
              description: desc ? desc[1] : `Step ${index + 1}`
            };
          });
          console.log('GuideMe: Recovered partial steps from broken JSON');
          return {
            steps: extractedSteps,
            canComplete: true,
            note: 'Guide recovered from partial response'
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
