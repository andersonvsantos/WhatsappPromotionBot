const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const express = require('express');
const { GoogleGenAI } = require('@google/genai');

// ==========================================
// CONFIGURAÇÕES E ESTADO DA APLICAÇÃO
// ==========================================
const PORT = 3000;
const GEMINI_MODEL = 'gemini-2.0-flash-lite';
const GEMINI_COOLDOWN_MS = 60 * 1000;
let isReady = false;
let targetGroupId = null;   // ID do grupo selecionado para ofertas
let targetGroupName = null; // Nome do grupo selecionado para ofertas
let currentQrBase64 = null; // QR Code em Base64 para exibir na rota /qr
let server = null;
let shuttingDown = false;
let loopStopRequested = false;
let lastGeminiCallAt = 0;

function carregarVariaveisDoEnv() {
    const arquivoEnv = path.join(__dirname, '.env');
    if (!fs.existsSync(arquivoEnv)) return;

    const conteudo = fs.readFileSync(arquivoEnv, 'utf8');
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

        process.env[chave] = valor;
    }
}

carregarVariaveisDoEnv();

function obterApiKeyGemini() {
    return (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
}

const geminiApiKey = obterApiKeyGemini();
console.log(`🔑 Gemini API Key carregada: ${geminiApiKey ? 'Sim' : 'Não'}`);

const ai = geminiApiKey ? new GoogleGenAI({ apiKey: geminiApiKey }) : null;

// Fila em memória para armazenar as ofertas pendentes
const ofertasQueue = [];

const app = express();

function formatErrorForLog(context, error, extra = {}) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    return {
        context,
        timestamp: new Date().toISOString(),
        message: normalizedError.message,
        stack: normalizedError.stack || null,
        ...extra
    };
}

function buildErrorPayload(message, error, extra = {}) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    return {
        success: false,
        message,
        ...extra,
        error: {
            message: normalizedError.message,
            stack: normalizedError.stack || null
        }
    };
}

function logError(context, error, extra = {}) {
    const payload = formatErrorForLog(context, error, extra);
    console.error(`[${payload.timestamp}] ❌ ${payload.context}`, JSON.stringify(payload, null, 2));
}

function isChatTargetCompatible(chatOrId) {
    if (!chatOrId) return false;

    if (typeof chatOrId === 'string') {
        const normalizedId = chatOrId.toString().trim();
        return normalizedId.endsWith('@g.us') || normalizedId.endsWith('@broadcast') || normalizedId.endsWith('@newsletter');
    }

    if (typeof chatOrId === 'object') {
        return Boolean(chatOrId.isGroup || chatOrId.isBroadcast || chatOrId.isChannel || chatOrId.isNewsletter);
    }

    return false;
}

// Middlewares defensivos para parsing do Body
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuração do WhatsApp Client
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});

// ==========================================
// FUNÇÕES DE SUPORTE E IA
// ==========================================

