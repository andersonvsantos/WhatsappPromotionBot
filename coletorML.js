const axios = require('axios');
const cheerio = require('cheerio');

// ==========================================
// CONFIGURAÇÕES
// ==========================================
const MEU_TAG_AFILIADO = process.env.ML_AFFILIATE_TAG || 'vean5438384';
const API_LOCAL_URL = 'http://127.0.0.1:3000/ofertas';
const QTD_PRODUTOS_POR_BUSCA = 10; // Limite total de produtos por rodada
const PRODUTOS_POR_CATEGORIA = 1;  // Troca de categoria a cada produto
const INTERVALO_MINUTOS = 50;     // Tempo entre cada verificação automática

// Conjunto para controle de duplicados em memória (evita reenviar o mesmo item)
const linksEnviados = new Set();

// Páginas de ofertas/promoções do Mercado Livre
const URLS_OFERTAS = [
  'https://www.mercadolivre.com.br/ofertas',

  // Tecnologia
  'https://www.mercadolivre.com.br/ofertas?category=MLB1055', // Celulares
  'https://www.mercadolivre.com.br/ofertas?category=MLB1051', // Informática
  'https://www.mercadolivre.com.br/ofertas?category=MLB1144', // Games

  // Casa
  'https://www.mercadolivre.com.br/ofertas?category=MLB5726', // Eletrodomésticos
  'https://www.mercadolivre.com.br/ofertas?category=MLB1574', // Casa e Decoração

  // Consumo recorrente
  'https://www.mercadolivre.com.br/ofertas?category=MLB1246', // Beleza
  'https://www.mercadolivre.com.br/ofertas?category=MLB1499', // Esportes

  // Ticket alto
  'https://www.mercadolivre.com.br/ofertas?category=MLB1743', // Auto Peças
  'https://www.mercadolivre.com.br/ofertas?category=MLB1648', // Ferramentas
];

function gerarLinkAfiliado(permalink) {
    if (!permalink) return '';
    const cleanUrl = permalink.split('#')[0];
    const separator = cleanUrl.includes('?') ? '&' : '?';
    return `${cleanUrl}${separator}matt_tool=${MEU_TAG_AFILIADO}`;
}

/**
 * Função utilitária de delay
 */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Embaralha um array de forma aleatória (Algoritmo Fisher-Yates)
 */
function embaralharArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/**
 * Raspagem de uma URL específica do ML
 */
async function rasparCategoria(url) {
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
                'Accept-Language': 'pt-BR,pt;q=0.9',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
            }
        });

        const $ = cheerio.load(response.data);
        const produtosRaspados = [];

        $('.promotions_promotion-item, .promotion-item, .poly-card').each((index, element) => {
            const titulo = $(element).find('.promotions_promotion-item__title, .poly-component__title, .promotion-item__title').text().trim();
            const link = $(element).find('a').attr('href');
            
            const precoPorText = $(element).find('.andromeda-price__fraction, .poly-price__current .andes-money-amount__fraction').first().text().trim();
            const precoDeText = $(element).find('.andes-money-amount--previous .andes-money-amount__fraction').first().text().trim();

            // Captura da imagem com fallback para atributos de lazy loading
            const imgElement = $(element).find('img').first();
            const imagemUrl = imgElement.attr('data-src') || imgElement.attr('src') || imgElement.attr('data-lazy') || null;

            if (titulo && link && precoPorText) {
                produtosRaspados.push({
                    titulo,
                    link,
                    precoPor: precoPorText,
                    precoDe: precoDeText || null,
                    imagemUrl: imagemUrl
                });
            }
        });

        return produtosRaspados;
    } catch (error) {
        console.error(`❌ [Coletor ML] Erro ao raspar URL (${url}):`, error.message);
        return [];
    }
}

/**
 * Raspagem e processamento rotativo de ofertas do Mercado Livre
 */
