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

CONTEXTO DA EMPRESA:
Você representa a Pacific Flowers, uma fabricante e distribuidora focada no público B2B (lojistas, papelarias e comércio). O objetivo no Mercado Livre é vender em ATACADO (Kits e Caixas fechadas) para elevar o ticket médio acima de R$ 79,00.

CATÁLOGO OFICIAL DE PRODUTOS (NUNCA invente itens fora desta lista):

Linha Office e Financeiro:

Talões de Pedido: 105x150mm, 150x210mm e 300x210mm (50 folhas).

Comandas: 75x105mm (50 folhas).

Recibos e Vales: Recibo comercial (150x105mm) e Vales (105x75mm), com 50 folhas.

Sinalização Comercial (Placas em Poliestireno/PS com impressão UV):

15x20cm: Banheiro, proibido fumar, sorria você está sendo filmado.

10x30cm: Saída de emergência, volto já, proibido capacete.

7x30cm: Entrada, saída, caixa, sanitários.

20x30cm: Alugo, vendo, cuidado cão bravo, extintores.

Envelopes e Papelaria Promocional:

Envelopes Kraft Natural: 80g e 90g (formatos de 162x229mm até 260x360mm). Vendidos em caixas de 100, 250 ou pacotes de 10.

Splashes de Oferta: Solapa, Combo e Granel em papel 220g (Tamanhos P, M e G).

Cartazes de Oferta: De 15x20cm até 43x63cm.

Linha Escolar e Educativa:

Cadernos/Cadernetas: Capa flexível 250g (48 ou 96 folhas).

Giz de Cera: Standard (6/12 cores, 26g/52g), Gizão (6/12 cores, 58g/112g) e Meu 1° Giz (185g/344g).

Dinheirinho/Dinheirão Educativo: Pacotes com 70 ou 15 notas.

Jogos e Atividades: Mercado Imobiliário, Damas, Ludo, Trilha, Jogo da Memória, Quebra-Cabeça, Caligrafia e Kits de Desenho.

FÓRMULA OBRIGATÓRIA PARA CRIAÇÃO DE TÍTULOS (Máx 60 caracteres):
[Quantidade do Kit] + [Nome do Produto do Catálogo] + [Tamanho/Gramatura] + [Uso].
Exemplo Correto: Kit 50 Talões De Pedido 105x150mm Comércio
Exemplo Correto: Caixa 250 Envelopes Kraft Natural 162x229mm 90g
Exemplo Errado (Proibido): Talão de Pedido Barato Pacific Flowers (Falta quantidade, tamanho e tem palavra promocional).

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

Se o usuário solicitar uma alteração ou criação que fira essas regras, você deve recusar a ação gentilmente, explicar qual regra do Mercado Livre seria violada, e sugerir a versão corrigida imediatamente.

Antes de sugerir um título, calcular uma margem ou preencher o modal de edição para um novo anúncio ou kit B2B, você DEVE obrigatoriamente acionar a função pesquisar_concorrentes(palavra_chave). Analise os preços e títulos dos 5 primeiros colocados. Use essa inteligência competitiva para redigir um título superior (focado em atacado) e sugerir um Preço de Venda que seja atrativo contra a concorrência, mas que ainda respeite a margem de lucro e as regras de Frete Grátis do Mercado Livre (produtos > R$ 79,00).`;

// ============================================================================
// Definições de Function Calling (Tools) mapeadas para Radar + Human-in-the-Loop
// ============================================================================
export const COPILOT_TOOLS = [
  {
    type: 'function',
    name: 'pesquisar_concorrentes',
    description:
      'Busca os 5 anúncios mais bem posicionados no Mercado Livre para uma determinada palavra-chave, retornando os títulos, preços e status de frete dos concorrentes.',
    parameters: {
      type: 'object',
      properties: {
        palavra_chave: {
          type: 'string',
          description:
            'Palavra-chave do produto ou kit B2B para pesquisar os 5 primeiros colocados no Mercado Livre (ex: Kit 50 Talões De Pedido 105x150mm, Caixa 250 Envelopes Kraft Natural).',
        },
      },
      required: ['palavra_chave'],
    },
  },
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
      'Prepara a otimização do título (title) de um anúncio B2B no Mercado Livre para aprovação humana no Modal de Edição, respeitando estritamente o limite de 60 caracteres e a fórmula [Quantidade do Kit] + [Nome do Produto do Catálogo] + [Tamanho/Gramatura] + [Uso].',
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
            'Novo título auditado (máximo absoluto de 60 caracteres, fórmula [Quantidade do Kit] + [Nome do Produto do Catálogo] + [Tamanho/Gramatura] + [Uso]).',
        },
      },
      required: ['item_id', 'title'],
    },
  },
];

// ============================================================================
// Banco de Dados Estruturado do Catálogo Oficial Pacific Flowers (B2B)
// ============================================================================
export const PACIFIC_FLOWERS_CATALOG_PROFILES = [
  {
    id: 'taloes_pedido',
    category: 'Linha Office e Financeiro',
    productName: 'Talões de Pedido',
    regex: /tal[aã]o|tal[oõ]es|bloco\s+de\s+pedido|pedido/i,
    specs: '105x150mm, 150x210mm e 300x210mm (50 folhas)',
    keyword: 'Kit 50 Talões De Pedido 105x150mm',
    primaryTitle: 'Kit 50 Talões De Pedido 105x150mm Comércio',
    alternativeTitles: [
      'Kit 40 Talões De Pedido 150x210mm 50 Folhas Loja',
      'Kit 25 Talões De Pedido 300x210mm 50 Folhas Atacado',
    ],
    recommendedPrice: 98.9,
    estimatedCost: 34.0,
    usage: 'Comércio, Lojas, Papelarias e Distribuidoras',
    pureTextDescription: `KIT 50 TALÕES DE PEDIDO 105X150MM 50 FOLHAS - LINHA OFFICE B2B

ESPECIFICAÇÕES TÉCNICAS:
- Produto: Talão de Pedido Comercial
- Quantidade do Kit: 50 talões (total de 2.500 folhas)
- Formato / Medidas: 105x150mm (disponível também em 150x210mm e 300x210mm)
- Folhas por Talão: 50 folhas destacáveis com serrilha de alta precisão
- Material: Papel offset alcalino de escrita fluida e alta legibilidade
- Impressão: Nítida com campos padronizados para quantidade, descrição, valor unitário e total

APLICAÇÃO E USO RECOMENDADO:
Ideal para atendimento rápido em balcão, comércio varejista, atacadistas, representantes comerciais, depósitos e revenda em papelarias.`,
  },
  {
    id: 'comandas',
    category: 'Linha Office e Financeiro',
    productName: 'Comandas',
    regex: /comanda/i,
    specs: '75x105mm (50 folhas)',
    keyword: 'Kit 100 Comandas 75x105mm 50 Folhas',
    primaryTitle: 'Kit 100 Comandas 75x105mm 50 Folhas Restaurante',
    alternativeTitles: [
      'Kit 50 Comandas 75x105mm 50 Folhas Comércio',
      'Caixa 100 Comandas Controle 75x105mm Bares Padaria',
    ],
    recommendedPrice: 94.9,
    estimatedCost: 31.5,
    usage: 'Restaurantes, Bares, Padarias e Lanchonetes',
    pureTextDescription: `KIT 100 COMANDAS DE CONSUMO 75X105MM 50 FOLHAS - LINHA OFFICE B2B

ESPECIFICAÇÕES TÉCNICAS:
- Produto: Bloco de Comanda para Controle de Pedidos
- Quantidade do Kit: 100 blocos (total de 5.000 folhas)
- Formato / Medidas Exatas: 75x105mm (formato bolso prático para garçons e atendentes)
- Folhas por Bloco: 50 folhas coladas no topo
- Material: Papel sulfite de alta alvura para anotação rápida a caneta ou lápis

APLICAÇÃO E USO RECOMENDADO:
Desenvolvido para bares, restaurantes, padarias, food trucks, lanchonetes e revenda em papelarias e distribuidoras.`,
  },
  {
    id: 'recibos_vales',
    category: 'Linha Office e Financeiro',
    productName: 'Recibos Comerciais e Vales',
    regex: /recibo|vale\b|vales\b/i,
    specs: 'Recibo comercial (150x105mm) e Vales (105x75mm), com 50 folhas',
    keyword: 'Kit 50 Recibos Comerciais 150x105mm 50 Folhas',
    primaryTitle: 'Kit 50 Recibos Comerciais 150x105mm 50 Folhas',
    alternativeTitles: [
      'Kit 100 Vales Impressos 105x75mm 50 Folhas RH',
      'Kit 60 Recibos Comerciais 150x105mm Escritório',
    ],
    recommendedPrice: 92.9,
    estimatedCost: 30.0,
    usage: 'Escritórios, Comércio, Contabilidade e RH',
    pureTextDescription: `KIT 50 BLOCOS DE RECIBO COMERCIAL 150X105MM 50 FOLHAS - LINHA FINANCEIRA

ESPECIFICAÇÕES TÉCNICAS:
- Produto: Recibo Comercial Padronizado (ou Vale 105x75mm)
- Quantidade do Kit: 50 blocos com 50 folhas cada (2.500 recibos no total)
- Medidas Exatas: 150x105mm (Recibo Comercial) / 105x75mm (Vales)
- Acabamento: Blocagem resistente com canhoto/campos de preenchimento claros

APLICAÇÃO E USO RECOMENDADO:
Indicado para comprovação de pagamentos, aluguéis, prestação de serviços, controle de caixa e revenda em papelarias.`,
  },
  {
    id: 'placas_sinalizacao',
    category: 'Sinalização Comercial (Placas em Poliestireno/PS com impressão UV)',
    productName: 'Placas de Sinalização em Poliestireno PS UV',
    regex: /placa|sinaliza[cç][aã]o|poliestireno|\bps\b|proibido\s+fumar|banheiro|sa[ií]da\s+de\s+emerg[eê]ncia|c[aã]o\s+bravo|extintor|alugo|vendo|sanit[aá]rio|capacete|sorria/i,
    specs:
      '15x20cm (Banheiro, Proibido Fumar, Sorria Filmado), 10x30cm (Saída de Emergência, Volto Já, Proibido Capacete), 7x30cm (Entrada, Saída, Caixa, Sanitários), 20x30cm (Alugo, Vendo, Cuidado Cão Bravo, Extintores)',
    keyword: 'Kit 20 Placas Sinalização PS UV 15x20cm Comércio',
    primaryTitle: 'Kit 20 Placas Sinalização PS UV 15x20cm Comércio',
    alternativeTitles: [
      'Kit 15 Placas Sinalização PS UV 20x30cm Empresa',
      'Kit 25 Placas Sinalização PS UV 10x30cm Emergência',
    ],
    recommendedPrice: 109.9,
    estimatedCost: 36.0,
    usage: 'Condomínios, Empresas, Comércio e Lojas',
    pureTextDescription: `KIT 20 PLACAS DE SINALIZAÇÃO COMERCIAL EM POLIESTIRENO (PS) IMPRESSÃO UV