function getTempoAleatorioMs(minMinutes = 3, maxMinutes = 6) {
    const minMs = minMinutes * 60 * 1000;
    const maxMs = maxMinutes * 60 * 1000;
    return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

function getHorarioAtual() {
    return new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function eHorarioPermitido() {
    const horaStr = new Date().toLocaleTimeString('pt-BR', { 
        timeZone: 'America/Sao_Paulo', 
        hour: '2-digit', 
        hour12: false 
    });
    const hora = parseInt(horaStr, 10);
    return hora >= 8 && hora < 23;
}

/**
 * Gera um texto engraçado e variado para a oferta utilizando a API do Gemini
 */
async function gerarMensagemComIA(oferta) {
    if (!geminiApiKey || !ai) {
        console.log('⚠️ Gemini não configurado. Usando layout padrão.');
        return gerarLayoutPadrao(oferta);
    }

    const now = Date.now();
    if (now - lastGeminiCallAt < GEMINI_COOLDOWN_MS) {
        console.log('⏱️ Aguardando cooldown do Gemini para evitar quota. Usando layout padrão.');
        return gerarLayoutPadrao(oferta);
    }

    try {
        lastGeminiCallAt = now;

        const prompt = `
Você é um especialista em marketing, humorista e copywriter criativo de grupos de ofertas no WhatsApp.
Crie um anúncio CURTO, ENGRAÇADO, DIVERTIDO e persuasivo para a oferta abaixo.

Dados da Oferta:
- Produto: ${oferta.titulo}
- Preço De: ${oferta.precoDe ? 'R$ ' + oferta.precoDe : 'Não informado'}
- Preço Por: R$ ${oferta.precoPor}
- Cupom: ${oferta.cupom || 'Nenhum'}
- Link: ${oferta.link}

Regras Obrigatórias:
1. Comece com uma piada curta ou comentário bem-humorado sobre compras por impulso, falência, desculpas para o/a cônjuge ou humor cotidiano.
2. Use a formatação nativa do WhatsApp (*negrito*, _itálico_, ~riscado~).
3. Destaque o Preço Por em *negrito*.
4. Se houver cupom, exiba-o com destaque em *negrito*.
5. Mantenha obrigatoriamente o link original intacto no final da mensagem.
6. Não adicione textos explicativos nem saudações genéricas fora da copy.
`;

        const response = await ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: prompt
        });

        if (response && response.text) {
            return response.text.trim();
        }

        return gerarLayoutPadrao(oferta);
    } catch (error) {
        const mensagemErro = error?.message || String(error);
        if (/quota|rate limit|429|RESOURCE_EXHAUSTED|PERMISSION_DENIED|API key/i.test(mensagemErro)) {
            console.warn('⚠️ Gemini indisponível no momento. Usando layout padrão.', mensagemErro);
        } else {
            logError('ia.gerarMensagem', error);
        }
        return gerarLayoutPadrao(oferta);
    }
}

function gerarLayoutPadrao(oferta) {
    let msg = `🔥 *${oferta.titulo.toUpperCase()}*\n\n`;
    if (oferta.precoDe) msg += ` De: ~R$ ${oferta.precoDe}~\n`;
    msg += ` Por apenas: *R$ ${oferta.precoPor}*\n\n`;
    if (oferta.cupom) msg += `🎟️ Cupom: *${oferta.cupom}*\n\n`;
    msg += `👉 Compre aqui: ${oferta.link}\n\n`;
    msg += `⚠️ _Preço sujeito a alteração a qualquer momento._`;
    return msg;
}

// ==========================================
// MOTOR DA AUTOMAÇÃO DE OFERTAS (LOOP)
// ==========================================

async function iniciarLoopDeEnvio() {
    console.log('🔄 Engine de disparo de ofertas inicializada.');
    loopStopRequested = false;

    while (!loopStopRequested) {
        try {
            if (isReady && targetGroupId && ofertasQueue.length > 0) {

                if (!eHorarioPermitido()) {
                    console.log(`[${getHorarioAtual()}] 🌙 Fora do horário comercial (8h-22h). Aguardando 15 minutos...`);
                    await new Promise(resolve => setTimeout(resolve, 15 * 60 * 1000));
                    continue;
                }

                const oferta = ofertasQueue.shift();
                console.log(`[${getHorarioAtual()}] 📤 Processando oferta com IA: "${oferta.titulo}"`);

                // Gera o texto personalizado via Gemini
                const mensagem = await gerarMensagemComIA(oferta);

                // Notifica status online
                await client.sendPresenceAvailable().catch(() => {});
                await new Promise(resolve => setTimeout(resolve, 2000));

                // Disparo pelo client
                await client.sendMessage(targetGroupId, mensagem);
                console.log(`[${getHorarioAtual()}] ✅ Oferta enviada com sucesso! Restantes na fila: ${ofertasQueue.length}`);

                // Intervalo seguro aleatório (ex: entre 3 e 6 minutos)
                const delayMs = getTempoAleatorioMs(3, 6);
                console.log(`⏳ Próximo disparo em ${(delayMs / 1000 / 60).toFixed(1)} minutos...\n`);

                await new Promise(resolve => setTimeout(resolve, delayMs));
                continue;
            }
        } catch (error) {
            logError('loop.disparo', error, { horario: getHorarioAtual() });
        }

        await new Promise(resolve => setTimeout(resolve, 10000));
    }

    console.log('🛑 Loop de disparo encerrado.');
}

