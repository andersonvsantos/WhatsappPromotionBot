const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

function carregarVariaveisDoEnv() {
    const caminhos = [path.join(__dirname, '.env'), path.join(__dirname, '.env.local')];

    for (const arquivo of caminhos) {
        if (!fs.existsSync(arquivo)) continue;

        const conteudo = fs.readFileSync(arquivo, 'utf8');
        const variaveis = {};

        for (const linha of conteudo.split(/\r?\n/)) {
            const texto = linha.trim();
            if (!texto || texto.startsWith('#')) continue;

            const separador = texto.indexOf('=');
            if (separador === -1) continue;

            const chave = texto.slice(0, separador).trim();
            let valor = texto.slice(separador + 1).trim();

            if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
                valor = valor.slice(1, -1);
            }

            variaveis[chave] = valor;
        }

        return { variaveis, arquivo };
    }

    return { variaveis: {}, arquivo: null };
}

function obterApiKey() {
    const ambiente = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
    if (ambiente.trim()) return ambiente.trim();

    const { variaveis } = carregarVariaveisDoEnv();
    const chaveArquivo = (variaveis.GEMINI_API_KEY || variaveis.GOOGLE_API_KEY || '').trim();
    if (chaveArquivo) return chaveArquivo;

    // Fallback temporário para testes locais
    return 'AIzaSyCZ6v0cv2mRivwJ5m0_3p9QNUob1zLxE3M';
}

const apiKey = obterApiKey();
console.log('🔑 Chave Gemini carregada:', apiKey ? 'Sim' : 'Não');

// Inicializa o SDK com a API Key informada
const ai = new GoogleGenAI({ apiKey });

const ofertaExemplo = {
    titulo: "Smartphone Samsung Galaxy A36 5G 128GB",
    precoDe: "1.999,00",
    precoPor: "1.299,00",
    cupom: "GALAXY100",
    link: "https://www.mercadolivre.com.br/p/MLB123456"
};

async function testarIA() {
    console.log("🚀 Testando geração de anúncio com o Gemini...\n");

    const prompt = `
Você é um especialista em marketing, humorista e copywriter criativo de grupos de ofertas no WhatsApp.
Crie um anúncio CURTO, ENGRAÇADO, DIVERTIDO e persuasivo para a oferta abaixo.

Dados da Oferta:
- Produto: ${ofertaExemplo.titulo}
- Preço De: R$ ${ofertaExemplo.precoDe}
- Preço Por: R$ ${ofertaExemplo.precoPor}
- Cupom: ${ofertaExemplo.cupom}
- Link: ${ofertaExemplo.link}

Regras Obrigatórias:
1. Comece com uma piada curta ou comentário bem-humorado sobre compras por impulso, falência, desculpas para o/a cônjuge ou humor cotidiano.
2. Use a formatação nativa do WhatsApp (*negrito*, _itálico_, ~riscado~).
3. Destaque o Preço Por em *negrito*.
4. Se houver cupom, exiba-o com destaque em *negrito*.
5. Mantenha obrigatoriamente o link original intacto no final da mensagem.
6. Não adicione textos explicativos nem saudações genéricas fora da copy.
`;

    try {
        if (!apiKey) {
            throw new Error('Nenhuma API key do Gemini foi encontrada. Defina GEMINI_API_KEY ou GOOGLE_API_KEY no ambiente ou em um arquivo .env.');
        }

        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: prompt
        });

        console.log("================ MENSAGEM GERADA ================\n");
        console.log(response.text);
        console.log("\n=================================================");
    } catch (error) {
        console.error("❌ Erro ao chamar a API:", error.message || error);
    }
}

module.exports = { carregarVariaveisDoEnv, obterApiKey, testarIA };

if (require.main === module) {
    testarIA();
}