async function buscarOfertasML() {
    console.log(`\n🔎 [Coletor ML] Coletando até ${QTD_PRODUTOS_POR_BUSCA} ofertas (alternando a cada ${PRODUTOS_POR_CATEGORIA} produtos)...`);

    const loteParaEnviar = [];
    const categoriasDisponiveis = embaralharArray(URLS_OFERTAS);
    let indexCategoria = 0;

    // Loop de coleta alternada por categoria
    while (loteParaEnviar.length < QTD_PRODUTOS_POR_BUSCA && categoriasDisponiveis.length > 0) {
        const urlAlvo = categoriasDisponiveis[indexCategoria % categoriasDisponiveis.length];
        
        const produtosRaspados = await rasparCategoria(urlAlvo);
        const produtosNovos = embaralharArray(produtosRaspados).filter(
            p => !linksEnviados.has(p.link) && !loteParaEnviar.some(item => item.link === p.link)
        );

        // Seleciona produtos desta categoria conforme limite
        const selecionados = produtosNovos.slice(0, PRODUTOS_POR_CATEGORIA);

        if (selecionados.length > 0) {
            loteParaEnviar.push(...selecionados);
            indexCategoria++;
        } else {
            // Se a categoria não tem mais produtos novos, remove da lista da rodada
            categoriasDisponiveis.splice(indexCategoria % categoriasDisponiveis.length, 1);
        }

        // Aguarda 1s entre as requisições das páginas de ofertas
        await delay(1000);
    }

    if (loteParaEnviar.length === 0) {
        console.log('⚠️ [Coletor ML] Nenhum produto novo encontrado nesta tentativa.');
        return;
    }

    console.log(`📦 [Coletor ML] ${loteParaEnviar.length} novos produtos selecionados para envio.\n`);

    let enviadosComSucesso = 0;

    for (const produto of loteParaEnviar) {
        const precoPorNum = parseFloat(produto.precoPor.replace(/\./g, '').replace(',', '.'));
        const precoDeNum = produto.precoDe 
            ? parseFloat(produto.precoDe.replace(/\./g, '').replace(',', '.'))
            : precoPorNum * 1.15;

        const payloadOferta = {
            titulo: produto.titulo,
            precoDe: precoDeNum.toFixed(2).replace('.', ','),
            precoPor: precoPorNum.toFixed(2).replace('.', ','),
            cupom: null,
            link: gerarLinkAfiliado(produto.link),
            imagemUrl: produto.imagemUrl
        };

        try {
            // Marca no histórico de enviados
            linksEnviados.add(produto.link);

            console.log(`➡️ Enviando (${enviadosComSucesso + 1}/${loteParaEnviar.length}): "${payloadOferta.titulo}"`);
            
            const res = await axios.post(API_LOCAL_URL, payloadOferta);
            
            if (res.data?.descartado) {
                console.log(`   🗑️ Descartado pela IA: ${res.data.motivo}`);
            } else {
                console.log(`   ✅ Aprovado e enfileirado!`);
            }

            enviadosComSucesso++;

            // Pausa de 1,5s entre requisições para a API processar com calma
            await delay(1500);

        } catch (err) {
            console.error(`   ❌ Erro ao enviar item "${produto.titulo}":`, err.message);
        }
    }

    // Limpa a memória se o histórico ficar muito grande (mais de 300 itens)
    if (linksEnviados.size > 300) {
        linksEnviados.clear();
    }

    console.log(`\n✨ [Coletor ML] Finalizado envio do lote. Total processado: ${enviadosComSucesso}`);
}

/**
 * Inicializador e Agendador Contínuo
 */
function iniciarColetorAutomatico() {
    console.log(`🚀 [Coletor ML] Iniciado em modo contínuo!`);
    console.log(`⏱️ Rodará a cada ${INTERVALO_MINUTOS} minutos buscando ${QTD_PRODUTOS_POR_BUSCA} produtos por vez.`);

    // Execução imediata ao iniciar
    buscarOfertasML();

    // Loop com setInterval
    setInterval(() => {
        buscarOfertasML();
    }, INTERVALO_MINUTOS * 60 * 1000);
}

// Permite executar via terminal
if (require.main === module) {
    iniciarColetorAutomatico();
}

module.exports = { buscarOfertasML, iniciarColetorAutomatico };