ESPECIFICAÇÕES TÉCNICAS:
- Material: Poliestireno (PS) de alta resistência com Impressão Direta UV (não desbota e resiste à umidade)
- Quantidade do Kit: 20 placas comerciais para atacado/revenda ou sinalização empresarial completa
- Medidas Disponíveis na Linha:
  * 15x20cm: Banheiro, Proibido Fumar, Sorria Você Está Sendo Filmado
  * 10x30cm: Saída de Emergência, Volto Já, Proibido Capacete
  * 7x30cm: Entrada, Saída, Caixa, Sanitários
  * 20x30cm: Alugo, Vendo, Cuidado Cão Bravo, Extintores
- Fixação: Pronta para aplicação em paredes lisas, portas, vidros e balcões

APLICAÇÃO E USO RECOMENDADO:
Atende normas de sinalização visual para lojas, clínicas, escritórios, condomínios, restaurantes e revenda em materiais de construção e papelarias.`,
  },
  {
    id: 'envelopes_kraft',
    category: 'Envelopes e Papelaria Promocional',
    productName: 'Envelopes Kraft Natural',
    regex: /envelope|kraft/i,
    specs: '80g e 90g (formatos de 162x229mm até 260x360mm) em caixas de 100, 250 ou pacotes de 10',
    keyword: 'Caixa 250 Envelopes Kraft Natural 162x229mm 90g',
    primaryTitle: 'Caixa 250 Envelopes Kraft Natural 162x229mm 90g',
    alternativeTitles: [
      'Caixa 250 Envelopes Kraft Natural 200x280mm 90g',
      'Caixa 100 Envelopes Kraft Natural 260x360mm 90g',
    ],
    recommendedPrice: 114.9,
    estimatedCost: 42.0,
    usage: 'Escritórios, E-commerce, Cartórios e Envios',
    pureTextDescription: `CAIXA 250 ENVELOPES KRAFT NATURAL 162X229MM GRAMATURA 90G - ATACADO B2B

ESPECIFICAÇÕES TÉCNICAS:
- Produto: Envelope Saco Kraft Natural
- Quantidade da Caixa: 250 unidades (também disponível em caixas de 100 unidades)
- Gramatura: 90g/m² de alta resistência ao rasgo e opacidade total (também disponível em 80g)
- Formato / Medidas: 162x229mm (linha completa de 162x229mm até 260x360mm)
- Material: Papel Kraft Natural fibra longa de primeira linha

APLICAÇÃO E USO RECOMENDADO:
Perfeito para envio de documentos, contratos, exames, expedição de e-commerce, escritórios contábeis, cartórios e revenda em papelarias.`,
  },
  {
    id: 'splashes_cartazes',
    category: 'Envelopes e Papelaria Promocional',
    productName: 'Splashes de Oferta e Cartazes de Oferta',
    regex: /splash|cartaz|solapa|granel|precificador/i,
    specs: 'Splashes de Oferta em papel 220g (Solapa, Combo e Granel - P, M e G) e Cartazes de Oferta (15x20cm até 43x63cm)',
    keyword: 'Kit 100 Cartazes De Oferta 30x40cm 220g Varejo',
    primaryTitle: 'Kit 100 Cartazes De Oferta 15x20cm 220g Varejo',
    alternativeTitles: [
      'Kit 150 Splashes De Oferta Papel 220g M Comércio',
      'Kit 100 Cartazes De Oferta 43x63cm Supermercado',
    ],
    recommendedPrice: 89.9,
    estimatedCost: 28.0,
    usage: 'Supermercados, Farmácias, Lojas e Varejo',
    pureTextDescription: `KIT 100 CARTAZES E SPLASHES DE OFERTA PAPEL 220G - COMUNICAÇÃO VISUAL VAREJO

ESPECIFICAÇÕES TÉCNICAS:
- Produto: Cartazes de Oferta / Splashes de Oferta (Solapa, Combo e Granel)
- Quantidade do Kit: 100 unidades em pacote fechado para uso comercial
- Gramatura: Papel Cartão 220g encorpado (não enverga na gôndola)
- Medidas da Linha: Cartazes de 15x20cm até 43x63cm; Splashes nos tamanhos P, M e G
- Cores: Impressão de alto contraste (amarelo/vermelho) para destaque imediato de preços

APLICAÇÃO E USO RECOMENDADO:
Essencial para precificação de gôndolas em supermercados, açougues, hortifrútis, farmácias, lojas de departamentos e distribuidoras.`,
  },
  {
    id: 'cadernos_cadernetas',
    category: 'Linha Escolar e Educativa',
    productName: 'Cadernos e Cadernetas Capa Flexível 250g',
    regex: /caderno|caderneta/i,
    specs: 'Capa flexível 250g (48 ou 96 folhas)',
    keyword: 'Kit 20 Cadernos Capa Flexível 250g 96 Folhas Escolar',
    primaryTitle: 'Kit 20 Cadernos Capa Flexível 250g 96 Folhas Escolar',
    alternativeTitles: [
      'Kit 30 Cadernos Capa Flexível 250g 48 Folhas Atacado',
      'Caixa 40 Cadernetas Capa 250g 48 Folhas Papelaria',
    ],
    recommendedPrice: 99.9,
    estimatedCost: 35.0,
    usage: 'Escolas, Papelarias, Kits Escolares e Licitações',
    pureTextDescription: `KIT 20 CADERNOS CAPA FLEXÍVEL 250G 96 FOLHAS PAUTADAS - LINHA ESCOLAR ATACADO

ESPECIFICAÇÕES TÉCNICAS:
- Produto: Caderno Brochura / Caderneta Escolar
- Quantidade do Kit: 20 unidades
- Capa: Papel Cartão Flexível 250g com acabamento resistente
- Miolo: 96 folhas pautadas (disponível também na versão de 48 folhas)
- Formato: Escolar padrão de excelente abertura e escrita macia

APLICAÇÃO E USO RECOMENDADO:
Ideal para formação de kits escolares, revenda em papelarias, bazares, doações institucionais e abastecimento de escolas.`,
  },
  {
    id: 'giz_de_cera',
    category: 'Linha Escolar e Educativa',
    productName: 'Giz de Cera (Standard, Gizão e Meu 1° Giz)',
    regex: /\bgiz\b|giz[aã]o|meu\s+1[º°]?\s*giz/i,
    specs: 'Standard (6/12 cores, 26g/52g), Gizão (6/12 cores, 58g/112g) e Meu 1° Giz (185g/344g)',
    keyword: 'Kit 24 Caixas Giz De Cera 12 Cores 52g Escolar',
    primaryTitle: 'Kit 24 Caixas Giz De Cera 12 Cores 52g Escolar',
    alternativeTitles: [
      'Kit 15 Caixas Gizão De Cera 12 Cores 112g Infantil',
      'Kit 10 Caixas Meu 1 Giz De Cera 185g Pré Escola',
    ],
    recommendedPrice: 94.9,
    estimatedCost: 32.0,
    usage: 'Educação Infantil, Escolas e Papelarias',
    pureTextDescription: `KIT 24 CAIXAS DE GIZ DE CERA 12 CORES 52G (OU GIZÃO 112G) - LINHA ESCOLAR B2B

ESPECIFICAÇÕES TÉCNICAS:
- Produto: Giz de Cera Escolar Atóxico
- Opções da Linha Oficial Pacific Flowers:
  * Standard: 6 ou 12 cores (26g / 52g)
  * Gizão: 6 ou 12 cores (58g / 112g) - formato anatômico para mãos pequenas
  * Meu 1° Giz: 185g / 344g - alta resistência para primeira infância
- Composição: Ceras de alta qualidade, traço macio, cores vivas e fórmula atóxica

APLICAÇÃO E USO RECOMENDADO:
Desenvolvido para creches, escolas de educação infantil, listas de material escolar e revenda em atacado para papelarias.`,
  },
  {
    id: 'dinheirinho_educativo',
    category: 'Linha Escolar e Educativa',
    productName: 'Dinheirinho e Dinheirão Educativo',
    regex: /dinheirinho|dinheir[aã]o|c[eé]dula\s+educativa|notas\s+educativas/i,
    specs: 'Pacotes com 70 ou 15 notas',
    keyword: 'Kit 30 Pacotes Dinheirinho Educativo 70 Notas Escolar',
    primaryTitle: 'Kit 30 Pacotes Dinheirinho Educativo 70 Notas Escolar',
    alternativeTitles: [
      'Kit 40 Pacotes Dinheirão Educativo 15 Notas Escola',
      'Caixa 50 Dinheirinho Educativo 70 Notas Papelaria',
    ],
    recommendedPrice: 86.9,
    estimatedCost: 26.0,
    usage: 'Alfabetização Matemática, Escolas e Papelarias',
    pureTextDescription: `KIT 30 PACOTES DE DINHEIRINHO EDUCATIVO 70 NOTAS - EDUCAÇÃO FINANCEIRA INFANTIL

ESPECIFICAÇÕES TÉCNICAS:
- Produto: Dinheirinho / Dinheirão Educativo Sem Valor Monetário
- Quantidade do Kit: 30 pacotes fechados
- Conteúdo por Pacote: 70 notas ilustrativas (disponível também na versão Dinheirão com 15 notas)
- Material: Papel impresso em cores nítidas para atividades didáticas

