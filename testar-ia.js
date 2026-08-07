const fs = require('fs');
const path = require('path');
const { Ollama } = require('ollama');

const OLLAMA_MODEL = 'llama3.2:3b';

const ollama = new Ollama({ host: 'http://127.0.0.1:11434' });

const ofertaExemplo = {
    titulo: "Smartphone Samsung Galaxy A36 5G 128GB",
    precoDe: "1.999,00",
    precoPor: "1.299,00",
    cupom: "GALAXY100",
    link: "https://www.mercadolivre.com.br/p/MLB123456"
};

async function testarIA() {
    console.log(`🚀 Gerando anúncio no formato estruturado com Ollama (${OLLAMA_MODEL})...\n`);

    const systemPrompt = `Você é um divulgador de ofertas direto, moderno e objetivo no WhatsApp.
Sua missão é criar uma mensagem no formato EXATO abaixo:

<Frase curta de destaque do produto> 🔥

📱 *<Nome do Produto>*
De: ~<Preço De>~
Por apenas: *<Preço Por>*
🎟️ Cupom: *<Cupom>*

👉 Compre agora: <Link>

Exemplos de chamadas para a primeira linha:
- Celulares/Tech: Celular top de linha com excelente custo-benefício!
- Roupas masculinas: Cueca extremamente confortável e de alta qualidade pra rapizada!
- Roupas femininas: Topzinho confortável e estiloso pras meninas!
- Cozinha/Casa: Potes reforçados e perfeitos pra levar sua marmita!

REGRAS RÍGIDAS:
1. Mantenha exatamente as quebras de linha mostradas no formato.
2. Destaque o nome do produto, o Preço Por e o Cupom em *negrito*.
3. Mostre o preço antigo com ~riscado~.
4. Termine com o link. Não escreva nada depois dele.`;

    const userPrompt = `Gere a oferta no formato estruturado:
- Produto: ${ofertaExemplo.titulo}
- Preço De: R$ ${ofertaExemplo.precoDe}
- Preço Por: R$ ${ofertaExemplo.precoPor}
- Cupom: ${ofertaExemplo.cupom}
- Link: ${ofertaExemplo.link}`;

    try {
        const response = await ollama.chat({
            model: OLLAMA_MODEL,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            options: {
                temperature: 0.4, // Mantém a estrutura bem comportada e sem inventar moda
                num_predict: 150
            }
        });

        if (response?.message?.content) {
            const textoLimpo = response.message.content.trim().replace(/^"+|"+$/g, '');
            
            console.log("================ MENSAGEM GERADA ================\n");
            console.log(textoLimpo);
            console.log("\n=================================================");
        }
    } catch (error) {
        console.error("❌ Erro ao chamar o Ollama:", error.message || error);
    }
}

if (require.main === module) {
    testarIA();
}