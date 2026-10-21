import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';

const brlFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const PRODUCTION_DOMAIN = 'https://pacific-flowers-meli-ads.vercel.app';
const ENV_API_BASE = (import.meta.env?.VITE_API_URL || '').trim().replace(/\/$/, '');

// Resolve a URL base da API sem nunca travar em localhost:3000 na produção
function resolveApiBaseUrl() {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return '';
    }
  }
  if (ENV_API_BASE && !/localhost/i.test(ENV_API_BASE)) {
    return ENV_API_BASE;
  }
  return '';
}

const API_BASE = resolveApiBaseUrl();
export const PRODUCTION_REDIRECT_URI = `${
  ENV_API_BASE && !/localhost/i.test(ENV_API_BASE) ? ENV_API_BASE : PRODUCTION_DOMAIN
}/callback`;

// ============================================================================
// Pilar 2: Motor Matemático do Simulador de Margem e Gatilho de R$ 79,00 (16% B2B)
// ============================================================================
export function calculateMeliSimulator(salePrice, productCost) {
  const price = Number(salePrice) || 0;
  const cost = Number(productCost) || 0;
  const isFreeShippingEligible = price >= 79;

  // Regra confirmada:
  // Se Preço >= 79: Taxa fixa (R$ 6,00) é zerada e Custo de Frete Vendedor (R$ 21,00) é aplicado.
  // Se Preço < 79: Comissão 16% + R$ 6,00 de Taxa Fixa e Custo de Frete Vendedor R$ 0,00.
  const fixedFee = isFreeShippingEligible ? 0.0 : 6.0;
  const baseCommission16 = price * 0.16;
  const mlCommission = baseCommission16 + fixedFee;
  const sellerShippingCost = isFreeShippingEligible ? 21.0 : 0.0;

  const netProfit = price - cost - mlCommission - sellerShippingCost;
  const marginPercent = price > 0 ? (netProfit / price) * 100 : 0;

  return {
    price,
    productCost: cost,
    baseCommission16,
    fixedFee,
    mlCommission,
    sellerShippingCost,
    netProfit,
    marginPercent,
    isFreeShippingEligible,
    strategyTagText: isFreeShippingEligible
      ? 'Elegível: Frete Grátis'
      : 'Cuidado: Taxa Fixa Ativa',
  };
}

// ============================================================================
// Pilar 1: Error Boundary para garantir ZERO Tela Branca no Frontend
// ============================================================================
class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      errorMessage: error?.message || 'Erro inesperado na interface.',
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            backgroundColor: '#09090b',
            color: '#f4f4f6',
            display: 'grid',
            placeItems: 'center',
            padding: '2rem',
            fontFamily: 'Inter, sans-serif',
          }}
        >
          <div
            style={{
              maxWidth: '480px',
              backgroundColor: '#111115',
              border: '1px solid #ef4444',
              borderRadius: '12px',
              padding: '1.75rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
            }}
          >
            <h2 style={{ fontSize: '1.15rem', color: '#f87171' }}>
              ⚠️ Atenção: Ocorreu um erro recuperável
            </h2>
            <p style={{ fontSize: '0.88rem', color: '#a1a1aa', lineHeight: 1.5 }}>
              {this.state.errorMessage}
            </p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  this.setState({ hasError: false, errorMessage: '' });
                  window.location.replace('/');
                }}
              >
                Voltar ao Painel Principal
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Componente Individual de Toast/Snackbar usando Popover API manual (Modern Web Guidance)
function ToastItem({ toast, onDismiss }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (el && typeof el.showPopover === 'function') {
      try {
        el.showPopover();
      } catch {
        // Fallback caso o navegador já tenha aberto ou não suporte top-layer
      }
    }
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, 4500);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div
      ref={ref}
      popover="manual"
      role="status"
      aria-live="polite"
      className={`toast-item ${
        toast.type === 'error' ? 'toast-error' : 'toast-success'
      }`}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
        <span>{toast.type === 'error' ? '❌' : '✅'}</span>
        <span>{toast.text}</span>
      </div>
      <button
        type="button"
        className="toast-close-btn"
        aria-label="Fechar notificação"
        onClick={() => onDismiss(toast.id)}
      >
        ✕
      </button>
    </div>
  );
}

// ============================================================================
// Renderizador Markdown Estilo Google Gemini (Headings, Callouts, Code, Listas)
// ============================================================================
function renderInlineGemini(lineText) {
  if (!lineText) return null;
  const parts = String(lineText).split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={idx} style={{ color: '#f8fafc', fontWeight: 600 }}>
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={idx}
          style={{
            backgroundColor: 'rgba(139, 92, 246, 0.16)',
            border: '1px solid rgba(139, 92, 246, 0.32)',
            color: '#ddd6fe',
            padding: '0.1rem 0.38rem',
            borderRadius: '5px',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: '0.8em',
          }}
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return (
        <em key={idx} style={{ color: '#cbd5e1' }}>
          {part.slice(1, -1)}
        </em>
      );
    }
    return part;
  });
}

function GeminiMarkdown({ content, onCopyText }) {
  const raw = String(content || '');
  const segments = raw.split(/(```[\s\S]*?```)/g);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {segments.map((segment, sIdx) => {
        if (segment.startsWith('```') && segment.endsWith('```')) {
          const codeBody = segment.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
          return (
            <div
              key={sIdx}
              style={{
                backgroundColor: '#09090d',
                border: '1px solid rgba(139, 92, 246, 0.35)',
                borderRadius: '8px',
                padding: '0.75rem',
                marginTop: '0.25rem',
                marginBottom: '0.25rem',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '0.45rem',
                  paddingBottom: '0.35rem',
                  borderBottom: '1px solid var(--border-subtle)',
                  fontSize: '0.72rem',
                  color: '#a78bfa',
                }}
              >
                <span>📄 Texto Puro Auditado (Padrão Mercado Livre)</span>
                {onCopyText && (
                  <button
                    type="button"
                    className="copilot-quick-chip"
                    style={{ padding: '0.15rem 0.5rem', fontSize: '0.7rem' }}
                    onClick={() => onCopyText(codeBody)}
                  >
                    📋 Copiar Texto
                  </button>
                )}
              </div>
              <pre
                style={{
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: '0.78rem',
                  color: '#e2e8f0',
                  lineHeight: 1.5,
                }}
              >
                {codeBody}
              </pre>
            </div>
          );
        }

        const lines = segment.split('\n');
        return lines.map((line, lIdx) => {
          const trimmed = line.trim();
          if (!trimmed) {
            return <div key={`${sIdx}-${lIdx}`} style={{ height: '0.2rem' }} />;
          }
          if (trimmed === '---') {
            return (
              <hr
                key={`${sIdx}-${lIdx}`}
                style={{
                  border: 'none',
                  borderTop: '1px solid var(--border-subtle)',
                  margin: '0.35rem 0',
                }}
              />
            );
          }
          if (trimmed.startsWith('### ')) {
            return (
              <h3
                key={`${sIdx}-${lIdx}`}
                style={{
                  fontSize: '0.93rem',
                  fontWeight: 700,
                  color: '#c4b5fd',
                  margin: '0.35rem 0 0.15rem 0',
                  letterSpacing: '-0.01em',
                }}
              >
                {renderInlineGemini(trimmed.slice(4))}
              </h3>
            );
          }
          if (trimmed.startsWith('#### ')) {
            return (
              <h4
                key={`${sIdx}-${lIdx}`}
                style={{
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  color: '#93c5fd',
                  margin: '0.25rem 0 0.1rem 0',
                }}
              >
                {renderInlineGemini(trimmed.slice(5))}
              </h4>
            );
          }
          if (trimmed.startsWith('> ')) {
            return (
              <div
                key={`${sIdx}-${lIdx}`}
                style={{
                  borderLeft: '3px solid #8b5cf6',
                  backgroundColor: 'rgba(139, 92, 246, 0.1)',
                  padding: '0.55rem 0.75rem',
                  borderRadius: '0 8px 8px 0',
                  fontSize: '0.82rem',
                  color: '#e2e8f0',
                }}
              >
                {renderInlineGemini(trimmed.slice(2))}
              </div>
            );
          }
          if (/^[-*]\s+/.test(trimmed)) {
            return (
              <div
                key={`${sIdx}-${lIdx}`}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.45rem',
                  paddingLeft: line.startsWith('  ') ? '1rem' : '0.2rem',
                }}
              >
                <span style={{ color: '#a78bfa', fontWeight: 700 }}>•</span>
                <span style={{ flex: 1 }}>
                  {renderInlineGemini(trimmed.replace(/^[-*]\s+/, ''))}
                </span>
              </div>
            );
          }
          if (/^\d+\.\s+/.test(trimmed)) {
            const numMatch = trimmed.match(/^(\d+\.)\s+(.*)$/);
            return (
              <div
                key={`${sIdx}-${lIdx}`}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.45rem',
                  paddingLeft: '0.2rem',
                }}
              >
                <span
                  className="mono-value"
                  style={{ color: '#38bdf8', fontWeight: 600, fontSize: '0.8em' }}
                >
                  {numMatch ? numMatch[1] : '•'}
                </span>
                <span style={{ flex: 1 }}>
                  {renderInlineGemini(numMatch ? numMatch[2] : trimmed)}
                </span>
              </div>
            );
          }
          return (
            <div key={`${sIdx}-${lIdx}`} style={{ lineHeight: 1.55 }}>
              {renderInlineGemini(line)}
            </div>
          );
        });
      })}
    </div>
  );
}

