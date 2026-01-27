// Protocols Module

const Protocols = {
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

  // Render protocols list page
  async renderList() {
    const container = document.getElementById('protocols-container');
    if (!container) return;

    try {
      const protocols = await this.getAll();

      container.innerHTML = `
        <div class="space-y-4">
          ${protocols.map(protocol => `
            <div onclick="App.navigateTo('protocol-detail', '${protocol.id}')"
              class="bg-oura-card rounded-2xl p-6 cursor-pointer hover:bg-oura-subtle transition-colors">
              <div class="flex items-start gap-4">
                <span class="text-4xl">${protocol.icon || '📋'}</span>
                <div>
                  <h3 class="text-xl font-semibold">${protocol.name}</h3>
                  <p class="text-oura-muted mt-1">${protocol.description || ''}</p>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    } catch (error) {
      console.error('Error rendering protocols:', error);
      container.innerHTML = `
        <div class="bg-red-900/20 border border-red-500 rounded-lg p-4">
          <p class="text-red-400">Failed to load protocols: ${error.message}</p>
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

      container.innerHTML = `
        <div class="bg-oura-card rounded-2xl p-6 mb-6">
          <button onclick="App.navigateTo('protocols')" class="min-h-[44px] inline-flex items-center text-oura-muted hover:text-white mb-4">
            &larr; Back to Protocols
          </button>
          <div class="flex items-start gap-4">
            <span class="text-5xl">${protocol.icon || '📋'}</span>
            <div>
              <h2 class="text-2xl font-bold">${protocol.name}</h2>
              <p class="text-oura-muted mt-2">${protocol.description || ''}</p>
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
                  <p class="font-medium">${habit.title}</p>
                  ${habit.description ? `<p class="text-sm text-oura-muted mt-1">${habit.description}</p>` : ''}
                </div>
              </div>
            `).join('') || '<p class="text-oura-muted">No habits defined for this protocol.</p>'}
          </div>
        </div>

        <div class="bg-oura-card rounded-2xl p-6">
          <h3 class="text-lg font-semibold mb-4">Start a Challenge</h3>
          <p class="text-oura-muted mb-4">Ready to commit to this protocol? Create a 30-day challenge and invite friends to join you.</p>
          <button onclick="Challenges.showCreateModal()"
            class="w-full py-3 min-h-[48px] bg-oura-teal text-gray-900 font-semibold rounded-lg hover:bg-oura-teal/90">
            Create Challenge with This Protocol
          </button>
        </div>
      `;
    } catch (error) {
      console.error('Error rendering protocol detail:', error);
      container.innerHTML = `
        <div class="bg-red-900/20 border border-red-500 rounded-lg p-4">
          <p class="text-red-400">Failed to load protocol: ${error.message}</p>
        </div>
      `;
    }
  }
};

// Export for use in other modules
window.Protocols = Protocols;
