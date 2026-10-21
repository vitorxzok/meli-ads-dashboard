import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_DIR = process.env.VERCEL ? '/tmp' : __dirname;
const TOKEN_STORE_PATH = path.join(STORAGE_DIR, '.tokens.json');
const COSTS_STORE_PATH = path.join(STORAGE_DIR, '.costs.json');

const app = express();
const PORT = process.env.PORT || 3001;
const ML_API_BASE = 'https://api.mercadolibre.com';

app.use(cors());
app.use(express.json());

// ============================================================================
// High-Performance In-Memory Token, Cost & Cache Store (with disk persistence)
// ============================================================================
let authSession = {
  access_token: process.env.ML_ACCESS_TOKEN || null,
  refresh_token: process.env.ML_REFRESH_TOKEN || null,
  user_id: process.env.ML_USER_ID || null,
  expires_at: null,
};

// Armazena o Custo do Produto (valor de produção interna Pacific Flowers) por ID de anúncio
let productCostsMap = {
  MLB3948102938: 22.5,
  MLB4019283741: 38.0,
  MLB3819203940: 19.9,
  MLB3728192031: 49.0,
  MLB4102938475: 26.0,
};

// Demo dataset de Anúncios (Meus Anúncios)
let demoItems = [
  {
    id: 'MLB3948102938',
    title: 'Kit 50 Caixas Presente Floral Premium Pacific Flowers 25x25cm',
    price: 69.9,
    product_cost: 22.5,
    available_quantity: 85,
    status: 'active',
    currency_id: 'BRL',
    thumbnail: 'https://http2.mlstatic.com/D_NQ_NP_2X_601411-MLA74651415532_022024-F.webp',
    permalink: 'https://produto.mercadolivre.com.br/MLB-3948102938',
  },
  {
    id: 'MLB4019283741',
    title: 'Papel Seda Estampado Botânico Bobina 60cm x 100m B2B',
    price: 119.9,
    product_cost: 38.0,
    available_quantity: 32,
    status: 'active',
    currency_id: 'BRL',
    thumbnail: 'https://http2.mlstatic.com/D_NQ_NP_2X_847192-MLA75123981234_032024-F.webp',
    permalink: 'https://produto.mercadolivre.com.br/MLB-4019283741',
  },
  {
    id: 'MLB3819203940',
    title: 'Pacote 100 Tags Cartão Kraft Decorado Buquê & Papelaria Fina',
    price: 54.9,
    product_cost: 19.9,
    available_quantity: 140,
    status: 'active',
    currency_id: 'BRL',
    thumbnail: 'https://http2.mlstatic.com/D_NQ_NP_2X_781234-MLA73981234561_012024-F.webp',
    permalink: 'https://produto.mercadolivre.com.br/MLB-3819203940',
  },
  {
    id: 'MLB3728192031',
    title: 'Kit Embalagem Celofane BOPP Transparente p/ Arranjos (500 un)',
    price: 149.0,
    product_cost: 49.0,
    available_quantity: 0,
    status: 'paused',
    currency_id: 'BRL',
    thumbnail: 'https://http2.mlstatic.com/D_NQ_NP_2X_918273-MLA72839182736_112023-F.webp',
    permalink: 'https://produto.mercadolivre.com.br/MLB-3728192031',
  },
  {
    id: 'MLB4102938475',
    title: 'Caixa Organizadora Rígida Linha Luxo Pacific Flowers Atacado',
    price: 79.0,
    product_cost: 26.0,
    available_quantity: 27,
    status: 'active',
    currency_id: 'BRL',
    thumbnail: 'https://http2.mlstatic.com/D_NQ_NP_2X_654321-MLA74918273645_032024-F.webp',
    permalink: 'https://produto.mercadolivre.com.br/MLB-4102938475',
  },
];

