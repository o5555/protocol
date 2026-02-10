// Protocols Module

const Protocols = {
  // Light mode habit mapping: protocol ID → sort_order values for "core 5" habits
  LIGHT_MODE_HABITS: {
    // Huberman: Morning sunlight, No caffeine after 2pm, Cool bedroom, No screens, Consistent wake time
    '11111111-1111-1111-1111-111111111111': [1, 2, 5, 6, 7],
    // Bryan Johnson: Wake at 5am, Morning light therapy, No caffeine, Wind down at 7pm, Sleep by 8:30pm
    '22222222-2222-2222-2222-222222222222': [1, 2, 6, 8, 11]
  },

  // State for custom protocol creation
  _customProtocolHabits: [],
  _availableHabits: [],
  _createStep: 1,
  _startDate: null, // null = start now, date string = specific date

  // Get all protocols
  async getAll() {
    const client = SupabaseClient.client;
    if (!client) throw new Error('Supabase not initialized');

    const { data, error } = await client
      .from('protocols')
      .select('*')
      .order('name');

    if (error) throw error;
    return data;
  },

  // Get all available habits from all system protocols (for picking)
  async getAllHabits() {
    const client = SupabaseClient.client;
    if (!client) throw new Error('Supabase not initialized');

    const { data, error } = await client
      .from('protocol_habits')
      .select(`
        *,
        protocol:protocols!inner(id, name)
      `)
      .order('protocol_id')
      .order('sort_order');

    if (error) throw error;
    return data;
  },

  // Create a custom protocol with habits
  async createCustomProtocol(name, habits) {
    const client = SupabaseClient.client;
    if (!client) throw new Error('Supabase not initialized');

    const user = await SupabaseClient.getCurrentUser();
    if (!user) throw new Error('Must be logged in to create protocols');

    // Create the protocol with user_id for RLS policy
    // Use a default icon emoji for custom protocols so challenge views show an icon
    const insertData = {
      name,
      description: '',
      icon: '\u{1F3AF}',
      user_id: user.id
    };

    const { data: protocol, error: protocolError } = await client
      .from('protocols')
      .insert(insertData)
      .select()
      .single();

    if (protocolError) throw protocolError;

    // Create the habits
    if (habits && habits.length > 0) {
      const habitsToInsert = habits.map((habit, index) => ({
        protocol_id: protocol.id,
        title: habit.title,
        description: habit.description || '',
        sort_order: index + 1
      }));

      const { error: habitsError } = await client
        .from('protocol_habits')
        .insert(habitsToInsert);

      if (habitsError) throw habitsError;
    }

    return protocol;
  },

  // Delete a custom protocol
  async deleteCustomProtocol(protocolId) {
    const client = SupabaseClient.client;
    if (!client) throw new Error('Supabase not initialized');

    const { error } = await client
      .from('protocols')
      .delete()
      .eq('id', protocolId);

    if (error) throw error;
  },

  // Get protocol by ID with habits
  async getById(protocolId) {
    const client = SupabaseClient.client;
    if (!client) throw new Error('Supabase not initialized');

    const { data, error } = await client
      .from('protocols')
      .select(`
        *,
        habits:protocol_habits(*)
      `)
      .eq('id', protocolId)
      .single();

    if (error) throw error;

    // Sort habits by sort_order
    if (data.habits) {
      data.habits.sort((a, b) => a.sort_order - b.sort_order);
    }

    return data;
  },

  // Filter habits based on mode (light returns only core 5, pro returns all)
  getHabitsForMode(protocol, mode) {
    if (!protocol?.habits) return [];
    if (mode === 'pro') return protocol.habits;

    const lightOrders = this.LIGHT_MODE_HABITS[protocol.id];
    if (!lightOrders) return protocol.habits; // fallback to all if no mapping
    return protocol.habits.filter(h => lightOrders.includes(h.sort_order));
  },

  // Render mode selector UI (two selectable cards, or single card for custom protocols)
  renderModeSelector(protocolId, selectedMode, totalHabits) {
    const hasLightMapping = !!this.LIGHT_MODE_HABITS[protocolId];
    const lightCount = hasLightMapping ? this.LIGHT_MODE_HABITS[protocolId].length : 0;

    // Custom protocols (no light mode mapping) only show Pro mode
    if (!hasLightMapping) {
      return `
        <div id="mode-selector">
          <div class="mode-card rounded-2xl p-4 border-2 border-oura-accent bg-oura-accent/5">
            <div class="text-2xl mb-2">&#x1F525;</div>
            <h4 class="font-semibold text-sm">Full Protocol</h4>
            <p class="text-xs text-oura-muted mt-1">All ${totalHabits || ''} habits in your custom protocol.</p>
          </div>
        </div>
      `;
    }

    return `
      <div class="grid grid-cols-2 gap-3" id="mode-selector">
        <div onclick="Protocols._selectMode('light')"
          class="mode-card cursor-pointer rounded-2xl p-4 border-2 transition-all ${selectedMode === 'light' ? 'border-oura-accent bg-oura-accent/5' : 'border-oura-border bg-oura-card hover:border-oura-accent/30'}">
          <div class="text-2xl mb-2">&#x2728;</div>
          <h4 class="font-semibold text-sm">Light</h4>
          <p class="text-xs text-oura-muted mt-1">Core ${lightCount} habits. Perfect for getting started.</p>
        </div>
        <div onclick="Protocols._selectMode('pro')"
          class="mode-card cursor-pointer rounded-2xl p-4 border-2 transition-all ${selectedMode === 'pro' ? 'border-oura-accent bg-oura-accent/5' : 'border-oura-border bg-oura-card hover:border-oura-accent/30'}">
          <div class="text-2xl mb-2">&#x1F525;</div>
          <h4 class="font-semibold text-sm">Pro</h4>
          <p class="text-xs text-oura-muted mt-1">All habits. The full protocol experience.</p>
        </div>
      </div>
    `;
  },

  // Internal: handle mode card click (used by onboarding and create modal)
  _selectedMode: 'pro',
  _onModeChange: null,

  _selectMode(mode) {
    this._selectedMode = mode;

    // Update visual state
    document.querySelectorAll('.mode-card').forEach(card => {
      card.classList.remove('border-oura-accent', 'bg-oura-accent/5');
      card.classList.add('border-oura-border', 'bg-oura-card');
    });
    const cards = document.querySelectorAll('.mode-card');
    const idx = mode === 'light' ? 0 : 1;
    if (cards[idx]) {
      cards[idx].classList.remove('border-oura-border', 'bg-oura-card');
      cards[idx].classList.add('border-oura-accent', 'bg-oura-accent/5');
    }

    if (this._onModeChange) this._onModeChange(mode);
  },

  // Render mode badge (small pill)
  renderModeBadge(mode) {
    if (mode === 'light') {
      return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.65rem] font-medium bg-amber-500/15 text-amber-400">&#x2728; Light</span>`;
    }
    return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.65rem] font-medium bg-oura-accent/15 text-oura-accent">&#x1F525; Pro</span>`;
  },

  // Get initials from protocol name (first letter of first two words)
  getInitials(name) {
    const words = name.split(' ').filter(w => w.length > 0);
    if (words.length >= 2) {
      return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  },

  // Render protocols list page
  async renderList() {
    const container = document.getElementById('protocols-container');
    if (!container) return;

    try {
      const protocols = await this.getAll();
      const user = await SupabaseClient.getCurrentUser();

      container.innerHTML = `
        <button onclick="Protocols.showCreateModal()"
          class="w-full mb-4 py-4 min-h-[48px] border-2 border-dashed border-oura-border rounded-2xl text-oura-muted hover:border-oura-accent hover:text-oura-accent transition-colors flex items-center justify-center gap-2">
          + Create Your Own Protocol
        </button>
        <div class="space-y-3">
          ${protocols.map(protocol => {
            const initials = this.getInitials(protocol.name);
            return `
            <div onclick="App.navigateTo('protocol-detail', '${protocol.id}')"
              class="bg-oura-card rounded-2xl p-5 cursor-pointer hover:bg-oura-subtle transition-colors">
              <div class="flex items-center gap-4">
                <div class="protocol-icon w-16 h-16 rounded-xl flex items-center justify-center text-lg font-semibold text-white flex-shrink-0">
                  ${initials}
                </div>
                <div class="flex-1 min-w-0">
                  <h3 class="text-lg font-semibold">${escapeHtml(protocol.name)}</h3>
                  <p class="text-oura-muted text-sm mt-1 line-clamp-3">${escapeHtml(protocol.description || '')}</p>
                </div>
                <svg class="w-5 h-5 text-oura-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          `}).join('')}
        </div>
      `;
    } catch (error) {
      console.error('Error rendering protocols:', error);
      container.innerHTML = `
        <div class="bg-red-900/20 border border-red-500 rounded-lg p-4">
          <p class="text-red-400">Failed to load protocols: ${escapeHtml(error.message)}</p>
        </div>
      `;
    }
  },

  // Render protocol detail page
  async renderDetail(protocolId) {
    const container = document.getElementById('protocol-detail-container');
    if (!container) return;

    try {
      const protocol = await this.getById(protocolId);
      const user = await SupabaseClient.getCurrentUser();
      const isCustom = protocol.user_id && protocol.user_id === user?.id;

      const initials = this.getInitials(protocol.name);
      container.innerHTML = `
        <div class="bg-oura-card rounded-2xl p-6 mb-6">
          <button onclick="App.navigateTo('protocols')" class="min-h-[44px] inline-flex items-center text-oura-muted hover:text-white mb-4">
            &larr; Back to Protocols
          </button>
          <div class="flex items-start gap-4">
            <div class="protocol-icon w-16 h-16 rounded-xl flex items-center justify-center text-xl font-semibold text-white flex-shrink-0">
              ${initials}
            </div>
            <div class="flex-1">
              <div class="flex items-center gap-2">
                <h2 class="text-2xl font-bold">${escapeHtml(protocol.name)}</h2>
                ${isCustom ? `<span class="px-2 py-0.5 text-[0.65rem] font-medium bg-purple-500/15 text-purple-400 rounded-full">Custom</span>` : ''}
              </div>
              <p class="text-oura-muted mt-2">${escapeHtml(protocol.description || '')}</p>
            </div>
          </div>
        </div>

        <div class="bg-oura-card rounded-2xl p-6 mb-6">
          <h3 class="text-lg font-semibold mb-4">Daily Habits (${protocol.habits?.length || 0})</h3>
          <div class="space-y-3">
            ${protocol.habits?.map((habit, index) => `
              <div class="flex items-start gap-4 p-4 bg-oura-subtle rounded-lg">
                <span class="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-oura-border rounded-full text-sm font-medium">
                  ${index + 1}
                </span>
                <div>
                  <p class="font-medium">${escapeHtml(habit.title)}</p>
                  ${habit.description ? `<p class="text-sm text-oura-muted mt-1">${escapeHtml(habit.description)}</p>` : ''}
                </div>
              </div>
            `).join('') || '<p class="text-oura-muted">No habits defined for this protocol.</p>'}
          </div>
        </div>

        <div class="bg-oura-card rounded-2xl p-6 ${isCustom ? 'mb-6' : ''}">
          <h3 class="text-lg font-semibold mb-4">Start a Challenge</h3>
          <p class="text-oura-muted mb-4">Ready to commit to this protocol? Create a 30-day challenge and invite friends to join you.</p>
          <button onclick="Challenges.showCreateModal()"
            class="w-full py-3 min-h-[48px] bg-oura-teal text-gray-900 font-semibold rounded-lg hover:bg-oura-teal/90">
            Create Challenge with This Protocol
          </button>
        </div>

        ${isCustom ? `
          <div class="bg-oura-card rounded-2xl p-6">
            <h3 class="text-lg font-semibold mb-4 text-red-400">Danger Zone</h3>
            <p class="text-oura-muted mb-4">Delete this custom protocol. This cannot be undone.</p>
            <button onclick="Protocols.confirmDeleteProtocol('${protocol.id}')"
              class="w-full py-3 min-h-[48px] bg-red-500/20 text-red-400 font-semibold rounded-lg hover:bg-red-500/30 border border-red-500/30">
              Delete Protocol
            </button>
          </div>
        ` : ''}
      `;
    } catch (error) {
      console.error('Error rendering protocol detail:', error);
      container.innerHTML = `
        <div class="bg-red-900/20 border border-red-500 rounded-lg p-4">
          <p class="text-red-400">Failed to load protocol: ${escapeHtml(error.message)}</p>
        </div>
      `;
    }
  },

  // Confirm and delete a custom protocol
  async confirmDeleteProtocol(protocolId) {
    if (!confirm('Are you sure you want to delete this protocol? This cannot be undone.')) {
      return;
    }

    try {
      await this.deleteCustomProtocol(protocolId);
      App.navigateTo('protocols');
    } catch (error) {
      console.error('Error deleting protocol:', error);
      alert('Failed to delete protocol: ' + error.message);
    }
  },

  // Show create protocol modal (multi-step wizard)
  async showCreateModal() {
    this._customProtocolHabits = [];
    this._createStep = 1;
    this._startDate = null;

    try {
      this._availableHabits = await this.getAllHabits();
    } catch (error) {
      console.error('Error loading habits:', error);
      this._availableHabits = [];
    }

    const modalHtml = `
      <div id="create-protocol-modal" class="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <div class="bg-oura-bg w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <div class="p-6 border-b border-oura-border flex-shrink-0">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <button id="back-btn" onclick="Protocols._prevStep()" class="min-h-[44px] min-w-[44px] flex items-center justify-center text-oura-muted hover:text-white hidden">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path>
                  </svg>
                </button>
                <div>
                  <h2 id="modal-title" class="text-xl font-bold">Select Your Habits</h2>
                  <p id="step-indicator" class="text-sm text-oura-muted">Step 1 of 3</p>
                </div>
              </div>
              <button onclick="Protocols.closeCreateModal()" class="min-h-[44px] min-w-[44px] flex items-center justify-center text-oura-muted hover:text-white">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
              </button>
            </div>
          </div>

          <div id="step-content" class="flex-1 overflow-y-auto p-6">
            <!-- Content will be rendered by _renderStep -->
          </div>

          <div class="p-6 border-t border-oura-border flex-shrink-0">
            <button onclick="Protocols._nextStep()" id="next-btn"
              class="w-full py-3 min-h-[48px] bg-oura-accent text-gray-900 font-semibold rounded-lg hover:bg-oura-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled>
              Next
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    this._renderStep();
  },

  // Render current step content
  _renderStep() {
    const content = document.getElementById('step-content');
    const title = document.getElementById('modal-title');
    const stepIndicator = document.getElementById('step-indicator');
    const nextBtn = document.getElementById('next-btn');
    const backBtn = document.getElementById('back-btn');

    // Show/hide back button
    backBtn.classList.toggle('hidden', this._createStep === 1);

    // Update step indicator
    stepIndicator.textContent = `Step ${this._createStep} of 3`;

    if (this._createStep === 1) {
      this._renderHabitsStep(content, title, nextBtn);
    } else if (this._createStep === 2) {
      this._renderStartDateStep(content, title, nextBtn);
    } else if (this._createStep === 3) {
      this._renderNameStep(content, title, nextBtn);
    }
  },

  // Step 1: Select habits
  _renderHabitsStep(content, title, nextBtn) {
    title.textContent = 'Select Your Habits';
    nextBtn.textContent = 'Next';
    nextBtn.disabled = this._customProtocolHabits.length === 0;

    // Group habits by protocol
    const habitsByProtocol = {};
    this._availableHabits.forEach(habit => {
      const protocolName = habit.protocol?.name || 'Unknown';
      if (!habitsByProtocol[protocolName]) {
        habitsByProtocol[protocolName] = [];
      }
      habitsByProtocol[protocolName].push(habit);
    });

    content.innerHTML = `
      <div class="space-y-6">
        <!-- Selected Habits -->
        <div>
          <div class="flex items-center justify-between mb-3">
            <label class="text-sm font-medium text-oura-muted">Your Habits</label>
            <span id="habit-count" class="text-xs text-oura-muted">${this._customProtocolHabits.length} habit${this._customProtocolHabits.length !== 1 ? 's' : ''}</span>
          </div>
          <div id="selected-habits" class="space-y-2 min-h-[60px] bg-oura-card/50 rounded-lg p-3 border border-dashed border-oura-border">
            ${this._customProtocolHabits.length === 0
              ? `<p class="text-sm text-oura-muted text-center py-2">Add habits from below or create your own</p>`
              : this._customProtocolHabits.map((habit, index) => `
                <div class="flex items-center gap-3 bg-oura-subtle rounded-lg px-3 py-2">
                  <span class="flex-shrink-0 w-6 h-6 flex items-center justify-center bg-oura-border rounded-full text-xs font-medium">${index + 1}</span>
                  <span class="flex-1 text-sm">${habit.title}</span>
                  <button onclick="Protocols.removeHabit(${index})" class="min-h-[32px] min-w-[32px] flex items-center justify-center text-oura-muted hover:text-red-400">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                  </button>
                </div>
              `).join('')
            }
          </div>
        </div>

        <!-- Add Custom Habit -->
        <div>
          <label class="block text-sm font-medium text-oura-muted mb-2">Add Custom Habit</label>
          <div class="flex gap-2">
            <input type="text" id="custom-habit-title" placeholder="Enter a habit..."
              class="flex-1 bg-oura-card border border-oura-border rounded-lg px-4 py-3 min-h-[48px] text-white placeholder-oura-muted focus:border-oura-accent focus:outline-none"
              onkeypress="if(event.key === 'Enter') Protocols.addCustomHabit()">
            <button onclick="Protocols.addCustomHabit()"
              class="min-h-[48px] min-w-[48px] bg-oura-accent text-gray-900 rounded-lg flex items-center justify-center hover:bg-oura-accent/90">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
              </svg>
            </button>
          </div>
        </div>

        <!-- Available Habits from Existing Protocols -->
        <div>
          <label class="block text-sm font-medium text-oura-muted mb-3">Or pick from existing protocols</label>
          <div class="space-y-4">
            ${Object.entries(habitsByProtocol).map(([protocolName, habits]) => `
              <div class="bg-oura-card rounded-lg p-4">
                <h4 class="text-sm font-semibold text-white mb-3">${protocolName}</h4>
                <div class="space-y-2">
                  ${habits.map(habit => {
                    const isSelected = this._customProtocolHabits.some(h => h.title === habit.title);
                    return `
                      <button onclick="Protocols.addExistingHabit('${habit.id}', '${habit.title.replace(/'/g, "\\'")}', '${(habit.description || '').replace(/'/g, "\\'")}')"
                        class="w-full text-left px-3 py-2 min-h-[44px] rounded-lg transition-colors ${isSelected ? 'bg-oura-accent/20 border border-oura-accent' : 'bg-oura-subtle hover:bg-oura-border'}">
                        <p class="text-sm font-medium">${habit.title}</p>
                        ${habit.description ? `<p class="text-xs text-oura-muted mt-0.5">${habit.description}</p>` : ''}
                      </button>
                    `;
                  }).join('')}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  },

  // Step 2: Select start date
  _renderStartDateStep(content, title, nextBtn) {
    title.textContent = 'When do you want to start?';
    nextBtn.textContent = 'Next';
    nextBtn.disabled = false;

    const today = new Date().toISOString().split('T')[0];
    const isStartNow = this._startDate === null;

    content.innerHTML = `
      <div class="space-y-4">
        <button onclick="Protocols._selectStartDate(null)"
          class="w-full text-left p-4 rounded-xl border-2 transition-all ${isStartNow ? 'border-oura-accent bg-oura-accent/10' : 'border-oura-border bg-oura-card hover:border-oura-accent/50'}">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-full bg-oura-accent/20 flex items-center justify-center">
              <svg class="w-6 h-6 text-oura-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
              </svg>
            </div>
            <div>
              <h3 class="font-semibold">Start Now</h3>
              <p class="text-sm text-oura-muted">Begin your challenge today</p>
            </div>
          </div>
        </button>

        <button onclick="Protocols._selectStartDate('pick')"
          class="w-full text-left p-4 rounded-xl border-2 transition-all ${!isStartNow ? 'border-oura-accent bg-oura-accent/10' : 'border-oura-border bg-oura-card hover:border-oura-accent/50'}">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-full bg-oura-accent/20 flex items-center justify-center">
              <svg class="w-6 h-6 text-oura-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
              </svg>
            </div>
            <div>
              <h3 class="font-semibold">Pick a Date</h3>
              <p class="text-sm text-oura-muted">Schedule your challenge for later</p>
            </div>
          </div>
        </button>

        <div id="date-picker-container" class="${isStartNow ? 'hidden' : ''} mt-4">
          <label class="block text-sm font-medium text-oura-muted mb-2">Start Date</label>
          <input type="date" id="start-date-input" value="${this._startDate || today}" min="${today}"
            onchange="Protocols._onDateChange(this.value)"
            class="w-full bg-oura-card border border-oura-border rounded-lg px-4 py-3 min-h-[48px] text-white focus:border-oura-accent focus:outline-none">
        </div>
      </div>
    `;
  },

  // Step 3: Name the challenge
  _renderNameStep(content, title, nextBtn) {
    title.textContent = 'Name Your Challenge';
    nextBtn.textContent = 'Create Challenge';
    nextBtn.disabled = false;

    content.innerHTML = `
      <div class="space-y-6">
        <!-- Preview of protocol icon -->
        <div class="flex justify-center">
          <div class="protocol-icon w-20 h-20 rounded-xl flex items-center justify-center text-2xl font-semibold text-white" id="preview-icon">
            MC
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium text-oura-muted mb-2">Challenge Name</label>
          <input type="text" id="challenge-name" value="My Challenge" placeholder="My Challenge"
            oninput="Protocols._onNameChange(this.value)"
            class="w-full bg-oura-card border border-oura-border rounded-lg px-4 py-3 min-h-[48px] text-white placeholder-oura-muted focus:border-oura-accent focus:outline-none text-center text-lg">
          <p class="text-xs text-oura-muted text-center mt-2">You can keep the default or customize it</p>
        </div>

        <div class="bg-oura-card rounded-xl p-4">
          <h4 class="text-sm font-medium text-oura-muted mb-3">Challenge Summary</h4>
          <div class="space-y-2 text-sm">
            <div class="flex justify-between">
              <span class="text-oura-muted">Habits</span>
              <span>${this._customProtocolHabits.length} habit${this._customProtocolHabits.length !== 1 ? 's' : ''}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-oura-muted">Duration</span>
              <span>30 days</span>
            </div>
            <div class="flex justify-between">
              <span class="text-oura-muted">Start</span>
              <span>${this._startDate ? new Date(this._startDate).toLocaleDateString() : 'Today'}</span>
            </div>
          </div>
        </div>
      </div>
    `;

    // Update preview icon with initials
    this._onNameChange(document.getElementById('challenge-name').value);
  },

  // Handle start date selection
  _selectStartDate(option) {
    if (option === null) {
      this._startDate = null;
    } else {
      const today = new Date().toISOString().split('T')[0];
      this._startDate = this._startDate || today;
    }
    this._renderStep();
  },

  // Handle date input change
  _onDateChange(value) {
    this._startDate = value;
  },

  // Handle name input change (update preview icon)
  _onNameChange(value) {
    const icon = document.getElementById('preview-icon');
    if (icon) {
      icon.textContent = this.getInitials(value || 'My Challenge');
    }
  },

  // Go to previous step
  _prevStep() {
    if (this._createStep > 1) {
      this._createStep--;
      this._renderStep();
    }
  },

  // Go to next step or finish
  async _nextStep() {
    if (this._createStep < 3) {
      this._createStep++;
      this._renderStep();
    } else {
      // Final step - create protocol and challenge
      await this._finishCreation();
    }
  },

  // Finish creation - create protocol and challenge
  async _finishCreation() {
    const name = document.getElementById('challenge-name').value.trim() || 'My Challenge';
    const nextBtn = document.getElementById('next-btn');

    nextBtn.disabled = true;
    nextBtn.textContent = 'Creating...';

    try {
      // Create the custom protocol
      const protocol = await this.createCustomProtocol(name, this._customProtocolHabits);

      // Create the challenge with this protocol
      const challenge = await Challenges.create({
        protocolId: protocol.id,
        name: name,
        friendIds: [],
        mode: 'pro',
        startDate: this._startDate
      });

      this.closeCreateModal();

      // Navigate to the new challenge
      App.navigateTo('challenge-detail', challenge.id);
    } catch (error) {
      console.error('Error creating protocol and challenge:', error);
      alert('Failed to create challenge: ' + error.message);
      nextBtn.disabled = false;
      nextBtn.textContent = 'Create Challenge';
    }
  },

  // Close create modal
  closeCreateModal() {
    const modal = document.getElementById('create-protocol-modal');
    if (modal) modal.remove();
    this._customProtocolHabits = [];
  },

  // Add an existing habit to the custom protocol
  addExistingHabit(habitId, title, description) {
    // Check if already added - if so, remove it (toggle)
    const existingIndex = this._customProtocolHabits.findIndex(h => h.title === title);
    if (existingIndex >= 0) {
      this._customProtocolHabits.splice(existingIndex, 1);
    } else {
      this._customProtocolHabits.push({ title, description });
    }
    // Re-render step to update UI
    if (this._createStep === 1) {
      this._renderStep();
    }
  },

  // Add a custom habit
  addCustomHabit() {
    const input = document.getElementById('custom-habit-title');
    const title = input.value.trim();

    if (!title) return;

    // Check if already added
    if (this._customProtocolHabits.some(h => h.title === title)) {
      input.value = '';
      return;
    }

    this._customProtocolHabits.push({ title, description: '' });
    // Re-render step to update UI
    if (this._createStep === 1) {
      this._renderStep();
      // Re-focus the input after re-render
      setTimeout(() => {
        const newInput = document.getElementById('custom-habit-title');
        if (newInput) newInput.focus();
      }, 0);
    }
  },

  // Remove a habit from selection
  removeHabit(index) {
    this._customProtocolHabits.splice(index, 1);
    // Re-render current step to update UI
    if (this._createStep === 1) {
      this._renderStep();
    }
  },

};

// Export for use in other modules
window.Protocols = Protocols;
