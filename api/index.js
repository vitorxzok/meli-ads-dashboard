import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_DIR = process.env.VERCEL ? '/tmp' : __dirname;
const TOKEN_STORE_PATH = path.join(STORAGE_DIR, '.tokens.json');
const COSTS_STORE_PATH = path.join(STORAGE_DIR, '.costs.json');

const app = express();
const PORT = process.env.PORT || 3001;
const ML_API_BASE = 'https://api.mercadolibre.com';

const DEFAULT_APP_ID = (process.env.APP_ID || '8994097000713485').trim();
const DEFAULT_SECRET_KEY = (process.env.SECRET_KEY || 'bLOGM4wmQHP76FcSYpzPFyAAX4TeTkzg').trim();
const PRODUCTION_APP_URL = (
  process.env.VITE_API_URL ||
  process.env.FRONTEND_URL ||
  'https://pacific-flowers-meli-ads.vercel.app'
)
  .trim()
  .replace(/\/$/, '');

// ============================================================================
// Pilar 5: Configuração Robusta de CORS para Produção na Vercel
// ============================================================================
const ALLOWED_ORIGINS = [
  PRODUCTION_APP_URL,
  'https://pacific-flowers-meli-ads.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173',
];

const corsOptions = {
  origin(origin, callback) {
    if (
      !origin ||
      ALLOWED_ORIGINS.includes(origin) ||
      /\.vercel\.app$/i.test(origin) ||
      /^https?:\/\/localhost(:\d+)?$/i.test(origin)
    ) {
      return callback(null, true);
    }
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Accept',
    'X-Requested-With',
    'api-version',
    'x-meli-authenticated',
  ],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());

// ============================================================================
// System Prompt Exato — Copiloto de Vendas B2B & Auditor Mercado Livre
// ============================================================================
export const COPILOT_SYSTEM_PROMPT = `Você é o Copiloto de Vendas B2B da Pacific Flowers, especialista no algoritmo e nas políticas de catálogo do Mercado Livre. Antes de executar qualquer Function Calling (atualizar_preco, otimizar_titulo, criar_anuncio), você deve obrigatoriamente validar a ação contra as seguintes regras da plataforma:

REGRAS DE TÍTULO (SEO e Conformidade):

Limite absoluto: 60 caracteres (com espaços).

Estrutura obrigatória: [Produto] + [Marca] + [Modelo] + [Especificações principais].

Proibido: Usar palavras promocionais (Oferta, Frete Grátis, Promoção, Brinde, Liquidação), símbolos especiais (!!!, ***), ou dados de contato.

Foco B2B: Em combos, a quantidade deve abrir o título (Ex: Kit 50 Talões Pedido 10x15cm Pacific Flowers).

REGRAS DE IMAGEM (A foto principal dita o ranqueamento):

A Foto 1 (capa) deve ter fundo 100% branco puro (RGB 255, 255, 255) criado digitalmente, não uma foto em parede branca.

O produto deve ocupar pelo menos 70% do quadro.

Proibido na Foto 1: Marcas d'água, logotipos (exceto no próprio produto), bordas, textos promocionais, QR codes ou qualquer elemento que não seja o produto.

REGRAS DE DESCRIÇÃO:

Apenas texto puro. É terminantemente proibido o uso de código HTML.

Proibido: Inserir e-mails, telefones, links externos, redes sociais, endereço da loja física ou dados bancários.

Estrutura: Deve ser clara, contendo medidas exatas, material, formato e aplicação (ex: Gramatura 90g, Poliestireno UV).

PRECIFICAÇÃO E TAXAS (Estratégia de Ticket):

Você sabe que anúncios abaixo de R$ 79,00 sofrem uma taxa fixa adicional de R$ 6,00.

Sempre recomende agrupar produtos (Kits/Caixas) para ultrapassar a barreira dos R$ 79,00 e absorver o frete de forma lucrativa.

Se o usuário solicitar uma alteração ou criação que fira essas regras, você deve recusar a ação gentilmente, explicar qual regra do Mercado Livre seria violada, e sugerir a versão corrigida imediatamente.`;

// ============================================================================
// Definições de Function Calling (Tools) mapeadas para o fluxo Human-in-the-Loop
// ============================================================================
export const COPILOT_TOOLS = [
  {
    type: 'function',
    name: 'atualizar_preco_anuncio',
    description:
      'Prepara a atualização do preço de venda (price) de um anúncio no Mercado Livre para aprovação humana no Modal de Edição. Atenção: valide antes a regra estratégica de R$ 79,00 (taxa fixa de R$ 6,00 abaixo de R$ 79,00).',
    parameters: {
      type: 'object',
      properties: {
        item_id: {
          type: 'string',
          description: 'ID do anúncio no Mercado Livre (ex: MLB3948102938)',
        },
        price: {
          type: 'number',
          description: 'Novo preço de venda em Reais (R$)',
        },
      },
      required: ['item_id', 'price'],
    },
  },
  {
    type: 'function',
    name: 'atualizar_estoque',
    description:
      'Prepara a atualização do estoque disponível (available_quantity) de um anúncio no Mercado Livre para aprovação humana no Modal de Edição.',
    parameters: {
      type: 'object',
      properties: {
        item_id: {
          type: 'string',
          description: 'ID do anúncio no Mercado Livre (ex: MLB3948102938)',
        },
        available_quantity: {
          type: 'integer',
          description: 'Nova quantidade de estoque disponível (>= 0)',
        },
      },
      required: ['item_id', 'available_quantity'],
    },
  },
  {
    type: 'function',
    name: 'otimizar_titulo_b2b',
    description:
      'Prepara a otimização do título (title) de um anúncio B2B no Mercado Livre para aprovação humana no Modal de Edição, respeitando estritamente o limite de 60 caracteres, sem termos promocionais ou símbolos proibidos, abrindo com a quantidade em kits B2B.',
    parameters: {
      type: 'object',
      properties: {
        item_id: {
          type: 'string',
          description: 'ID do anúncio no Mercado Livre (ex: MLB3948102938)',
        },
        title: {
          type: 'string',
          description:
            'Novo título auditado (máximo absoluto de 60 caracteres, estrutura [Quantidade/Kit] + [Produto] + [Marca] + [Modelo] + [Especificações]).',
        },
      },
      required: ['item_id', 'title'],
    },
  },
];

