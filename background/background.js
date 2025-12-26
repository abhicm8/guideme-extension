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
    return `You are a website navigation assistant. Given a task and available elements, provide the next steps.

YOUR JOB: Identify which clickable elements the user should interact with to accomplish their task.

OUTPUT FORMAT (JSON only, no markdown):
{
  "steps": [
    {"elementId": "gm-5", "action": "click", "description": "Click the 'Submit' button"}
  ],
  "completed": false,
  "reason": "Brief explanation of current state"
}

RULES:
1. Use ONLY element IDs from the provided list (gm-0, gm-1, etc.)
2. Maximum 3 steps per response - keep it focused
3. "completed": true ONLY when the task is fully achievable with current elements
4. Each step description should be clear: "Click [element name]" or "Enter text in [field]"
5. If the needed element isn't visible, provide steps to reveal it (click dropdown, scroll, etc.)

ELEMENT SELECTION:
- Prefer buttons over links for actions
- Prefer {primary-action} elements for main tasks
- Prefer {dropdown} elements when looking for hidden options
- When multiple elements have same text, use location hints (main > sidebar > header)`;
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

    return `TASK: "${task}"

PAGE: ${title}
URL: ${url}

COMPLETED (${stepCount} steps, last 3):
${recentSteps}

AVAILABLE ELEMENTS:
${elementList}

What should the user click next to accomplish "${task}"?
If the task can be completed with current elements, set completed: true.`;
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
2. Maximum 3 steps per response
3. Each step = ONE click
4. Be specific in descriptions: "Click 'Settings' in the sidebar" not just "Click Settings"

ELEMENT SELECTION PRIORITY:
When multiple elements have similar text, choose based on:
1. TYPE: For actions, prefer [button] over [link]
2. HINTS: Prefer {primary-action} or {dropdown} over {navigation}
3. LOCATION: For main tasks, prefer (main) over (sidebar) or (header)

EXAMPLE - "Clone repository":
- "Code" [link] (header) {navigation} → WRONG - this is a nav tab
- "Code" [button] (main) {dropdown, clone-button} → CORRECT - opens clone URLs

WHEN TO SET completed: true:
- Simple tasks (find, show, locate): After pointing to the element
- Action tasks (create, submit, delete): After the final action button is shown
- Multi-page tasks: Only when on the final page with the submit button visible`;
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

    return `PAGE: ${title}
URL: ${url}
CONTEXT: ${headings || 'Main page'}${stateInfo}

TASK: "${task}"

ELEMENTS (use these IDs):
${elementList}

Provide steps to accomplish: "${task}"`;
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