// Demo dataset de Campanhas Patrocinadas (Mercado Ads - últimos 30 dias)
let demoAdsCampaigns = [
  {
    id: 'CMP-9081721',
    item_id: 'MLB4019283741',
    name: 'Kit Atacado Bobinas Papel Seda Estampado Botânico B2B (5 rolos)',
    thumbnail: 'https://http2.mlstatic.com/D_NQ_NP_2X_847192-MLA75123981234_032024-F.webp',
    status: 'active',
    budget: 85.0,
    kit_price: 239.9,
    ads_revenue_30d: 14820.5,
    ads_spend_30d: 1659.9,
    acos: 11.2,
  },
  {
    id: 'CMP-9081722',
    item_id: 'MLB3728192031',
    name: 'Kit 500un Embalagem Celofane BOPP Transparente Floricultura Atacado',
    thumbnail: 'https://http2.mlstatic.com/D_NQ_NP_2X_918273-MLA72839182736_112023-F.webp',
    status: 'active',
    budget: 120.0,
    kit_price: 149.0,
    ads_revenue_30d: 22450.0,
    ads_spend_30d: 2132.75,
    acos: 9.5,
  },
  {
    id: 'CMP-9081723',
    item_id: 'MLB3948102938',
    name: 'Pacote Unitário Caixas Presente Floral 25x25cm (Varejo)',
    thumbnail: 'https://http2.mlstatic.com/D_NQ_NP_2X_601411-MLA74651415532_022024-F.webp',
    status: 'paused',
    budget: 35.0,
    kit_price: 69.9,
    ads_revenue_30d: 1890.0,
    ads_spend_30d: 538.65,
    acos: 28.5,
  },
  {
    id: 'CMP-9081724',
    item_id: 'MLB4102938475',
    name: 'Kit Master 20 Caixas Organizadoras Rígidas Linha Luxo Pacific Flowers',
    thumbnail: 'https://http2.mlstatic.com/D_NQ_NP_2X_654321-MLA74918273645_032024-F.webp',
    status: 'active',
    budget: 150.0,
    kit_price: 389.0,
    ads_revenue_30d: 31290.0,
    ads_spend_30d: 2440.62,
    acos: 7.8,
  },
  {
    id: 'CMP-9081725',
    item_id: 'MLB3819203940',
    name: 'Bloco Unitário 100 Tags Cartão Kraft Decorado Buquê',
    thumbnail: 'https://http2.mlstatic.com/D_NQ_NP_2X_781234-MLA73981234561_012024-F.webp',
    status: 'active',
    budget: 25.0,
    kit_price: 54.9,
    ads_revenue_30d: 1420.0,
    ads_spend_30d: 443.04,
    acos: 31.2,
  },
];

const itemsCache = {
  data: null,
  timestamp: 0,
  ttlMs: 15_000,
};

// ============================================================================
// Motor Matemático: Simulador de Margem e Gatilho de Frete Grátis (R$ 79,00)
// ============================================================================
export function calculatePricingMetrics(price, productCost = 0) {
  const safePrice = Number(price) || 0;
  const safeCost = Number(productCost) || 0;
  const isFreeShippingTriggered = safePrice >= 79;

  const fixedFee = isFreeShippingTriggered ? 0.0 : 6.0;
  const mlCommission = safePrice * 0.16 + fixedFee;
  const sellerShippingCost = isFreeShippingTriggered ? 21.0 : 0.0;

  const netProfit = safePrice - safeCost - mlCommission - sellerShippingCost;
  const marginPercent = safePrice > 0 ? (netProfit / safePrice) * 100 : 0;

  return {
    product_cost: Number(safeCost.toFixed(2)),
    ml_fee_estimate: Number(mlCommission.toFixed(2)),
    seller_shipping_cost: Number(sellerShippingCost.toFixed(2)),
    net_profit: Number(netProfit.toFixed(2)),
    margin_percent: Number(marginPercent.toFixed(2)),
    strategy_status: isFreeShippingTriggered ? 'free_shipping' : 'fixed_fee_warning',
    strategy_label: isFreeShippingTriggered
      ? 'Elegível: Frete Grátis'
      : 'Cuidado: Taxa Fixa Ativa',
  };
}

