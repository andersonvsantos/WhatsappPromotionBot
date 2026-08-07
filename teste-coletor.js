const axios = require('axios');
const cheerio = require('cheerio');

// ==========================================
// CONFIGURAÇÕES DE TESTE
// ==========================================
const MEU_TAG_AFILIADO = process.env.ML_AFFILIATE_TAG || 'vean5438384';
const API_LOCAL_URL = 'http://127.0.0.1:3000/ofertas';
const URL_TESTE = 'https://www.mercadolivre.com.br/ofertas';

function gerarLinkAfiliado(permalink) {
    if (!permalink) return '';
    const cleanUrl = permalink.split('#')[0];
    const separator = cleanUrl.includes('?') ? '&' : '?';
    return `${cleanUrl}${separator}matt_tool=${MEU_TAG_AFILIADO}`;
}

async function executarTesteIntegrado() {
    console.log('🧪 ==========================================');
    console.log('🧪 INICIANDO TESTE DO COLETOR + INTEGRAÇÃO API');
    console.log('🧪 ==========================================\n');

    try {
        // 1. RASPAGEM DA PÁGINA
        console.log(`📡 1. Fazendo requisição HTTP para: ${URL_TESTE}...`);
        const response = await axios.get(URL_TESTE, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
                'Accept-Language': 'pt-BR,pt;q=0.9',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
            }
        });

        console.log('✅ Resposta recebida da web! Carregando HTML no Cheerio...');
        const $ = cheerio.load(response.data);
        const produtosEncontrados = [];

        $('.promotions_promotion-item, .promotion-item, .poly-card').each((index, element) => {
            const titulo = $(element).find('.promotions_promotion-item__title, .poly-component__title, .promotion-item__title').text().trim();
            const link = $(element).find('a').attr('href');
            
            const precoPorText = $(element).find('.andromeda-price__fraction, .poly-price__current .andes-money-amount__fraction').first().text().trim();
            const precoDeText = $(element).find('.andes-money-amount--previous .andes-money-amount__fraction').first().text().trim();

            const imgElement = $(element).find('img').first();
            const imagemUrl = imgElement.attr('data-src') || imgElement.attr('src') || imgElement.attr('data-lazy') || null;

            if (titulo && link && precoPorText) {
                produtosEncontrados.push({
                    titulo,
                    link,
                    precoPorText,
                    precoDeText: precoDeText || null,
                    imagemUrl
                });
            }
        });

        console.log(`📊 Total de produtos raspados na página: ${produtosEncontrados.length}`);

        if (produtosEncontrados.length === 0) {
            console.error('❌ Nenhum produto foi capturado. Verifique se os seletores CSS do Mercado Livre mudaram.');
            return;
        }

        // 2. SELEÇÃO E FORMATO DO PAYLOAD
        const itemSelecionado = produtosEncontrados[0]; // Pega o primeiro item capturado
        console.log('\n📦 2. Produto selecionado para o teste:');
        console.log(JSON.stringify(itemSelecionado, null, 2));

        const precoPorNum = parseFloat(itemSelecionado.precoPorText.replace(/\./g, '').replace(',', '.'));
        const precoDeNum = itemSelecionado.precoDeText 
            ? parseFloat(itemSelecionado.precoDeText.replace(/\./g, '').replace(',', '.'))
            : precoPorNum * 1.15;

        const payloadOferta = {
            titulo: itemSelecionado.titulo,
            precoDe: precoDeNum.toFixed(2).replace('.', ','),
            precoPor: precoPorNum.toFixed(2).replace('.', ','),
            cupom: null,
            link: gerarLinkAfiliado(itemSelecionado.link),
            imagem: itemSelecionado.imagemUrl // Atributo esperado pelo seu endpoint com suporte a imagem
        };

        console.log('\n📤 3. Enviando o seguinte Payload para a API Local:');
        console.log(JSON.stringify(payloadOferta, null, 2));

        // 3. ENVIO PARA A API
        const res = await axios.post(API_LOCAL_URL, payloadOferta);

        console.log('\n✅ 4. Resposta recebida da API HTTP:');
        console.log('Status HTTP:', res.status);
        console.log('Corpo da Resposta:', res.data);

        console.log('\n🎉 TESTE CONCLUÍDO COM SUCESSO!');

    } catch (error) {
        console.error('\n❌ ERRO DURANTE O TESTE:');
        if (error.response) {
            console.error(`HTTP Status: ${error.response.status}`);
            console.error('Resposta de erro:', error.response.data);
        } else {
            console.error('Mensagem:', error.message);
        }
    }
}

executarTesteIntegrado();