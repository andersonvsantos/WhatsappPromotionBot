const { Ollama } = require('ollama');

const OLLAMA_MODEL = 'llama3.2:3b';
const ollama = new Ollama({ host: 'http://127.0.0.1:11434' });

// Bateria de testes com produtos de categorias distintas
const ofertasDeTeste = [
    {
        titulo: "Monitor Gamer 24\" 200Hz Full HD 1ms IPS FreeSync",
        precoDe: "999,00",
        precoPor: "699,00",
        cupom: "MONITOR10",
        link: "https://www.mercadolivre.com.br/p/MLB111222"
    },
    {
        titulo: "Fritadeira Elétrica Air Fryer 4L 1500W Antiaderente",
        precoDe: "399,00",
        precoPor: "249,90",
        cupom: "COZINHA50",
        link: "https://www.mercadolivre.com.br/p/MLB333444"
    },
    {
        titulo: "Tênis Esportivo Masculino para Corrida e Caminhada",
        precoDe: "299,90",
        precoPor: "159,90",
        cupom: null,
        link: "https://www.mercadolivre.com.br/p/MLB555666"
    },
    {
        titulo: "100% Whey Protein Concentrado 900g Growth Supplements",
        precoDe: "120,00",
        precoPor: "89,90",
        cupom: "SUPLE10",
        link: "https://www.mercadolivre.com.br/p/MLB777888"
    },
    {
        titulo: "Kit 5 Potes de Vidro Herméticos Mantimentos com Tampa",
        precoDe: "149,00",
        precoPor: "89,00",
        cupom: null,
        link: "https://www.mercadolivre.com.br/p/MLB999000"
    },
    {
        titulo: "Smartphone Samsung Galaxy A36 5G 128GB",
        precoDe: "1.999,00",
        precoPor: "1.299,00",
        cupom: "GALAXY100",
        link: "https://www.mercadolivre.com.br/p/MLB123456"
    },
    {
        titulo: "Cadeira de Escritório Ergonômica Presidente com Rodízios",
        precoDe: "699,00",
        precoPor: "429,00",
        cupom: "OFFICE20",
        link: "https://www.mercadolivre.com.br/p/MLB222333"
    },
    {
        titulo: "Jogo de Ferramentas Automotivo 110 Peças Aço Cromo Vanádio",
        precoDe: "350,00",
        precoPor: "199,00",
        cupom: null,
        link: "https://www.mercadolivre.com.br/p/MLB444555"
    }
];

async function testarOferta(oferta, index) {
    console.log(`\n================ TESTE ${index + 1}/${ofertasDeTeste.length}: ${oferta.titulo.toUpperCase()} ================`);

    const systemPrompt = `Você é um assistente de ofertas no WhatsApp.
Sua tarefa é analisar o nome do produto recebido, identificar exatamente o que ele é e gerar uma chamada curta e precisa para ele.

FORMATO OBRIGATÓRIO DE SAÍDA:
<Frase de destaque adequada ao produto exato> 🔥

📦 *<Nome do Produto>*
${oferta.precoDe ? 'De: ~R$ ' + oferta.precoDe + '~\n' : ''}Por apenas: *R$ ${oferta.precoPor}*
${oferta.cupom ? '🎟️ Cupom: *' + oferta.cupom + '*\n' : ''}
👉 Compre agora: ${oferta.link}

REGRAS RÍGIDAS:
1. Identifique o tipo real do produto pelo título (ex: monitor, tênis, whey, ferramenta, celular). NUNCA chame algo que não seja um celular de "celular".
2. Crie apenas UMA frase curta e empolgante na primeira linha sobre a categoria/utilidade real do produto.
3. Respeite a estrutura exata fornecida acima e pare de escrever logo após o link.`;

    const userPrompt = `Produto: ${oferta.titulo}`;

    try {
        const response = await ollama.chat({
            model: OLLAMA_MODEL,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            options: {
                temperature: 0.2, // Baixa variação para evitar alucinações de categoria
                num_predict: 130
            }
        });

        if (response?.message?.content) {
            const textoLimpo = response.message.content.trim().replace(/^"+|"+$/g, '');
            console.log(textoLimpo);
        }
    } catch (error) {
        console.error(`❌ Erro no teste ${index + 1}:`, error.message || error);
    }
}

async function rodarBateriaDeTestes() {
    console.log(`🚀 Iniciando bateria de testes com ${ofertasDeTeste.length} produtos no Ollama (${OLLAMA_MODEL})...\n`);
    for (let i = 0; i < ofertasDeTeste.length; i++) {
        await testarOferta(ofertasDeTeste[i], i);
        // Pequena pausa entre requisições locais
        await new Promise(res => setTimeout(res, 500));
    }
    console.log("\n================ BATERIA DE TESTES CONCLUÍDA ================");
}

if (require.main === module) {
    rodarBateriaDeTestes();
}