// ============================================================================
// Validador de Conformidade das Políticas do Mercado Livre (Guardrail Backend)
// ============================================================================
export function validateTitleCompliance(title) {
  const clean = String(title || '').trim();
  const violations = [];

  if (clean.length > 60) {
    violations.push(
      `O título possui ${clean.length} caracteres, violando o limite absoluto de 60 caracteres do Mercado Livre.`
    );
  }

  const forbiddenPromoRegex =
    /\b(oferta|frete\s*gr[aá]tis|promo[cç][aã]o|brinde|liquida[cç][aã]o|desconto|imperd[ií]vel)\b/i;
  const promoMatch = clean.match(forbiddenPromoRegex);
  if (promoMatch) {
    violations.push(
      `Uso da palavra promocional proibida "${promoMatch[0]}" nas Regras de Título do Mercado Livre.`
    );
  }

  if (/[!*]{2,}|[@#$%&]/.test(clean)) {
    violations.push(
      'Uso de símbolos especiais proibidos (!!!, ***, @, etc.) nas Regras de Título.'
    );
  }

  if (/(\b\d{4,5}[-\s]?\d{4}\b|https?:\/\/|www\.|@\w+)/i.test(clean)) {
    violations.push('Inclusão proibida de dados de contato, telefone ou links no título.');
  }

  let suggested = clean
    .replace(forbiddenPromoRegex, '')
    .replace(/[!*#@$%&]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!/Pacific Flowers/i.test(suggested) && suggested.length <= 42) {
    suggested = `${suggested} Pacific Flowers`.trim();
  }
  if (suggested.length > 60) {
    suggested = suggested.slice(0, 60).trim();
  }

  return {
    valid: violations.length === 0,
    length: clean.length,
    violations,
    suggested_title: suggested,
  };
}

// ============================================================================
// Pilar 1: OAuth 2.0 + PKCE (RFC 7636) + REDIRECT_URI de Produção (Sem localhost)
// ============================================================================
function getPkcePair() {
  const codeVerifier = crypto
    .createHmac('sha256', DEFAULT_SECRET_KEY)
    .update(`meli-pkce-${DEFAULT_APP_ID}`)
    .digest('base64url');

  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  return { codeVerifier, codeChallenge };
}

export function getRedirectUri(req) {
  // Prioriza VITE_API_URL ou REDIRECT_URI de produção (nunca trava em localhost:3000 na Vercel)
  const envApiUrl = (process.env.VITE_API_URL || '').trim().replace(/\/$/, '');
  const envRedirectUri = (process.env.REDIRECT_URI || '').trim();

  if (envRedirectUri && !/localhost/i.test(envRedirectUri)) {
    return envRedirectUri;
  }

  if (envApiUrl && !/localhost/i.test(envApiUrl)) {
    return `${envApiUrl}/callback`;
  }

  if (req && req.headers?.host && !/localhost/i.test(req.headers.host)) {
    const proto = req.headers['x-forwarded-proto'] || 'https';
    return `${proto}://${req.headers.host}/callback`;
  }

  return 'https://pacific-flowers-meli-ads.vercel.app/callback';
}

export function getFrontendBaseUrl(req) {
  const envApiUrl = (process.env.VITE_API_URL || process.env.FRONTEND_URL || '')
    .trim()
    .replace(/\/$/, '');

  if (envApiUrl && (!process.env.VERCEL || !/localhost/i.test(envApiUrl))) {
    return envApiUrl;
  }

  if (req && req.headers?.host) {
    const proto =
      req.headers['x-forwarded-proto'] ||
      (/localhost/i.test(req.headers.host) ? 'http' : 'https');
    return `${proto}://${req.headers.host}`;
  }

  return PRODUCTION_APP_URL;
}

export function getMeliAuthUrl(req) {
  const redirectUri = getRedirectUri(req);
  const { codeChallenge } = getPkcePair();
  return `https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=${encodeURIComponent(
    DEFAULT_APP_ID
  )}&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&code_challenge=${encodeURIComponent(codeChallenge)}&code_challenge_method=S256`;
}

// ============================================================================
// Gerenciamento de Sessão Híbrido + Tratamento de Token Expirado (Pilar 5)
// ============================================================================
let authSession = {
  access_token: process.env.ML_ACCESS_TOKEN || null,
  refresh_token: process.env.ML_REFRESH_TOKEN || null,
  user_id: process.env.ML_USER_ID || null,
  expires_at: null,
};

let productCostsMap = {};

function parseCookies(req) {
  const list = {};
  const cookieHeader = req?.headers?.cookie;
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach((cookie) => {
    let [name, ...rest] = cookie.split('=');
    name = name?.trim();
    if (!name) return;
    const value = rest.join('=').trim();
    if (!value) return;
    list[name] = decodeURIComponent(value);
  });
  return list;
}

function setSessionCookie(res, sessionObj) {
  try {
    const encoded = Buffer.from(JSON.stringify(sessionObj), 'utf-8').toString('base64url');
    const isProd = Boolean(process.env.VERCEL);
    res.setHeader(
      'Set-Cookie',
      `meli_session=${encoded}; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax${
        isProd ? '; Secure' : ''
      }`
    );
  } catch (err) {
    console.warn('[Cookie] Erro ao gravar cookie de sessão:', err.message);
  }
}

function clearExpiredSession(res = null) {
  authSession = {
    access_token: null,
    refresh_token: null,
    user_id: null,
    expires_at: null,
  };
  itemsCache.data = null;

  if (res) {
    try {
      const isProd = Boolean(process.env.VERCEL);
      res.setHeader(
        'Set-Cookie',
        `meli_session=; Path=/; Max-Age=0; SameSite=Lax${isProd ? '; Secure' : ''}`
      );
    } catch {
      // Ignora falha ao limpar header
    }
  }

  fs.unlink(TOKEN_STORE_PATH).catch(() => {});
}

function hydrateSessionFromCookie(req) {
  try {
    const cookies = parseCookies(req);
    if (cookies.meli_session) {
      const decoded = JSON.parse(
        Buffer.from(cookies.meli_session, 'base64url').toString('utf-8')
      );
      if (decoded && decoded.access_token) {
        authSession = { ...authSession, ...decoded };
        return true;
      }
    }
  } catch {
    // Cookie inválido ou ausente
  }
  return false;
}

let demoItems = [
  {
    id: 'MLB3948102938',
    title: 'Kit 50 Caixas Presente Floral 25x25cm Pacific Flowers',
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
    title: 'Kit 5 Bobinas Papel Seda Botânico 60cm Pacific Flowers',
    price: 119.9,
    product_cost: 38.0,
    available_quantity: 32,
    status: 'active',
    currency_id: 'BRL',
    thumbnail: 'https://http2.mlstatic.com/D_NQ_NP_2X_847192-MLA75123981234_032024-F.webp',
    permalink: 'https://produto.mercadolivre.com.br/MLB-4019283741',
  },
];

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
    item_id: 'MLB3948102938',
    name: 'Kit 50 Caixas Presente Floral 25x25cm Pacific Flowers',
    thumbnail: 'https://http2.mlstatic.com/D_NQ_NP_2X_601411-MLA74651415532_022024-F.webp',
    status: 'paused',
    budget: 45.0,
    kit_price: 69.9,
    ads_revenue_30d: 3120.0,
    ads_spend_30d: 686.4,
    acos: 22.0,
  },
];