function enrichItemWithMetrics(item) {
  const cost =
    item.product_cost !== undefined
      ? Number(item.product_cost)
      : productCostsMap[item.id] ?? Number((item.price * 0.35).toFixed(2));
  return {
    ...item,
    ...calculatePricingMetrics(item.price, cost),
  };
}

function getLast30DaysRange() {
  const now = new Date();
  const past = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const format = (d) => d.toISOString().split('T')[0];
  return { date_from: format(past), date_to: format(now) };
}

async function resolveUserId(token) {
  if (authSession.user_id) return authSession.user_id;
  const meResponse = await fetch(`${ML_API_BASE}/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!meResponse.ok) {
    throw new Error('Não foi possível obter os dados do usuário (/users/me). Verifique o token.');
  }
  const meData = await meResponse.json();
  authSession.user_id = meData.id;
  return meData.id;
}

async function loadSavedState() {
  try {
    const rawTokens = await fs.readFile(TOKEN_STORE_PATH, 'utf-8');
    const parsedTokens = JSON.parse(rawTokens);
    if (parsedTokens.access_token) {
      authSession = { ...authSession, ...parsedTokens };
      console.log(`[Auth] Sessão carregada para o user_id: ${authSession.user_id}`);
    }
  } catch {
    // No saved token file yet
  }

  try {
    const rawCosts = await fs.readFile(COSTS_STORE_PATH, 'utf-8');
    const parsedCosts = JSON.parse(rawCosts);
    productCostsMap = { ...productCostsMap, ...parsedCosts };
  } catch {
    // No saved costs file yet
  }
}

async function saveProductCost(itemId, costValue) {
  productCostsMap[itemId] = Number(Number(costValue).toFixed(2));
  try {
    await fs.writeFile(COSTS_STORE_PATH, JSON.stringify(productCostsMap, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[Costs] Não foi possível persistir custo em disco:', err.message);
  }
}

async function saveTokens(sessionData) {
  authSession = {
    access_token: sessionData.access_token,
    refresh_token: sessionData.refresh_token || authSession.refresh_token,
    user_id: sessionData.user_id || authSession.user_id,
    expires_at: sessionData.expires_in
      ? Date.now() + sessionData.expires_in * 1000
      : authSession.expires_at,
  };
  itemsCache.data = null;
  try {
    await fs.writeFile(TOKEN_STORE_PATH, JSON.stringify(authSession, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[Auth] Não foi possível persistir token em disco:', err.message);
  }
}

async function ensureValidAccessToken() {
  if (!authSession.access_token) {
    return null;
  }
  if (
    authSession.expires_at &&
    Date.now() > authSession.expires_at - 60_000 &&
    authSession.refresh_token
  ) {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.APP_ID,
      client_secret: process.env.SECRET_KEY,
      refresh_token: authSession.refresh_token,
    });

    const response = await fetch(`${ML_API_BASE}/oauth/token`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    if (response.ok) {
      const tokenData = await response.json();
      await saveTokens(tokenData);
    }
  }
  return authSession.access_token;
}

async function exchangeCodeForToken(code) {
  const payload = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: process.env.APP_ID,
    client_secret: process.env.SECRET_KEY,
    code: String(code),
    redirect_uri: process.env.REDIRECT_URI,
  });

  const response = await fetch(`${ML_API_BASE}/oauth/token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: payload,
  });

  const data = await response.json();
  if (!response.ok) {
    const error = new Error(
      data.message || data.error_description || 'Falha na autenticação OAuth 2.0'
    );
    error.status = response.status;
    error.details = data;
    throw error;
  }

  await saveTokens(data);
  return data;
}