function DashboardContent() {
  // Controle de Navegação da Sidebar ('ads_items' | 'mercado_ads' | 'copilot_chat')
  const [activeView, setActiveView] = useState('ads_items');

  // Estados de Autenticação e Anúncios Orgânicos
  const [items, setItems] = useState([]);
  const [source, setSource] = useState('loading');
  const [authStatus, setAuthStatus] = useState({
    authenticated: false,
    auth_url: `${API_BASE}/api/auth/login`,
    redirect_uri: PRODUCTION_REDIRECT_URI,
    user_id: null,
    expires_at: null,
  });
  const authRef = useRef(authStatus);
  useEffect(() => {
    authRef.current = authStatus;
  }, [authStatus]);

  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Estados do Modal de Edição (Human-in-the-Loop + Edição Manual em Tempo Real)
  const [selectedItem, setSelectedItem] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editCost, setEditCost] = useState('');
  const [editStock, setEditStock] = useState('');
  const [isAiSuggested, setIsAiSuggested] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);

  // Pilar 3: Sistema de Notificações Toast / Snackbar
  const [toasts, setToasts] = useState([]);

  const showToast = useCallback((type, text) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev.slice(-3), { id, type, text }]);
    setFeedback({ type, text });
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Estados do Módulo Mercado Ads (Tráfego Pago)
  const [campaigns, setCampaigns] = useState([]);
  const [adsMetrics, setAdsMetrics] = useState({
    period: { days: 30 },
    summary: { total_revenue_30d: 0, total_spend_30d: 0, average_acos: 0 },
    metrics_by_campaign: {},
  });
  const [adsLoading, setAdsLoading] = useState(false);
  const [adsSearchQuery, setAdsSearchQuery] = useState('');
  const [onlyB2BKitsOver79, setOnlyB2BKitsOver79] = useState(false);
  const [budgetDrafts, setBudgetDrafts] = useState({});
  // Pilar 3: Estado de loading individual por campanha ('status' | 'budget') para evitar múltiplos cliques
  const [campaignLoadingMap, setCampaignLoadingMap] = useState({});

  // Pilar 4: Estados do Copiloto B2B + Widget no Canto Inferior Direito (Estilo Gemini 3.8 Flash)
  const [isFloatingChatOpen, setIsFloatingChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([
    {
      role: 'assistant',
      text: `Olá! Sou o **Copiloto de Vendas B2B da Pacific Flowers** (motor **Gemini 3.8 Flash**), especialista no catálogo oficial, precificação de atacado e auditoria do **Mercado Livre**.

### ✨ O que posso fazer por você agora:
- 🔍 **Radar de Concorrência Top 5:** Consulto os 5 primeiros colocados do Mercado Livre em tempo real antes de sugerir títulos ou preços.
- 🏷️ **Fórmula Obrigatória de Títulos (Máx. 60 chars):** \`[Quantidade do Kit] + [Nome do Produto do Catálogo] + [Tamanho/Gramatura] + [Uso]\`.
- 💰 **Simulador do Gatilho de R$ 79,00:** Calculo comissões (16%), eliminação da taxa fixa de R$ 6,00 e absorção lucrativa do Frete Grátis (R$ 21,00).
- ✍️ **Descrições em Texto Puro & Auditoria de Fotos:** Gero descrições técnicas sem HTML e audito fotos de capa (\`RGB 255, 255, 255\`).`,
      tools: [],
    },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [previousInteractionId, setPreviousInteractionId] = useState(null);

  const dialogRef = useRef(null);

  // ==========================================================================
  // Pilar 5: Interceptor Global de API (Trata CORS, JSON seguro e Token Expirado)
  // ==========================================================================
  const apiFetch = useCallback(async (endpoint, options = {}) => {
    const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
    const headers = {
      Accept: 'application/json',
      ...(options.headers || {}),
    };

    if (authRef.current?.authenticated) {
      headers['x-meli-authenticated'] = 'true';
    }

    const response = await fetch(url, {
      ...options,
      credentials: 'include',
      headers,
    });

    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {
        message: 'Resposta inesperada do servidor. Verifique sua conexão.',
      };
    }

    // Interceptor de Token Expirado: redireciona silenciosamente para o Login do Mercado Livre
    if (
      response.status === 401 ||
      data?.token_expired === true ||
      data?.error === 'token_expired'
    ) {
      const targetLoginUrl =
        data?.auth_url || authRef.current?.auth_url || `${API_BASE}/api/auth/login`;
      window.location.replace(targetLoginUrl);
      return { response, data, redirectedToLogin: true };
    }

    return { response, data, redirectedToLogin: false };
  }, []);

  // Monitora expiração do access_token em tempo de execução para redirecionamento silencioso
  useEffect(() => {
    if (!authStatus.authenticated || !authStatus.expires_at) return;

    const remainingMs = Number(authStatus.expires_at) - Date.now();
    if (remainingMs <= 0) {
      window.location.replace(authStatus.auth_url || `${API_BASE}/api/auth/login`);
      return;
    }

    const timer = setTimeout(() => {
      window.location.replace(authStatus.auth_url || `${API_BASE}/api/auth/login`);
    }, remainingMs);

    return () => clearTimeout(timer);
  }, [authStatus.authenticated, authStatus.expires_at, authStatus.auth_url]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      setSelectedItem(null);
      setIsAiSuggested(false);
    };
    dialog.addEventListener('close', handleClose);

    let handleBackdropClick;
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      handleBackdropClick = (event) => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const isDialogContent =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width;
        if (!isDialogContent) {
          dialog.close();
        }
      };
      dialog.addEventListener('click', handleBackdropClick);
    }

    return () => {
      dialog.removeEventListener('close', handleClose);
      if (handleBackdropClick) {
        dialog.removeEventListener('click', handleBackdropClick);
      }
    };
  }, []);

  // ==========================================================================
  // Pilar 1: Inicialização e Tratamento de Erros (try/catch) no Callback OAuth 2.0
  // ==========================================================================
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const authResult = params.get('auth');
    const authMessage = params.get('auth_message');
    const oauthError = params.get('error');
    const returnedUserId = params.get('user_id');

    async function init() {
      try {
        if (authResult === 'success') {
          showToast(
            'success',
            `Conta Mercado Livre conectada com sucesso${
              returnedUserId ? ` (Seller ID: ${returnedUserId})` : ''
            }! Sincronizando anúncios...`
          );
          window.history.replaceState({}, document.title, '/');
        } else if (authResult === 'error' || oauthError) {
          const friendlyError =
            authMessage ||
            params.get('error_description') ||
            'Não foi possível concluir a autenticação com o Mercado Livre. Por favor, clique em "Conectar OAuth 2.0" para tentar novamente.';
          showToast('error', friendlyError);
          window.history.replaceState({}, document.title, '/');
        } else if (code) {
          try {
            const { response, data } = await apiFetch(
              `/api/auth/callback?code=${encodeURIComponent(code)}`
            );
            if (response.ok) {
              showToast(
                'success',
                `OAuth 2.0 autenticado com sucesso (Seller ID: ${data.user_id || 'Ativo'})!`
              );
            } else {
              showToast(
                'error',
                data.message ||
                  'A API do Mercado Livre não entregou o token de acesso. Tente conectar novamente.'
              );
            }
          } catch (callbackErr) {
            showToast(
              'error',
              callbackErr.message ||
                'Falha ao comunicar com a API do Mercado Livre durante o callback OAuth 2.0.'
            );
          } finally {
            window.history.replaceState({}, document.title, '/');
          }
        }

        await Promise.all([
          fetchAuthStatus(),
          fetchItems(authResult === 'success'),
          fetchMercadoAdsData(),
        ]);
      } catch (initErr) {
        showToast(
          'error',
          initErr.message || 'Erro ao inicializar o painel. Modo de segurança ativado.'
        );
      }
    }

    init();
  }, [apiFetch, showToast]);

  async function fetchAuthStatus() {
    try {
      const { response, data } = await apiFetch('/api/auth/status');
      if (response.ok && data) {
        setAuthStatus(data);
      }
    } catch {
      // Ignora erro silenciosamente no boot
    }
  }

  async function fetchItems(forceRefresh = false) {
    setLoading(true);
    try {
      const { response, data, redirectedToLogin } = await apiFetch(
        `/api/items${forceRefresh ? '?refresh=true' : ''}`
      );
      if (redirectedToLogin) return;
      if (!response.ok) {
        throw new Error(data.message || 'Erro ao carregar anúncios');
      }
      setItems(data.items || []);
      setSource(data.source || 'live');
    } catch (err) {
      showToast('error', err.message);
    } finally {
      setLoading(false);
    }
  }

  async function fetchMercadoAdsData() {
    setAdsLoading(true);
    try {
      const [campResult, metricsResult] = await Promise.all([
        apiFetch('/api/ads/campaigns'),
        apiFetch('/api/ads/metrics'),
      ]);

      if (campResult.redirectedToLogin || metricsResult.redirectedToLogin) return;

      if (!campResult.response.ok) {
        throw new Error(
          campResult.data.message || 'Erro ao carregar campanhas do Mercado Ads.'
        );
      }

      const loadedCampaigns = campResult.data.campaigns || [];
      setCampaigns(loadedCampaigns);

      const drafts = {};
      for (const c of loadedCampaigns) {
        drafts[c.id] = String(c.budget);
      }
      setBudgetDrafts(drafts);

      if (metricsResult.response.ok && metricsResult.data) {
        setAdsMetrics(metricsResult.data);
      }
    } catch (err) {
      showToast('error', err.message);
    } finally {
      setAdsLoading(false);
    }
  }

  // ==========================================================================
  // Pilar 3: Estabilidade da Aba Mercado Ads (Loading + Toast + Status HTTP 200)
  // ==========================================================================
  async function handleToggleCampaignStatus(campaign) {
    if (campaignLoadingMap[campaign.id]) return;
    const nextStatus = campaign.status === 'active' ? 'paused' : 'active';

    setCampaignLoadingMap((prev) => ({ ...prev, [campaign.id]: 'status' }));

    try {
      const { response, data, redirectedToLogin } = await apiFetch(
        `/api/ads/campaigns/${encodeURIComponent(campaign.id)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: nextStatus }),
        }
      );

      if (redirectedToLogin) return;

      // Atualiza a linha da tabela APENAS se a API retornar status 200
      if (response.status !== 200 || !response.ok) {
        throw new Error(
          data.message || `Falha ao alterar status da campanha (HTTP ${response.status}).`
        );
      }

      setCampaigns((prev) =>
        prev.map((c) => (c.id === campaign.id ? { ...c, status: nextStatus } : c))
      );

      showToast(
        'success',
        `Sucesso: Campanha ${campaign.id} ${
          nextStatus === 'active' ? 'ATIVADA' : 'PAUSADA'
        } no Mercado Ads!`
      );
    } catch (err) {
      showToast('error', `Erro ao atualizar campanha ${campaign.id}: ${err.message}`);
    } finally {
      setCampaignLoadingMap((prev) => {
        const next = { ...prev };
        delete next[campaign.id];
        return next;
      });
    }
  }

  async function handleSaveCampaignBudget(campaignId) {
    if (campaignLoadingMap[campaignId]) return;
    const rawValue = budgetDrafts[campaignId];
    const parsedBudget = Number(rawValue);

    if (Number.isNaN(parsedBudget) || parsedBudget <= 0) {
      showToast('error', 'Informe um Orçamento Diário válido maior que R$ 0,00.');
      return;
    }

    setCampaignLoadingMap((prev) => ({ ...prev, [campaignId]: 'budget' }));

    try {
      const { response, data, redirectedToLogin } = await apiFetch(
        `/api/ads/campaigns/${encodeURIComponent(campaignId)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ budget: parsedBudget }),
        }
      );

      if (redirectedToLogin) return;

      // Atualiza a linha da tabela APENAS se a API retornar status 200
      if (response.status !== 200 || !response.ok) {
        throw new Error(
          data.message || `Falha ao salvar orçamento diário (HTTP ${response.status}).`
        );
      }

      const confirmedBudget = Number(data.campaign?.budget ?? parsedBudget);

      setCampaigns((prev) =>
        prev.map((c) => (c.id === campaignId ? { ...c, budget: confirmedBudget } : c))
      );
      setBudgetDrafts((prev) => ({
        ...prev,
        [campaignId]: String(confirmedBudget),
      }));

      showToast(
        'success',
        `Sucesso: Orçamento diário da campanha ${campaignId} atualizado para ${brlFormatter.format(
          confirmedBudget
        )}!`
      );
    } catch (err) {
      showToast('error', `Erro ao salvar orçamento de ${campaignId}: ${err.message}`);
    } finally {
      setCampaignLoadingMap((prev) => {
        const next = { ...prev };
        delete next[campaignId];
        return next;
      });
    }
  }

  /**
   * Pilar 4: Abre o Modal de Edição (Slide-Over).
   * Quando acionado pelo fluxo Human-in-the-Loop da IA (aiProposal), pré-preenche
   * o novo Título, Preço e Estoque sugeridos pela IA sem disparar o PUT até o clique em Salvar!
   */
  function openEditSlideOver(item, aiProposal = null) {
    const nextTitle =
      aiProposal?.title ?? aiProposal?.proposed_fields?.title ?? item.title ?? '';
    const nextPrice =
      aiProposal?.price ?? aiProposal?.proposed_fields?.price ?? item.price ?? 0;
    const nextStock =
      aiProposal?.available_quantity ??
      aiProposal?.proposed_fields?.available_quantity ??
      item.available_quantity ??
      0;

    setSelectedItem(item);
    setEditTitle(String(nextTitle));
    setEditPrice(String(nextPrice));
    setEditCost(String(item.product_cost ?? 0));
    setEditStock(String(nextStock));
    setIsAiSuggested(Boolean(aiProposal));

    // Minimiza o chat flutuante automaticamente para não sobrepor o Modal de Edição
    setIsFloatingChatOpen(false);

    if (dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal();
    }
  }

  function closeEditSlideOver() {
    if (dialogRef.current && dialogRef.current.open) {
      dialogRef.current.close();
    }
    setSelectedItem(null);
    setIsAiSuggested(false);
  }

  // ==========================================================================
  // Pilar 4: Trava de Segurança da IA (Human-in-the-Loop) no Chat
  // ==========================================================================
  async function handleSendChatMessage(event, presetText = null) {
    if (event) event.preventDefault();
    const textToSend = presetText ?? chatInput;
    if (!textToSend.trim() || chatLoading) return;

    const userMsg = textToSend.trim();
    setChatMessages((prev) => [...prev, { role: 'user', text: userMsg }]);
    if (!presetText) setChatInput('');
    setChatLoading(true);

    try {
      const { response, data, redirectedToLogin } = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg,
          previous_interaction_id: previousInteractionId,
        }),
      });

      if (redirectedToLogin) return;

      if (!response.ok) {
        throw new Error(data.message || 'Erro ao consultar Copiloto B2B.');
      }

      if (data.interaction_id) {
        setPreviousInteractionId(data.interaction_id);
      }

      setChatMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: data.reply,
          tools: data.executed_tools || [],
          radar: data.competitors_radar || null,
        },
      ]);

      // VERIFICAÇÃO ABSOLUTA HUMAN-IN-THE-LOOP:
      // A IA NÃO realiza disparo direto (PUT) para o Mercado Livre.
      // Interceptamos o JSON (data.pending_approval) e abrimos o Modal de Edição com os campos pré-preenchidos!
      if (data.pending_approval) {
        const targetId = data.pending_approval.item_id;
        const matchedItem =
          items.find((it) => it.id.toUpperCase() === String(targetId).toUpperCase()) ||
          items[0] || {
            id: targetId || 'MLB3948102938',
            title: 'Kit 50 Caixas Presente Floral 25x25cm Pacific Flowers',
            price: 69.9,
            product_cost: 22.5,
            available_quantity: 85,
            status: 'active',
            thumbnail:
              'https://http2.mlstatic.com/D_NQ_NP_2X_601411-MLA74651415532_022024-F.webp',
          };

        openEditSlideOver(matchedItem, data.pending_approval);
      }
    } catch (err) {
      setChatMessages((prev) => [
        ...prev,
        { role: 'assistant', text: `Erro: ${err.message}`, tools: [] },
      ]);
      showToast('error', err.message);
    } finally {
      setChatLoading(false);
    }
  }

  // Pilar 2: Reatividade em tempo real no Modal de Edição sem corromper o item salvo antes do clique em Salvar
  function handlePriceChange(val) {
    setEditPrice(val);
  }

  function handleCostChange(val) {
    setEditCost(val);
  }

  // Pilar 4: O envio real via HTTP PUT para a API do Mercado Livre SÓ acontece quando o usuário clica fisicamente em "Salvar" no modal!
  async function handleSaveItem(event) {
    event.preventDefault();
    if (!selectedItem || saving) return;

    setSaving(true);

    try {
      const { response, data, redirectedToLogin } = await apiFetch(
        `/api/items/${encodeURIComponent(selectedItem.id)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: editTitle.trim(),
            price: Number(editPrice),
            product_cost: Number(editCost),
            available_quantity: Number(editStock),
          }),
        }
      );

      if (redirectedToLogin) return;

      if (response.status !== 200 || !response.ok) {
        throw new Error(data.message || 'Falha ao atualizar anúncio no Mercado Livre.');
      }

      setItems((prev) =>
        prev.map((it) => (it.id === selectedItem.id ? { ...it, ...data.item } : it))
      );

      showToast(
        'success',
        `Anúncio ${selectedItem.id} salvo e sincronizado com o Mercado Livre!`
      );
      closeEditSlideOver();
    } catch (err) {
      showToast('error', err.message);
    } finally {
      setSaving(false);
    }
  }

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.id.toLowerCase().includes(q) || item.title.toLowerCase().includes(q)
    );
  }, [items, searchQuery]);

  const filteredCampaigns = useMemo(() => {
    const q = adsSearchQuery.trim().toLowerCase();
    return campaigns.filter((camp) => {
      const isOver79 = Number(camp.kit_price) > 79;
      if (onlyB2BKitsOver79 && !isOver79) return false;
      if (!q) return true;
      return (
        camp.id.toLowerCase().includes(q) || camp.name.toLowerCase().includes(q)
      );
    });
  }, [campaigns, adsSearchQuery, onlyB2BKitsOver79]);

  const activeDailyBudgetTotal = useMemo(() => {
    return campaigns
      .filter((c) => c.status === 'active')
      .reduce((acc, c) => acc + (Number(c.budget) || 0), 0);
  }, [campaigns]);

  // Pilar 2: Cálculo instantâneo em tempo real a cada dígito no Modal de Edição
  const liveModalSim = useMemo(() => {
    return calculateMeliSimulator(editPrice, editCost);
  }, [editPrice, editCost]);

  return (
    <div className="app-shell">
      {/* Pilar 3: Pilha de Toasts / Snackbars no Topo Direito */}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={dismissToast} />
        ))}
      </div>

      {/* Sidebar com "Meus Anúncios", "Mercado Ads" e "Copiloto B2B (IA)" */}
      <aside className="sidebar">
        <div>
          <div className="brand">
            <div className="brand-mark">PF</div>
            <div>
              <div className="brand-title">Pacific Flowers</div>
              <div className="brand-subtitle">Meli Ads & Margin Engine</div>
            </div>
          </div>

          <nav className="nav-section" aria-label="Navegação Principal">
            <button
              type="button"
              className={`nav-item ${activeView === 'ads_items' ? 'active' : ''}`}
              onClick={() => setActiveView('ads_items')}
            >
              <span className="nav-indicator" />
              <span>Meus Anúncios</span>
            </button>

            <button
              type="button"
              className={`nav-item ${activeView === 'mercado_ads' ? 'active' : ''}`}
              onClick={() => setActiveView('mercado_ads')}
            >
              <span className="nav-indicator" />
              <span>Mercado Ads</span>
            </button>

            <button
              type="button"
              className={`nav-item ${activeView === 'copilot_chat' ? 'active' : ''}`}
              onClick={() => setActiveView('copilot_chat')}
            >
              <span className="nav-indicator" />
              <span>Copiloto B2B (IA)</span>
            </button>
          </nav>
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-footer-row">
            <span>Status OAuth 2.0</span>
            <strong style={{ color: authStatus.authenticated ? '#00ff88' : '#fbbf24' }}>
              {authStatus.authenticated ? 'Conectado' : 'Modo Simulador'}
            </strong>
          </div>
          <div className="sidebar-footer-row">
            <span>Comissão Base</span>
            <span className="mono-id">16% (Papelaria/B2B)</span>
          </div>
          <div className="sidebar-footer-row">
            <span>Gatilho B2B / Frete</span>
            <span className="mono-id">&ge; R$ 79,00</span>
          </div>
          <a
            href={authStatus.auth_url}
            className="accent-link"
            style={{ marginTop: '0.25rem', fontSize: '0.78rem' }}
          >
            {authStatus.authenticated
              ? 'Reconectar conta ML →'
              : 'Autenticar no Mercado Livre →'}
          </a>
        </div>
      </aside>

      {/* Conteúdo Principal Alternável */}
      <main className="main-content">
        {feedback && (
          <div
            className="banner-notice"
            style={{
              borderColor: feedback.type === 'error' ? '#ef4444' : '#8b5cf6',
              color: '#f4f4f6',
            }}
          >
            <span>{feedback.text}</span>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {feedback.type === 'error' && (
                <a
                  href={authStatus.auth_url}
                  className="btn-primary btn-sm"
                  style={{ textDecoration: 'none' }}
                >
                  Tentar Reconectar OAuth 2.0
                </a>
              )}
              <button
                type="button"
                className="btn-secondary"
                style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                onClick={() => setFeedback(null)}
              >
                Fechar
              </button>
            </div>
          </div>
        )}

        {activeView === 'ads_items' ? (
          <>
            <header className="topbar">
              <div>
                <h1 className="page-title">Meus Anúncios & Simulador de Margem</h1>
                <p className="page-subtitle">
                  Gerenciamento de anúncios Pacific Flowers com cálculo automático em tempo real de comissão ML (16%), gatilho de R$ 79,00 e margem líquida.
                </p>
              </div>

              <div className="topbar-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => fetchItems(true)}
                  disabled={loading}
                >
                  {loading ? 'Sincronizando...' : 'Sincronizar'}
                </button>
                <a
                  href={authStatus.auth_url}
                  className="btn-primary"
                  style={{ textDecoration: 'none' }}
                >
                  Conectar OAuth 2.0
                </a>
              </div>
            </header>

            <div className="toolbar">
              <input
                type="search"
                className="search-input"
                placeholder="Filtrar por MLB ID ou título do anúncio..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {filteredItems.length}{' '}
                {filteredItems.length === 1 ? 'anúncio listado' : 'anúncios listados'}
              </span>
            </div>

            <div className="table-card">
              <table className="ads-table clickable-rows">
                <thead>
                  <tr>
                    <th style={{ width: '60px' }}>Foto</th>
                    <th style={{ width: '140px' }}>ID</th>
                    <th style={{ width: '270px', maxWidth: '270px' }}>Título</th>
                    <th style={{ paddingLeft: '1.15rem' }}>Preço</th>
                    <th>Custo do Produto</th>
                    <th>Taxas ML (Estimativa)</th>
                    <th>Custo de Frete (Vendedor)</th>
                    <th>Lucro Líquido</th>
                    <th>Margem %</th>
                    <th>Status de Estratégia</th>
                    <th>Estoque</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td
                        colSpan={12}
                        style={{
                          textAlign: 'center',
                          padding: '3rem',
                          color: 'var(--text-muted)',
                        }}
                      >
                        Carregando anúncios e calculando margens...
                      </td>
                    </tr>
                  ) : filteredItems.length === 0 ? (
                    <tr>
                      <td
                        colSpan={12}
                        style={{
                          textAlign: 'center',
                          padding: '3rem',
                          color: 'var(--text-muted)',
                        }}
                      >
                        Nenhum anúncio encontrado.
                      </td>
                    </tr>
                  ) : (
                    filteredItems.map((item) => {
                      // Se este item estiver aberto no Modal de Edição, reflete a simulação em tempo real também na linha
                      const isEditingThisRow = selectedItem?.id === item.id;
                      const effectivePrice = isEditingThisRow ? editPrice : item.price;
                      const effectiveCost = isEditingThisRow
                        ? editCost
                        : item.product_cost ?? 0;

                      const sim = calculateMeliSimulator(effectivePrice, effectiveCost);
                      const marginClass =
                        sim.marginPercent >= 20
                          ? 'positive'
                          : sim.marginPercent > 0
                          ? 'warning'
                          : 'negative';

                      return (
                        <tr key={item.id} onClick={() => openEditSlideOver(item)}>
                          <td>
                            <img
                              src={item.thumbnail}
                              alt={item.title}
                              className="item-thumb"
                              loading="lazy"
                              onError={(e) => {
                                e.currentTarget.src =
                                  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="42" height="42"><rect width="100%" height="100%" fill="%2318181f"/></svg>';
                              }}
                            />
                          </td>
                          <td>
                            <span className="mono-id">{item.id}</span>
                          </td>
                          <td className="item-title-cell">
                            <div
                              className="item-title-truncate"
                              title={isEditingThisRow ? editTitle : item.title}
                            >
                              {isEditingThisRow ? editTitle : item.title}
                            </div>
                          </td>
                          <td className="price-cell">{brlFormatter.format(sim.price)}</td>
                          <td className="cost-cell">{brlFormatter.format(sim.productCost)}</td>
                          <td className="fee-cell">
                            {brlFormatter.format(sim.mlCommission)}
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                              16% {sim.fixedFee > 0 ? '+ R$ 6,00 fixo' : '(sem taxa fixa)'}
                            </div>
                          </td>
                          <td className="mono-value">
                            {brlFormatter.format(sim.sellerShippingCost)}
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                              {sim.isFreeShippingEligible
                                ? 'Frete Grátis Nac.'
                                : 'Pago pelo cliente'}
                            </div>
                          </td>
                          <td
                            className={
                              sim.netProfit >= 0 ? 'profit-positive' : 'profit-negative'
                            }
                          >
                            {brlFormatter.format(sim.netProfit)}
                          </td>
                          <td>
                            <span className={`margin-pill ${marginClass}`}>
                              {sim.marginPercent.toFixed(1)}%
                            </span>
                          </td>
                          <td>
                            <span
                              className={`strategy-tag ${
                                sim.isFreeShippingEligible ? 'neon-green' : 'danger'
                              }`}
                            >
                              {sim.isFreeShippingEligible ? '⚡ ' : '⚠️ '}
                              {sim.strategyTagText}
                            </span>
                          </td>
                          <td>
                            <span className="stock-badge">
                              {isEditingThisRow ? editStock : item.available_quantity} un.
                            </span>
                          </td>
                          <td>
                            <span
                              className={`status-pill ${
                                item.status === 'active' ? 'active' : 'paused'
                              }`}
                            >
                              ● {item.status === 'active' ? 'Ativo' : 'Pausado'}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : activeView === 'mercado_ads' ? (
          <>
            <header className="topbar">
              <div>
                <h1 className="page-title">Mercado Ads — Gestão de Tráfego Pago B2B</h1>
                <p className="page-subtitle">
                  Controle de campanhas patrocinadas (Product Ads API), orçamento diário com estado de carregamento e filtro estratégico para Kits de Atacado (&gt; R$ 79,00).
                </p>
              </div>

              <div className="topbar-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={fetchMercadoAdsData}
                  disabled={adsLoading}
                >
                  {adsLoading ? 'Atualizando Ads...' : 'Atualizar Métricas (30d)'}
                </button>
                <a
                  href={authStatus.auth_url}
                  className="btn-primary"
                  style={{ textDecoration: 'none' }}
                >
                  Conectar OAuth 2.0
                </a>
              </div>
            </header>

            <div className="kpi-grid">
              <div className="kpi-card">
                <span className="kpi-label">Faturamento Ads (30 Dias)</span>
                <span className="kpi-value" style={{ color: '#00ff88' }}>
                  {brlFormatter.format(adsMetrics.summary?.total_revenue_30d || 0)}
                </span>
                <span className="kpi-sub">Receita atribuída às campanhas</span>
              </div>

              <div className="kpi-card">
                <span className="kpi-label">ACOS Médio (30 Dias)</span>
                <span className="kpi-value" style={{ color: '#c4b5fd' }}>
                  {(adsMetrics.summary?.average_acos || 0).toFixed(1)}%
                </span>
                <span className="kpi-sub">
                  Investimento: {brlFormatter.format(adsMetrics.summary?.total_spend_30d || 0)}
                </span>
              </div>

              <div className="kpi-card">
                <span className="kpi-label">Orçamento Diário Ativo</span>
                <span className="kpi-value">
                  {brlFormatter.format(activeDailyBudgetTotal)}
                </span>
                <span className="kpi-sub">Soma das campanhas ativas hoje</span>
              </div>

              <div className="kpi-card">
                <span className="kpi-label">Foco Estratégico B2B</span>
                <span className="kpi-value" style={{ fontSize: '1rem', color: '#00ff88' }}>
                  Kits &gt; R$ 79,00
                </span>
                <span className="kpi-sub">Priorize verba em kits de atacado</span>
              </div>
            </div>

            <div className="toolbar">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  flexWrap: 'wrap',
                }}
              >
                <input
                  type="search"
                  className="search-input"
                  placeholder="Buscar por ID da Campanha ou Nome do Kit..."
                  value={adsSearchQuery}
                  onChange={(e) => setAdsSearchQuery(e.target.value)}
                />

                <button
                  type="button"
                  className={`btn-secondary ${onlyB2BKitsOver79 ? 'active-filter' : ''}`}
                  onClick={() => setOnlyB2BKitsOver79((prev) => !prev)}
                >
                  {onlyB2BKitsOver79
                    ? '⚡ Exibindo Apenas Kits B2B (> R$ 79,00)'
                    : '🔍 Filtrar Apenas Kits Atacado (> R$ 79,00)'}
                </button>
              </div>

              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {filteredCampaigns.length}{' '}
                {filteredCampaigns.length === 1
                  ? 'campanha exibida'
                  : 'campanhas exibidas'}
              </span>
            </div>

            <div className="table-card">
              <table className="ads-table">
                <thead>
                  <tr>
                    <th style={{ width: '64px' }}>Foto</th>
                    <th style={{ width: '150px' }}>ID da Campanha</th>
                    <th>Nome do Kit</th>
                    <th style={{ width: '175px' }}>Status</th>
                    <th style={{ width: '250px' }}>Orçamento Diário</th>
                    <th style={{ width: '170px' }}>Faturamento Ads</th>
                    <th style={{ width: '130px' }}>ACOS (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {adsLoading ? (
                    <tr>
                      <td
                        colSpan={7}
                        style={{
                          textAlign: 'center',
                          padding: '3rem',
                          color: 'var(--text-muted)',
                        }}
                      >
                        Consultando campanhas e métricas na Advertising API...
                      </td>
                    </tr>
                  ) : filteredCampaigns.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        style={{
                          textAlign: 'center',
                          padding: '3rem',
                          color: 'var(--text-muted)',
                        }}
                      >
                        Nenhuma campanha encontrada para o filtro selecionado.
                      </td>
                    </tr>
                  ) : (
                    filteredCampaigns.map((camp) => {
                      const isB2BKit = Number(camp.kit_price) > 79;
                      const metricEntry =
                        adsMetrics.metrics_by_campaign?.[camp.id] || camp;
                      const revenue30d = Number(
                        metricEntry.ads_revenue_30d ?? camp.ads_revenue_30d ?? 0
                      );
                      const acosValue = Number(metricEntry.acos ?? camp.acos ?? 0);
                      const isActive = camp.status === 'active';
                      const loadingState = campaignLoadingMap[camp.id];
                      const isBusy = Boolean(loadingState);

                      const acosBadgeClass =
                        acosValue <= 15
                          ? 'positive'
                          : acosValue <= 25
                          ? 'warning'
                          : 'negative';

                      return (
                        <tr
                          key={camp.id}
                          className={isB2BKit ? 'b2b-highlight-row' : ''}
                        >
                          <td>
                            <img
                              src={camp.thumbnail}
                              alt={camp.name}
                              className="item-thumb"
                              loading="lazy"
                              onError={(e) => {
                                e.currentTarget.src =
                                  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="42" height="42"><rect width="100%" height="100%" fill="%2318181f"/></svg>';
                              }}
                            />
                          </td>

                          <td>
                            <span className="mono-id">{camp.id}</span>
                          </td>

                          <td className="item-title-cell">
                            <div
                              className="item-title-truncate"
                              style={{ fontWeight: 600 }}
                              title={camp.name}
                            >
                              {camp.name}
                            </div>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                marginTop: '0.35rem',
                                flexWrap: 'wrap',
                              }}
                            >
                              <span className="mono-id">
                                Ticket: {brlFormatter.format(camp.kit_price || 0)}
                              </span>
                              {isB2BKit ? (
                                <span className="strategy-tag b2b-purple">
                                  ★ Kit Atacado B2B (&gt; R$ 79)
                                </span>
                              ) : (
                                <span className="strategy-tag danger">
                                  ⚠️ Unitário (&le; R$ 79) — Evitar Ads
                                </span>
                              )}
                            </div>
                          </td>

                          <td>
                            <div className="toggle-wrapper">
                              <button
                                type="button"
                                role="switch"
                                aria-checked={isActive}
                                aria-busy={isBusy}
                                aria-label={`Alternar status da campanha ${camp.name}`}
                                disabled={isBusy}
                                className={`toggle-switch ${isActive ? 'active' : ''} ${
                                  loadingState === 'status' ? 'loading' : ''
                                }`}
                                onClick={() => handleToggleCampaignStatus(camp)}
                              />
                              <span
                                className={`toggle-label ${isActive ? 'active' : ''}`}
                              >
                                {loadingState === 'status' ? (
                                  <span
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '0.35rem',
                                    }}
                                  >
                                    <span className="inline-spinner" />
                                    <span>Salvando...</span>
                                  </span>
                                ) : isActive ? (
                                  'Ativa'
                                ) : (
                                  'Pausada'
                                )}
                              </span>
                            </div>
                          </td>

                          <td>
                            <div className="budget-editor">
                              <div
                                className={`budget-input-group ${isBusy ? 'disabled' : ''}`}
                              >
                                <span className="budget-prefix">R$</span>
                                <input
                                  type="number"
                                  step="1"
                                  min="1"
                                  disabled={isBusy}
                                  aria-label={`Orçamento diário da campanha ${camp.id}`}
                                  className="budget-inline-input"
                                  value={budgetDrafts[camp.id] ?? camp.budget}
                                  onChange={(e) =>
                                    setBudgetDrafts((prev) => ({
                                      ...prev,
                                      [camp.id]: e.target.value,
                                    }))
                                  }
                                />
                              </div>
                              <button
                                type="button"
                                className="btn-primary btn-sm"
                                disabled={isBusy}
                                onClick={() => handleSaveCampaignBudget(camp.id)}
                              >
                                {loadingState === 'budget' ? (
                                  <>
                                    <span className="inline-spinner" />
                                    <span>Salvando...</span>
                                  </>
                                ) : (
                                  'Salvar'
                                )}
                              </button>
                            </div>
                          </td>

                          <td className="profit-positive">
                            {brlFormatter.format(revenue30d)}
                            <div
                              style={{
                                fontSize: '0.68rem',
                                color: 'var(--text-muted)',
                                fontWeight: 400,
                              }}
                            >
                              Últimos 30 dias
                            </div>
                          </td>

                          <td>
                            <span className={`margin-pill ${acosBadgeClass}`}>
                              {acosValue.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          /* ================================================================
           * VIEW 3: COPILOTO DE VENDAS B2B & RADAR DE CONCORRÊNCIA
           * ================================================================ */
          <>
            <header className="topbar">
              <div>
                <h1 className="page-title">
                  ✦ Gemini 3.8 Flash — Copiloto B2B & Radar de Concorrência
                </h1>
                <p className="page-subtitle">
                  Respostas analíticas no padrão Google Gemini com consulta aos 5 primeiros colocados do Mercado Livre (<code>pesquisar_concorrentes</code>), banco de dados oficial do catálogo Pacific Flowers e aprovação Human-in-the-Loop.
                </p>
              </div>
            </header>

            <div
              className="toolbar"
              style={{ justifyContent: 'flex-start', gap: '0.55rem', flexWrap: 'wrap' }}
            >
              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={() =>
                  handleSendChatMessage(
                    null,
                    `Pesquisar concorrentes e otimizar título B2B do anúncio ${
                      items[0]?.id || 'MLB3948102938'
                    } para "Kit 50 Talões De Pedido 105x150mm Comércio"`
                  )
                }
              >
                🔍 1. Kit 50 Talões 105x150mm (Abre Modal)
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() =>
                  handleSendChatMessage(
                    null,
                    `Pesquisar concorrentes e otimizar anúncio ${
                      items[0]?.id || 'MLB3948102938'
                    } para "Caixa 250 Envelopes Kraft Natural 162x229mm 90g"`
                  )
                }
              >
                📦 2. Caixa 250 Envelopes Kraft 90g
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() =>
                  handleSendChatMessage(
                    null,
                    `Quero vender placas de proibido fumar e banheiro 15x20cm em kit atacado, otimize o anúncio`
                  )
                }
              >
                ⚠️ 3. Kit Placas Sinalização PS UV 15x20cm
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() =>
                  handleSendChatMessage(
                    null,
                    `Otimizar título do ${
                      items[0]?.id || 'MLB3948102938'
                    } para "Talão de Pedido Barato Pacific Flowers"`
                  )
                }
              >
                🛡️ 4. Testar Bloqueio: &ldquo;Talão Barato&rdquo;
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() =>
                  handleSendChatMessage(
                    null,
                    `Crie uma descrição técnica para a Caixa de 250 Envelopes Kraft 90g`
                  )
                }
              >
                ✍️ 5. Gerar Descrição Texto Puro
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() =>
                  handleSendChatMessage(
                    null,
                    `Quais produtos a Pacific Flowers vende no catálogo oficial?`
                  )
                }
              >
                📚 6. Ver Catálogo Oficial B2B
              </button>
            </div>

            <div
              className="table-card"
              style={{
                padding: '1.25rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
                minHeight: '490px',
              }}
            >
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.95rem',
                  maxHeight: '480px',
                  overflowY: 'auto',
                  paddingRight: '0.5rem',
                }}
              >
                {chatMessages.map((msg, i) => (
                  <div
                    key={i}
                    style={{
                      alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                      maxWidth: '90%',
                      backgroundColor:
                        msg.role === 'user'
                          ? 'rgba(139, 92, 246, 0.2)'
                          : 'var(--bg-base)',
                      border: `1px solid ${
                        msg.role === 'user'
                          ? 'rgba(139, 92, 246, 0.5)'
                          : 'rgba(139, 92, 246, 0.25)'
                      }`,
                      borderRadius: '12px',
                      padding: '0.95rem 1.1rem',
                      fontSize: '0.86rem',
                      lineHeight: 1.55,
                    }}
                  >
                    {msg.role === 'assistant' && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.45rem',
                          marginBottom: '0.55rem',
                          paddingBottom: '0.4rem',
                          borderBottom: '1px solid var(--border-subtle)',
                          fontSize: '0.74rem',
                          fontWeight: 600,
                          color: '#a78bfa',
                        }}
                      >
                        <span style={{ color: '#38bdf8', fontSize: '0.9rem' }}>✦</span>
                        <span>Gemini 3.8 Flash · Copiloto B2B Pacific Flowers</span>
                      </div>
                    )}

                    {msg.role === 'assistant' ? (
                      <GeminiMarkdown
                        content={msg.text}
                        onCopyText={(txt) => {
                          if (navigator?.clipboard?.writeText) {
                            navigator.clipboard.writeText(txt);
                          }
                          showToast(
                            'success',
                            'Texto puro copiado para a área de transferência!'
                          );
                        }}
                      />
                    ) : (
                      <div style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</div>
                    )}

                    {/* Tabela Compacta do Radar de Concorrência (Top 5 do Mercado Livre) */}
                    {msg.radar?.concorrentes && msg.radar.concorrentes.length > 0 && (
                      <div
                        style={{
                          marginTop: '0.75rem',
                          padding: '0.75rem',
                          borderRadius: '8px',
                          backgroundColor: 'var(--bg-surface)',
                          border: '1px solid rgba(139, 92, 246, 0.35)',
                        }}
                      >
                        <div
                          style={{
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            color: '#c4b5fd',
                            marginBottom: '0.5rem',
                            display: 'flex',
                            justifyContent: 'space-between',
                          }}
                        >
                          <span>
                            🎯 Top 5 Concorrentes no Mercado Livre (&ldquo;{msg.radar.query}&rdquo;)
                          </span>
                          <span>
                            Média:{' '}
                            {brlFormatter.format(msg.radar.stats?.average_price || 0)}
                          </span>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.4rem',
                          }}
                        >
                          {msg.radar.concorrentes.map((comp, cIdx) => (
                            <div
                              key={cIdx}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '0.75rem',
                                fontSize: '0.76rem',
                                padding: '0.35rem 0.5rem',
                                borderRadius: '6px',
                                backgroundColor: 'var(--bg-base)',
                              }}
                            >
                              <span
                                style={{
                                  flex: 1,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {cIdx + 1}. {comp.title}
                              </span>
                              <span className="mono-value" style={{ fontWeight: 600 }}>
                                {brlFormatter.format(comp.price || 0)}
                              </span>
                              <span
                                className={`strategy-tag ${
                                  comp.free_shipping ? 'neon-green' : 'danger'
                                }`}
                                style={{ fontSize: '0.65rem', padding: '0.1rem 0.45rem' }}
                              >
                                {comp.free_shipping ? '⚡ Frete Grátis' : 'Frete Pago'}
                              </span>
                              {comp.link && (
                                <a
                                  href={comp.link}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="accent-link"
                                  style={{ fontSize: '0.72rem' }}
                                >
                                  Ver ↗
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {msg.tools && msg.tools.length > 0 && (
                      <div
                        style={{
                          marginTop: '0.65rem',
                          paddingTop: '0.5rem',
                          borderTop: '1px dashed var(--border-subtle)',
                          fontSize: '0.75rem',
                          color: '#c4b5fd',
                          fontFamily: 'JetBrains Mono, monospace',
                        }}
                      >
                        ⚡ Fluxo de Tools Executado:{' '}
                        {msg.tools
                          .map((t) => `${t.name}(${JSON.stringify(t.arguments)})`)
                          .join(' → ')}
                      </div>
                    )}
                  </div>
                ))}

                {chatLoading && (
                  <div
                    style={{
                      alignSelf: 'flex-start',
                      backgroundColor: 'var(--bg-base)',
                      border: '1px solid rgba(139, 92, 246, 0.35)',
                      borderRadius: '10px',
                      padding: '0.75rem 1rem',
                      fontSize: '0.82rem',
                      color: '#c4b5fd',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                  >
                    <span className="spinner-inline" />
                    <span>
                      ✦ Gemini está analisando o catálogo oficial e consultando os 5 primeiros colocados do Mercado Livre...
                    </span>
                  </div>
                )}
              </div>

              <form
                onSubmit={handleSendChatMessage}
                style={{ display: 'flex', gap: '0.75rem', marginTop: 'auto' }}
              >
                <input
                  type="text"
                  className="form-input"
                  style={{ flex: 1 }}
                  placeholder="Pergunte qualquer coisa ao Gemini B2B: otimizar kit, criar descrição, auditar foto, simular margem..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                />
                <button type="submit" className="btn-primary" disabled={chatLoading}>
                  {chatLoading ? '✦ Pensando...' : '✦ Perguntar ao Gemini'}
                </button>
              </form>
            </div>
          </>
        )}
      </main>

      {/* ====================================================================
       * Pilar 4: Widget do Copiloto B2B no Canto Inferior Direito (Retrátil)
       * Não cobre informações da tabela e fecha automaticamente ao abrir o Modal!
       * ==================================================================== */}
      {activeView !== 'copilot_chat' && !selectedItem && (
        <div className="copilot-floating-container">
          {isFloatingChatOpen && (
            <div className="copilot-floating-panel" role="region" aria-label="Copiloto B2B IA">
              <div className="copilot-floating-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ color: '#38bdf8', fontSize: '0.95rem' }}>✦</span>
                  <strong style={{ fontSize: '0.82rem' }}>
                    Gemini 3.8 Flash · Copiloto B2B
                  </strong>
                </div>
                <button
                  type="button"
                  className="toast-close-btn"
                  aria-label="Minimizar chat"
                  onClick={() => setIsFloatingChatOpen(false)}
                >
                  ✕
                </button>
              </div>

              <div className="copilot-floating-messages">
                {chatMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    style={{
                      alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                      maxWidth: '92%',
                      backgroundColor:
                        msg.role === 'user'
                          ? 'rgba(139, 92, 246, 0.22)'
                          : 'var(--bg-base)',
                      border: `1px solid ${
                        msg.role === 'user'
                          ? 'rgba(139, 92, 246, 0.5)'
                          : 'var(--border-subtle)'
                      }`,
                      borderRadius: '8px',
                      padding: '0.65rem 0.8rem',
                      fontSize: '0.78rem',
                      lineHeight: 1.48,
                    }}
                  >
                    {msg.role === 'assistant' ? (
                      <GeminiMarkdown
                        content={msg.text}
                        onCopyText={(txt) => {
                          if (navigator?.clipboard?.writeText) {
                            navigator.clipboard.writeText(txt);
                          }
                          showToast('success', 'Texto copiado!');
                        }}
                      />
                    ) : (
                      <div style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</div>
                    )}
                  </div>
                ))}
              </div>

              <div className="copilot-floating-quick">
                <button
                  type="button"
                  className="copilot-quick-chip"
                  onClick={() =>
                    handleSendChatMessage(
                      null,
                      `Pesquisar concorrentes e otimizar título do ${
                        items[0]?.id || 'MLB3948102938'
                      } para "Kit 50 Talões De Pedido 105x150mm Comércio"`
                    )
                  }
                >
                  🔍 Radar Top 5 + Kit 50 Talões
                </button>
                <button
                  type="button"
                  className="copilot-quick-chip"
                  onClick={() =>
                    handleSendChatMessage(
                      null,
                      `Crie uma descrição técnica para a Caixa de 250 Envelopes Kraft 90g`
                    )
                  }
                >
                  ✍️ Descrição Kraft 90g
                </button>
              </div>

              <form onSubmit={handleSendChatMessage} className="copilot-floating-form">
                <input
                  type="text"
                  className="form-input"
                  style={{ flex: 1, padding: '0.45rem 0.65rem', fontSize: '0.78rem' }}
                  placeholder="Ex: Atualizar preço para R$ 89,90..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                />
                <button
                  type="submit"
                  className="btn-primary btn-sm"
                  disabled={chatLoading}
                >
                  {chatLoading ? '...' : 'Enviar'}
                </button>
              </form>
            </div>
          )}

          <button
            type="button"
            className="copilot-fab"
            onClick={() => setIsFloatingChatOpen((prev) => !prev)}
          >
            <span>🤖</span>
            <span>{isFloatingChatOpen ? 'Ocultar Copiloto IA' : 'Copiloto B2B (IA)'}</span>
          </button>
        </div>
      )}

      {/* ====================================================================
       * Slide-Over Modal de Edição (<dialog closedby="any">) — Pilar 2 & Pilar 4
       * ==================================================================== */}
      <dialog
        ref={dialogRef}
        closedby="any"
        className="slideover-dialog"
        aria-labelledby="slideover-title"
      >
        {selectedItem && (
          <form
            onSubmit={handleSaveItem}
            style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
          >
            <div className="slideover-header">
              <div>
                <h2 id="slideover-title" style={{ fontSize: '1.1rem', fontWeight: 600 }}>
                  Modal de Edição do Anúncio
                </h2>
                <span className="mono-id">{selectedItem.id}</span>
              </div>
              <button
                type="button"
                className="btn-secondary"
                onClick={closeEditSlideOver}
                style={{ padding: '0.35rem 0.65rem' }}
              >
                ✕
              </button>
            </div>

            <div className="slideover-body">
              {isAiSuggested && (
                <div
                  style={{
                    padding: '0.75rem 0.9rem',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(139, 92, 246, 0.16)',
                    border: '1px solid rgba(139, 92, 246, 0.55)',
                    fontSize: '0.8rem',
                    color: '#e9d5ff',
                    lineHeight: 1.4,
                  }}
                >
                  <strong>⚡ Sugestão do Copiloto IA (Human-in-the-Loop):</strong>{' '}
                  Preparei a atualização do anúncio. Verifique os dados na tela e clique em{' '}
                  <strong>Salvar</strong> para enviar ao Mercado Livre.
                </div>
              )}

              <div className="slideover-item-preview">
                <img
                  src={selectedItem.thumbnail}
                  alt={editTitle || selectedItem.title}
                  className="item-thumb"
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <div style={{ fontSize: '0.86rem', fontWeight: 500, lineHeight: 1.35 }}>
                    {editTitle || selectedItem.title}
                  </div>
                  {selectedItem.permalink && (
                    <a
                      href={selectedItem.permalink}
                      target="_blank"
                      rel="noreferrer"
                      className="accent-link"
                      style={{ fontSize: '0.75rem' }}
                    >
                      Ver anúncio no Mercado Livre ↗
                    </a>
                  )}
                </div>
              </div>

              <div className="form-field">
                <label
                  htmlFor="title-input"
                  style={{ display: 'flex', justifyContent: 'space-between' }}
                >
                  <span>Título do Anúncio (SEO B2B)</span>
                  <span
                    className="mono-id"
                    style={{
                      color: editTitle.length > 60 ? '#f87171' : '#a78bfa',
                    }}
                  >
                    {editTitle.length}/60 caracteres
                  </span>
                </label>
                <input
                  id="title-input"
                  type="text"
                  maxLength={60}
                  required
                  className="form-input"
                  style={{ fontFamily: 'Inter, sans-serif', fontSize: '0.86rem' }}
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                />
              </div>

              <div className="form-grid">
                <div className="form-field">
                  <label
                    htmlFor="price-input"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.35rem',
                    }}
                  >
                    <span>Preço de Venda (R$)</span>
                    <span
                      className={`strategy-tag ${
                        liveModalSim.isFreeShippingEligible ? 'neon-green' : 'danger'
                      }`}
                      style={{ fontSize: '0.64rem', padding: '0.12rem 0.45rem' }}
                    >
                      {liveModalSim.isFreeShippingEligible ? '⚡ ≥ R$ 79' : '⚠️ < R$ 79'}
                    </span>
                  </label>
                  <input
                    id="price-input"
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    className="form-input"
                    value={editPrice}
                    onChange={(e) => handlePriceChange(e.target.value)}
                    onInput={(e) => handlePriceChange(e.currentTarget.value)}
                  />
                </div>

                <div className="form-field">
                  <label htmlFor="cost-input">Custo do Produto (Pacific Flowers)</label>
                  <input
                    id="cost-input"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    className="form-input"
                    value={editCost}
                    onChange={(e) => handleCostChange(e.target.value)}
                    onInput={(e) => handleCostChange(e.currentTarget.value)}
                  />
                </div>
              </div>

              <div className="form-field">
                <label htmlFor="stock-input">Estoque Disponível (available_quantity)</label>
                <input
                  id="stock-input"
                  type="number"
                  step="1"
                  min="0"
                  required
                  className="form-input"
                  value={editStock}
                  onChange={(e) => setEditStock(e.target.value)}
                />
              </div>

              {/* Pilar 2: Simulador em Tempo Real Reativo a cada tecla digitada */}
              <div
                className={`simulator-card ${
                  liveModalSim.isFreeShippingEligible
                    ? 'free-shipping-active'
                    : 'fixed-fee-active'
                }`}
              >
                <div className="simulator-card-header">
                  <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                    Simulador em Tempo Real (Comissão 16% B2B)
                  </span>
                  <span
                    className={`strategy-tag ${
                      liveModalSim.isFreeShippingEligible ? 'neon-green' : 'danger'
                    }`}
                  >
                    {liveModalSim.isFreeShippingEligible ? '⚡ ' : '⚠️ '}
                    {liveModalSim.strategyTagText}
                  </span>
                </div>

                <div className="simulator-row">
                  <span>Preço de Venda Digitado</span>
                  <span className="mono-value">{brlFormatter.format(liveModalSim.price)}</span>
                </div>

                <div className="simulator-row">
                  <span>(-) Custo do Produto (Pacific Flowers)</span>
                  <span className="mono-value">
                    - {brlFormatter.format(liveModalSim.productCost)}
                  </span>
                </div>

                <div className="simulator-row">
                  <span>
                    (-) Comissão ML (16% = {brlFormatter.format(liveModalSim.baseCommission16)}
                    {liveModalSim.fixedFee > 0
                      ? ' + R$ 6,00 Taxa Fixa'
                      : ' | Taxa Fixa R$ 0,00'}
                    )
                  </span>
                  <span className="mono-value">
                    - {brlFormatter.format(liveModalSim.mlCommission)}
                  </span>
                </div>

                <div className="simulator-row">
                  <span>
                    (-) Custo de Frete Vendedor (
                    {liveModalSim.isFreeShippingEligible
                      ? 'Preço ≥ R$ 79 → Frete Grátis'
                      : 'Preço < R$ 79 → Comprador paga'}
                    )
                  </span>
                  <span className="mono-value">
                    - {brlFormatter.format(liveModalSim.sellerShippingCost)}
                  </span>
                </div>

                <div className="simulator-row highlight">
                  <span>Lucro Líquido / Margem %</span>
                  <span
                    className={
                      liveModalSim.netProfit >= 0 ? 'profit-positive' : 'profit-negative'
                    }
                  >
                    {brlFormatter.format(liveModalSim.netProfit)} (
                    {liveModalSim.marginPercent.toFixed(1)}%)
                  </span>
                </div>
              </div>
            </div>

            <div className="slideover-footer">
              <button type="button" className="btn-secondary" onClick={closeEditSlideOver}>
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? (
                  <>
                    <span className="inline-spinner" />
                    <span>Enviando ao ML...</span>
                  </>
                ) : (
                  'Salvar'
                )}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <DashboardContent />
    </AppErrorBoundary>
  );
}
