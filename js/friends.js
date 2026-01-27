// Friends Management Module

const Friends = {
  // Search for user by email
  async searchByEmail(email) {
    const client = SupabaseClient.client;
    if (!client) throw new Error('Supabase not initialized');

    const currentUser = await SupabaseClient.getCurrentUser();
    if (!currentUser) throw new Error('Not authenticated');

    const { data, error } = await client
      .from('profiles')
      .select('id, email, display_name')
      .eq('email', email.toLowerCase())
      .neq('id', currentUser.id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null; // No user found
      }
      throw error;
    }

    return data;
  },

  // Store a pending invite and send an invite email via the server
  async sendInviteLink(email) {
    const client = SupabaseClient.client;
    if (!client) throw new Error('Supabase not initialized');

    const currentUser = await SupabaseClient.getCurrentUser();
    if (!currentUser) throw new Error('Not authenticated');

    // Store pending invite in database
    const { data, error } = await client
      .from('pending_invites')
      .insert({
        inviter_id: currentUser.id,
        invited_email: email.toLowerCase()
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new Error('Invite already sent to this email');
      }
      throw error;
    }

    // Send invite email via server endpoint
    let emailSent = false;
    let emailError = null;
    try {
      const res = await fetch('/api/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.toLowerCase() })
      });
      if (res.ok) {
        emailSent = true;
      } else {
        const result = await res.json().catch(() => ({}));
        emailError = result.details || result.error || `Server responded with ${res.status}`;
        console.error('Invite email failed:', emailError);
      }
    } catch (e) {
      emailError = e.message;
      console.error('Invite email request failed:', e.message);
    }

    return { ...data, emailSent, emailError };
  },

  // Get pending invites sent by the current user
  async getPendingInvites() {
    const client = SupabaseClient.client;
    if (!client) throw new Error('Supabase not initialized');

    const { data, error } = await client
      .from('pending_invites')
      .select('id, invited_email, created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  },

  // Cancel a pending invite
  async cancelInvite(inviteId) {
    const client = SupabaseClient.client;
    if (!client) throw new Error('Supabase not initialized');

    const { error } = await client
      .from('pending_invites')
      .delete()
      .eq('id', inviteId);

    if (error) throw error;
  },

  // Send friend request
  async sendRequest(friendId) {
    const client = SupabaseClient.client;
    if (!client) throw new Error('Supabase not initialized');

    const currentUser = await SupabaseClient.getCurrentUser();
    if (!currentUser) throw new Error('Not authenticated');

    // Check if friendship already exists
    const { data: existing } = await client
      .from('friendships')
      .select('id, status')
      .or(`and(user_id.eq.${currentUser.id},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${currentUser.id})`)
      .single();

    if (existing) {
      if (existing.status === 'accepted') {
        throw new Error('Already friends');
      } else if (existing.status === 'pending') {
        throw new Error('Friend request already pending');
      }
    }

    const { data, error } = await client
      .from('friendships')
      .insert({
        user_id: currentUser.id,
        friend_id: friendId,
        status: 'pending'
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // Accept friend request
  async acceptRequest(friendshipId) {
    const client = SupabaseClient.client;
    if (!client) throw new Error('Supabase not initialized');

    const { data, error } = await client
      .from('friendships')
      .update({ status: 'accepted' })
      .eq('id', friendshipId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // Decline friend request
  async declineRequest(friendshipId) {
    const client = SupabaseClient.client;
    if (!client) throw new Error('Supabase not initialized');

    const { data, error } = await client
      .from('friendships')
      .update({ status: 'declined' })
      .eq('id', friendshipId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // Remove friend
  async removeFriend(friendshipId) {
    const client = SupabaseClient.client;
    if (!client) throw new Error('Supabase not initialized');

    const { error } = await client
      .from('friendships')
      .delete()
      .eq('id', friendshipId);

    if (error) throw error;
  },

  // Get all accepted friends
  async getFriends() {
    const client = SupabaseClient.client;
    if (!client) throw new Error('Supabase not initialized');

    const currentUser = await SupabaseClient.getCurrentUser();
    if (!currentUser) throw new Error('Not authenticated');

    // Get friendships where current user is either user_id or friend_id
    const { data, error } = await client
      .from('friendships')
      .select(`
        id,
        status,
        created_at,
        user_id,
        friend_id,
        user:profiles!friendships_user_id_fkey(id, email, display_name),
        friend:profiles!friendships_friend_id_fkey(id, email, display_name)
      `)
      .eq('status', 'accepted')
      .or(`user_id.eq.${currentUser.id},friend_id.eq.${currentUser.id}`);

    if (error) throw error;

    // Map to consistent friend object
    return data.map(f => {
      const friendProfile = f.user_id === currentUser.id ? f.friend : f.user;
      return {
        friendshipId: f.id,
        id: friendProfile.id,
        email: friendProfile.email,
        displayName: friendProfile.display_name,
        since: f.created_at
      };
    });
  },

  // Get pending friend requests (received)
  async getPendingRequests() {
    const client = SupabaseClient.client;
    if (!client) throw new Error('Supabase not initialized');

    const currentUser = await SupabaseClient.getCurrentUser();
    if (!currentUser) throw new Error('Not authenticated');

    const { data, error } = await client
      .from('friendships')
      .select(`
        id,
        created_at,
        user:profiles!friendships_user_id_fkey(id, email, display_name)
      `)
      .eq('friend_id', currentUser.id)
      .eq('status', 'pending');

    if (error) throw error;

    return data.map(f => ({
      friendshipId: f.id,
      id: f.user.id,
      email: f.user.email,
      displayName: f.user.display_name,
      requestedAt: f.created_at
    }));
  },

  // Get sent friend requests (pending)
  async getSentRequests() {
    const client = SupabaseClient.client;
    if (!client) throw new Error('Supabase not initialized');

    const currentUser = await SupabaseClient.getCurrentUser();
    if (!currentUser) throw new Error('Not authenticated');

    const { data, error } = await client
      .from('friendships')
      .select(`
        id,
        created_at,
        friend:profiles!friendships_friend_id_fkey(id, email, display_name)
      `)
      .eq('user_id', currentUser.id)
      .eq('status', 'pending');

    if (error) throw error;

    return data.map(f => ({
      friendshipId: f.id,
      id: f.friend.id,
      email: f.friend.email,
      displayName: f.friend.display_name,
      sentAt: f.created_at
    }));
  },

  // Render friends page
  async render() {
    const container = document.getElementById('friends-container');
    if (!container) return;

    try {
      const [friends, pendingRequests, sentRequests, pendingInvites] = await Promise.all([
        this.getFriends(),
        this.getPendingRequests(),
        this.getSentRequests(),
        this.getPendingInvites()
      ]);

      container.innerHTML = `
        <!-- Invite Friend -->
        <div class="bg-oura-card rounded-2xl p-6 mb-6">
          <h3 class="text-lg font-semibold mb-4">Add Friend</h3>
          <form id="invite-friend-form" class="flex flex-col sm:flex-row gap-2">
            <input type="email" id="friend-email" placeholder="friend@email.com"
              class="flex-1 px-4 py-3 bg-oura-subtle border border-oura-border rounded-lg text-white placeholder-neutral-600 focus:outline-none focus:border-oura-teal">
            <button type="submit" class="w-full sm:w-auto px-6 py-3 min-h-[44px] bg-oura-teal text-gray-900 font-semibold rounded-lg hover:bg-oura-teal/90">
              Send Invite
            </button>
          </form>
          <p id="invite-message" class="text-sm mt-2 hidden"></p>
        </div>

        <!-- Pending Requests -->
        ${pendingRequests.length > 0 ? `
          <div class="bg-oura-card rounded-2xl p-6 mb-6">
            <h3 class="text-lg font-semibold mb-4">Friend Requests (${pendingRequests.length})</h3>
            <div class="space-y-3">
              ${pendingRequests.map(req => `
                <div class="flex items-center justify-between p-3 bg-oura-subtle rounded-lg">
                  <div>
                    <p class="font-medium">${req.displayName || req.email}</p>
                    <p class="text-sm text-oura-muted">${req.email}</p>
                  </div>
                  <div class="flex gap-2">
                    <button onclick="Friends.handleAccept('${req.friendshipId}')"
                      class="px-4 py-2 min-h-[44px] bg-oura-teal text-gray-900 rounded-lg text-sm font-medium hover:bg-oura-teal/90">
                      Accept
                    </button>
                    <button onclick="Friends.handleDecline('${req.friendshipId}')"
                      class="px-4 py-2 min-h-[44px] bg-oura-border text-white rounded-lg text-sm font-medium hover:bg-oura-subtle">
                      Decline
                    </button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Sent Requests -->
        ${sentRequests.length > 0 ? `
          <div class="bg-oura-card rounded-2xl p-6 mb-6">
            <h3 class="text-lg font-semibold mb-4 text-oura-muted">Sent Requests (${sentRequests.length})</h3>
            <div class="space-y-3">
              ${sentRequests.map(req => `
                <div class="flex items-center justify-between p-3 bg-oura-subtle/50 rounded-lg">
                  <div>
                    <p class="font-medium text-neutral-300">${req.displayName || req.email}</p>
                    <p class="text-sm text-oura-muted">${req.email}</p>
                  </div>
                  <span class="text-sm text-oura-muted">Pending</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Pending Invite Links -->
        ${pendingInvites.length > 0 ? `
          <div class="bg-oura-card rounded-2xl p-6 mb-6">
            <h3 class="text-lg font-semibold mb-4 text-oura-muted">Invite Links Sent (${pendingInvites.length})</h3>
            <div class="space-y-3">
              ${pendingInvites.map(inv => `
                <div class="flex items-center justify-between p-3 bg-oura-subtle/50 rounded-lg">
                  <div>
                    <p class="font-medium text-neutral-300">${inv.invited_email}</p>
                    <p class="text-xs text-oura-muted">Auto-connects when they sign up</p>
                  </div>
                  <button onclick="Friends.handleCancelInvite('${inv.id}')"
                    class="text-sm text-oura-muted hover:text-red-400">
                    Cancel
                  </button>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Friends List -->
        <div class="bg-oura-card rounded-2xl p-6">
          <h3 class="text-lg font-semibold mb-4">Friends (${friends.length})</h3>
          ${friends.length > 0 ? `
            <div class="space-y-3">
              ${friends.map(friend => `
                <div class="flex items-center justify-between p-3 bg-oura-subtle rounded-lg">
                  <div>
                    <p class="font-medium">${friend.displayName || friend.email}</p>
                    <p class="text-sm text-oura-muted">${friend.email}</p>
                  </div>
                  <button onclick="Friends.handleRemove('${friend.friendshipId}')"
                    class="text-sm text-oura-muted hover:text-red-400">
                    Remove
                  </button>
                </div>
              `).join('')}
            </div>
          ` : `
            <p class="text-oura-muted">No friends yet. Invite someone to get started!</p>
          `}
        </div>
      `;

      // Set up invite form handler
      const inviteForm = document.getElementById('invite-friend-form');
      if (inviteForm) {
        inviteForm.addEventListener('submit', this.handleInvite.bind(this));
      }
    } catch (error) {
      console.error('Error rendering friends:', error);
      container.innerHTML = `
        <div class="bg-red-900/20 border border-red-500 rounded-lg p-4">
          <p class="text-red-400">Failed to load friends: ${error.message}</p>
        </div>
      `;
    }
  },

  // Handle invite form submission
  async handleInvite(e) {
    e.preventDefault();

    const emailInput = document.getElementById('friend-email');
    const messageEl = document.getElementById('invite-message');
    const email = emailInput.value.trim();

    if (!email) return;

    try {
      messageEl.className = 'text-sm mt-2 text-oura-muted';
      messageEl.textContent = 'Searching...';
      messageEl.classList.remove('hidden');

      const user = await this.searchByEmail(email);

      if (!user) {
        messageEl.className = 'text-sm mt-2 text-yellow-400';
        messageEl.innerHTML = `No user found with that email. <button id="send-invite-link-btn" class="underline hover:text-yellow-300">Send invite link?</button>`;
        document.getElementById('send-invite-link-btn').addEventListener('click', () => {
          this.handleSendInviteLink(email);
        });
        return;
      }

      await this.sendRequest(user.id);

      messageEl.className = 'text-sm mt-2 text-green-400';
      messageEl.textContent = 'Friend request sent!';
      emailInput.value = '';

      // Refresh the list
      await this.render();
    } catch (error) {
      messageEl.className = 'text-sm mt-2 text-red-400';
      messageEl.textContent = error.message;
    }
  },

  // Handle accept request
  async handleAccept(friendshipId) {
    try {
      await this.acceptRequest(friendshipId);
      await this.render();
    } catch (error) {
      console.error('Error accepting request:', error);
      alert('Failed to accept request: ' + error.message);
    }
  },

  // Handle decline request
  async handleDecline(friendshipId) {
    try {
      await this.declineRequest(friendshipId);
      await this.render();
    } catch (error) {
      console.error('Error declining request:', error);
      alert('Failed to decline request: ' + error.message);
    }
  },

  // Handle sending an invite link to a non-existing user
  async handleSendInviteLink(email) {
    const messageEl = document.getElementById('invite-message');
    const emailInput = document.getElementById('friend-email');

    try {
      const result = await this.sendInviteLink(email);

      const inviteUrl = window.location.origin;
      await navigator.clipboard.writeText(inviteUrl);

      if (result.emailSent) {
        messageEl.className = 'text-sm mt-2 text-green-400';
        messageEl.textContent = `Invite email sent to ${email}! Link also copied to clipboard.`;
      } else {
        messageEl.className = 'text-sm mt-2 text-yellow-400';
        messageEl.textContent = `Invite saved but email could not be sent (${result.emailError}). Link copied to clipboard — share it manually.`;
      }
      emailInput.value = '';

      await this.render();
    } catch (error) {
      messageEl.className = 'text-sm mt-2 text-red-400';
      messageEl.textContent = error.message;
    }
  },

  // Handle cancelling a pending invite
  async handleCancelInvite(inviteId) {
    try {
      await this.cancelInvite(inviteId);
      await this.render();
    } catch (error) {
      console.error('Error cancelling invite:', error);
      alert('Failed to cancel invite: ' + error.message);
    }
  },

  // Handle remove friend
  async handleRemove(friendshipId) {
    if (!confirm('Remove this friend?')) return;

    try {
      await this.removeFriend(friendshipId);
      await this.render();
    } catch (error) {
      console.error('Error removing friend:', error);
      alert('Failed to remove friend: ' + error.message);
    }
  }
};

// Export for use in other modules
window.Friends = Friends;