// ============================================================================
// 1. OAuth 2.0 Endpoints (Authorization URL, Status & Callback)
// ============================================================================
app.get('/api/auth/status', (req, res) => {
  const authUrl = `https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=${encodeURIComponent(
    process.env.APP_ID || ''
  )}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI || '')}`;

  res.json({
    authenticated: Boolean(authSession.access_token),
    user_id: authSession.user_id,
    expires_at: authSession.expires_at,
    app_id: process.env.APP_ID,
    redirect_uri: process.env.REDIRECT_URI,
    auth_url: authUrl,
  });
});

const handleOAuthCallback = async (req, res) => {
  const code = req.query.code || req.body?.code;

  if (!code) {
    return res.status(400).json({
      error: 'missing_code',
      message: 'Parâmetro "code" não informado na URL de callback do Mercado Livre.',
    });
  }

  try {
    const tokenData = await exchangeCodeForToken(code);

    if (req.headers.accept && req.headers.accept.includes('text/html') && req.method === 'GET') {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      return res.redirect(`${frontendUrl}/?auth=success`);
    }

    return res.json({
      message: 'Autenticação OAuth 2.0 concluída com sucesso!',
      user_id: tokenData.user_id,
      expires_in: tokenData.expires_in,
      scope: tokenData.scope,
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      error: 'oauth_exchange_failed',
      message: error.message,
      details: error.details || null,
    });
  }
};

app.get('/callback', handleOAuthCallback);
app.get('/api/auth/callback', handleOAuthCallback);
app.post('/api/auth/callback', handleOAuthCallback);

