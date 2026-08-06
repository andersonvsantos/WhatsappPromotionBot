const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const express = require('express');

// ==========================================
// CONFIGURAÇÕES E ESTADO DA APLICAÇÃO
// ==========================================
const PORT = 3000;
let isReady = false;
let targetGroupId = null;   // ID do grupo selecionado para ofertas
let targetGroupName = null; // Nome do grupo selecionado para ofertas
let currentQrBase64 = null; // QR Code em Base64 para exibir na rota /qr
let server = null;
let shuttingDown = false;
let loopStopRequested = false;

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

// Middlewares defensivos para parsing do Body
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuração do WhatsApp Client (sem versão remota legada)
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
// FUNÇÕES DE SUPORTE E UTILITÁRIOS
// ==========================================

function getTempoAleatorioMs(minMinutes = 5, maxMinutes = 8) {
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
    return hora >= 8 && hora < 22;
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
                console.log(`[${getHorarioAtual()}] 📤 Processando oferta: "${oferta.titulo}"`);

                // Notifica que está online para enviar
                await client.sendPresenceAvailable().catch(() => {});
                await new Promise(resolve => setTimeout(resolve, 2000));

                let mensagem = `🔥 *${oferta.titulo.toUpperCase()}*\n\n`;
                if (oferta.precoDe) mensagem += ` De: ~R$ ${oferta.precoDe}~\n`;
                mensagem += ` Por apenas: *R$ ${oferta.precoPor}*\n\n`;
                if (oferta.cupom) mensagem += `🎟️ Cupom: *${oferta.cupom}*\n\n`;
                mensagem += `👉 Compre aqui: ${oferta.link}\n\n`;
                mensagem += `⚠️ _Preço sujeito a alteração a qualquer momento._`;

                // Disparo direto pelo client usando o ID do grupo
                await client.sendMessage(targetGroupId, mensagem);
                console.log(`[${getHorarioAtual()}] ✅ Oferta enviada com sucesso! Restantes na fila: ${ofertasQueue.length}`);

                // Configurado para 1 minuto (60.000 ms) para testes
                const delayTesteMs = 60 * 1000; 
                console.log(`⏳ Modo de Teste: Próximo disparo em 1 minuto...\n`);

                await new Promise(resolve => setTimeout(resolve, delayTesteMs));
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

// Rota para visualização web do QR Code caso queira abrir manualmente
app.get('/qr', (req, res) => {
    if (!currentQrBase64) {
        return res.send('<h2>WhatsApp Conectado com sucesso!</h2>');
    }
    res.send(`<img src="${currentQrBase64}" style="padding:20px; background:white;" />`);
});

// Status detalhado do Bot
app.get('/status', (req, res) => {
    return res.json({
        success: true,
        whatsappConectado: isReady,
        grupoId: targetGroupId,
        grupoNome: targetGroupName || 'Não identificado',
        totalFila: ofertasQueue.length
    });
});

// Definir grupo manualmente via HTTP POST
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

// Adicionar oferta na fila de disparo automatizado
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

// Rota direta para enviar mensagem de texto para número específico
app.post('/send-message', checkWhatsAppReady, checkValidBody, async (req, res) => {
    const { number, message } = req.body;

    if (!number || !message) {
        return res.status(400).json({
            success: false,
            message: 'Parâmetros "number" e "message" são obrigatórios.'
        });
    }

    try {
        const cleanNumber = number.toString().replace(/\D/g, '');git 
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

// Captura do comando !setgrupo nos chats de grupos
client.on('message_create', async (msg) => {
    if (!msg.body) return;
    const comando = msg.body.trim().toLowerCase();

    if (comando === '!setgrupo' || comando === '!grupo' || comando === '!id') {
        try {
            // Descobre o ID do chat sem depender exclusivamente do getChat()
            const chatId = msg.from.endsWith('@g.us') ? msg.from : (msg.to.endsWith('@g.us') ? msg.to : null);

            if (!chatId) {
                console.log('⚠️ O comando foi enviado fora de um grupo.');
                return;
            }

            const chat = await msg.getChat().catch(() => null);

            targetGroupId = chatId;
            targetGroupName = chat ? chat.name : 'Grupo Vinculado';

            console.log('\n======================================');
            console.log(`🎯 GRUPO SELECIONADO COM SUCESSO!`);
            console.log(`📌 Nome: ${targetGroupName}`);
            console.log(`👉 ID: ${targetGroupId}`);
            console.log('======================================\n');

            await client.sendMessage(targetGroupId, `✅ *Bot de Ofertas Vinculado!*\nAs ofertas serão enviadas neste grupo.`);
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
    formatErrorForLog
};