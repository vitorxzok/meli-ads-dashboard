import React, { useState, useEffect, useRef, useMemo } from 'react';

const brlFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export function calculateMeliSimulator(salePrice, productCost) {
  const price = Number(salePrice) || 0;
  const cost = Number(productCost) || 0;
  const isFreeShippingEligible = price >= 79;

  const fixedFee = isFreeShippingEligible ? 0.0 : 6.0;
  const mlCommission = price * 0.16 + fixedFee;
  const sellerShippingCost = isFreeShippingEligible ? 21.0 : 0.0;

  const netProfit = price - cost - mlCommission - sellerShippingCost;
  const marginPercent = price > 0 ? (netProfit / price) * 100 : 0;

  return {
    price,
    productCost: cost,
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

export default function App() {
  // Controle de Navegação da Sidebar ('ads_items' | 'mercado_ads' | 'copilot_chat')
  const [activeView, setActiveView] = useState('ads_items');

  // Estados de Autenticação e Anúncios Orgânicos
  const [items, setItems] = useState([]);
  const [source, setSource] = useState('loading');
  const [authStatus, setAuthStatus] = useState({
    authenticated: false,
    auth_url: '/api/auth/login',
    user_id: null,
  });
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Estados do Modal de Edição (Human-in-the-Loop + Edição Manual)
  const [selectedItem, setSelectedItem] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editCost, setEditCost] = useState('');
  const [editStock, setEditStock] = useState('');
  const [isAiSuggested, setIsAiSuggested] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);

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
  const [updatingCampaignId, setUpdatingCampaignId] = useState(null);

  // Estados do Copiloto B2B (/api/chat com Human-in-the-Loop)
  const [chatMessages, setChatMessages] = useState([
    {
      role: 'assistant',
      text: 'Olá! Sou o Copiloto de Vendas B2B da Pacific Flowers (Modo Human-in-the-Loop ativo). Quando você pedir para otimizar um título ou atualizar preço/estoque, validarei as políticas do Mercado Livre e abrirei automaticamente o Modal de Edição preenchido para você revisar e clicar em Salvar.',
      tools: [],
    },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [previousInteractionId, setPreviousInteractionId] = useState(null);

  const dialogRef = useRef(null);

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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const authResult = params.get('auth');
    const returnedUserId = params.get('user_id');

    async function init() {
      if (authResult === 'success') {
        setFeedback({
          type: 'success',
          text: `Conta Mercado Livre conectada com sucesso${
            returnedUserId ? ` (Seller ID: ${returnedUserId})` : ''
          }! Carregando todos os anúncios da conta...`,
        });
        window.history.replaceState({}, document.title, '/');
      } else if (code) {
        try {
          const res = await fetch(`/api/auth/callback?code=${encodeURIComponent(code)}`);
          const data = await res.json();
          if (res.ok) {
            setFeedback({
              type: 'success',
              text: `OAuth 2.0 autenticado com sucesso (User ID: ${data.user_id})`,
            });
          } else {
            setFeedback({
              type: 'error',
              text: data.message || 'Falha ao trocar código OAuth pelo access_token.',
            });
          }
          window.history.replaceState({}, document.title, '/');
        } catch (err) {
          setFeedback({ type: 'error', text: err.message });
        }
      }
      await Promise.all([
        fetchAuthStatus(),
        fetchItems(authResult === 'success'),
        fetchMercadoAdsData(),
      ]);
    }

    init();
  }, []);

  async function fetchAuthStatus() {
    try {
      const res = await fetch('/api/auth/status');
      if (res.ok) {
        const data = await res.json();
        setAuthStatus(data);
      }
    } catch {
      // Ignora erro silenciosamente no boot
    }
  }

  async function fetchItems(forceRefresh = false) {
    setLoading(true);
    try {
      const res = await fetch(`/api/items${forceRefresh ? '?refresh=true' : ''}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Erro ao carregar anúncios');
      }
      setItems(data.items || []);
      setSource(data.source || 'live');
    } catch (err) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }

  async function fetchMercadoAdsData() {
    setAdsLoading(true);
    try {
      const [campRes, metricsRes] = await Promise.all([
        fetch('/api/ads/campaigns'),
        fetch('/api/ads/metrics'),
      ]);

      const campData = await campRes.json();
      const metricsData = await metricsRes.json();

      if (!campRes.ok) {
        throw new Error(campData.message || 'Erro ao carregar campanhas do Mercado Ads.');
      }

      const loadedCampaigns = campData.campaigns || [];
      setCampaigns(loadedCampaigns);

      const drafts = {};
      for (const c of loadedCampaigns) {
        drafts[c.id] = String(c.budget);
      }
      setBudgetDrafts(drafts);

      if (metricsRes.ok && metricsData) {
        setAdsMetrics(metricsData);
      }
    } catch (err) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setAdsLoading(false);
    }
  }

  async function handleToggleCampaignStatus(campaign) {
    const nextStatus = campaign.status === 'active' ? 'paused' : 'active';
    setUpdatingCampaignId(campaign.id);
    setFeedback(null);

    try {
      const res = await fetch(`/api/ads/campaigns/${encodeURIComponent(campaign.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Falha ao alterar status da campanha.');
      }

      setCampaigns((prev) =>
        prev.map((c) => (c.id === campaign.id ? { ...c, status: nextStatus } : c))
      );

      setFeedback({
        type: 'success',
        text: `Campanha ${campaign.id} ${
          nextStatus === 'active' ? 'ATIVADA' : 'PAUSADA'
        } com sucesso!`,
      });
    } catch (err) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setUpdatingCampaignId(null);
    }
  }

  async function handleSaveCampaignBudget(campaignId) {
    const rawValue = budgetDrafts[campaignId];
    const parsedBudget = Number(rawValue);

    if (Number.isNaN(parsedBudget) || parsedBudget <= 0) {
      setFeedback({
        type: 'error',
        text: 'Informe um Orçamento Diário válido maior que R$ 0,00.',
      });
      return;
    }

    setUpdatingCampaignId(campaignId);
    setFeedback(null);

    try {
      const res = await fetch(`/api/ads/campaigns/${encodeURIComponent(campaignId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ budget: parsedBudget }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Falha ao salvar orçamento diário.');
      }

      setCampaigns((prev) =>
        prev.map((c) => (c.id === campaignId ? { ...c, budget: parsedBudget } : c))
      );

      setFeedback({
        type: 'success',
        text: `Orçamento diário da campanha ${campaignId} atualizado para ${brlFormatter.format(
          parsedBudget
        )}!`,
      });
    } catch (err) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setUpdatingCampaignId(null);
    }
  }

  /**
   * Abre o Modal de Edição (Slide-Over).
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

  async function handleSendChatMessage(event, presetText = null) {
    if (event) event.preventDefault();
    const textToSend = presetText ?? chatInput;
    if (!textToSend.trim() || chatLoading) return;

    const userMsg = textToSend.trim();
    setChatMessages((prev) => [...prev, { role: 'user', text: userMsg }]);
    if (!presetText) setChatInput('');
    setChatLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg,
          previous_interaction_id: previousInteractionId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
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
        },
      ]);

      // HUMAN-IN-THE-LOOP: Se a IA gerou uma proposta de atualização, abre o Modal de Edição
      // preenchido com Título, Preço e Estoque sugeridos, aguardando o clique físico em "Salvar"!
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
    } finally {
      setChatLoading(false);
    }
  }

  function handlePriceChange(val) {
    setEditPrice(val);
    if (selectedItem && val !== '' && !Number.isNaN(Number(val))) {
      const numericPrice = Number(val);
      setItems((prev) =>
        prev.map((it) => (it.id === selectedItem.id ? { ...it, price: numericPrice } : it))
      );
    }
  }

  function handleCostChange(val) {
    setEditCost(val);
    if (selectedItem && val !== '' && !Number.isNaN(Number(val))) {
      const numericCost = Number(val);
      setItems((prev) =>
        prev.map((it) =>
          it.id === selectedItem.id ? { ...it, product_cost: numericCost } : it
        )
      );
    }
  }

  // O envio real via HTTP PUT para a API do Mercado Livre SÓ acontece quando o usuário clica em "Salvar" no modal!
  async function handleSaveItem(event) {
    event.preventDefault();
    if (!selectedItem) return;

    setSaving(true);
    setFeedback(null);

    try {
      const res = await fetch(`/api/items/${encodeURIComponent(selectedItem.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle.trim(),
          price: Number(editPrice),
          product_cost: Number(editCost),
          available_quantity: Number(editStock),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Falha ao atualizar anúncio.');
      }

      setItems((prev) =>
        prev.map((it) => (it.id === selectedItem.id ? { ...it, ...data.item } : it))
      );

      setFeedback({
        type: 'success',
        text: `Anúncio ${selectedItem.id} aprovado e enviado ao Mercado Livre com sucesso!`,
      });
      closeEditSlideOver();
    } catch (err) {
      setFeedback({ type: 'error', text: err.message });
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

  const liveModalSim = useMemo(() => {
    return calculateMeliSimulator(editPrice, editCost);
  }, [editPrice, editCost]);

  return (
    <div className="app-shell">
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
            <span className="mono-id">&gt; R$ 79,00</span>
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
            <button
              type="button"
              className="btn-secondary"
              style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
              onClick={() => setFeedback(null)}
            >
              Fechar
            </button>
          </div>
        )}

        {activeView === 'ads_items' ? (
          <>
            <header className="topbar">
              <div>
                <h1 className="page-title">Meus Anúncios & Simulador de Margem</h1>
                <p className="page-subtitle">
                  Gerenciamento de anúncios Pacific Flowers com cálculo automático de comissão ML (16%), gatilho de R$ 79,00 e margem líquida.
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
                    <th>ID</th>
                    <th>Título</th>
                    <th>Preço</th>
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
                      const sim = calculateMeliSimulator(item.price, item.product_cost ?? 0);
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
                          <td className="item-title-cell">{item.title}</td>
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
                            <span className="stock-badge">{item.available_quantity} un.</span>
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
                  Controle de campanhas patrocinadas (Product Ads API), orçamento diário e filtro estratégico para Kits de Atacado (&gt; R$ 79,00).
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
                    <th style={{ width: '160px' }}>Status</th>
                    <th style={{ width: '240px' }}>Orçamento Diário</th>
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
                      const isBusy = updatingCampaignId === camp.id;

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
                            <div style={{ fontWeight: 600 }}>{camp.name}</div>
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
                                aria-label={`Alternar status da campanha ${camp.name}`}
                                disabled={isBusy}
                                className={`toggle-switch ${isActive ? 'active' : ''}`}
                                onClick={() => handleToggleCampaignStatus(camp)}
                              />
                              <span
                                className={`toggle-label ${isActive ? 'active' : ''}`}
                              >
                                {isActive ? 'Ativa' : 'Pausada'}
                              </span>
                            </div>
                          </td>

                          <td>
                            <div className="budget-editor">
                              <div className="budget-input-group">
                                <span className="budget-prefix">R$</span>
                                <input
                                  type="number"
                                  step="1"
                                  min="1"
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
                                Salvar
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
           * VIEW 3: COPILOTO DE VENDAS B2B & AUDITOR (HUMAN-IN-THE-LOOP)
           * ================================================================ */
          <>
            <header className="topbar">
              <div>
                <h1 className="page-title">
                  Copiloto de Vendas B2B — Aprovação Manual (Human-in-the-Loop)
                </h1>
                <p className="page-subtitle">
                  A IA audita as políticas do Mercado Livre e abre o Modal de Edição preenchido com Título, Preço e Estoque sugeridos. O PUT só é enviado ao clicar em Salvar.
                </p>
              </div>
            </header>

            <div className="toolbar" style={{ justifyContent: 'flex-start', gap: '0.6rem' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() =>
                  handleSendChatMessage(
                    null,
                    `Otimizar título do ${
                      items[0]?.id || 'MLB3948102938'
                    } para "PROMOÇÃO!!! Kit 50 Caixas Presente Floral Frete Grátis Pacific Flowers"`
                  )
                }
              >
                1. Testar Bloqueio de Violação (Promoção + &gt;60 chars)
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() =>
                  handleSendChatMessage(
                    null,
                    `Otimizar título do ${
                      items[0]?.id || 'MLB3948102938'
                    } para "Kit 50 Caixas Presente Floral 25x25cm Pacific Flowers"`
                  )
                }
              >
                2. Sugerir Título B2B (Abre Modal p/ Aprovação)
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() =>
                  handleSendChatMessage(
                    null,
                    `Atualizar preço do ${items[0]?.id || 'MLB3948102938'} para R$ 94,90`
                  )
                }
              >
                3. Sugerir Novo Preço R$ 94,90 (Abre Modal p/ Aprovação)
              </button>
            </div>

            <div
              className="table-card"
              style={{
                padding: '1.25rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
                minHeight: '460px',
              }}
            >
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.85rem',
                  maxHeight: '420px',
                  overflowY: 'auto',
                  paddingRight: '0.5rem',
                }}
              >
                {chatMessages.map((msg, i) => (
                  <div
                    key={i}
                    style={{
                      alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                      maxWidth: '82%',
                      backgroundColor:
                        msg.role === 'user'
                          ? 'rgba(139, 92, 246, 0.2)'
                          : 'var(--bg-base)',
                      border: `1px solid ${
                        msg.role === 'user'
                          ? 'rgba(139, 92, 246, 0.5)'
                          : 'var(--border-subtle)'
                      }`,
                      borderRadius: '10px',
                      padding: '0.85rem 1rem',
                      fontSize: '0.86rem',
                      lineHeight: 1.5,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    <div>{msg.text}</div>
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
                        ⚡ Function Call preparada (aguardando Salvar no Modal):{' '}
                        {msg.tools
                          .map((t) => `${t.name}(${JSON.stringify(t.arguments)})`)
                          .join(', ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <form
                onSubmit={handleSendChatMessage}
                style={{ display: 'flex', gap: '0.75rem', marginTop: 'auto' }}
              >
                <input
                  type="text"
                  className="form-input"
                  style={{ flex: 1 }}
                  placeholder="Peça ao Copiloto B2B para otimizar título ou atualizar preço/estoque..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                />
                <button type="submit" className="btn-primary" disabled={chatLoading}>
                  {chatLoading ? 'Preparando...' : 'Enviar para /api/chat'}
                </button>
              </form>
            </div>
          </>
        )}
      </main>

      {/* Slide-Over Modal de Edição (<dialog closedby="any">) — Human-in-the-Loop */}
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
                  <label htmlFor="price-input">Preço de Venda (R$)</label>
                  <input
                    id="price-input"
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    className="form-input"
                    value={editPrice}
                    onChange={(e) => handlePriceChange(e.target.value)}
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

              <div className="simulator-card">
                <div className="simulator-card-header">
                  <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                    Resumo da Simulação (Regra 16% B2B)
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
                  <span>Preço de Venda</span>
                  <span className="mono-value">{brlFormatter.format(liveModalSim.price)}</span>
                </div>

                <div className="simulator-row">
                  <span>(-) Custo de Produção (Pacific Flowers)</span>
                  <span className="mono-value">
                    - {brlFormatter.format(liveModalSim.productCost)}
                  </span>
                </div>

                <div className="simulator-row">
                  <span>
                    (-) Taxas ML (16%{' '}
                    {liveModalSim.fixedFee > 0 ? '+ R$ 6,00 Taxa Fixa' : 'Sem Taxa Fixa'})
                  </span>
                  <span className="mono-value">
                    - {brlFormatter.format(liveModalSim.mlCommission)}
                  </span>
                </div>

                <div className="simulator-row">
                  <span>
                    (-) Custo de Frete Vendedor (
                    {liveModalSim.isFreeShippingEligible ? ' >= R$ 79' : ' < R$ 79'})
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
                {saving ? 'Enviando ao ML...' : 'Salvar'}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}
