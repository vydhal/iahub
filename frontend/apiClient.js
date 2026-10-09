const API_BASE = '/api';

export const apiClient = {
  token: localStorage.getItem('jwt_token') || '',

  async fetch(endpoint, options = {}) {
    const headers = {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...options.headers,
    };

    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Erro na requisição' }));
      throw new Error(err.message || 'Erro no servidor');
    }

    if (res.status === 204) return null;
    return res.json();
  },

  // Auth
  async login(email, password) {
    const data = await this.fetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (data.token) {
      this.token = data.token;
      localStorage.setItem('jwt_token', data.token);
    }
    return data;
  },

  async register(name, email, password) {
    const data = await this.fetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    });
    if (data.token) {
      this.token = data.token;
      localStorage.setItem('jwt_token', data.token);
    }
    return data;
  },

  logout() {
    this.token = '';
    localStorage.removeItem('jwt_token');
  },

  async me() {
    return this.fetch('/auth/me');
  },

  async updateProfile(data) {
    return this.fetch('/auth/me', { method: 'PATCH', body: JSON.stringify(data) });
  },

  // Workspace
  async getWorkspaces() {
    return this.fetch('/workspaces');
  },

  async updateWorkspace(id, data) {
    return this.fetch(`/workspaces/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },

  // Campaigns
  async getCampaigns() {
    return this.fetch('/campaigns');
  },

  async getCampaign(id) {
    return this.fetch(`/campaigns/${id}`);
  },

  async createCampaign(campaignData) {
    return this.fetch('/campaigns', {
      method: 'POST',
      body: JSON.stringify(campaignData),
    });
  },

  async setCampaignFavorite(id, isFavorite) {
    return this.fetch(`/campaigns/${id}/favorite`, {
      method: 'PATCH',
      body: JSON.stringify({ isFavorite }),
    });
  },

  // Stream de Workflow em Tempo Real via SSE
  streamWorkflow(campaignId, onStepUpdate, onComplete, onError) {
    // EventSource não envia headers: o backend valida o JWT recebido na query.
    const eventSource = new EventSource(`${API_BASE}/campaigns/${campaignId}/stream?token=${encodeURIComponent(this.token)}`);

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'COMPLETED') {
          eventSource.close();
          onComplete?.(payload);
        } else if (payload.type === 'ERROR') {
          eventSource.close();
          onError?.(payload.error);
        } else if (payload.step) {
          onStepUpdate?.(payload.step, payload.label, payload.data);
        }
      } catch (err) {
        console.error('Erro ao processar SSE:', err);
      }
    };

    eventSource.onerror = (err) => {
      console.error('Erro na conexão SSE:', err);
      eventSource.close();
      onError?.(err);
    };

    return eventSource;
  },

  // Creatives & Refinement
  async getCreatives() {
    return this.fetch('/creatives');
  },

  async refineCreative(versionId, prompt) {
    return this.fetch(`/creatives/${versionId}/refine`, {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    });
  },

  // Agents
  async getAgents() {
    return this.fetch('/agents');
  },

  async createAgent(data) {
    return this.fetch('/agents', { method: 'POST', body: JSON.stringify(data) });
  },

  async updateAgent(id, data) {
    return this.fetch(`/agents/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },

  async deleteAgent(id) {
    return this.fetch(`/agents/${id}`, { method: 'DELETE' });
  },

  // Brands
  async getBrands() {
    return this.fetch('/brands');
  },

  async createBrand(data) {
    return this.fetch('/brands', { method: 'POST', body: JSON.stringify(data) });
  },

  async updateBrand(id, data) {
    return this.fetch(`/brands/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },

  async deleteBrand(id) {
    return this.fetch(`/brands/${id}`, { method: 'DELETE' });
  },

  // Logo da marca: multipart (não passa pelo fetch() genérico — precisa do boundary automático
  // do navegador, nunca Content-Type: application/json).
  async uploadBrandLogo(id, file) {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API_BASE}/brands/${id}/logo`, {
      method: 'POST',
      headers: { ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Erro ao enviar a logo' }));
      throw new Error(err.message || 'Erro no servidor');
    }
    return res.json();
  },

  async deleteBrandLogo(id) {
    return this.fetch(`/brands/${id}/logo`, { method: 'DELETE' });
  },

  // `logoUrl` já vem com o prefixo /api (mesmo padrão dos assets de mídia) — só falta o token,
  // já que <img> não manda cabeçalho Authorization.
  brandLogoSrc(logoUrl) {
    return logoUrl ? `${logoUrl}&token=${this.token}` : null;
  },

  // Integrations
  async getIntegrations() {
    return this.fetch('/integrations');
  },

  async createIntegration(data) {
    return this.fetch('/integrations', { method: 'POST', body: JSON.stringify(data) });
  },

  async updateIntegration(id, data) {
    return this.fetch(`/integrations/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },

  async deleteIntegration(id) {
    return this.fetch(`/integrations/${id}`, { method: 'DELETE' });
  },

  // Google Drive
  async getGoogleDriveStatus() {
    return this.fetch('/integrations/google-drive/status');
  },

  async getGoogleDriveConnectUrl() {
    return this.fetch('/integrations/google-drive/connect-url');
  },

  async disconnectGoogleDrive() {
    return this.fetch('/integrations/google-drive/disconnect', { method: 'DELETE' });
  },

  // Instagram (por marca)
  async getInstagramStatus(brandId) {
    return this.fetch(`/integrations/instagram/status?brandId=${encodeURIComponent(brandId)}`);
  },

  async getInstagramConnectUrl(brandId) {
    return this.fetch(`/integrations/instagram/connect-url?brandId=${encodeURIComponent(brandId)}`);
  },

  async disconnectInstagram(brandId) {
    return this.fetch(`/integrations/instagram/disconnect?brandId=${encodeURIComponent(brandId)}`, { method: 'DELETE' });
  },

  // MCP (conectar Claude/ChatGPT via Model Context Protocol)
  async getMcpTokenStatus() {
    return this.fetch('/integrations/mcp/token');
  },
  async createMcpToken() {
    return this.fetch('/integrations/mcp/token', { method: 'POST', body: JSON.stringify({}) });
  },
  async revokeMcpToken() {
    return this.fetch('/integrations/mcp/token', { method: 'DELETE' });
  },

  async getUsage() {
    return this.fetch('/usage');
  },

  // ── Agent Operations Center ──
  async getAgentCatalog() {
    return this.fetch('/agents/catalog');
  },
  async getAgent(id) {
    return this.fetch(`/agents/${id}`);
  },
  async testAgent(id, input) {
    return this.fetch(`/agents/${id}/test`, { method: 'POST', body: JSON.stringify({ input: input || {} }) });
  },
  async runAgent(id, input) {
    return this.fetch(`/agents/${id}/run`, { method: 'POST', body: JSON.stringify({ input: input || {} }) });
  },
  async activateAgent(id) {
    return this.fetch(`/agents/${id}/activate`, { method: 'POST', body: '{}' });
  },
  async pauseAgent(id) {
    return this.fetch(`/agents/${id}/pause`, { method: 'POST', body: '{}' });
  },
  async rotateAgentWebhook(id) {
    return this.fetch(`/agents/${id}/webhook-token`, { method: 'POST', body: '{}' });
  },

  async getExecutions(params = {}) {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
    return this.fetch(`/executions${q ? `?${q}` : ''}`);
  },
  async getExecution(id) {
    return this.fetch(`/executions/${id}`);
  },
  async cancelExecution(id) {
    return this.fetch(`/executions/${id}/cancel`, { method: 'POST', body: '{}' });
  },

  async getApprovals(status = 'pending') {
    return this.fetch(`/approvals?status=${encodeURIComponent(status)}`);
  },
  async approve(id, data = {}) {
    return this.fetch(`/approvals/${id}/approve`, { method: 'POST', body: JSON.stringify(data) });
  },
  async reject(id, data = {}) {
    return this.fetch(`/approvals/${id}/reject`, { method: 'POST', body: JSON.stringify(data) });
  },

  async getCredentialTypes() {
    return this.fetch('/credentials/types');
  },
  async getCredentials() {
    return this.fetch('/credentials');
  },
  async createCredential(data) {
    return this.fetch('/credentials', { method: 'POST', body: JSON.stringify(data) });
  },
  async updateCredential(id, data) {
    return this.fetch(`/credentials/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },
  async deleteCredential(id) {
    return this.fetch(`/credentials/${id}`, { method: 'DELETE' });
  },
  async testCredential(id) {
    return this.fetch(`/credentials/${id}/test`, { method: 'POST', body: '{}' });
  },

  async getOperationsSummary() {
    return this.fetch('/operations/summary');
  },
  async getOnboarding() {
    return this.fetch('/operations/onboarding');
  },
  async getAudit(limit = 30) {
    return this.fetch(`/audit?limit=${limit}`);
  },

  // ── Editor de posts (carrossel) ──
  async getCarousels() {
    return this.fetch('/carousel');
  },
  async getCarousel(id) {
    return this.fetch(`/carousel/${id}`);
  },
  async createCarousel(data) {
    return this.fetch('/carousel', { method: 'POST', body: JSON.stringify(data) });
  },
  async updateCarousel(id, data) {
    return this.fetch(`/carousel/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },
  async deleteCarousel(id) {
    return this.fetch(`/carousel/${id}`, { method: 'DELETE' });
  },
  async carouselScript(data) {
    return this.fetch('/carousel/script', { method: 'POST', body: JSON.stringify(data) });
  },
  async carouselImagePrompt(data) {
    return this.fetch('/carousel/image-prompt', { method: 'POST', body: JSON.stringify(data) });
  },
  async carouselImage(data) {
    return this.fetch('/carousel/image', { method: 'POST', body: JSON.stringify(data) });
  },

  // ── Mídia ──
  async getMedia() {
    return this.fetch('/media');
  },
  async uploadMediaFile(file) {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API_BASE}/media`, { method: 'POST', headers: { Authorization: `Bearer ${this.token}` }, body: form });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'Falha no upload');
    return res.json();
  },
  async uploadDataUrl(dataUrl, name, origin) {
    return this.fetch('/media/data-url', { method: 'POST', body: JSON.stringify({ dataUrl, name, origin }) });
  },
  async deleteMedia(id) {
    return this.fetch(`/media/${id}`, { method: 'DELETE' });
  },
  // <img>/CSS não enviam header: o arquivo é servido com o token na query.
  mediaUrl(idOrUrl) {
    if (!idOrUrl) return '';
    if (idOrUrl.startsWith('data:') || idOrUrl.startsWith('http')) return idOrUrl;
    const path = idOrUrl.startsWith('/api/') ? idOrUrl : `/api/media/${idOrUrl}/file`;
    return `${path}?token=${encodeURIComponent(this.token)}`;
  },

  // ── Cobrança ──
  async billingOverview() {
    return this.fetch('/billing/overview');
  },
  async subscribePlan(planCode) {
    return this.fetch('/billing/subscribe', { method: 'POST', body: JSON.stringify({ planCode }) });
  },
  async closeCycle(force) {
    return this.fetch('/billing/close-cycle', { method: 'POST', body: JSON.stringify({ force: !!force }) });
  },
  async invoiceCheckout(id) {
    return this.fetch(`/billing/invoices/${id}/checkout`, { method: 'POST', body: '{}' });
  },
  async invoiceRefresh(id) {
    return this.fetch(`/billing/invoices/${id}/refresh`, { method: 'POST', body: '{}' });
  },
  // ── Agendador de posts ──
  async getScheduledPosts(status) {
    return this.fetch(`/scheduled-posts${status && status !== 'all' ? `?status=${status}` : ''}`);
  },
  async getSchedulerCatalog() {
    return this.fetch('/scheduled-posts/catalog');
  },
  async createScheduledPost(data) {
    return this.fetch('/scheduled-posts', { method: 'POST', body: JSON.stringify(data) });
  },
  async updateScheduledPost(id, data) {
    return this.fetch(`/scheduled-posts/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },
  async publishPostNow(id) {
    return this.fetch(`/scheduled-posts/${id}/publish-now`, { method: 'POST', body: '{}' });
  },
  async cancelScheduledPost(id) {
    return this.fetch(`/scheduled-posts/${id}/cancel`, { method: 'POST', body: '{}' });
  },
  async deleteScheduledPost(id) {
    return this.fetch(`/scheduled-posts/${id}`, { method: 'DELETE' });
  },

  // ── Plataforma (superadmin) ──
  // ── Identidade da plataforma ──
  async getBranding() {
    const res = await fetch(`${API_BASE}/platform/branding`);
    if (!res.ok) throw new Error('Falha ao carregar identidade');
    return res.json();
  },
  async adminBranding() {
    return this.fetch('/admin/branding');
  },
  async adminSaveBranding(data) {
    return this.fetch('/admin/branding', { method: 'PUT', body: JSON.stringify(data) });
  },
  async adminUploadLogo(file) {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API_BASE}/admin/branding/logo`, { method: 'POST', headers: { Authorization: `Bearer ${this.token}` }, body: form });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'Falha ao enviar a logo');
    return res.json();
  },
  async adminRemoveLogo() {
    return this.fetch('/admin/branding/logo', { method: 'DELETE' });
  },
  async adminDeleteAccount(id, confirmName) {
    return this.fetch(`/admin/accounts/${id}`, { method: 'DELETE', body: JSON.stringify({ confirmName }) });
  },

  async adminCatalog() {
    return this.fetch('/admin/catalog');
  },
  async adminMetrics() {
    return this.fetch('/admin/metrics');
  },
  async adminAccounts() {
    return this.fetch('/admin/accounts');
  },
  async adminAccount(id) {
    return this.fetch(`/admin/accounts/${id}`);
  },
  async adminCreateAccount(data) {
    return this.fetch('/admin/accounts', { method: 'POST', body: JSON.stringify(data) });
  },
  async adminUpdateAccount(id, data) {
    return this.fetch(`/admin/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },
  async adminSuspend(id, reason) {
    return this.fetch(`/admin/accounts/${id}/suspend`, { method: 'POST', body: JSON.stringify({ reason }) });
  },
  async adminReactivate(id) {
    return this.fetch(`/admin/accounts/${id}/reactivate`, { method: 'POST', body: '{}' });
  },
  async adminCreateUser(accountId, data) {
    return this.fetch(`/admin/accounts/${accountId}/users`, { method: 'POST', body: JSON.stringify(data) });
  },
  async adminUpdateUser(userId, data) {
    return this.fetch(`/admin/users/${userId}`, { method: 'PATCH', body: JSON.stringify(data) });
  },

  async invoiceManualPayment(id, note) {
    return this.fetch(`/billing/invoices/${id}/manual-payment`, { method: 'POST', body: JSON.stringify({ note }) });
  },
};
