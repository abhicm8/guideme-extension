// GuideMe Background Service Worker
// Handles AI API communication

// Import GuideMe file format utilities
import { GuideMeFormat } from '../lib/guideme-format.js';
import { buildGuidePrompt, buildGuideSystemPrompt, bindGuideToSnapshot } from '../lib/guide-planner.js';
import { PanelController } from './panel-controller.js';
import { buildGuidanceHandoff } from '../lib/guide-outcome.js';
import { GeminiClient } from '../lib/gemini-client.js';
const aiConfig = globalThis.GuideMeAIConfig;

class GuideMeBackground {
  constructor() {
    this.geminiClient = new GeminiClient();
    this.init();
  }

  init() {
    this.panelController = new PanelController(chrome, payload => this.generateGuide(payload));
    this.panelController.init();
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
    return this.planGuide(payload);
  }

  async generateGuide(payload) {
    return this.planGuide(payload);
  }

  async planGuide({ task, url, title, dom, completedSteps = [], guidancePreference = 'auto' }) {
    const settings = await chrome.storage.local.get(aiConfig.keys);
    settings.apiProvider ||= 'gemini';
    aiConfig.assertCredentials(settings);
    const { apiProvider, apiKey } = settings;
    if (!dom || !Array.isArray(dom.elements)) throw new Error('Could not read the page. Refresh and try again.');
    const systemPrompt = buildGuideSystemPrompt();
    let userPrompt = buildGuidePrompt(task, url, title, dom, completedSteps, null, guidancePreference);
    const generate = async () => {
      if (apiProvider === 'gemini' || apiProvider === 'vertex') {
        // Only keep a worker alive while a bounded provider call is active.
        const keepAlive = setInterval(() => { chrome.runtime.getPlatformInfo().catch(() => {}); }, 20000);
        try { return this.parseAIResponse(await this.geminiClient.generate(settings, systemPrompt, userPrompt)); }
        finally { clearInterval(keepAlive); }
      }
      if (apiProvider === 'openai') return this.callOpenAI(apiKey, systemPrompt, userPrompt);
      if (apiProvider === 'anthropic') return this.callAnthropic(apiKey, systemPrompt, userPrompt);
      throw new Error('Unknown API provider');
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      let result;
      try { result = await generate(); }
      catch (error) {
        if (attempt) return buildGuidanceHandoff(task, dom, completedSteps, 'Further model guidance is unavailable. Continue from the observed page context.');
        throw error;
      }
      if (!attempt && !result.steps?.length && !result.summary?.trim()) {
        userPrompt = buildGuidePrompt(task, url, title, dom, completedSteps,
          'No exact next target was provided. Return a useful handoff or blocked summary with remaining instructions grounded in the task and current snapshot. Do not repeat the last action or claim the task succeeded without visible evidence.', guidancePreference);
        continue;
      }
      try { return bindGuideToSnapshot(result, dom, completedSteps, task); }
      catch (error) {
        if (attempt) return buildGuidanceHandoff(task, dom, completedSteps, 'The next highlight could not be grounded reliably in this page.');
        userPrompt = buildGuidePrompt(task, url, title, dom, completedSteps, `${error.message} If no different target is reliable, return a handoff with a useful summary and remaining instructions.`, guidancePreference);
      }
    }
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
        element: step.elementId || step.element,
        action: step.action || 'click',
        description: step.description || step.instruction || `Step ${index + 1}`,
        hint: step.hint,
        expectedResult: step.expectedResult
      }));

      console.log('GuideMe: Parsed steps:', validatedSteps);
      console.log('GuideMe: completed:', parsed.completed, 'willNavigate:', parsed.willNavigate);

      return {
        steps: validatedSteps,
        status: parsed.status,
        summary: parsed.summary,
        remainingActions: parsed.remainingActions,
        evidenceIds: parsed.evidenceIds,
        canComplete: parsed.canComplete !== false,
        completed: parsed.completed === true,  // Must explicitly be true
        willNavigate: parsed.willNavigate === true,
        progress: parsed.progress || parsed.navigationHint || null,
        note: parsed.reason || parsed.note || parsed.message || null
      };
    } catch (error) {
      console.error('Failed to parse AI response:', error.message);
      console.error('Original content:', content);
      
      throw new Error('Failed to parse AI response. The AI may have returned an incomplete response. Please try again.');
    }
  }
}

// Initialize background service
const guideme = new GuideMeBackground();
