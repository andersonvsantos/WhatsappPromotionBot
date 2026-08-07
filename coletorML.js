const axios = require('axios');
const cheerio = require('cheerio');

// ==========================================
// CONFIGURAÇÕES
// ==========================================
const MEU_TAG_AFILIADO = process.env.ML_AFFILIATE_TAG || 'vean5438384';
const API_LOCAL_URL = 'http://127.0.0.1:3000/ofertas';

// Páginas de ofertas/promoções do Mercado Livre
const URLS_OFERTAS = [
    'https://www.mercadolivre.com.br/ofertas',
    'https://www.mercadolivre.com.br/ofertas?category=MLB1051', // Informática
    'https://www.mercadolivre.com.br/ofertas?category=MLB1055', // Celulares
    'https://www.mercadolivre.com.br/ofertas?category=MLB5726', // Eletrodomésticos
    'https://www.mercadolivre.com.br/ofertas?category=MLB1499'  // Fitness / Esportes
];

function gerarLinkAfiliado(permalink) {
    if (!permalink) return '';
    const cleanUrl = permalink.split('#')[0];
    const separator = cleanUrl.includes('?') ? '&' : '?';
    return `${cleanUrl}${separator}matt_tool=${MEU_TAG_AFILIADO}`;
}

/**
 * Raspagem de dados diretamente da página de Ofertas do Mercado Livre
 */
async function buscarOfertasML() {
    console.log('🔎 [Coletor ML] Raspando ofertas do Mercado Livre...');

    const urlAlvo = URLS_OFERTAS[Math.floor(Math.random() * URLS_OFERTAS.length)];

    try {
        const response = await axios.get(urlAlvo, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
                'Accept-Language': 'pt-BR,pt;q=0.9',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
            }
        });

        const $ = cheerio.load(response.data);
        const produtos = [];

        // Varre os cards de produtos da página de Ofertas
        $('.promotions_promotion-item, .promotion-item, .poly-card').each((index, element) => {
            const titulo = $(element).find('.promotions_promotion-item__title, .poly-component__title, .promotion-item__title').text().trim();
            const link = $(element).find('a').attr('href');
            
            // Pega os preços
            const precoPorText = $(element).find('.andromeda-price__fraction, .poly-price__current .andes-money-amount__fraction').first().text().trim();
            const precoDeText = $(element).find('.andes-money-amount--previous .andes-money-amount__fraction').first().text().trim();

            if (titulo && link && precoPorText) {
                produtos.push({
                    titulo,
                    link,
                    precoPor: precoPorText,
                    precoDe: precoDeText || null
                });
            }
        });

        if (produtos.length === 0) {
            console.log('⚠️ [Coletor ML] Nenhum card de produto capturado nesta tentativa. Tentando novamente...');
            return;
        }

        // Escolhe um produto aleatório da lista raspada
        const produto = produtos[Math.floor(Math.random() * produtos.length)];

        const precoPorNum = parseFloat(produto.precoPor.replace(/\./g, '').replace(',', '.'));
        const precoDeNum = produto.precoDe 
            ? parseFloat(produto.precoDe.replace(/\./g, '').replace(',', '.'))
            : precoPorNum * 1.15;

        const payloadOferta = {
            titulo: produto.titulo,
            precoDe: precoDeNum.toFixed(2).replace('.', ','),
            precoPor: precoPorNum.toFixed(2).replace('.', ','),
            cupom: null,
            link: gerarLinkAfiliado(produto.link)
        };

        console.log(`✨ [Coletor ML] Oferta capturada: "${payloadOferta.titulo}" - R$ ${payloadOferta.precoPor}`);

        // Envia para o servidor local
        await axios.post(API_LOCAL_URL, payloadOferta);
        console.log(`✅ [Coletor ML] Oferta enviada para a fila do bot com sucesso!\n`);

    } catch (error) {
        console.error('❌ [Coletor ML] Erro durante a raspagem:', error.message);
    }
}

// Permite executar via terminal
if (require.main === module) {
    buscarOfertasML();
}

module.exports = { buscarOfertasML };