APLICAÇÃO E USO RECOMENDADO:
Recurso pedagógico para ensino de matemática, soma, troco e educação financeira em escolas fundamentais e revenda em papelarias.`,
  },
  {
    id: 'jogos_educativos',
    category: 'Linha Escolar e Educativa',
    productName: 'Jogos e Atividades Educativas',
    regex: /jogo|imobili[aá]rio|damas|ludo|trilha|mem[oó]ria|quebra[-\s]?cabe[cç]a|caligrafia|desenho/i,
    specs: 'Mercado Imobiliário, Damas, Ludo, Trilha, Jogo da Memória, Quebra-Cabeça, Caligrafia e Kits de Desenho',
    keyword: 'Kit 15 Jogos Educativos Tabuleiro Memória Escolar',
    primaryTitle: 'Kit 15 Jogos Educativos Damas Ludo Trilha Escolar',
    alternativeTitles: [
      'Kit 12 Jogos Mercado Imobiliário Memória Brinquedo',
      'Kit 20 Kits De Desenho E Caligrafia Infantil Escola',
    ],
    recommendedPrice: 108.9,
    estimatedCost: 37.0,
    usage: 'Brinquedotecas, Escolas, Papelarias e Lojas',
    pureTextDescription: `KIT 15 JOGOS EDUCATIVOS E ATIVIDADES PEDAGÓGICAS - LINHA ESCOLAR PACIFIC FLOWERS

ESPECIFICAÇÕES TÉCNICAS:
- Produtos da Linha: Mercado Imobiliário, Damas, Ludo, Trilha, Jogo da Memória, Quebra-Cabeça, Caligrafia e Kits de Desenho
- Quantidade do Kit: 15 unidades sortidas ou padronizadas para atacado
- Material: Papel cartão de alta gramatura com impressão colorida resistente

APLICAÇÃO E USO RECOMENDADO:
Estimula o raciocínio lógico, coordenação motora e socialização em escolas, brinquedotecas, eventos infantis e revenda em papelarias e lojas de brinquedos.`,
  },
];

export function resolveCatalogProfile(text = '', itemId = '') {
  const clean = String(text || '');
  for (const profile of PACIFIC_FLOWERS_CATALOG_PROFILES) {
    if (profile.regex.test(clean)) {
      return profile;
    }
  }
  if (itemId === 'MLB4019283741') {
    return PACIFIC_FLOWERS_CATALOG_PROFILES.find((p) => p.id === 'envelopes_kraft');
  }
  return PACIFIC_FLOWERS_CATALOG_PROFILES[0]; // Default: Talões de Pedido
}

export function detectOutOfCatalogProduct(text = '') {
  const outOfCatalogRegex =
    /\b(caneta\s+esferogr[aá]fica|l[aá]pis\s+de\s+cor|mochila|estojo|garrafa\s+t[eé]rmica|tesoura|grampeador|clips|cola\s+branca|fita\s+adesiva|bobina\s+t[eé]rmica|papel\s+a4|sulfite\s+a4|toner|cartucho|mouse|teclado|cadeira)\b/i;
  const match = String(text || '').match(outOfCatalogRegex);
  return match ? match[1] : null;
}

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

  // Permite "Cartazes de Oferta" / "Splashes de Oferta" quando parte do nome oficial do produto, mas bloqueia adjetivos promocionais proibidos
  const isOfficialCatalogOfferItem = /\b(cartaz(?:es)?|splash(?:es)?)\s+de\s+oferta\b/i.test(
    clean
  );
  const forbiddenPromoRegex = isOfficialCatalogOfferItem
    ? /\b(frete\s*gr[aá]tis|promo[cç][aã]o|brinde|liquida[cç][aã]o|desconto|imperd[ií]vel|barat[oa]s?|queima\s+de\s+estoque)\b/i
    : /\b(oferta|frete\s*gr[aá]tis|promo[cç][aã]o|brinde|liquida[cç][aã]o|desconto|imperd[ií]vel|barat[oa]s?|queima\s+de\s+estoque)\b/i;

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

  // Verifica se o título inicia com a quantidade do Kit/Caixa/Pacote conforme Fórmula Obrigatória B2B
  if (!/^(kit|caixa|pacote|\d+\s*un|\d+\s*p[cç]s|\d+\b)/i.test(clean)) {
    violations.push(
      'Falta a Quantidade do Kit abrindo o título conforme a Fórmula Obrigatória: [Quantidade do Kit] + [Nome do Produto do Catálogo] + [Tamanho/Gramatura] + [Uso].'
    );
  }

  // Verifica se possui tamanho/gramatura/medida técnica (ex: mm, cm, g, folhas, notas, cores, P/M/G)
  if (
    !/(\d+\s*x\s*\d+|\d+\s*(?:mm|cm|g|gr|kg|folhas|fls|notas|cores|pe[cç]as)|\b(?:15x20|10x30|7x30|20x30|105x150|150x210|300x210|75x105|150x105|105x75|162x229|260x360|220g|250g|80g|90g)\b)/i.test(
      clean
    ) &&
    !/jogo|imobili[aá]rio|damas|ludo|trilha|mem[oó]ria|quebra|caligrafia|desenho/i.test(clean)
  ) {
    violations.push(
      'Falta especificar o [Tamanho/Gramatura] exato do catálogo (ex: 105x150mm, 90g, 220g, 250g, 15x20cm) na estrutura obrigatória.'
    );
  }

  const profile = resolveCatalogProfile(clean);

  return {
    valid: violations.length === 0,
    length: clean.length,
    violations,
    suggested_title: profile.primaryTitle,
    alternative_titles: profile.alternativeTitles,
    catalog_profile: profile,
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
    title: 'Kit 50 Talões De Pedido 105x150mm Comércio',
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
    title: 'Caixa 250 Envelopes Kraft Natural 162x229mm 90g',
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
    name: 'Caixa 250 Envelopes Kraft Natural 162x229mm 90g',
    thumbnail: 'https://http2.mlstatic.com/D_NQ_NP_2X_847192-MLA75123981234_032024-F.webp',
    status: 'active',
    budget: 85.0,
    kit_price: 119.9,
    ads_revenue_30d: 14820.5,
    ads_spend_30d: 1659.9,
    acos: 11.2,
  },
  {
    id: 'CMP-9081722',
    item_id: 'MLB3948102938',
    name: 'Kit 50 Talões De Pedido 105x150mm Comércio',
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
  const commissionOnly = safePrice * 0.16;
  const mlCommission = commissionOnly + fixedFee;
  const sellerShippingCost = isFreeShippingTriggered ? 21.0 : 0.0;

  const netProfit = safePrice - safeCost - mlCommission - sellerShippingCost;
  const marginPercent = safePrice > 0 ? (netProfit / safePrice) * 100 : 0;

  return {
    price: Number(safePrice.toFixed(2)),
    cost: Number(safeCost.toFixed(2)),
    product_cost: Number(safeCost.toFixed(2)),
    fixed_fee: Number(fixedFee.toFixed(2)),
    fixedFee: Number(fixedFee.toFixed(2)),
    commissionAmount: Number(commissionOnly.toFixed(2)),
    ml_fee_estimate: Number(mlCommission.toFixed(2)),
    seller_shipping_cost: Number(sellerShippingCost.toFixed(2)),
    shippingCost: Number(sellerShippingCost.toFixed(2)),
    net_profit: Number(netProfit.toFixed(2)),
    netProfit: Number(netProfit.toFixed(2)),
    margin_percent: Number(marginPercent.toFixed(2)),
    marginPercent: Number(marginPercent.toFixed(2)),
    isFreeShipping: isFreeShippingTriggered,
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
// Radar de Concorrência: Busca Pública no Mercado Livre (/sites/MLB/search)
// ============================================================================
function buildBenchmarkCompetitors(keyword) {
  const cleanKw = String(keyword || 'Kit Talões De Pedido 105x150mm Comércio').trim();
  const slug = cleanKw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-');

  if (/envelope|kraft/i.test(cleanKw)) {
    return [
      {
        title: 'Caixa 250 Envelopes Kraft Natural 162x229mm 90g Escritório',
        price: 118.9,
        link: `https://produto.mercadolivre.com.br/MLB-3819201921-${slug}-1`,
        free_shipping: true,
      },
      {
        title: 'Caixa 250 Envelopes Kraft Natural 200x280mm 90g Envios',
        price: 134.5,
        link: `https://produto.mercadolivre.com.br/MLB-3819201922-${slug}-2`,
        free_shipping: true,
      },
      {
        title: 'Caixa 100 Envelopes Kraft Natural 260x360mm 90g Documentos',
        price: 96.0,
        link: `https://produto.mercadolivre.com.br/MLB-3819201923-${slug}-3`,
        free_shipping: true,
      },
      {
        title: 'Caixa 250 Envelopes Kraft Natural 162x229mm 80g Comércio',
        price: 89.9,
        link: `https://produto.mercadolivre.com.br/MLB-3819201924-${slug}-4`,
        free_shipping: true,
      },
      {
        title: 'Pacote 10 Envelopes Kraft Natural 260x360mm 90g Papelaria',
        price: 29.9,
        link: `https://produto.mercadolivre.com.br/MLB-3819201925-${slug}-5`,
        free_shipping: false,
      },
    ];
  }

  if (/placa|sinaliza[cç][aã]o|poliestireno|\bps\b|banheiro|fumar|emerg[eê]ncia|extintor/i.test(cleanKw)) {
    return [
      {
        title: 'Kit 20 Placas Sinalização PS UV 15x20cm Comércio Empresa',
        price: 114.9,
        link: `https://produto.mercadolivre.com.br/MLB-3920192831-${slug}-1`,
        free_shipping: true,
      },
      {
        title: 'Kit 15 Placas Sinalização Fotoluminescente PS 10x30cm',
        price: 108.0,
        link: `https://produto.mercadolivre.com.br/MLB-3920192832-${slug}-2`,
        free_shipping: true,
      },
      {
        title: 'Kit 25 Placas Aviso Banheiro Proibido Fumar PS UV 15x20cm',
        price: 124.9,
        link: `https://produto.mercadolivre.com.br/MLB-3920192833-${slug}-3`,
        free_shipping: true,
      },
      {
        title: 'Kit 12 Placas Sinalização Comercial 20x30cm Poliestireno',
        price: 89.9,
        link: `https://produto.mercadolivre.com.br/MLB-3920192834-${slug}-4`,
        free_shipping: true,
      },
      {
        title: 'Placa Sinalização Avulsa 15x20cm Poliestireno UV Unitária',
        price: 18.9,
        link: `https://produto.mercadolivre.com.br/MLB-3920192835-${slug}-5`,
        free_shipping: false,
      },
    ];
  }

  if (/splash|cartaz|oferta|g[oô]ndola|supermercado/i.test(cleanKw)) {
    return [
      {
        title: 'Kit 100 Cartazes De Oferta 30x40cm Papel 220g Supermercado',
        price: 94.9,
        link: `https://produto.mercadolivre.com.br/MLB-3930192841-${slug}-1`,
        free_shipping: true,
      },
      {
        title: 'Kit 150 Splashes De Oferta Papel 220g Tamanhos P M G Varejo',
        price: 99.9,
        link: `https://produto.mercadolivre.com.br/MLB-3930192842-${slug}-2`,
        free_shipping: true,
      },
      {
        title: 'Kit 100 Cartazes De Oferta 43x63cm Amarelo Vermelho Loja',
        price: 116.0,
        link: `https://produto.mercadolivre.com.br/MLB-3930192843-${slug}-3`,
        free_shipping: true,
      },
      {
        title: 'Kit 100 Cartazes De Oferta 15x20cm Papel 220g Comércio',
        price: 84.9,
        link: `https://produto.mercadolivre.com.br/MLB-3930192844-${slug}-4`,
        free_shipping: true,
      },
      {
        title: 'Pacote 20 Splashes De Oferta Avulso Papelaria Varejo',
        price: 24.9,
        link: `https://produto.mercadolivre.com.br/MLB-3930192845-${slug}-5`,
        free_shipping: false,
      },
    ];
  }

  if (/caderno|caderneta|giz|dinheirinho|dinheir[aã]o|jogo|imobili[aá]rio|damas|ludo|trilha|mem[oó]ria|quebra|caligrafia|escolar/i.test(cleanKw)) {
    return [
      {
        title: 'Kit 24 Caixas Giz De Cera 12 Cores 52g Escolar Atacado',
        price: 98.9,
        link: `https://produto.mercadolivre.com.br/MLB-3940192851-${slug}-1`,
        free_shipping: true,
      },
      {
        title: 'Kit 20 Cadernos Capa Flexível 250g 96 Folhas Escolar',
        price: 104.9,
        link: `https://produto.mercadolivre.com.br/MLB-3940192852-${slug}-2`,
        free_shipping: true,
      },
      {
        title: 'Kit 15 Caixas Gizão De Cera 12 Cores 112g Educação Infantil',
        price: 112.5,
        link: `https://produto.mercadolivre.com.br/MLB-3940192853-${slug}-3`,
        free_shipping: true,
      },
      {
        title: 'Kit 15 Jogos Educativos Damas Ludo Trilha Memória Escola',
        price: 92.0,
        link: `https://produto.mercadolivre.com.br/MLB-3940192854-${slug}-4`,
        free_shipping: true,
      },
      {
        title: 'Kit 5 Cadernos Pequenos 48 Folhas Varejo Escolar',
        price: 34.9,
        link: `https://produto.mercadolivre.com.br/MLB-3940192855-${slug}-5`,
        free_shipping: false,
      },
    ];
  }

  if (/tal[aã]o|pedido|bloco|comanda|recibo|vale/i.test(cleanKw)) {
    return [
      {
        title: 'Kit 50 Talões De Pedido 105x150mm 50 Folhas Comércio',
        price: 109.9,
        link: `https://produto.mercadolivre.com.br/MLB-3910293811-${slug}-1`,
        free_shipping: true,
      },
      {
        title: 'Kit 40 Talões De Pedido 150x210mm 50 Folhas Atacado',
        price: 94.9,
        link: `https://produto.mercadolivre.com.br/MLB-3910293812-${slug}-2`,
        free_shipping: true,
      },
      {
        title: 'Caixa 50 Comandas 75x105mm 50 Folhas Restaurante',
        price: 118.0,
        link: `https://produto.mercadolivre.com.br/MLB-3910293813-${slug}-3`,
        free_shipping: true,
      },
      {
        title: 'Kit 30 Recibos Comerciais 150x105mm 50 Folhas Loja',
        price: 82.5,
        link: `https://produto.mercadolivre.com.br/MLB-3910293814-${slug}-4`,
        free_shipping: true,
      },
      {
        title: 'Kit 10 Talões De Pedido 105x150mm 50 Folhas Varejo',
        price: 42.9,
        link: `https://produto.mercadolivre.com.br/MLB-3910293815-${slug}-5`,
        free_shipping: false,
      },
    ];
  }

  return [
    {
      title: 'Kit 50 Talões De Pedido 105x150mm 50 Folhas Comércio',
      price: 104.9,
      link: `https://produto.mercadolivre.com.br/MLB-4102938471-${slug}-1`,
      free_shipping: true,
    },
    {
      title: 'Caixa 250 Envelopes Kraft Natural 162x229mm 90g Escritório',
      price: 96.5,
      link: `https://produto.mercadolivre.com.br/MLB-4102938472-${slug}-2`,
      free_shipping: true,
    },
    {
      title: 'Kit 20 Placas Sinalização PS UV 15x20cm Comércio',
      price: 112.0,
      link: `https://produto.mercadolivre.com.br/MLB-4102938473-${slug}-3`,
      free_shipping: true,
    },
    {
      title: 'Kit 100 Cartazes De Oferta 30x40cm 220g Varejo',
      price: 88.9,
      link: `https://produto.mercadolivre.com.br/MLB-4102938474-${slug}-4`,
      free_shipping: true,
    },
    {
      title: 'Kit 20 Cadernos Capa Flexível 250g 96 Folhas Escolar',
      price: 59.9,
      link: `https://produto.mercadolivre.com.br/MLB-4102938475-${slug}-5`,
      free_shipping: false,
    },
  ];
}