app.post('/api/auth/token', async (req, res) => {
  const { access_token, user_id } = req.body;
  if (!access_token) {
    return res.status(400).json({ error: 'Informe um access_token válido.' });
  }

  let resolvedUserId = user_id;
  if (!resolvedUserId) {
    const meRes = await fetch(`${ML_API_BASE}/users/me`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (meRes.ok) {
      const meData = await meRes.json();
      resolvedUserId = meData.id;
    }
  }

  await saveTokens({
    access_token,
    user_id: resolvedUserId,
  });

  return res.json({
    message: 'Access token configurado com sucesso.',
    authenticated: true,
    user_id: authSession.user_id,
  });
});

// ============================================================================
// 2. Rota GET para listar os anúncios do usuário com Alta Performance (Multiget)
// ============================================================================
app.get('/api/items', async (req, res) => {
  const forceRefresh = req.query.refresh === 'true';
  const mode = req.query.mode;

  try {
    const token = await ensureValidAccessToken();

    if (!token || mode === 'demo') {
      const enrichedDemo = demoItems.map(enrichItemWithMetrics);
      return res.json({
        source: 'demo',
        user_id: 'PACIFIC_FLOWERS_DEMO',
        total: enrichedDemo.length,
        items: enrichedDemo,
      });
    }

    if (!forceRefresh && itemsCache.data && Date.now() - itemsCache.timestamp < itemsCache.ttlMs) {
      return res.json({
        source: 'cache',
        user_id: authSession.user_id,
        total: itemsCache.data.length,
        items: itemsCache.data.map(enrichItemWithMetrics),
      });
    }

    const userId = await resolveUserId(token);

    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const offset = Number(req.query.offset) || 0;
    const searchUrl = `${ML_API_BASE}/users/${userId}/items/search?limit=${limit}&offset=${offset}`;

    const searchResponse = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const searchData = await searchResponse.json();
    if (!searchResponse.ok) {
      return res.status(searchResponse.status).json({
        error: 'ml_items_search_error',
        message: searchData.message || 'Erro ao buscar IDs de anúncios no Mercado Livre.',
        details: searchData,
      });
    }

    const itemIds = searchData.results || [];
    if (itemIds.length === 0) {
      itemsCache.data = [];
      itemsCache.timestamp = Date.now();
      return res.json({
        source: 'live',
        user_id: userId,
        total: 0,
        items: [],
      });
    }

    const attributes =
      'id,title,price,available_quantity,status,thumbnail,secure_thumbnail,permalink,currency_id';
    const chunks = [];
    for (let i = 0; i < itemIds.length; i += 20) {
      chunks.push(itemIds.slice(i, i + 20));
    }

    const batchResponses = await Promise.all(
      chunks.map(async (chunk) => {
        const multiGetUrl = `${ML_API_BASE}/items?ids=${chunk.join(',')}&attributes=${attributes}`;
        const resBatch = await fetch(multiGetUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resBatch.ok) {
          throw new Error(`Falha no Multiget de itens (HTTP ${resBatch.status})`);
        }
        return resBatch.json();
      })
    );

    const items = batchResponses
      .flat()
      .filter((entry) => entry && entry.code === 200 && entry.body)
      .map((entry) =>
        enrichItemWithMetrics({
          id: entry.body.id,
          title: entry.body.title,
          price: entry.body.price,
          available_quantity: entry.body.available_quantity,
          status: entry.body.status,
          currency_id: entry.body.currency_id || 'BRL',
          thumbnail: entry.body.secure_thumbnail || entry.body.thumbnail,
          permalink: entry.body.permalink,
        })
      );

    itemsCache.data = items;
    itemsCache.timestamp = Date.now();

    return res.json({
      source: 'live',
      user_id: userId,
      total: searchData.paging?.total ?? items.length,
      items,
    });
  } catch (error) {
    return res.status(500).json({
      error: 'internal_error',
      message: error.message || 'Erro interno ao listar anúncios.',
    });
  }
});

// ============================================================================
// 3. Rota PUT para atualizar Preço, Estoque e Custo do Produto (Pacific Flowers)
// ============================================================================
app.put('/api/items/:id', async (req, res) => {
  const { id } = req.params;
  const { price, available_quantity, product_cost } = req.body;

  const parsedPrice = price !== undefined ? Number(price) : undefined;
  const parsedQuantity = available_quantity !== undefined ? Number(available_quantity) : undefined;
  const parsedCost = product_cost !== undefined ? Number(product_cost) : undefined;

  if (
    (parsedPrice === undefined || Number.isNaN(parsedPrice) || parsedPrice <= 0) &&
    (parsedQuantity === undefined || Number.isNaN(parsedQuantity) || parsedQuantity < 0) &&
    (parsedCost === undefined || Number.isNaN(parsedCost) || parsedCost < 0)
  ) {
    return res.status(400).json({
      error: 'invalid_payload',
      message: 'Informe valores válidos para price, available_quantity e/ou product_cost.',
    });
  }

  const updatePayload = {};
  if (parsedPrice !== undefined && !Number.isNaN(parsedPrice)) {
    updatePayload.price = Number(parsedPrice.toFixed(2));
  }
  if (parsedQuantity !== undefined && !Number.isNaN(parsedQuantity)) {
    updatePayload.available_quantity = Math.floor(parsedQuantity);
  }

  if (parsedCost !== undefined && !Number.isNaN(parsedCost) && parsedCost >= 0) {
    await saveProductCost(id, parsedCost);
  }

  try {
    const token = await ensureValidAccessToken();

    if (!token || req.query.mode === 'demo') {
      const idx = demoItems.findIndex((item) => item.id === id);
      if (idx === -1) {
        return res.status(404).json({ error: 'not_found', message: 'Anúncio não encontrado.' });
      }
      demoItems[idx] = {
        ...demoItems[idx],
        ...updatePayload,
        product_cost:
          parsedCost !== undefined && !Number.isNaN(parsedCost)
            ? Number(parsedCost.toFixed(2))
            : demoItems[idx].product_cost,
        status:
          updatePayload.available_quantity === 0
            ? 'paused'
            : updatePayload.available_quantity > 0 && demoItems[idx].status === 'paused'
            ? 'active'
            : demoItems[idx].status,
      };
      const enriched = enrichItemWithMetrics(demoItems[idx]);
      return res.json({
        source: 'demo',
        message: 'Anúncio e simulação de margem atualizados com sucesso.',
        item: enriched,
      });
    }

    let updatedItemBase = null;
    if (Object.keys(updatePayload).length > 0) {
      const mlResponse = await fetch(`${ML_API_BASE}/items/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(updatePayload),
      });

      const mlData = await mlResponse.json();
      if (!mlResponse.ok) {
        return res.status(mlResponse.status).json({
          error: 'ml_update_failed',
          message: mlData.message || 'Falha ao atualizar anúncio na API do Mercado Livre.',
          details: mlData,
        });
      }

      updatedItemBase = {
        id: mlData.id,
        title: mlData.title,
        price: mlData.price,
        available_quantity: mlData.available_quantity,
        status: mlData.status,
        currency_id: mlData.currency_id || 'BRL',
        thumbnail: mlData.secure_thumbnail || mlData.thumbnail,
        permalink: mlData.permalink,
      };
    } else if (itemsCache.data) {
      updatedItemBase = itemsCache.data.find((item) => item.id === id) || { id };
    }

    const enrichedUpdatedItem = enrichItemWithMetrics({
      ...updatedItemBase,
      product_cost: productCostsMap[id],
    });

    if (itemsCache.data) {
      itemsCache.data = itemsCache.data.map((item) =>
        item.id === id ? { ...item, ...enrichedUpdatedItem } : item
      );
    }

    return res.json({
      source: 'live',
      message: 'Anúncio atualizado com sucesso no Mercado Livre!',
      item: enrichedUpdatedItem,
    });
  } catch (error) {
    return res.status(500).json({
      error: 'update_exception',
      message: error.message || 'Erro interno ao atualizar anúncio.',
    });
  }
});

// ============================================================================
// 4. Módulo Mercado Ads (Advertising API do Mercado Livre)
// ============================================================================

/**
 * Rota GET /api/ads/campaigns
 * Lista as campanhas ativas e pausadas, extraindo Orçamento Diário (budget),
 * status (active/paused) e elegibilidade B2B (preço > R$ 79,00).
 */
app.get('/api/ads/campaigns', async (req, res) => {
  const mode = req.query.mode;

  try {
    const token = await ensureValidAccessToken();

    if (!token || mode === 'demo') {
      return res.json({
        source: 'demo',
        campaigns: demoAdsCampaigns.map((c) => ({
          ...c,
          is_b2b_kit: Number(c.kit_price) > 79,
        })),
      });
    }

    const userId = await resolveUserId(token);
    const { date_from, date_to } = getLast30DaysRange();

    // Chamada oficial à Advertising API do Mercado Livre repassando Authorization: Bearer
    const adsUrl = `${ML_API_BASE}/advertising/product_ads/campaigns/search?user_id=${encodeURIComponent(
      userId
    )}&date_from=${date_from}&date_to=${date_to}`;

    const mlResponse = await fetch(adsUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        'api-version': '2',
        Accept: 'application/json',
      },
    });

    const mlData = await mlResponse.json();
    if (!mlResponse.ok) {
      return res.status(mlResponse.status).json({
        error: 'ml_ads_campaigns_error',
        message: mlData.message || 'Falha ao consultar campanhas na Advertising API do Mercado Livre.',
        details: mlData,
      });
    }

    const rawCampaigns = mlData.results || [];
    const campaigns = rawCampaigns.map((camp) => {
      const revenue = Number(camp.metrics?.total_amount ?? camp.metrics?.amount_total ?? 0);
      const spend = Number(camp.metrics?.cost ?? 0);
      const acos =
        camp.metrics?.acos !== undefined
          ? Number(camp.metrics.acos)
          : revenue > 0
          ? Number(((spend / revenue) * 100).toFixed(2))
          : 0;
      const kitPrice = Number(camp.price ?? camp.kit_price ?? 89.9);

      return {
        id: String(camp.id),
        name: camp.name || `Campanha #${camp.id}`,
        status: camp.status === 'active' ? 'active' : 'paused',
        budget: Number(camp.budget ?? camp.daily_budget ?? 0),
        kit_price: kitPrice,
        is_b2b_kit: kitPrice > 79,
        thumbnail:
          camp.thumbnail ||
          'https://http2.mlstatic.com/D_NQ_NP_2X_847192-MLA75123981234_032024-F.webp',
        ads_revenue_30d: revenue,
        ads_spend_30d: spend,
        acos,
      };
    });

    return res.json({
      source: 'live',
      user_id: userId,
      campaigns,
    });
  } catch (error) {
    return res.status(500).json({
      error: 'ads_campaigns_exception',
      message: error.message || 'Erro interno ao buscar campanhas do Mercado Ads.',
    });
  }
});

