// Provider form owns draft credentials; it never renders a saved private key.
class GuideMeProviderSettings {
  constructor(report) {
    this.config = globalThis.GuideMeAIConfig;
    this.report = report;
    this.provider = document.getElementById('apiProvider');
    this.model = document.getElementById('geminiModel');
    this.custom = document.getElementById('customGeminiModel');
    this.thinking = document.getElementById('geminiThinking');
    this.json = document.getElementById('vertexJson');
    this.project = document.getElementById('vertexProject');
    this.location = document.getElementById('vertexLocation');
    this.summary = document.getElementById('vertexCredentialSummary');
    this.credentials = null;
    this.provider.addEventListener('change', () => this.update(true));
    this.model.addEventListener('change', () => this.updateThinking());
    document.getElementById('vertexFile').addEventListener('change', async event => {
      const file = event.target.files[0];
      try {
        if (!file) return;
        if (file.size > 32768) throw new Error('Choose a service-account JSON file smaller than 32 KB.');
        const credentials = this.config.parseCredentials(await file.text());
        this.json.value = JSON.stringify(credentials);
        if (!this.project.value.trim()) this.project.value = credentials.project_id;
        this.summary.textContent = `Ready to save: ${credentials.client_email}`;
      } catch (error) { this.report(error.message, 'error'); }
      finally { event.target.value = ''; }
    });
    document.getElementById('removeVertexCredential').addEventListener('click', async () => {
      try {
        await chrome.storage.local.remove('vertexCredentials');
        this.credentials = null;
        this.json.value = '';
        this.renderSummary();
        this.report('Vertex credential removed from this device.', 'success');
      } catch { this.report('Could not remove the credential. Try again.', 'error'); }
    });
  }

  load(settings) {
    this.provider.value = settings.apiProvider || 'gemini';
    this.credentials = settings.vertexCredentials || null;
    this.project.value = settings.vertexProject || this.credentials?.project_id || '';
    this.location.value = settings.vertexLocation || 'global';
    this.selectedModel = settings.geminiModel || 'gemini-3.8-flash';
    this.selectedThinking = settings.geminiThinking || 'auto';
    this.json.value = '';
    this.update();
    this.renderSummary();
  }

  renderSummary() {
    this.summary.textContent = this.credentials ? `Saved on this device: ${this.credentials.client_email}` : 'No service-account credential saved.';
    document.getElementById('removeVertexCredential').disabled = !this.credentials && !this.json.value;
  }

  update(preserve = false) {
    const provider = this.provider.value;
    document.getElementById('apiKeyGroup').hidden = provider === 'vertex';
    document.getElementById('vertexSettings').hidden = provider !== 'vertex';
    document.getElementById('geminiSettings').hidden = !['gemini', 'vertex'].includes(provider);
    if (!['gemini', 'vertex'].includes(provider)) return;
    const selected = preserve ? (this.model.value === 'custom' ? this.custom.value : this.model.value) : this.selectedModel;
    const thinking = preserve ? this.thinking.value : this.selectedThinking;
    const models = this.config.models.filter(model => !model.providers || model.providers.includes(provider));
    this.model.replaceChildren(...models.map(model => new Option(model.label, model.id)), new Option('Custom model ID', 'custom'));
    const known = models.some(model => model.id === selected);
    const unsupported = this.config.models.some(model => model.id === selected) && !known;
    this.model.value = unsupported ? 'gemini-3.8-flash' : known ? selected : 'custom';
    this.custom.value = known || unsupported ? '' : selected || '';
    this.updateThinking(thinking);
  }

  updateThinking(selection = this.thinking.value) {
    const model = this.config.models.find(item => item.id === this.model.value);
    const choices = model?.levels || model?.budgets?.filter(value => value !== 'auto') || [];
    const labels = { auto: 'Model default', MINIMAL: 'Minimal', LOW: 'Low · faster', MEDIUM: 'Medium · balanced', HIGH: 'High · more reasoning', off: 'Off', '1024': '1,024 thinking tokens', '8192': '8,192 thinking tokens' };
    this.thinking.replaceChildren(...['auto', ...choices].map(value => new Option(labels[value], value)));
    this.thinking.value = ['auto', ...choices].includes(selection) ? selection : 'auto';
    this.thinking.disabled = !choices.length;
    document.getElementById('customModelGroup').hidden = this.model.value !== 'custom';
    document.getElementById('modelHint').textContent = this.model.value === 'gemini-3.5-flash' && this.provider.value === 'gemini'
      ? 'Google routes the Gemini API 3.5 Flash endpoint to 3.6 Flash. Choose 3.6 to use its explicit model ID.'
      : this.model.value === 'custom' ? 'Enter a generateContent model available to your project. Custom models use their default thinking settings.'
      : this.model.value === 'gemini-2.5-flash' ? 'Legacy model; access may be limited to projects that used it previously.'
      : 'Availability depends on your Google project and, for Vertex, the selected location.';
  }

  collect() {
    const settings = { geminiModel: this.model.value === 'custom' ? this.custom.value.trim() : this.model.value, geminiThinking: this.thinking.value, vertexProject: this.project.value.trim(), vertexLocation: this.location.value.trim() || 'global' };
    let credentials = this.credentials;
    if (this.json.value.trim()) credentials = this.config.parseCredentials(this.json.value);
    if (credentials) settings.vertexCredentials = credentials;
    if (['gemini', 'vertex'].includes(this.provider.value)) this.config.modelConfig({ ...settings, apiProvider: this.provider.value });
    if (this.provider.value === 'vertex') {
      this.config.assertCredentials({ ...settings, apiProvider: 'vertex' });
      settings.vertexProject ||= credentials.project_id;
    }
    return settings;
  }

  saved(settings) {
    this.credentials = settings.vertexCredentials || null;
    this.json.value = '';
    this.project.value = settings.vertexProject || '';
    this.renderSummary();
  }
}
globalThis.GuideMeProviderSettings = GuideMeProviderSettings;
