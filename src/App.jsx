import React, { useState, useEffect, useRef, useMemo } from 'react';

const brlFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

/**
 * Motor Matemático do Simulador de Margem e Gatilho de Frete Grátis (Pacific Flowers)
 */
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
  // Controle de Navegação da Sidebar ('ads_items' = Meus Anúncios | 'mercado_ads' = Mercado Ads)
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
  const [selectedItem, setSelectedItem] = useState(null);
  const [editPrice, setEditPrice] = useState('');
  const [editCost, setEditCost] = useState('');
  const [editStock, setEditStock] = useState('');
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

  const dialogRef = useRef(null);

  // Fallback para light-dismiss em navegadores sem suporte a <dialog closedby="any">
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => setSelectedItem(null);
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

  // Inicialização e interceptação de callback OAuth 2.0
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
      await Promise.all([fetchAuthStatus(), fetchItems(authResult === 'success'), fetchMercadoAdsData()]);
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

  // Carrega Campanhas (/api/ads/campaigns) e Métricas de 30 dias (/api/ads/metrics)
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

      // Inicializa os inputs editáveis de Orçamento Diário
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

  // PUT /api/ads/campaigns/:id -> Alterna Status (Toggle Liga/Desliga em Roxo Elétrico)
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

  // PUT /api/ads/campaigns/:id -> Salva novo Orçamento Diário (budget)
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

  function openEditSlideOver(item) {
    setSelectedItem(item);
    setEditPrice(String(item.price));
    setEditCost(String(item.product_cost ?? 0));
    setEditStock(String(item.available_quantity));
    if (dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal();
    }
  }

  function closeEditSlideOver() {
    if (dialogRef.current && dialogRef.current.open) {
      dialogRef.current.close();
    }
    setSelectedItem(null);
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
        text: `Anúncio ${selectedItem.id} salvo! Preço, Custo Pacific Flowers e Estoque sincronizados.`,
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

  // Filtro de Campanhas do Mercado Ads (com suporte ao Filtro B2B: Preço > R$ 79,00)
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
      {/* Sidebar com "Meus Anúncios" e "Mercado Ads" */}
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
          /* ================================================================
           * VIEW 1: MEUS ANÚNCIOS & SIMULADOR DE MARGEM
           * ================================================================ */
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
        ) : (
          /* ================================================================
           * VIEW 2: MERCADO ADS (GERENCIAMENTO DE TRÁFEGO PAGO & FILTRO B2B)
           * ================================================================ */
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

            {/* Resumo de Performance dos Últimos 30 Dias (/api/ads/metrics) */}
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

            {/* Barra de Busca + Botão de Regra de Negócio (Filtro B2B > R$ 79,00) */}
            <div className="toolbar">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
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

            {/* Data Table Dedicada para Anúncios Patrocinados (Mercado Ads) */}
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

                          {/* Coluna Status: Toggle Switch com brilho em Roxo Elétrico */}
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

                          {/* Coluna Orçamento Diário: Input Editável + Botão Salvar ao lado */}
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

                          {/* Coluna Faturamento Ads (30d) */}
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

                          {/* Coluna ACOS (%) */}
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
        )}
      </main>

      {/* Slide-Over Modal Nativo (<dialog closedby="any">) para editar Preço, Custo Pacific Flowers e Estoque */}
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
                  Editar Anúncio & Simular Margem
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
              <div className="slideover-item-preview">
                <img
                  src={selectedItem.thumbnail}
                  alt={selectedItem.title}
                  className="item-thumb"
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <div style={{ fontSize: '0.86rem', fontWeight: 500, lineHeight: 1.35 }}>
                    {selectedItem.title}
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

              {/* Simulador de Margem e Gatilho de Frete Grátis em Tempo Real */}
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
                {saving ? 'Salvando...' : 'Salvar Alterações'}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}