/**
 * Rota GET /api/ads/metrics
 * Busca as métricas de performance (Faturamento gerado por Ads e ACOS %) dos últimos 30 dias.
 */
app.get('/api/ads/metrics', async (req, res) => {
  const mode = req.query.mode;
  const { date_from, date_to } = getLast30DaysRange();

  try {
    const token = await ensureValidAccessToken();

    if (!token || mode === 'demo') {
      const metricsById = {};
      let totalRevenue30d = 0;
      let totalSpend30d = 0;

      for (const camp of demoAdsCampaigns) {
        totalRevenue30d += Number(camp.ads_revenue_30d || 0);
        totalSpend30d += Number(camp.ads_spend_30d || 0);
        metricsById[camp.id] = {
          campaign_id: camp.id,
          ads_revenue_30d: camp.ads_revenue_30d,
          ads_spend_30d: camp.ads_spend_30d,
          acos: camp.acos,
        };
      }

      const globalAcos =
        totalRevenue30d > 0 ? Number(((totalSpend30d / totalRevenue30d) * 100).toFixed(2)) : 0;

      return res.json({
        source: 'demo',
        period: { date_from, date_to, days: 30 },
        summary: {
          total_revenue_30d: Number(totalRevenue30d.toFixed(2)),
          total_spend_30d: Number(totalSpend30d.toFixed(2)),
          average_acos: globalAcos,
        },
        metrics_by_campaign: metricsById,
      });
    }

    const userId = await resolveUserId(token);
    const metricsUrl = `${ML_API_BASE}/advertising/product_ads/campaigns/search?user_id=${encodeURIComponent(
      userId
    )}&date_from=${date_from}&date_to=${date_to}&metrics=clicks,prints,cost,acos,total_amount`;

    const mlResponse = await fetch(metricsUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        'api-version': '2',
        Accept: 'application/json',
      },
    });

    const mlData = await mlResponse.json();
    if (!mlResponse.ok) {
      return res.status(mlResponse.status).json({
        error: 'ml_ads_metrics_error',
        message: mlData.message || 'Erro ao buscar métricas de 30 dias no Mercado Ads.',
        details: mlData,
      });
    }

    const results = mlData.results || [];
    const metricsById = {};
    let totalRevenue30d = 0;
    let totalSpend30d = 0;

    for (const camp of results) {
      const revenue = Number(camp.metrics?.total_amount ?? 0);
      const spend = Number(camp.metrics?.cost ?? 0);
      const acos =
        camp.metrics?.acos !== undefined
          ? Number(camp.metrics.acos)
          : revenue > 0
          ? Number(((spend / revenue) * 100).toFixed(2))
          : 0;

      totalRevenue30d += revenue;
      totalSpend30d += spend;

      metricsById[String(camp.id)] = {
        campaign_id: String(camp.id),
        ads_revenue_30d: revenue,
        ads_spend_30d: spend,
        acos,
      };
    }

    const globalAcos =
      totalRevenue30d > 0 ? Number(((totalSpend30d / totalRevenue30d) * 100).toFixed(2)) : 0;

    return res.json({
      source: 'live',
      period: { date_from, date_to, days: 30 },
      summary: {
        total_revenue_30d: Number(totalRevenue30d.toFixed(2)),
        total_spend_30d: Number(totalSpend30d.toFixed(2)),
        average_acos: globalAcos,
      },
      metrics_by_campaign: metricsById,
    });
  } catch (error) {
    return res.status(500).json({
      error: 'ads_metrics_exception',
      message: error.message || 'Erro interno ao buscar métricas de 30 dias.',
    });
  }
});

