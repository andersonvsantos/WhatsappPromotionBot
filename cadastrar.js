// Lista com 5 ofertas para cadastrar na fila
const listaDeOfertas = [
    {
        titulo: "Smartphone Samsung Galaxy A36 5G 128GB",
        precoDe: "1.899,00",
        precoPor: "1.299,00",
        cupom: "OFERTA100",
        link: "https://www.mercadolivre.com.br"
    },
    {
        titulo: "Monitor Gamer 24\" 200Hz Full HD 1ms",
        precoDe: "1.199,00",
        precoPor: "849,00",
        cupom: "GAMER10",
        link: "https://www.amazon.com.br"
    },
    {
        titulo: "Kit Teclado Mecânico RGB + Mouse Gamer 12000 DPI",
        precoDe: "299,00",
        precoPor: "179,90",
        cupom: "SETUPTOP",
        link: "https://www.shopee.com.br"
    },
    {
        titulo: "Mousepad Gamer Speed Extra Grande 90x40cm",
        precoDe: "89,00",
        precoPor: "45,90",
        cupom: null,
        link: "https://www.mercadolivre.com.br"
    },
    {
        titulo: "Fone de Ouvido Bluetooth TWS Sem Fio",
        precoDe: "159,00",
        precoPor: "89,90",
        cupom: "AUDIO15",
        link: "https://www.amazon.com.br"
    }
];

const API_URL = 'http://localhost:3000/ofertas';

async function enviarOfertasEmLote() {
    console.log(`🚀 Iniciando o envio de ${listaDeOfertas.length} ofertas para a fila...\n`);

    for (let i = 0; i < listaDeOfertas.length; i++) {
        const oferta = listaDeOfertas[i];

        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(oferta)
            });

            const data = await response.json();

            if (response.ok && data.success) {
                console.log(`✅ [${i + 1}/${listaDeOfertas.length}] "${oferta.titulo}" -> Adicionado! (Posição na fila: ${data.posicaoNaFila})`);
            } else {
                console.error(`❌ [${i + 1}/${listaDeOfertas.length}] Erro ao adicionar "${oferta.titulo}":`, data.error || data.message);
            }
        } catch (error) {
            console.error(`💥 Erro de conexão ao enviar "${oferta.titulo}":`, error.message);
        }
    }

    console.log('\n✨ Todas as 5 ofertas foram enviadas para a fila com sucesso!');
}

enviarOfertasEmLote();