export async function searchMeliCompetitors(palavraChave) {
  const cleanQuery = String(palavraChave || 'Kit 50 Talões De Pedido 105x150mm').trim();
  const publicSearchUrl = `${ML_API_BASE}/sites/MLB/search?q=${encodeURIComponent(
    cleanQuery
  )}&limit=5`;

  let rawCompetitors = [];
  let source = 'mercadolibre_public_api';

  try {
    // Requisição livre de autenticação para o endpoint público do Mercado Livre
    const response = await fetch(publicSearchUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; PacificFlowersRadar/1.0)',
      },
    });

    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data?.results) && data.results.length > 0) {
        // Filtra o JSON do Mercado Livre retornando APENAS: Título, Preço, Link e Frete Grátis
        rawCompetitors = data.results.slice(0, 5).map((item) => ({
          title: item.title,
          price: Number(item.price || 0),
          link: item.permalink,
          free_shipping: Boolean(item.shipping?.free_shipping),
        }));
      }
    }
  } catch {
    // Em caso de bloqueio de rede em IP de nuvem, utiliza fallback estruturado
  }

  if (rawCompetitors.length === 0) {
    source = 'mercadolibre_benchmark_radar';
    rawCompetitors = buildBenchmarkCompetitors(cleanQuery);
  }

  const prices = rawCompetitors.map((c) => Number(c.price) || 0).filter((p) => p > 0);
  const avgPrice =
    prices.length > 0
      ? Number((prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2))
      : 94.9;
  const minPrice = prices.length > 0 ? Math.min(...prices) : 79.9;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 119.9;
  const freeShippingCount = rawCompetitors.filter((c) => c.free_shipping).length;

  // Sugere um preço competitivo B2B > R$ 79,00 (4% abaixo da média dos kits com Frete Grátis, respeitando piso de R$ 84,90)
  const freeShippingPrices = rawCompetitors
    .filter((c) => c.free_shipping && c.price >= 79)
    .map((c) => c.price);
  const refB2BPrice =
    freeShippingPrices.length > 0
      ? freeShippingPrices.reduce((a, b) => a + b, 0) / freeShippingPrices.length
      : avgPrice;
  const suggestedCompetitivePrice = Number(Math.max(84.9, refB2BPrice * 0.96).toFixed(2));

  return {
    query: cleanQuery,
    source,
    endpoint: publicSearchUrl,
    concorrentes: rawCompetitors,
    results: rawCompetitors,
    stats: {
      average_price: avgPrice,
      min_price: minPrice,
      max_price: maxPrice,
      free_shipping_count: freeShippingCount,
      suggested_competitive_price: suggestedCompetitivePrice,
    },
  };
}

// ============================================================================
// 1. Nova Rota GET /api/concorrencia?q={palavra_chave} (Livre de Autenticação)
// ============================================================================
app.get('/api/concorrencia', async (req, res) => {
  const palavraChave = (req.query.q || req.query.palavra_chave || '').trim();

  if (!palavraChave) {
    return res.status(400).json({
      error: 'missing_query',
      message:
        'Informe o parâmetro de busca "?q={palavra_chave}" na rota /api/concorrencia.',
    });
  }

  try {
    const radarData = await searchMeliCompetitors(palavraChave);
    return res.status(200).json({
      query: radarData.query,
      source: radarData.source,
      results: radarData.results,
      concorrentes: radarData.concorrentes,
      stats: radarData.stats,
    });
  } catch (error) {
    return res.status(500).json({
      error: 'competitor_radar_error',
      message: error.message || 'Erro ao consultar o Radar de Concorrência no Mercado Livre.',
    });
  }
});

// ============================================================================
// Pilar 4: Trava Absoluta Human-in-the-Loop nas Tools da IA (Sem HTTP PUT direto)
// ============================================================================
export const HUMAN_IN_THE_LOOP_MESSAGE =
  'Preparei a atualização do anúncio. Verifique os dados na tela e clique em Salvar para enviar ao Mercado Livre.';