const itemsCache = {
  data: null,
  timestamp: 0,
  ttlMs: 20_000,
};

// ============================================================================
// Pilar 2: Motor Matemático — Simulador de Margem e Gatilho R$ 79,00 (16% B2B)
// ============================================================================
export function calculatePricingMetrics(price, productCost = 0) {
  const safePrice = Number(price) || 0;
  const safeCost = Number(productCost) || 0;
  const isFreeShippingTriggered = safePrice >= 79;

  // Regra oficial: Se Preço >= 79, taxa fixa (R$ 6) é zerada e frete vendedor (R$ 21) é aplicado.
  // Se Preço < 79, comissão 16% + R$ 6,00 de taxa fixa e frete vendedor R$ 0,00.
  const fixedFee = isFreeShippingTriggered ? 0.0 : 6.0;
  const mlCommission = safePrice * 0.16 + fixedFee;
  const sellerShippingCost = isFreeShippingTriggered ? 21.0 : 0.0;

  const netProfit = safePrice - safeCost - mlCommission - sellerShippingCost;
  const marginPercent = safePrice > 0 ? (netProfit / safePrice) * 100 : 0;

  return {
    product_cost: Number(safeCost.toFixed(2)),
    fixed_fee: Number(fixedFee.toFixed(2)),
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
      : productCostsMap[item.id] ?? 0;
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
  if (meResponse.status === 401) {
    const err = new Error('Sessão do Mercado Livre expirada (401 em /users/me).');
    err.code = 'TOKEN_EXPIRED';
    err.status = 401;
    throw err;
  }
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

async function saveTokens(sessionData, res = null) {
  authSession = {
    access_token: sessionData.access_token,
    refresh_token: sessionData.refresh_token || authSession.refresh_token,
    user_id: sessionData.user_id || authSession.user_id,
    expires_at: sessionData.expires_in
      ? Date.now() + sessionData.expires_in * 1000
      : authSession.expires_at,
  };
  itemsCache.data = null;

  if (res) {
    setSessionCookie(res, authSession);
  }

  try {
    await fs.writeFile(TOKEN_STORE_PATH, JSON.stringify(authSession, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[Auth] Não foi possível persistir token em disco:', err.message);
  }
}

async function refreshAccessToken(res = null) {
  if (!authSession.refresh_token) return null;
  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: DEFAULT_APP_ID,
      client_secret: DEFAULT_SECRET_KEY,
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
      await saveTokens(tokenData, res);
      return authSession.access_token;
    }
  } catch (err) {
    console.warn('[Auth] Falha ao tentar refresh_token:', err.message);
  }
  return null;
}

async function ensureValidAccessToken(req, res) {
  const hadCookie = hydrateSessionFromCookie(req);

  if (!authSession.access_token) {
    await loadSavedState();
  }

  const clientExpectedAuth =
    req?.headers?.['x-meli-authenticated'] === 'true' ||
    req?.query?.require_auth === 'true' ||
    hadCookie;

  if (!authSession.access_token) {
    if (req?.headers?.['x-meli-authenticated'] === 'true') {
      const err = new Error('Sessão do Mercado Livre expirada.');
      err.code = 'TOKEN_EXPIRED';
      err.status = 401;
      throw err;
    }
    return null;
  }

  // Verifica se o token expirou
  if (authSession.expires_at && Date.now() > authSession.expires_at - 60_000) {
    const refreshed = await refreshAccessToken(res);
    if (!refreshed) {
      clearExpiredSession(res);
      if (clientExpectedAuth) {
        const err = new Error('Seu access_token do Mercado Livre expirou.');
        err.code = 'TOKEN_EXPIRED';
        err.status = 401;
        throw err;
      }
      return null;
    }
  }

  return authSession.access_token;
}

function sendTokenExpiredResponse(req, res, message) {
  clearExpiredSession(res);
  return res.status(401).json({
    error: 'token_expired',
    token_expired: true,
    auth_url: getMeliAuthUrl(req),
    message:
      message ||
      'Sua sessão do Mercado Livre expirou. Redirecionando para a tela de login...',
  });
}

// ============================================================================
// Execução Real da Atualização de Anúncio (Exclusiva para o botão Salvar no Modal)
// ============================================================================
async function executeMeliItemUpdate(itemId, updateFields, token, res = null) {
  if (!token) {
    const idx = demoItems.findIndex((item) => item.id === itemId);
    if (idx !== -1) {
      demoItems[idx] = { ...demoItems[idx], ...updateFields };
      return {
        source: 'demo',
        success: true,
        item: enrichItemWithMetrics(demoItems[idx]),
      };
    }
    return {
      source: 'demo',
      success: true,
      item: enrichItemWithMetrics({ id: itemId, ...updateFields }),
    };
  }

  let activeToken = token;
  let mlResponse = await fetch(`${ML_API_BASE}/items/${encodeURIComponent(itemId)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${activeToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(updateFields),
  });

  if (mlResponse.status === 401) {
    const refreshed = await refreshAccessToken(res);
    if (!refreshed) {
      const err = new Error('Token do Mercado Livre expirado ao salvar anúncio.');
      err.code = 'TOKEN_EXPIRED';
      err.status = 401;
      throw err;
    }
    activeToken = refreshed;
    mlResponse = await fetch(`${ML_API_BASE}/items/${encodeURIComponent(itemId)}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${activeToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(updateFields),
    });
  }

  const mlData = await mlResponse.json().catch(() => ({}));
  if (!mlResponse.ok) {
    return {
      source: 'live',
      success: false,
      status: mlResponse.status,
      error: mlData.message || 'Falha ao atualizar item na API do Mercado Livre.',
      details: mlData,
    };
  }

  const updated = enrichItemWithMetrics({
    id: mlData.id,
    title: mlData.title,
    price: mlData.price,
    available_quantity: mlData.available_quantity,
    status: mlData.status,
    currency_id: mlData.currency_id || 'BRL',
    thumbnail: mlData.secure_thumbnail || mlData.thumbnail,
    permalink: mlData.permalink,
  });

  if (itemsCache.data) {
    itemsCache.data = itemsCache.data.map((item) =>
      item.id === itemId ? { ...item, ...updated } : item
    );
  }

  return {
    source: 'live',
    success: true,
    item: updated,
  };
}

// ============================================================================
// Pilar 4: Trava Absoluta Human-in-the-Loop nas Tools da IA (Sem HTTP PUT direto)
// ============================================================================
export const HUMAN_IN_THE_LOOP_MESSAGE =
  'Preparei a atualização do anúncio. Verifique os dados na tela e clique em Salvar para enviar ao Mercado Livre.';

function createMeliToolExecutors() {
  return {
    // NUNCA realiza fetch/PUT para o Mercado Livre! Devolve apenas o JSON para abrir o Modal de Edição.
    atualizar_preco_anuncio: async ({ item_id, price }) => {
      const numericPrice = Number(price);
      if (Number.isNaN(numericPrice) || numericPrice <= 0) {
        return { error: 'Preço inválido.' };
      }
      const normalizedId = String(item_id || 'MLB3948102938')
        .toUpperCase()
        .replace('-', '');
      const metrics = calculatePricingMetrics(numericPrice, productCostsMap[normalizedId] || 0);
      return {
        success: true,
        human_in_the_loop: true,
        direct_api_call_blocked: true,
        status: 'pending_human_approval',
        item_id: normalizedId,
        proposed_fields: {
          price: Number(numericPrice.toFixed(2)),
        },
        pricing_analysis: metrics,
        below_79_warning:
          numericPrice < 79
            ? 'Atenção: Preço abaixo de R$ 79,00 sofre taxa fixa adicional de R$ 6,00 por unidade.'
            : null,
        message: HUMAN_IN_THE_LOOP_MESSAGE,
      };
    },

    atualizar_estoque: async ({ item_id, available_quantity }) => {
      const qty = Math.floor(Number(available_quantity));
      if (Number.isNaN(qty) || qty < 0) {
        return { error: 'Quantidade de estoque inválida.' };
      }
      const normalizedId = String(item_id || 'MLB3948102938')
        .toUpperCase()
        .replace('-', '');
      return {
        success: true,
        human_in_the_loop: true,
        direct_api_call_blocked: true,
        status: 'pending_human_approval',
        item_id: normalizedId,
        proposed_fields: {
          available_quantity: qty,
        },
        message: HUMAN_IN_THE_LOOP_MESSAGE,
      };
    },

    otimizar_titulo_b2b: async ({ item_id, title }) => {
      const audit = validateTitleCompliance(title);
      if (!audit.valid) {
        return {
          success: false,
          compliance_rejected: true,
          violations: audit.violations,
          suggested_title: audit.suggested_title,
          message:
            'Ação bloqueada pelo Auditor de Conformidade do Mercado Livre. Explique a regra violada ao usuário e sugira o título corrigido.',
        };
      }
      const normalizedId = String(item_id || 'MLB3948102938')
        .toUpperCase()
        .replace('-', '');
      return {
        success: true,
        human_in_the_loop: true,
        direct_api_call_blocked: true,
        status: 'pending_human_approval',
        item_id: normalizedId,
        proposed_fields: {
          title: String(title).trim(),
        },
        audit,
        message: HUMAN_IN_THE_LOOP_MESSAGE,
      };
    },
  };
}

// ============================================================================
// 5. Rota POST /api/chat — Copiloto B2B Pacific Flowers (Human-in-the-Loop)
// ============================================================================
app.get('/api/chat/config', (req, res) => {
  res.json({
    system_prompt: COPILOT_SYSTEM_PROMPT,
    tools: COPILOT_TOOLS.map((t) => t.name),
    human_in_the_loop: true,
    direct_ml_put_disabled_in_chat: true,
    gemini_configured: Boolean(process.env.GEMINI_API_KEY),
  });
});

app.post('/api/chat', async (req, res) => {
  const { message, previous_interaction_id, gemini_api_key } = req.body || {};

  if (!message || !String(message).trim()) {
    return res.status(400).json({
      error: 'missing_message',
      message: 'Envie uma mensagem no campo "message".',
    });
  }

  const toolExecutors = createMeliToolExecutors();
  const resolvedApiKey = (gemini_api_key || process.env.GEMINI_API_KEY || '').trim();

  if (resolvedApiKey) {
    try {
      const ai = new GoogleGenAI({ apiKey: resolvedApiKey });
      let currentInput = String(message);
      let currentPreviousId = previous_interaction_id || undefined;
      let interaction;
      const executedTools = [];
      let pendingApproval = null;

      while (true) {
        interaction = await ai.interactions.create({
          model: 'gemini-3.8-flash',
          system_instruction: COPILOT_SYSTEM_PROMPT,
          input: currentInput,
          tools: COPILOT_TOOLS,
          previous_interaction_id: currentPreviousId,
        });

        const functionResults = [];
        for (const step of interaction.steps || []) {
          if (step.type === 'function_call') {
            const fn = toolExecutors[step.name];
            const result = fn
              ? await fn(step.arguments || {})
              : { error: `Tool "${step.name}" não encontrada.` };

            executedTools.push({
              name: step.name,
              arguments: step.arguments,
              result,
            });

            if (result && result.human_in_the_loop && result.proposed_fields) {
              pendingApproval = {
                item_id: result.item_id,
                tool_name: step.name,
                ...(pendingApproval?.proposed_fields || {}),
                ...result.proposed_fields,
                proposed_fields: {
                  ...(pendingApproval?.proposed_fields || {}),
                  ...result.proposed_fields,
                },
              };
            }

            functionResults.push({
              type: 'function_result',
              name: step.name,
              call_id: step.id,
              result: [{ type: 'text', text: JSON.stringify(result) }],
            });
          }
        }

        if (functionResults.length === 0) {
          break;
        }

        currentInput = functionResults;
        currentPreviousId = interaction.id;
      }

      return res.json({
        reply: pendingApproval
          ? HUMAN_IN_THE_LOOP_MESSAGE
          : interaction.output_text || 'Auditoria concluída.',
        interaction_id: interaction.id,
        executed_tools: executedTools,
        pending_approval: pendingApproval,
        system_prompt_active: true,
      });
    } catch (error) {
      return res.status(500).json({
        error: 'gemini_chat_error',
        message: error.message || 'Erro ao processar mensagem no Copiloto Gemini.',
      });
    }
  }

  // ==========================================================================
  // Motor Local de Auditoria & Function Calling (Human-in-the-Loop)
  // ==========================================================================
  const text = String(message).trim();
  const mlbMatch = text.match(/\b(MLB[-_]?\d+)\b/i);
  const itemId = mlbMatch ? mlbMatch[1].toUpperCase().replace('-', '') : 'MLB3948102938';
  const executedTools = [];
  const combinedProposedFields = {};

  // 1) Verifica se há violação de HTML na descrição
  if (/<[a-z][\s\S]*>/i.test(text)) {
    return res.json({
      reply:
        'Recuso gentilmente esta descrição: pelas **Regras de Descrição do Mercado Livre**, é terminantemente proibido o uso de **código HTML**. Utilize apenas texto puro estruturado com medidas exatas, material, formato e aplicação (ex: Gramatura 90g, Poliestireno UV).',
      executed_tools: [],
      pending_approval: null,
      system_prompt_active: true,
    });
  }

  // 2) Verifica se o usuário pediu otimização/alteração de título
  const titleQuoteMatch = text.match(/["'“”]([^"'“”]{5,120})["'“”]/);
  if (/t[ií]tulo|otimiz|renome/i.test(text) && titleQuoteMatch) {
    const candidateTitle = titleQuoteMatch[1];
    const audit = validateTitleCompliance(candidateTitle);

    if (!audit.valid) {
      return res.json({
        reply: `Recuso gentilmente a alteração solicitada pois ela viola as **Regras de Título (SEO e Conformidade)** do Mercado Livre:\n\n- ${audit.violations.join(
          '\n- '
        )}\n\n✅ **Sugestão Corrigida (${
          audit.suggested_title.length
        }/60 caracteres, Foco B2B):**\n\`${audit.suggested_title}\``,
        executed_tools: [],
        pending_approval: null,
        system_prompt_active: true,
      });
    }

    const toolResult = await toolExecutors.otimizar_titulo_b2b({
      item_id: itemId,
      title: candidateTitle,
    });
    executedTools.push({
      name: 'otimizar_titulo_b2b',
      arguments: { item_id: itemId, title: candidateTitle },
      result: toolResult,
    });
    combinedProposedFields.title = candidateTitle;
  }

  // 3) Verifica comando de atualização de preço (Human-in-the-Loop)
  const priceMatch = text.match(
    /R\$\s*(\d+(?:[.,]\d{1,2})?)|pre[cç]o\s+(?:para\s+)?(\d+(?:[.,]\d{1,2})?)/i
  );
  if (/pre[cç]o|valor|atualiz/i.test(text) && priceMatch) {
    const rawNum = (priceMatch[1] || priceMatch[2]).replace(',', '.');
    const newPrice = Number(rawNum);
    const toolResult = await toolExecutors.atualizar_preco_anuncio({
      item_id: itemId,
      price: newPrice,
    });
    executedTools.push({
      name: 'atualizar_preco_anuncio',
      arguments: { item_id: itemId, price: newPrice },
      result: toolResult,
    });
    combinedProposedFields.price = Number(newPrice.toFixed(2));
  }

  // 4) Verifica comando de atualização de estoque (Human-in-the-Loop)
  const stockMatch = text.match(/estoque\s+(?:para\s+)?(\d+)|(\d+)\s*unidades/i);
  if (/estoque|quantidade|unidades/i.test(text) && stockMatch) {
    const newQty = Number(stockMatch[1] || stockMatch[2]);
    const toolResult = await toolExecutors.atualizar_estoque({
      item_id: itemId,
      available_quantity: newQty,
    });
    executedTools.push({
      name: 'atualizar_estoque',
      arguments: { item_id: itemId, available_quantity: newQty },
      result: toolResult,
    });
    combinedProposedFields.available_quantity = newQty;
  }

  if (Object.keys(combinedProposedFields).length > 0) {
    return res.json({
      reply: HUMAN_IN_THE_LOOP_MESSAGE,
      executed_tools: executedTools,
      pending_approval: {
        item_id: itemId,
        tool_name: executedTools.map((t) => t.name).join('+'),
        ...combinedProposedFields,
        proposed_fields: combinedProposedFields,
      },
      system_prompt_active: true,
    });
  }

  return res.json({
    reply: `Sou o **Copiloto de Vendas B2B da Pacific Flowers** e Auditor de Conformidade do Mercado Livre (Modo **Human-in-the-Loop** ativo).\n\nSempre que você solicitar uma alteração de **Título**, **Preço** ou **Estoque**, irei validar as regras do Mercado Livre e abrir automaticamente o **Modal de Edição** preenchido com os novos dados para sua revisão final antes do envio ao Mercado Livre.`,
    executed_tools: [],
    pending_approval: null,
    system_prompt_active: true,
  });
});

// ============================================================================
// Pilar 1: Troca do Código OAuth 2.0 com try/catch robusto e PKCE
// ============================================================================
async function exchangeCodeForToken(code, req, res) {
  try {
    const { codeVerifier } = getPkcePair();
    const redirectUri = getRedirectUri(req);

    const payloadWithPkce = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: DEFAULT_APP_ID,
      client_secret: DEFAULT_SECRET_KEY,
      code: String(code).trim(),
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });

    const response = await fetch(`${ML_API_BASE}/oauth/token`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: payloadWithPkce,
    });

    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {
        message: 'A API do Mercado Livre retornou uma resposta inválida ao gerar o token.',
      };
    }

    if (!response.ok) {
      const error = new Error(
        data.message ||
          data.error_description ||
          'Não foi possível obter o token de acesso do Mercado Livre. Tente autenticar novamente.'
      );
      error.status = response.status || 400;
      error.details = data;
      throw error;
    }

    await saveTokens(data, res);
    return data;
  } catch (err) {
    const friendlyError = new Error(
      err.message ||
        'Falha de comunicação com o servidor OAuth 2.0 do Mercado Livre. Por favor, tente novamente.'
    );
    friendlyError.status = err.status || 500;
    friendlyError.details = err.details || null;
    throw friendlyError;
  }
}