/**
 * Rota PUT /api/ads/campaigns/:id
 * Envia comandos de edição ao Mercado Livre (status: active/paused e budget: valor do orçamento diário).
 */
app.put('/api/ads/campaigns/:id', async (req, res) => {
  const { id } = req.params;
  const { status, budget } = req.body;

  const updatePayload = {};
  if (status !== undefined) {
    if (status !== 'active' && status !== 'paused') {
      return res.status(400).json({
        error: 'invalid_status',
        message: 'O campo "status" deve ser "active" ou "paused".',
      });
    }
    updatePayload.status = status;
  }

  if (budget !== undefined) {
    const parsedBudget = Number(budget);
    if (Number.isNaN(parsedBudget) || parsedBudget <= 0) {
      return res.status(400).json({
        error: 'invalid_budget',
        message: 'Informe um Orçamento Diário (budget) maior que zero.',
      });
    }
    updatePayload.budget = Number(parsedBudget.toFixed(2));
  }

  if (Object.keys(updatePayload).length === 0) {
    return res.status(400).json({
      error: 'empty_payload',
      message: 'Informe "status" e/ou "budget" para atualizar a campanha.',
    });
  }

  try {
    const token = await ensureValidAccessToken();

    if (!token || req.query.mode === 'demo') {
      const idx = demoAdsCampaigns.findIndex((c) => c.id === id);
      if (idx === -1) {
        return res.status(404).json({
          error: 'campaign_not_found',
          message: 'Campanha não encontrada.',
        });
      }

      demoAdsCampaigns[idx] = {
        ...demoAdsCampaigns[idx],
        ...updatePayload,
      };

      return res.json({
        source: 'demo',
        message: `Campanha ${id} atualizada com sucesso!`,
        campaign: {
          ...demoAdsCampaigns[idx],
          is_b2b_kit: Number(demoAdsCampaigns[idx].kit_price) > 79,
        },
      });
    }

    const mlResponse = await fetch(
      `${ML_API_BASE}/advertising/product_ads/campaigns/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'api-version': '2',
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(updatePayload),
      }
    );

    const mlData = await mlResponse.json();
    if (!mlResponse.ok) {
      return res.status(mlResponse.status).json({
        error: 'ml_ads_update_failed',
        message: mlData.message || 'Falha ao atualizar campanha na Advertising API do Mercado Livre.',
        details: mlData,
      });
    }

    return res.json({
      source: 'live',
      message: `Campanha ${id} atualizada no Mercado Ads!`,
      campaign: {
        id: String(mlData.id || id),
        status: mlData.status || updatePayload.status,
        budget: Number(mlData.budget ?? updatePayload.budget),
      },
    });
  } catch (error) {
    return res.status(500).json({
      error: 'ads_update_exception',
      message: error.message || 'Erro interno ao atualizar campanha do Mercado Ads.',
    });
  }
});

await loadSavedState();

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`🚀 [Meli Ads Backend] Servidor rodando em http://localhost:${PORT}`);
    console.log(
      `🔐 [OAuth 2.0] APP_ID=${process.env.APP_ID} | REDIRECT_URI=${process.env.REDIRECT_URI}`
    );
  });
}

export default app;