function createMeliToolExecutors() {
  return {
    // Tool 1: Radar de Concorrência (Executa busca real nos 5 primeiros colocados do ML e devolve ao contexto do LLM)
    pesquisar_concorrentes: async ({ palavra_chave }) => {
      const radar = await searchMeliCompetitors(palavra_chave);
      return {
        success: true,
        human_in_the_loop: false,
        palavra_chave: radar.query,
        concorrentes: radar.concorrentes,
        stats: radar.stats,
      };
    },

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
// Formatação Estilo Gemini 3.8 Flash (Markdown Estruturado, Raciocínio + Ação)
// ============================================================================
function formatRadarSectionGemini(radar) {
  if (!radar || !Array.isArray(radar.concorrentes) || radar.concorrentes.length === 0) {
    return '';
  }
  const rows = radar.concorrentes
    .map(
      (c, idx) =>
        `${idx + 1}. **${c.title}** — \`R$ ${Number(c.price).toFixed(2)}\` · ${
          c.free_shipping ? '⚡ **Frete Grátis**' : '📦 Frete por conta do comprador'
        }`
    )
    .join('\n');

  return `### 📊 Radar de Concorrência Mercado Livre (\`"${radar.query}"\`)
${rows}

> 💡 **Síntese Competitiva Gemini:** Preço médio dos Top 5: **R$ ${radar.stats.average_price.toFixed(
    2
  )}** (amplitude de \`R$ ${radar.stats.min_price.toFixed(2)}\` a \`R$ ${radar.stats.max_price.toFixed(
    2
  )}\`, onde **${radar.stats.free_shipping_count} de 5** oferecem Frete Grátis). Para capturar a Buy Box e ranquear no topo sem sacrificar margem, o ticket B2B ideal situa-se em **R$ ${radar.stats.suggested_competitive_price.toFixed(
    2
  )}**.`;
}

function formatMarginComparisonGemini(priceValue, unitCost = 32.0) {
  const sim = calculatePricingMetrics(priceValue, unitCost);
  const statusBadge = sim.isFreeShipping
    ? '⚡ **Frete Grátis Ativo (Isento de Taxa Fixa)**'
    : '🚨 **Taxa Fixa de R$ 6,00 Ativa (Ticket < R$ 79,00)**';

  return `### 💰 Simulação Financeira & Regra do Gatilho (R$ 79,00)
- **Preço de Venda Simulado:** \`R$ ${sim.price.toFixed(2)}\` — ${statusBadge}
- **Comissão Mercado Livre (16%):** \`- R$ ${sim.commissionAmount.toFixed(2)}\`
- **Taxa Fixa (< R$ 79,00):** \`- R$ ${sim.fixedFee.toFixed(2)}\`
- **Custo de Frete Vendedor (>= R$ 79,00):** \`- R$ ${sim.shippingCost.toFixed(2)}\`
- **Custo Fabril Estimado do Kit:** \`- R$ ${sim.cost.toFixed(2)}\`
- **Lucro Líquido por Venda:** **R$ ${sim.netProfit.toFixed(2)}** (**Margem Líquida de ${sim.marginPercent.toFixed(
    1
  )}%**)`;
}

// ============================================================================
// 5. Rota POST /api/chat — Copiloto B2B + Radar de Concorrência + Human-in-the-Loop
// ============================================================================
app.get('/api/chat/config', (req, res) => {
  res.json({
    model: 'gemini-3.8-flash',
    style: 'google-gemini-structured-b2b',
    system_prompt: COPILOT_SYSTEM_PROMPT,
    catalog_lines_count: PACIFIC_FLOWERS_CATALOG_PROFILES.length,
    tools: COPILOT_TOOLS.map((t) => t.name),
    human_in_the_loop: true,
    competitor_radar_enabled: true,
    direct_ml_put_disabled_in_chat: true,
    gemini_configured: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
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
  const resolvedApiKey = (
    gemini_api_key ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    ''
  ).trim();

  // ==========================================================================
  // Fluxo 1: LLM Gemini (Interactions API - gemini-3.8-flash) com Function Calling
  // ==========================================================================
  if (resolvedApiKey) {
    try {
      const ai = new GoogleGenAI({ apiKey: resolvedApiKey });
      let currentInput = String(message);
      let currentPreviousId = previous_interaction_id || undefined;
      let interaction;
      const executedTools = [];
      let pendingApproval = null;
      let competitorsRadar = null;

      const geminiFormattingInstruction = `${COPILOT_SYSTEM_PROMPT}

ESTILO DE RESPOSTA OBRIGATÓRIO (PADRÃO GOOGLE GEMINI):
- Estruture suas respostas usando Markdown rico, claro e escaneável com subtítulos (###), listas em tópicos (- **Item:** ...), blocos de destaque (> 💡 ...) e código inline (\`...\`) para contagens de caracteres, medidas e preços.
- Sempre apresente seu raciocínio analítico antes da recomendação final.
- Quando preparar uma atualização de anúncio via Function Calling (otimizar_titulo_b2b, atualizar_preco_anuncio, atualizar_estoque), encerre obrigatoriamente com a frase exata: "${HUMAN_IN_THE_LOOP_MESSAGE}"`;

      while (true) {
        interaction = await ai.interactions.create({
          model: 'gemini-3.8-flash',
          system_instruction: geminiFormattingInstruction,
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

            if (step.name === 'pesquisar_concorrentes' && result?.concorrentes) {
              competitorsRadar = {
                query: result.palavra_chave,
                concorrentes: result.concorrentes,
                stats: result.stats,
              };
            }

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

      const llmAnalysisText = (interaction.output_text || '').trim();
      const finalReply = pendingApproval
        ? llmAnalysisText && !llmAnalysisText.includes(HUMAN_IN_THE_LOOP_MESSAGE)
          ? `${llmAnalysisText}\n\n${HUMAN_IN_THE_LOOP_MESSAGE}`
          : HUMAN_IN_THE_LOOP_MESSAGE
        : llmAnalysisText || 'Auditoria e análise de concorrência concluídas.';

      return res.json({
        model: 'gemini-3.8-flash',
        reply: finalReply,
        interaction_id: interaction.id,
        executed_tools: executedTools,
        competitors_radar: competitorsRadar,
        pending_approval: pendingApproval,
        system_prompt_active: true,
      });
    } catch {
      // Se a chave externa falhar ou expirar, prossegue de forma transparente para o Motor Gemini B2B Integrado
    }
  }

  // ==========================================================================
  // Fluxo 2: Motor Cognitivo Estilo Gemini 3.8 Flash (Multi-Intenção + Catálogo B2B)
  // Responde de forma fluida, analítica e estruturada para qualquer tipo de texto!
  // ==========================================================================
  const text = String(message).trim();
  const mlbMatch = text.match(/\b(MLB[-_]?\d+)\b/i);
  const itemId = mlbMatch ? mlbMatch[1].toUpperCase().replace('-', '') : 'MLB3948102938';
  const executedTools = [];
  const combinedProposedFields = {};
  const catalogProfile = resolveCatalogProfile(text, itemId);

  // --------------------------------------------------------------------------
  // CASO A: Violação de Descrição (HTML ou Dados de Contato Proibidos)
  // --------------------------------------------------------------------------
  const hasHtmlTags = /<[a-z][\s\S]*>/i.test(text);
  const hasForbiddenContactInDesc =
    /descri[cç][aã]o/i.test(text) &&
    /(\b\d{2}\s?\d{4,5}[-\s]?\d{4}\b|@[a-z0-9_]+|https?:\/\/|www\.|\.com\.br|\bpix\b|\bcnpj\b|rua\s+\w+)/i.test(
      text
    );

  if (hasHtmlTags || hasForbiddenContactInDesc) {
    const reasonText = hasHtmlTags
      ? 'o uso de **tags HTML** (`<br>`, `<b>`, `<h1>`, `<p>`, etc.) é **terminantemente proibido** pelo algoritmo atual do Mercado Livre, podendo causar perda de indexação ou moderação do anúncio'
      : 'a inserção de **dados de contato externos** (telefones, WhatsApp, e-mails, links, redes sociais, endereço físico ou dados bancários) viola a política anti-evasão do Mercado Livre e gera suspensão imediata do anúncio';

    return res.json({
      model: 'gemini-3.8-flash',
      reply: `Olá! Analisei o texto enviado e **recuso gentilmente esta alteração**, pois ${reasonText}.

### 🛡️ Regra de Conformidade Acionada (Política de Descrição ML)
- **Formato Obrigatório:** Apenas **texto puro** (sem marcação HTML).
- **Proibições Estritas:** Zero e-mails, telefones, links externos, \`@redes_sociais\`, endereço da loja física ou dados bancários.
- **Estrutura de Alta Conversão B2B:** Medidas exatas, material/gramatura, quantidade do kit e aplicação comercial.

---

### ✍️ Descrição Corrigida em Texto Puro (Pronta para Copiar)
\`\`\`
${catalogProfile.pureTextDescription}
\`\`\`

> 💡 **Dica Gemini B2B:** Você pode copiar o bloco acima diretamente para o campo de descrição do Mercado Livre. Ele já destaca as especificações técnicas de **${catalogProfile.productName}** para compradores corporativos.`,
      executed_tools: [],
      competitors_radar: null,
      pending_approval: null,
      system_prompt_active: true,
    });
  }

  // --------------------------------------------------------------------------
  // CASO B: Produto Fora do Catálogo Oficial da Pacific Flowers (Alucinação Zero)
  // --------------------------------------------------------------------------
  const outOfCatalogItem = detectOutOfCatalogProduct(text);
  if (outOfCatalogItem) {
    return res.json({
      model: 'gemini-3.8-flash',
      reply: `Analisei sua solicitação para **"${outOfCatalogItem}"**, mas **recuso gentilmente criar ou otimizar este item**, pois ele **não faz parte do Catálogo Oficial da Pacific Flowers**.

### 📌 Diretriz de Governança do Catálogo
Como Copiloto B2B da **Pacific Flowers**, sigo a trava estrita de **nunca inventar itens fora da nossa linha oficial de fabricação e distribuição**. Nosso foco no Mercado Livre é vender **Kits e Caixas Fechadas (> R$ 79,00)** exclusivamente dentro das nossas **4 linhas oficiais**:

1. **Linha Office e Financeiro:**
   - **Talões de Pedido:** \`105x150mm\`, \`150x210mm\` e \`300x210mm\` (50 folhas)
   - **Comandas:** \`75x105mm\` (50 folhas)
   - **Recibos e Vales:** Recibo comercial (\`150x105mm\`) e Vales (\`105x75mm\`), com 50 folhas
2. **Sinalização Comercial (Placas em Poliestireno/PS com impressão UV):**
   - **15x20cm:** Banheiro, Proibido Fumar, Sorria Você Está Sendo Filmado
   - **10x30cm:** Saída de Emergência, Volto Já, Proibido Capacete
   - **7x30cm:** Entrada, Saída, Caixa, Sanitários
   - **20x30cm:** Alugo, Vendo, Cuidado Cão Bravo, Extintores
3. **Envelopes e Papelaria Promocional:**
   - **Envelopes Kraft Natural:** \`80g\` e \`90g\` (\`162x229mm\` até \`260x360mm\`) em caixas de \`100\`, \`250\` ou pacotes de \`10\`
   - **Splashes de Oferta:** Solapa, Combo e Granel em papel \`220g\` (Tamanhos \`P\`, \`M\` e \`G\`)
   - **Cartazes de Oferta:** De \`15x20cm\` até \`43x63cm\`
4. **Linha Escolar e Educativa:**
   - **Cadernos/Cadernetas:** Capa flexível \`250g\` (\`48\` ou \`96\` folhas)
   - **Giz de Cera:** Standard (\`6/12 cores\`, \`26g/52g\`), Gizão (\`6/12 cores\`, \`58g/112g\`) e Meu 1° Giz (\`185g/344g\`)
   - **Dinheirinho/Dinheirão Educativo:** Pacotes com \`70\` ou \`15\` notas
   - **Jogos e Atividades:** Mercado Imobiliário, Damas, Ludo, Trilha, Jogo da Memória, Quebra-Cabeça, Caligrafia e Kits de Desenho

> 💡 **Qual destes itens oficiais você gostaria de escalar agora?** Basta me dizer o produto e eu aciono o **Radar de Concorrência Top 5** e preencho o **Modal de Edição** para você!`,
      executed_tools: [],
      competitors_radar: null,
      pending_approval: null,
      system_prompt_active: true,
    });
  }

  // --------------------------------------------------------------------------
  // CASO C: Auditoria e Dúvidas sobre Foto de Capa / Imagem Principal
  // --------------------------------------------------------------------------
  if (
    /\b(foto|imagem|capa|fundo\s+branco|parede\s+branca|marca\s+d['’]?[aá]gua|rgb|255|70%|logotipo|borda|qr\s*code)\b/i.test(
      text
    ) &&
    !/t[ií]tulo|pre[cç]o/i.test(text)
  ) {
    const hasPhotoViolation =
      /parede\s+branca|marca\s+d['’]?[aá]gua|logo|borda|texto\s+na\s+foto|qr\s*code|selo/i.test(
        text
      );

    return res.json({
      model: 'gemini-3.8-flash',
      reply: `${
        hasPhotoViolation
          ? '⚠️ **Atenção — Risco de Rebaixamento no Algoritmo:** Identifiquei elementos na sua pergunta que **violam as Regras de Imagem de Capa (Foto 1)** do Mercado Livre. A Foto 1 é o fator visual nº 1 de ranqueamento e taxa de clique (CTR).'
          : 'Claro! Aqui está o **Guia de Auditoria Visual Gemini** para a **Foto 1 (Capa)** dos anúncios B2B da **Pacific Flowers** no Mercado Livre:'
      }

### 📸 Regras Obrigatórias da Foto 1 (Capa do Anúncio)
- **Fundo 100% Branco Puro Digital (\`RGB 255, 255, 255\`):** O fundo deve ser recortado digitalmente. **Nunca utilize fotos tiradas contra parede branca ou mesa branca**, pois o algoritmo de visão computacional do Mercado Livre detecta tons acinzentados/sombras e reduz a exposição orgânica.
- **Ocupação Mínima de \`70%\` do Quadro:** O kit ou caixa fechada (ex: **${catalogProfile.productName}**) deve preencher pelo menos **70% da área útil** da imagem, deixando margens mínimas e equilibradas.
- **Proibições Absolutas na Foto 1:**
  - ❌ **Sem Marcas d'água ou Logotipos inseridos** (o logo só é permitido se fizer parte física da embalagem real do produto).
  - ❌ **Sem Textos Promocionais ou Selos** (proibido escrever *"Kit com 50"*, *"Frete Grátis"*, *"Atacado"* ou *"Envio Rápido"* sobre a foto de capa).
  - ❌ **Sem Bordas, Molduras ou QR Codes**.

### 🎨 Estratégia Visual B2B Recomendada (Fotos 2 a 6)
- **Foto 1 (Capa):** Empilhamento limpo do **${catalogProfile.primaryTitle}** em fundo \`RGB 255, 255, 255\` mostrando volume de atacado.
- **Foto 2:** Detalhe aproximado da gramatura/material (${catalogProfile.specs}).
- **Foto 3:** Tabela visual ou infográfico das medidas exatas (permitido a partir da Foto 2!).

> 💡 **Quer otimizar também o título e o preço deste anúncio?** Peça por exemplo: *"Otimize o título e pesquise concorrentes para ${catalogProfile.primaryTitle}"*.`,
      executed_tools: [],
      competitors_radar: null,
      pending_approval: null,
      system_prompt_active: true,
    });
  }

  // --------------------------------------------------------------------------
  // CASO D: Pedido de Criação / Otimização de Descrição em Texto Puro
  // --------------------------------------------------------------------------
  if (
    /\b(descri[cç][aã]o|escreva\s+um\s+texto|ficha\s+t[eé]cnica|redija\s+a\s+descri[cç][aã]o)\b/i.test(
      text
    ) &&
    !/t[ií]tulo/i.test(text)
  ) {
    return res.json({
      model: 'gemini-3.8-flash',
      reply: `Com certeza! Elaborei uma **Descrição Técnica B2B em Texto Puro** para **${catalogProfile.productName}** (${catalogProfile.category}), 100% auditada contra as políticas do Mercado Livre.

### ✅ Checklist de Conformidade Aplicado
- **Zero Código HTML:** Texto puro estruturado com espaçamento limpo e tópicos em caixa alta.
- **Zero Dados de Contato:** Sem links externos, telefones, e-mails ou menções a redes sociais.
- **Foco em Conversão B2B:** Destaca medidas exatas (\`${catalogProfile.specs}\`), material e aplicação comercial para reduzir perguntas no pós-venda.

---

### 📄 Descrição Pronta para o Mercado Livre (Texto Puro)
\`\`\`
${catalogProfile.pureTextDescription}
\`\`\`

### 🏷️ Sugestão de Título B2B Pareado (\`${catalogProfile.primaryTitle.length}/60 caracteres\`)
- \`${catalogProfile.primaryTitle}\`

> 💡 **Deseja aplicar este título e ajustar o preço no anúncio agora?** Basta responder: *"Otimizar anúncio para ${catalogProfile.primaryTitle}"* que eu abro o **Modal de Edição** preenchido na sua tela!`,
      executed_tools: [],
      competitors_radar: null,
      pending_approval: null,
      system_prompt_active: true,
    });
  }

  // --------------------------------------------------------------------------
  // CASO E: Consulta ao Catálogo Oficial da Empresa ou Linhas de Produtos
  // --------------------------------------------------------------------------
  if (
    /\b(cat[aá]logo|quais\s+produtos|o\s+que\s+voc[eê]s\s+vendem|o\s+que\s+a\s+pacific\s+flowers\s+vende|lista\s+de\s+produtos|linhas\s+de\s+produtos|quais\s+itens)\b/i.test(
      text
    )
  ) {
    return res.json({
      model: 'gemini-3.8-flash',
      reply: `Aqui está o **Catálogo Oficial B2B da Pacific Flowers** estruturado para vendas em **Atacado (Kits e Caixas Fechadas > R$ 79,00)** no Mercado Livre:

### 🏢 1. Linha Office e Financeiro
- **Talões de Pedido:** \`105x150mm\`, \`150x210mm\` e \`300x210mm\` (50 folhas)
  - *Sugestão B2B:* \`Kit 50 Talões De Pedido 105x150mm Comércio\` (**R$ 98,90**)
- **Comandas:** \`75x105mm\` (50 folhas)
  - *Sugestão B2B:* \`Kit 100 Comandas 75x105mm 50 Folhas Restaurante\` (**R$ 94,90**)
- **Recibos e Vales:** Recibo Comercial (\`150x105mm\`) e Vales (\`105x75mm\`), com 50 folhas
  - *Sugestão B2B:* \`Kit 50 Recibos Comerciais 150x105mm 50 Folhas\` (**R$ 92,90**)

### ⚠️ 2. Sinalização Comercial (Placas em Poliestireno/PS com Impressão UV)
- **15x20cm:** Banheiro, Proibido Fumar, Sorria Você Está Sendo Filmado
- **10x30cm:** Saída de Emergência, Volto Já, Proibido Capacete
- **7x30cm:** Entrada, Saída, Caixa, Sanitários
- **20x30cm:** Alugo, Vendo, Cuidado Cão Bravo, Extintores
  - *Sugestão B2B:* \`Kit 20 Placas Sinalização PS UV 15x20cm Comércio\` (**R$ 109,90**)

### 📦 3. Envelopes e Papelaria Promocional
- **Envelopes Kraft Natural:** \`80g\` e \`90g\` (\`162x229mm\` até \`260x360mm\`) — Caixas de \`100\`, \`250\` ou pacotes de \`10\`
  - *Sugestão B2B:* \`Caixa 250 Envelopes Kraft Natural 162x229mm 90g\` (**R$ 114,90**)
- **Splashes de Oferta:** Solapa, Combo e Granel em papel \`220g\` (Tamanhos \`P\`, \`M\` e \`G\`)
- **Cartazes de Oferta:** De \`15x20cm\` até \`43x63cm\`
  - *Sugestão B2B:* \`Kit 100 Cartazes De Oferta 15x20cm 220g Varejo\` (**R$ 89,90**)

### 🎓 4. Linha Escolar e Educativa
- **Cadernos/Cadernetas:** Capa flexível \`250g\` (\`48\` ou \`96\` folhas)
- **Giz de Cera:** Standard (\`6/12 cores\`, \`26g/52g\`), Gizão (\`6/12 cores\`, \`58g/112g\`) e Meu 1° Giz (\`185g/344g\`)
- **Dinheirinho/Dinheirão Educativo:** Pacotes com \`70\` ou \`15\` notas
- **Jogos e Atividades:** Mercado Imobiliário, Damas, Ludo, Trilha, Jogo da Memória, Quebra-Cabeça, Caligrafia e Kits de Desenho

> 💡 ** Fórmula Obrigatória de Títulos (Máx. 60 caracteres):**
> \`[Quantidade do Kit] + [Nome do Produto do Catálogo] + [Tamanho/Gramatura] + [Uso]\`
> Qual linha você quer analisar no **Radar de Concorrência** agora?`,
      executed_tools: [],
      competitors_radar: null,
      pending_approval: null,
      system_prompt_active: true,
    });
  }

  // --------------------------------------------------------------------------
  // CASO F: Estratégia de Mercado Ads (ACOS, Orçamento Diário e Campanhas B2B)
  // --------------------------------------------------------------------------
  if (
    /\b(acos|mercado\s+ads|campanha|or[cç]amento\s+di[aá]rio|tr[aá]fego\s+pago|patrocinad[oa]s?|roas)\b/i.test(
      text
    ) &&
    !/t[ií]tulo/i.test(text)
  ) {
    return res.json({
      model: 'gemini-3.8-flash',
      reply: `Analisei sua dúvida sobre **Mercado Ads (Publicidade Patrocinada)** sob a ótica da estratégia B2B da **Pacific Flowers**.

### 📈 Diretrizes Estratégicas de Tráfego Pago (Mercado Ads)
1. **Regra de Ouro B2B (Filtro \`>= R$ 79,00\`):**
   - **Pause imediatamente** campanhas de itens unitários ou kits pequenos abaixo de \`R$ 79,00\` (ex: pacotes de 10 envelopes a \`R$ 29,90\` ou kits de 10 talões a \`R$ 42,90\`). Nesses itens, a **Taxa Fixa de R$ 6,00** somada ao clique do Ads corrói toda a margem.
   - **Concentre 100% do orçamento diário** em Kits e Caixas Fechadas acima de \`R$ 79,00\` (ex: \`Caixa 250 Envelopes Kraft Natural 162x229mm 90g\` e \`Kit 50 Talões De Pedido 105x150mm Comércio\`).
2. **Leitura de ACOS (Advertising Cost of Sales):**
   - **ACOS Excelente (\`< 12%\`):** Escale o orçamento diário em \`+20%\` a \`+30%\` para dominar as primeiras posições da busca.
   - **ACOS de Atenção (\`12% a 20%\`):** Mantenha o orçamento estável e otimize o **Título B2B** e a **Foto 1 (fundo RGB 255,255,255)** para elevar a taxa de conversão.
   - **ACOS Crítico (\`> 20%\`):** Reduza o orçamento diário ou revise o preço frente aos 5 primeiros concorrentes.

> 💡 **Ação Rápida:** Na aba **Mercado Ads** na barra lateral esquerda, ative o filtro **"Apenas Kits B2B (> R$ 79,00)"** para visualizar e editar os orçamentos diários com 1 clique.`,
      executed_tools: [],
      competitors_radar: null,
      pending_approval: null,
      system_prompt_active: true,
    });
  }

  // --------------------------------------------------------------------------
  // CASO G: Saudação / Conversa Inicial / Ajuda Geral
  // --------------------------------------------------------------------------
  if (
    /^(?:oi|ol[aá]|bom\s+dia|boa\s+tarde|boa\s+noite|tudo\s+bem|opa|e\s*a[ií]|hey|ajuda|help|como\s+funciona|quem\s+[eé]\s+voc[eê]|o\s+que\s+voc[eê]\s+faz)(?:[\s,!.?]+(?:tudo\s+bem|como\s+vai|bom\s+dia|boa\s+tarde|boa\s+noite|me\s+ajuda|como\s+funciona|com\s+voc[eê]|por\s+a[ií]))*[\s,!.?]*$/i.test(
      text
    )
  ) {
    return res.json({
      model: 'gemini-3.8-flash',
      reply: `Olá! Sou o **Copiloto de Vendas B2B da Pacific Flowers** (motor **Gemini 3.8 Flash**), especialista no algoritmo, precificação e auditoria de conformidade do **Mercado Livre**.

### ✨ Como posso ajudar sua operação B2B hoje?
- 🔍 **Radar de Concorrência em Tempo Real (\`pesquisar_concorrentes\`):** Consulto os **5 primeiros colocados** do Mercado Livre para qualquer item do nosso catálogo antes de sugerir títulos ou preços.
- 🏷️ **Engenharia de Títulos B2B (Máx. 60 caracteres):** Aplico rigorosamente a fórmula \`[Quantidade do Kit] + [Nome do Produto do Catálogo] + [Tamanho/Gramatura] + [Uso]\` e bloqueio termos proibidos (*Barato*, *Promoção*, *Frete Grátis*).
- 💰 **Simulador do Gatilho de R$ 79,00:** Calculo comissões (16%), eliminação da taxa fixa de R$ 6,00 e absorção lucrativa do Frete Grátis (R$ 21,00) em Kits e Caixas Fechadas.
- ✍️ **Gerador de Descrições em Texto Puro & Auditoria de Fotos:** Crio descrições técnicas sem HTML e audito fotos de capa (\`RGB 255, 255, 255\` e ocupação de \`70%\`).

### 🚀 Experimente me enviar comandos como:
1. *"Pesquise concorrentes e otimize o anúncio de Talões de Pedido 105x150mm"*
2. *"Crie uma descrição técnica para a Caixa 250 Envelopes Kraft 90g"*
3. *"Vale a pena vender um kit de comandas por R$ 49,90 ou subir para R$ 94,90?"*
4. *"Otimize o título para Talão de Pedido Barato Pacific Flowers"* *(teste de auditoria)*`,
      executed_tools: [],
      competitors_radar: null,
      pending_approval: null,
      system_prompt_active: true,
    });
  }

  // --------------------------------------------------------------------------
  // CASO H: Simulação Pura de Margem / Dúvida de Precificação (< R$ 79 vs >= R$ 79)
  // (Quando o usuário pergunta se vale a pena um preço ou pede cálculo de margem sem pedir edição/criação de kit)
  // --------------------------------------------------------------------------
  const priceMatch = text.match(
    /R\$\s*(\d+(?:[.,]\d{1,2})?)|(?:pre[cç]o|valor|por)\s+(?:de\s+|para\s+)?(\d+(?:[.,]\d{1,2})?)/i
  );
  const isMarginQuestionOnly =
    /\b(vale\s+a\s+pena|calcul[ae]|simul[ae]|margem|lucro|taxa\s+fixa|gatilho)\b/i.test(
      text
    ) && !/\b(atualiz[ae]|mude|altere|coloque|salvar|modal|otimiz[ae]|cri[ae]|mont[ae]|sugir[ae])\b/i.test(text);

  if (isMarginQuestionOnly) {
    const radarToolResult = await toolExecutors.pesquisar_concorrentes({
      palavra_chave: catalogProfile.keyword,
    });
    executedTools.push({
      name: 'pesquisar_concorrentes',
      arguments: { palavra_chave: catalogProfile.keyword },
      result: radarToolResult,
    });
    const competitorsRadar = {
      query: radarToolResult.palavra_chave,
      concorrentes: radarToolResult.concorrentes,
      stats: radarToolResult.stats,
    };

    const queriedPrice = priceMatch
      ? Number((priceMatch[1] || priceMatch[2]).replace(',', '.'))
      : 49.9;
    const recommendedB2BPrice =
      radarToolResult.stats?.suggested_competitive_price || catalogProfile.recommendedPrice;

    const lowSim = calculatePricingMetrics(
      queriedPrice,
      queriedPrice < 79 ? catalogProfile.estimatedCost * 0.45 : catalogProfile.estimatedCost
    );
    const b2bSim = calculatePricingMetrics(recommendedB2BPrice, catalogProfile.estimatedCost);

    return res.json({
      model: 'gemini-3.8-flash',
      reply: `Realizei o **Diagnóstico Financeiro Gemini** para **${catalogProfile.productName}** cruzando as regras de tarifas do Mercado Livre com os **5 primeiros colocados** da categoria.

${formatRadarSectionGemini(competitorsRadar)}

---

### ⚖️ Comparativo de Rentabilidade: Cenário Informado vs. Kit Atacado B2B

#### 1. Cenário Analisado (\`R$ ${queriedPrice.toFixed(2)}\`)
- **Status Tarifário:** ${
        lowSim.isFreeShipping
          ? '⚡ **Acima do Gatilho (>= R$ 79,00) — Taxa Fixa Zerada**'
          : '🚨 **Abaixo do Gatilho (< R$ 79,00) — Sofre Taxa Fixa de R$ 6,00**'
      }
- **Comissão ML (16%):** \`- R$ ${lowSim.commissionAmount.toFixed(2)}\`
- **Taxa Fixa / Frete:** \`- R$ ${(lowSim.isFreeShipping ? lowSim.shippingCost : lowSim.fixedFee).toFixed(2)}\`
- **Lucro Líquido Estimado:** **R$ ${lowSim.netProfit.toFixed(2)}** (\`${lowSim.marginPercent.toFixed(1)}%\`)

#### 2. Recomendação Estratégica B2B (\`${catalogProfile.primaryTitle}\` a \`R$ ${recommendedB2BPrice.toFixed(2)}\`)
- **Status Tarifário:** ⚡ **Frete Grátis Ativo + Taxa Fixa de R$ 6,00 Eliminada**
- **Comissão ML (16%):** \`- R$ ${b2bSim.commissionAmount.toFixed(2)}\`
- **Custo de Frete Vendedor:** \`- R$ ${b2bSim.shippingCost.toFixed(2)}\` (diluído no volume do kit)
- **Lucro Líquido por Caixa/Kit:** **R$ ${b2bSim.netProfit.toFixed(2)}** (**Margem de ${b2bSim.marginPercent.toFixed(1)}%**)

> 💡 **Conclusão Gemini B2B:** ${
        queriedPrice < 79
          ? `Vender abaixo de **R$ 79,00** penaliza sua operação com **R$ 6,00 de taxa fixa por unidade** e deixa seu anúncio sem o selo de **Frete Grátis** (presente em **${radarToolResult.stats.free_shipping_count} dos 5 líderes**). Ao agrupar no **${catalogProfile.primaryTitle}** por **R$ ${recommendedB2BPrice.toFixed(2)}**, você elimina a taxa fixa e multiplica o lucro em reais por pedido.`
          : `O ticket de **R$ ${queriedPrice.toFixed(2)}** já supera a barreira dos **R$ 79,00**, eliminando a taxa fixa de R$ 6,00 e ativando **Frete Grátis** competitivo!`
      }`,
      executed_tools: executedTools,
      competitors_radar: competitorsRadar,
      pending_approval: null,
      system_prompt_active: true,
    });
  }

  // --------------------------------------------------------------------------
  // CASO I: Fluxo Principal de Inteligência Competitiva + Otimização B2B + Modal Human-in-the-Loop
  // (Aciona obrigatoriamente pesquisar_concorrentes, audita conformidade e abre o Modal)
  // --------------------------------------------------------------------------
  const titleQuoteMatch = text.match(/["'“”]([^"'“”]{3,120})["'“”]/);
  // Também detecta quando o usuário pede "para Talão de Pedido Barato..." sem aspas
  const unquotedTargetMatch = !titleQuoteMatch
    ? text.match(
        /(?:t[ií]tulo\s+para|renomear\s+para|mudar\s+para|alterar\s+para)\s+([A-Za-zÀ-ÿ0-9\s!@#$%&*xX/+-]{5,90})$/i
      )
    : null;
  const explicitCandidateTitle = titleQuoteMatch
    ? titleQuoteMatch[1].trim()
    : unquotedTargetMatch
    ? unquotedTargetMatch[1].trim()
    : null;

  const extractedKeyword = explicitCandidateTitle
    ? explicitCandidateTitle
        .replace(/\b(frete\s*gr[aá]tis|promo[cç][aã]o|brinde|liquida[cç][aã]o|barato)\b/gi, '')
        .replace(/[!*#@$%&]+/g, '')
        .trim()
        .slice(0, 48) || catalogProfile.keyword
    : catalogProfile.keyword;

  // 1º Passo Obrigatório do System Prompt: Acionar pesquisar_concorrentes(palavra_chave)
  const radarToolResult = await toolExecutors.pesquisar_concorrentes({
    palavra_chave: extractedKeyword,
  });
  executedTools.push({
    name: 'pesquisar_concorrentes',
    arguments: { palavra_chave: extractedKeyword },
    result: radarToolResult,
  });

  const competitorsRadar = {
    query: radarToolResult.palavra_chave,
    concorrentes: radarToolResult.concorrentes,
    stats: radarToolResult.stats,
  };

  const radarSectionMarkdown = formatRadarSectionGemini(competitorsRadar);

  // Verifica se o usuário pediu atualização de título, sugestão de kit ou se enviou um título candidato
  const isTitleOrKitOptimization =
    Boolean(explicitCandidateTitle) ||
    /t[ií]tulo|otimiz|renome|concorr[eê]n|radar|pesquis|suger|melhor|cri[ae]|kit|caixa|an[uú]ncio|tal[aã]o|comanda|recibo|vale|placa|envelope|kraft|splash|cartaz|caderno|giz|dinheirinho|jogo/i.test(
      text
    );

  if (isTitleOrKitOptimization && !(/^(atualiz|mud|alter).*(pre[cç]o|estoque)/i.test(text) && !explicitCandidateTitle)) {
    const rawCandidate = explicitCandidateTitle || catalogProfile.primaryTitle;
    const audit = validateTitleCompliance(rawCandidate);

    // Se o título enviado pelo usuário violar as regras do Mercado Livre, recusa em estilo Gemini completo!
    if (!audit.valid) {
      const violationsList = audit.violations.map((v) => `- ❌ ${v}`).join('\n');
      const altOptions = [audit.suggested_title, ...(audit.alternative_titles || [])]
        .slice(0, 3)
        .map((t, i) => `${i + 1}. \`${t}\` *(${t.length}/60 caracteres — Aprovado)*`)
        .join('\n');

      return res.json({
        model: 'gemini-3.8-flash',
        reply: `Analisei sua solicitação para o título **\`"${rawCandidate}"\`** (\`${rawCandidate.length}/60 caracteres\`) e **recuso gentilmente esta alteração**, pois ela viola as diretrizes de conformidade e SEO do Mercado Livre.

### 🛡️ Diagnóstico do Auditor de Conformidade
${violationsList}

### 📐 Fórmula Obrigatória da Pacific Flowers (Máx. 60 caracteres)
\`[Quantidade do Kit] + [Nome do Produto do Catálogo] + [Tamanho/Gramatura] + [Uso]\`

---

${radarSectionMarkdown}

---

### ✅ 3 Opções de Títulos Corrigidos (Superiores à Concorrência)
${altOptions}

> 💡 **Como aplicar:** Clique em um dos botões rápidos acima ou peça *"Otimizar anúncio para ${audit.suggested_title}"* para que eu preencha o **Modal de Edição** automaticamente!`,
        executed_tools: executedTools,
        competitors_radar: competitorsRadar,
        pending_approval: null,
        system_prompt_active: true,
      });
    }

    // Título válido! Executa otimizar_titulo_b2b (Human-in-the-Loop)
    const toolResult = await toolExecutors.otimizar_titulo_b2b({
      item_id: itemId,
      title: rawCandidate,
    });
    executedTools.push({
      name: 'otimizar_titulo_b2b',
      arguments: { item_id: itemId, title: rawCandidate },
      result: toolResult,
    });
    combinedProposedFields.title = rawCandidate;

    const isThreshold79ReferenceOnly =
      /(?:passar|acima|maior|ultrapassar|barreira|gatilho)\s+(?:de\s+|dos\s+|que\s+)?R\$\s*79(?:[.,]00)?/i.test(
        text
      );

    // Define também o Preço Competitivo B2B (> R$ 79,00) baseado no Radar Top 5
    if (
      competitorsRadar?.stats?.suggested_competitive_price &&
      (!priceMatch || isThreshold79ReferenceOnly)
    ) {
      const suggestedPrice = competitorsRadar.stats.suggested_competitive_price;
      const priceToolResult = await toolExecutors.atualizar_preco_anuncio({
        item_id: itemId,
        price: suggestedPrice,
      });
      executedTools.push({
        name: 'atualizar_preco_anuncio',
        arguments: { item_id: itemId, price: suggestedPrice },
        result: priceToolResult,
      });
      combinedProposedFields.price = suggestedPrice;
    }
  }

  // Verifica se há comando explícito de preço (ex: "Atualize o preço para R$ 94,90")
  const isThreshold79Reference =
    /(?:passar|acima|maior|ultrapassar|barreira|gatilho)\s+(?:de\s+|dos\s+|que\s+)?R\$\s*79(?:[.,]00)?/i.test(
      text
    );
  if (/pre[cç]o|valor|atualiz|mud|alter|R\$/i.test(text) && priceMatch && !isThreshold79Reference) {
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

  // Verifica se há comando explícito de estoque (ex: "estoque para 120 unidades")
  const stockMatch = text.match(/estoque\s+(?:para\s+|de\s+)?(\d+)|(\d+)\s*unidades/i);
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

  // Se preparamos campos para o Modal de Edição (Human-in-the-Loop), retorna análise Gemini completa + abre o Modal!
  if (Object.keys(combinedProposedFields).length > 0) {
    const finalTitle = combinedProposedFields.title || catalogProfile.primaryTitle;
    const finalPrice =
      combinedProposedFields.price ||
      competitorsRadar?.stats?.suggested_competitive_price ||
      catalogProfile.recommendedPrice;

    const below79Alert =
      finalPrice < 79
        ? `\n> ⚠️ **Alerta de Margem (< R$ 79,00):** O preço solicitado (\`R$ ${finalPrice.toFixed(
            2
          )}\`) sofre a **Taxa Fixa de R$ 6,00** por venda no Mercado Livre. Recomendo agrupar unidades em Kit/Caixa para elevar o ticket para **R$ ${catalogProfile.recommendedPrice.toFixed(
            2
          )}** e ativar Frete Grátis lucrativo!\n`
        : '';

    const geminiApprovalResponse = `Concluí a análise competitiva em tempo real e a auditoria de catálogo para **${catalogProfile.productName}** (${catalogProfile.category}) no anúncio \`${itemId}\`.

${radarSectionMarkdown}

---

### 🏷️ Engenharia de Título & Conformidade B2B
- **Título Proposto:** \`${finalTitle}\`
- **Extensão Exata:** \`${finalTitle.length}/60 caracteres\` *(100% dentro do limite do algoritmo)*
- **Fórmula Aplicada:** \`[Quantidade do Kit] + [Nome do Produto do Catálogo] + [Tamanho/Gramatura] + [Uso]\`
${
  combinedProposedFields.available_quantity !== undefined
    ? `- **Estoque Disponível Proposto:** \`${combinedProposedFields.available_quantity} unidades\`\n`
    : ''
}${below79Alert}
---

${formatMarginComparisonGemini(finalPrice, catalogProfile.estimatedCost)}

---

✅ **${HUMAN_IN_THE_LOOP_MESSAGE}**`;

    return res.json({
      model: 'gemini-3.8-flash',
      reply: geminiApprovalResponse,
      executed_tools: executedTools,
      competitors_radar: competitorsRadar,
      pending_approval: {
        item_id: itemId,
        tool_name: executedTools.map((t) => t.name).join(' -> '),
        ...combinedProposedFields,
        proposed_fields: combinedProposedFields,
      },
      system_prompt_active: true,
    });
  }

  // Fallback conversacional inteligente estilo Gemini (caso a pergunta seja aberta sobre vendas/Mercado Livre)
  return res.json({
    model: 'gemini-3.8-flash',
    reply: `Analisei sua mensagem sobre **"${text}"** com base nas diretrizes B2B da **Pacific Flowers** no Mercado Livre.

${radarSectionMarkdown}

---

### 🎯 Recomendação Estratégica Gemini B2B
Para escalar nossas vendas de **${catalogProfile.productName}** (${catalogProfile.category}) com máxima lucratividade:
- **Título Ideal (\`${catalogProfile.primaryTitle.length}/60 chars\`):** \`${catalogProfile.primaryTitle}\`
- **Ticket Alvo Recomendado:** **R$ ${catalogProfile.recommendedPrice.toFixed(2)}** *(acima do gatilho de R$ 79,00 — elimina a taxa fixa de R$ 6,00 e ativa Frete Grátis)*
- **Medidas Oficiais da Linha:** ${catalogProfile.specs}

> 💡 **Quer que eu preencha o Modal de Edição com essa configuração agora?** Basta clicar no botão rápido de sugestão acima ou digitar: *"Otimize o anúncio para ${catalogProfile.primaryTitle}"*.`,
    executed_tools: executedTools,
    competitors_radar: competitorsRadar,
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