// ============================================================================
// 1. OAuth 2.0 Endpoints (Authorization URL com PKCE, Status & Callback c/ try/catch)
// ============================================================================
app.get('/api/auth/status', async (req, res) => {
  try {
    await ensureValidAccessToken(req, res);
  } catch {
    // Se expirou, apenas reporta authenticated: false no status check inicial
  }

  const redirectUri = getRedirectUri(req);
  const authUrl = getMeliAuthUrl(req);

  res.json({
    authenticated: Boolean(authSession.access_token),
    user_id: authSession.user_id,
    expires_at: authSession.expires_at,
    app_id: DEFAULT_APP_ID,
    redirect_uri: redirectUri,
    auth_url: authUrl,
  });
});

app.get('/api/auth/login', (req, res) => {
  const authUrl = getMeliAuthUrl(req);
  return res.redirect(authUrl);
});

const handleOAuthCallback = async (req, res) => {
  const isBrowserNavigation =
    req.method === 'GET' &&
    req.headers.accept &&
    req.headers.accept.includes('text/html');
  const frontendUrl = getFrontendBaseUrl(req);

  try {
    const mlError = req.query.error || req.body?.error;
    const mlErrorDesc = req.query.error_description || req.body?.error_description;

    if (mlError) {
      const friendlyMsg =
        mlErrorDesc ||
        `O Mercado Livre recusou ou cancelou a autorização (${mlError}). Clique em "Conectar OAuth 2.0" para tentar novamente.`;
      if (isBrowserNavigation) {
        return res.redirect(
          `${frontendUrl}/?auth=error&auth_message=${encodeURIComponent(friendlyMsg)}`
        );
      }
      return res.status(400).json({
        error: 'oauth_provider_error',
        message: friendlyMsg,
        auth_url: getMeliAuthUrl(req),
      });
    }

    const code = req.query.code || req.body?.code;

    if (!code) {
      const missingCodeMsg =
        'Código de autorização (code) não recebido do Mercado Livre. Inicie a conexão novamente pelo botão Conectar OAuth 2.0.';
      if (isBrowserNavigation) {
        return res.redirect(
          `${frontendUrl}/?auth=error&auth_message=${encodeURIComponent(missingCodeMsg)}`
        );
      }
      return res.status(400).json({
        error: 'missing_code',
        message: missingCodeMsg,
        auth_url: getMeliAuthUrl(req),
      });
    }

    const tokenData = await exchangeCodeForToken(code, req, res);

    if (isBrowserNavigation) {
      return res.redirect(
        `${frontendUrl}/?auth=success&user_id=${encodeURIComponent(tokenData.user_id || '')}`
      );
    }

    return res.status(200).json({
      message: 'Autenticação OAuth 2.0 concluída com sucesso!',
      user_id: tokenData.user_id,
      expires_in: tokenData.expires_in,
      scope: tokenData.scope,
      redirect_uri: getRedirectUri(req),
    });
  } catch (error) {
    const friendlyMessage =
      error.message ||
      'A API do Mercado Livre falhou ao entregar o token de acesso. Verifique sua conexão e tente autenticar novamente.';

    // Evita tela branca no navegador: redireciona de forma segura para a interface React exibir o alerta amigável
    if (isBrowserNavigation) {
      return res.redirect(
        `${frontendUrl}/?auth=error&auth_message=${encodeURIComponent(friendlyMessage)}`
      );
    }

    return res.status(error.status || 500).json({
      error: 'oauth_exchange_failed',
      message: friendlyMessage,
      details: error.details || null,
      auth_url: getMeliAuthUrl(req),
    });
  }
};