// ==========================================
// MIDDLEWARES DE VALIDAÇÃO
// ==========================================

const checkWhatsAppReady = (req, res, next) => {
    if (!isReady) {
        return res.status(503).json({
            success: false,
            message: 'O WhatsApp ainda não está pronto ou desconectou. Aguarde a autenticação.'
        });
    }
    next();
};

const checkValidBody = (req, res, next) => {
    if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({
            success: false,
            message: 'Corpo da requisição inválido. Certifique-se de enviar um JSON válido e definir o Header Content-Type como application/json.'
        });
    }
    next();
};

// ==========================================
// ROTAS DA API HTTP E INTERFACE WEB
// ==========================================

app.get('/qr', (req, res) => {
    if (!currentQrBase64) {
        return res.send('<h2>WhatsApp Conectado com sucesso!</h2>');
    }
    res.send(`<img src="${currentQrBase64}" style="padding:20px; background:white;" />`);
});

app.get('/status', (req, res) => {
    return res.json({
        success: true,
        whatsappConectado: isReady,
        grupoId: targetGroupId,
        grupoNome: targetGroupName || 'Não identificado',
        totalFila: ofertasQueue.length,
        geminiConfigurado: Boolean(geminiApiKey)
    });
});

app.post('/set-grupo', checkValidBody, (req, res) => {
    try {
        const { groupId } = req.body;
        if (!groupId) {
            return res.status(400).json(buildErrorPayload('Parâmetro groupId é obrigatório.', new Error('groupId ausente')));
        }

        const cleanId = groupId.toString().trim();
        targetGroupId = cleanId.endsWith('@g.us') ? cleanId : `${cleanId}@g.us`;

        console.log(`📌 Grupo de destino configurado para: ${targetGroupId}`);
        return res.json({ success: true, message: 'Grupo configurado com sucesso!', targetGroupId });
    } catch (error) {
        logError('route.set-grupo', error, { body: req.body });
        return res.status(500).json(buildErrorPayload('Erro ao configurar grupo.', error));
    }
});

app.post('/ofertas', checkValidBody, (req, res) => {
    try {
        const { titulo, precoPor, precoDe, cupom, link } = req.body;

        if (!titulo || !precoPor || !link) {
            return res.status(400).json(buildErrorPayload('Os campos "titulo", "precoPor" e "link" são obrigatórios.', new Error('payload inválido')));
        }

        const novaOferta = { titulo, precoPor, precoDe, cupom, link, adicionadoEm: new Date() };
        ofertasQueue.push(novaOferta);

        return res.json({
            success: true,
            message: 'Oferta adicionada à fila com sucesso!',
            posicaoNaFila: ofertasQueue.length,
            oferta: novaOferta
        });
    } catch (error) {
        logError('route.ofertas', error, { body: req.body });
        return res.status(500).json(buildErrorPayload('Erro ao adicionar oferta.', error));
    }
});

app.post('/send-message', checkWhatsAppReady, checkValidBody, async (req, res) => {
    const { number, message } = req.body;

    if (!number || !message) {
        return res.status(400).json({
            success: false,
            message: 'Parâmetros "number" e "message" são obrigatórios.'
        });
    }

    try {
        const cleanNumber = number.toString().replace(/\D/g, '');
        const formattedNumber = `${cleanNumber}@c.us`;

        const isRegistered = await client.isRegisteredUser(formattedNumber);
        if (!isRegistered) {
            return res.status(404).json({
                success: false,
                message: 'Este número não está cadastrado no WhatsApp.'
            });
        }

        const response = await client.sendMessage(formattedNumber, message);

        return res.json({
            success: true,
            message: 'Mensagem enviada com sucesso!',
            messageId: response.id.id
        });
    } catch (error) {
        logError('route.send-message', error, { number, message });
        return res.status(500).json(buildErrorPayload('Erro ao enviar mensagem direta.', error));
    }
});