app.get('/callback', handleOAuthCallback);
app.get('/api/auth/callback', handleOAuthCallback);
app.post('/api/auth/callback', handleOAuthCallback);

// ============================================================================
// 2. Rota GET para extrair TODOS os anúncios da conta (Paginação Completa + Multiget)
// ============================================================================
async function fetchAllSellerItemIds(userId, token) {
  const allIds = [];
  let scrollId = null;
  const limit = 100;

  const firstUrl = `${ML_API_BASE}/users/${userId}/items/search?search_type=scan&limit=${limit}`;
  const firstRes = await fetch(firstUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (firstRes.status === 401) {
    const err = new Error('Sessão do Mercado Livre expirada ao buscar anúncios.');
    err.code = 'TOKEN_EXPIRED';
    err.status = 401;
    throw err;
  }

  const firstData = await firstRes.json();

  if (!firstRes.ok) {
    throw new Error(
      firstData.message || 'Erro ao buscar IDs de anúncios na conta do Mercado Livre.'
    );
  }

  const totalExpected = firstData.paging?.total || 0;
  if (Array.isArray(firstData.results)) {
    allIds.push(...firstData.results);
  }
  scrollId = firstData.scroll_id;

  while (scrollId && allIds.length < totalExpected && allIds.length < 2000) {
    const nextUrl = `${ML_API_BASE}/users/${userId}/items/search?search_type=scan&scroll_id=${encodeURIComponent(
      scrollId
    )}&limit=${limit}`;
    const nextRes = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!nextRes.ok) break;
    const nextData = await nextRes.json();
    if (!Array.isArray(nextData.results) || nextData.results.length === 0) {
      break;
    }
    allIds.push(...nextData.results);
    scrollId = nextData.scroll_id;
  }

  return { allIds, totalExpected: totalExpected || allIds.length };
}

app.get('/api/items', async (req, res) => {
  const forceRefresh = req.query.refresh === 'true';
  const mode = req.query.mode;

  try {
    const token = await ensureValidAccessToken(req, res);

    if (!token || mode === 'demo') {
      const enrichedDemo = demoItems.map(enrichItemWithMetrics);
      return res.status(200).json({
        source: 'demo',
        user_id: 'PACIFIC_FLOWERS_DEMO',
        total: enrichedDemo.length,
        items: enrichedDemo,
      });
    }

    if (!forceRefresh && itemsCache.data && Date.now() - itemsCache.timestamp < itemsCache.ttlMs) {
      return res.status(200).json({
        source: 'cache',
        user_id: authSession.user_id,
        total: itemsCache.data.length,
        items: itemsCache.data.map(enrichItemWithMetrics),
      });
    }

    const userId = await resolveUserId(token);
    const { allIds: itemIds, totalExpected } = await fetchAllSellerItemIds(userId, token);

    if (itemIds.length === 0) {
      itemsCache.data = [];
      itemsCache.timestamp = Date.now();
      return res.status(200).json({
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
        if (resBatch.status === 401) {
          const err = new Error('Token expirado durante o Multiget.');
          err.code = 'TOKEN_EXPIRED';
          err.status = 401;
          throw err;
        }
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

    return res.status(200).json({
      source: 'live',
      user_id: userId,
      total: totalExpected,
      items,
    });
  } catch (error) {
    if (error.code === 'TOKEN_EXPIRED' || error.status === 401) {
      return sendTokenExpiredResponse(req, res, error.message);
    }
    return res.status(500).json({
      error: 'internal_error',
      message: error.message || 'Erro interno ao listar anúncios.',
    });
  }
});

// ============================================================================
// 3. Rota PUT para atualizar Preço, Estoque, Título e Custo do Produto
// ============================================================================
app.put('/api/items/:id', async (req, res) => {
  const { id } = req.params;
  const { price, available_quantity, product_cost, title } = req.body || {};

  const parsedPrice = price !== undefined ? Number(price) : undefined;
  const parsedQuantity = available_quantity !== undefined ? Number(available_quantity) : undefined;
  const parsedCost = product_cost !== undefined ? Number(product_cost) : undefined;

  if (title !== undefined) {
    const titleAudit = validateTitleCompliance(title);
    if (!titleAudit.valid) {
      return res.status(400).json({
        error: 'title_policy_violation',
        message: titleAudit.violations.join(' '),
        suggested_title: titleAudit.suggested_title,
      });
    }
  }

  const updatePayload = {};
  if (parsedPrice !== undefined && !Number.isNaN(parsedPrice) && parsedPrice > 0) {
    updatePayload.price = Number(parsedPrice.toFixed(2));
  }
  if (parsedQuantity !== undefined && !Number.isNaN(parsedQuantity) && parsedQuantity >= 0) {
    updatePayload.available_quantity = Math.floor(parsedQuantity);
  }
  if (title !== undefined) {
    updatePayload.title = String(title).trim();
  }

  if (parsedCost !== undefined && !Number.isNaN(parsedCost) && parsedCost >= 0) {
    await saveProductCost(id, parsedCost);
  }

  try {
    const token = await ensureValidAccessToken(req, res);
    const result = await executeMeliItemUpdate(id, updatePayload, token, res);
    if (!result.success) {
      return res.status(result.status || 400).json({
        error: 'ml_update_failed',
        message: result.error,
        details: result.details,
      });
    }

    return res.status(200).json({
      source: result.source,
      message: 'Anúncio atualizado com sucesso!',
      item: result.item,
    });
  } catch (error) {
    if (error.code === 'TOKEN_EXPIRED' || error.status === 401) {
      return sendTokenExpiredResponse(req, res, error.message);
    }
    return res.status(500).json({
      error: 'update_exception',
      message: error.message || 'Erro interno ao atualizar anúncio.',
    });
  }
});

// ============================================================================
// 4. Módulo Mercado Ads (Advertising API do Mercado Livre) — Pilar 3 & 5
// ============================================================================
app.get('/api/ads/campaigns', async (req, res) => {
  const mode = req.query.mode;

  try {
    const token = await ensureValidAccessToken(req, res);

    if (!token || mode === 'demo') {
      return res.status(200).json({
        source: 'demo',
        campaigns: demoAdsCampaigns.map((c) => ({
          ...c,
          is_b2b_kit: Number(c.kit_price) > 79,
        })),
      });
    }

    const userId = await resolveUserId(token);
    const { date_from, date_to } = getLast30DaysRange();

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

    if (mlResponse.status === 401) {
      const refreshed = await refreshAccessToken(res);
      if (!refreshed) {
        return sendTokenExpiredResponse(req, res);
      }
    }

    const mlData = await mlResponse.json().catch(() => ({}));
    if (!mlResponse.ok) {
      return res.status(200).json({
        source: 'live',
        user_id: userId,
        campaigns: [],
        warning:
          mlData.message || 'Conta sem campanhas ativas ou Product Ads v2 não habilitado.',
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

    return res.status(200).json({
      source: 'live',
      user_id: userId,
      campaigns,
    });
  } catch (error) {
    if (error.code === 'TOKEN_EXPIRED' || error.status === 401) {
      return sendTokenExpiredResponse(req, res, error.message);
    }
    return res.status(500).json({
      error: 'ads_campaigns_exception',
      message: error.message || 'Erro interno ao buscar campanhas do Mercado Ads.',
    });
  }
});

app.get('/api/ads/metrics', async (req, res) => {
  const mode = req.query.mode;
  const { date_from, date_to } = getLast30DaysRange();

  try {
    const token = await ensureValidAccessToken(req, res);

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

      return res.status(200).json({
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

    if (mlResponse.status === 401) {
      const refreshed = await refreshAccessToken(res);
      if (!refreshed) {
        return sendTokenExpiredResponse(req, res);
      }
    }

    const mlData = await mlResponse.json().catch(() => ({}));
    if (!mlResponse.ok) {
      return res.status(200).json({
        source: 'live',
        period: { date_from, date_to, days: 30 },
        summary: { total_revenue_30d: 0, total_spend_30d: 0, average_acos: 0 },
        metrics_by_campaign: {},
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

    return res.status(200).json({
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
    if (error.code === 'TOKEN_EXPIRED' || error.status === 401) {
      return sendTokenExpiredResponse(req, res, error.message);
    }
    return res.status(500).json({
      error: 'ads_metrics_exception',
      message: error.message || 'Erro interno ao buscar métricas de 30 dias.',
    });
  }
});

app.put('/api/ads/campaigns/:id', async (req, res) => {
  const { id } = req.params;
  const { status, budget } = req.body || {};

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
    const token = await ensureValidAccessToken(req, res);

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

      return res.status(200).json({
        source: 'demo',
        message: `Campanha ${id} atualizada com sucesso!`,
        campaign: {
          ...demoAdsCampaigns[idx],
          is_b2b_kit: Number(demoAdsCampaigns[idx].kit_price) > 79,
        },
      });
    }

    let activeToken = token;
    let mlResponse = await fetch(
      `${ML_API_BASE}/advertising/product_ads/campaigns/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${activeToken}`,
          'api-version': '2',
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(updatePayload),
      }
    );

    if (mlResponse.status === 401) {
      const refreshed = await refreshAccessToken(res);
      if (!refreshed) {
        return sendTokenExpiredResponse(req, res);
      }
      activeToken = refreshed;
      mlResponse = await fetch(
        `${ML_API_BASE}/advertising/product_ads/campaigns/${encodeURIComponent(id)}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${activeToken}`,
            'api-version': '2',
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(updatePayload),
        }
      );
    }

    const mlData = await mlResponse.json().catch(() => ({}));
    if (!mlResponse.ok) {
      return res.status(mlResponse.status || 400).json({
        error: 'ml_ads_update_failed',
        message:
          mlData.message || 'Falha ao atualizar campanha na Advertising API do Mercado Livre.',
        details: mlData,
      });
    }

    return res.status(200).json({
      source: 'live',
      message: `Campanha ${id} atualizada no Mercado Ads com sucesso!`,
      campaign: {
        id: String(mlData.id || id),
        status: mlData.status || updatePayload.status,
        budget: Number(mlData.budget ?? updatePayload.budget),
      },
    });
  } catch (error) {
    if (error.code === 'TOKEN_EXPIRED' || error.status === 401) {
      return sendTokenExpiredResponse(req, res, error.message);
    }
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
  });
}

export default app;