app.use((err, req, res, next) => {
    logError('express.error-handler', err, { method: req.method, url: req.originalUrl });
    res.status(err.status || 500).json(buildErrorPayload('Erro interno do servidor.', err));
});

// ==========================================
// EVENTOS DO WHATSAPP
// ==========================================

client.on('qr', async (qr) => {
    isReady = false;
    currentQrBase64 = await QRCode.toDataURL(qr);

    console.log('\n📲 Escaneie o QR Code abaixo no terminal:\n');
    qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
    console.log('🔑 Sessão autenticada com sucesso! Carregando dados do WhatsApp...');
});

client.on('ready', () => {
    isReady = true;
    currentQrBase64 = null;
    console.log('✅ WhatsApp conectado e pronto para uso!');
    console.log('👉 Para definir o grupo de ofertas via WhatsApp, mande a mensagem: !setgrupo dentro do grupo.');
});

client.on('disconnected', (reason) => {
    isReady = false;
    logError('whatsapp.disconnected', new Error(reason || 'Conexão encerrada'), { reason });
});

client.on('auth_failure', (message) => {
    logError('whatsapp.auth_failure', new Error(message || 'Falha de autenticação'), { message });
});

client.on('change_state', (state) => {
    console.log(`🧭 Estado do WhatsApp alterado: ${state}`);
});

client.on('message_create', async (msg) => {
    if (!msg.body) return;
    const comando = msg.body.trim().toLowerCase();

    if (comando === '!setgrupo' || comando === '!grupo' || comando === '!id') {
        try {
            const chat = await msg.getChat().catch(() => null);
            const chatId = chat?.id?._serialized || msg.from || msg.to || null;

            if (!chatId || !isChatTargetCompatible(chatId) && !isChatTargetCompatible(chat)) {
                console.log('⚠️ O comando foi enviado fora de um grupo ou canal de broadcast.');
                return;
            }

            targetGroupId = chatId;
            targetGroupName = chat ? chat.name : 'Grupo Vinculado';

            console.log('\n======================================');
            console.log(`🎯 ALVO SELECIONADO COM SUCESSO!`);
            console.log(`📌 Nome: ${targetGroupName}`);
            console.log(`👉 ID: ${targetGroupId}`);
            console.log('======================================\n');

            await client.sendMessage(targetGroupId, `✅ *Bot de Ofertas Vinculado!*\nAs ofertas serão enviadas neste grupo/canal.`);
        } catch (e) {
            console.error('Erro ao vincular grupo via comando:', e.message || e);
        }
    }
});

// ==========================================
// INICIALIZAÇÃO E SHUTDOWN SEGURO
// ==========================================

const handleShutdown = async (signal = 'SIGTERM') => {
    if (shuttingDown) return;
    shuttingDown = true;
    loopStopRequested = true;

    console.log(`\n🛑 Recebido ${signal}. Encerrando bot de forma segura...`);

    try {
        if (server) {
            await new Promise((resolve, reject) => {
                server.close((err) => (err ? reject(err) : resolve()));
            });
            console.log('🌐 Servidor HTTP encerrado.');
        }
    } catch (err) {
        logError('shutdown.server', err);
    }

    console.log('🔐 Mantendo a sessão do WhatsApp preservada via LocalAuth.');
    process.exit(0);
};

if (require.main === module) {
    client.initialize().catch((error) => {
        logError('whatsapp.initialize', error);
        process.exit(1);
    });

    server = app.listen(PORT, () => {
        console.log(`🚀 API rodando em http://localhost:${PORT}`);
        iniciarLoopDeEnvio();
    });

    server.on('error', (error) => {
        logError('server.listen', error, { port: PORT });
    });

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('uncaughtException', (error) => {
        logError('process.uncaughtException', error);
        handleShutdown('uncaughtException');
    });
    process.on('unhandledRejection', (reason) => {
        logError('process.unhandledRejection', reason);
        handleShutdown('unhandledRejection');
    });
}

module.exports = {
    buildErrorPayload,
    formatErrorForLog,
    isChatTargetCompatible
};