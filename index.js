const fs = require('fs');
const path = require('path');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const express = require('express');
const { Ollama } = require('ollama');

// ==========================================
// CONFIGURAÇÕES E ESTADO DA APLICAÇÃO
// ==========================================
const PORT = 3000;
const OLLAMA_MODEL = 'llama3.2:3b';
const IA_COOLDOWN_MS = 5 * 1000;
const OLLAMA_TIMEOUT_MS = 15 * 1000;
let isReady = false;
let targetGroupIds = [];
let targetGroupName = null;
let currentQrBase64 = null;
let server = null;
let shuttingDown = false;
let loopStopRequested = false;
let lastIACallAt = 0;

// ==========================================
// FUNÇÕES AUXILIARES DE TRATAMENTO E AMBIENTE
// ==========================================

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

function normalizeTargetGroupIds(value) {
    if (!value) return [];

    const rawValues = Array.isArray(value) ? value : [value];
    const normalized = [];

    for (const item of rawValues) {
        if (typeof item !== 'string') continue;

        const cleaned = item.toString().trim();
        if (!cleaned) continue;

        const parts = cleaned
            .replace(/\[|\]/g, '')
            .split(/[,;]+/)
            .map(part => part.trim())
            .filter(Boolean);

        for (const part of parts) {
            if (part.endsWith('@g.us') || part.endsWith('@broadcast') || part.endsWith('@newsletter')) {
                normalized.push(part);
            }
        }
    }

    return [...new Set(normalized)];
}

function mergeTargetGroupIds(existingIds = [], incomingIds = []) {
    return [...new Set([...(existingIds || []), ...(incomingIds || [])])];
}

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

function carregarGruposDoEnv() {
    const gruposEnv = process.env.GRUPOS || process.env.GROUPS || '';
    const ids = normalizeTargetGroupIds(gruposEnv);
    targetGroupIds = mergeTargetGroupIds(targetGroupIds, ids);
    return targetGroupIds;
}

function withTimeout(promise, ms, fallbackValue) {
    let timeoutId;
    const timeoutPromise = new Promise((resolve) => {
        timeoutId = setTimeout(() => {
            console.warn(`⏱️ Tempo limite de ${ms}ms excedido na chamada.`);
            resolve(fallbackValue);
        }, ms);
    });

    return Promise.race([
        promise.then((res) => {
            clearTimeout(timeoutId);
            return res;
        }),
        timeoutPromise
    ]);
}

carregarVariaveisDoEnv();
carregarGruposDoEnv();

const ollama = new Ollama({ host: 'http://127.0.0.1:11434' });
const ofertasQueue = [];
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
    try {
        const horaStr = new Date().toLocaleTimeString('pt-BR', { 
            timeZone: 'America/Sao_Paulo', 
            hour: '2-digit', 
            hourCycle: 'h23'
        });
        const hora = parseInt(horaStr.replace(/\D/g, ''), 10);
        if (isNaN(hora)) return true;
        return hora >= 8 && hora < 23;
    } catch {
        return true;
    }
}

async function curarOfertaComIA(oferta) {
    try {
        const systemPrompt = `Você é um curador para um grupo geral de promoções e achadinhos no WhatsApp.
Seu objetivo é APROVAR produtos de uso pessoal, higiene, beleza, cosméticos, suplementos, tecnologia, casa, eletrodomésticos, acessórios e ofertas baratas atrativas ("achadinhos").

CRITÉRIOS RÍGIDOS DE REJEIÇÃO (aprovar = false):
1. Insumos estritamente hospitalares, clínicos ou médicos cirúrgicos.
2. Embalagens de mudança em lote ou caixas de papelão vazias.
3. Peças puramente industriais ou mecânicas.
4. Peças genéricas para modelos específicos muito antigos/incomuns.

FORMATO OBRIGATÓRIO DE SAÍDA:
Retorne APENAS um JSON válido no formato:
{"aprovar": false, "motivo": "Insumo hospitalar sem apelo comercial geral."}
ou
{"aprovar": true, "motivo": "Produto útil de boa procura ou achadinho em conta."}`;

        const userPrompt = `Analise este produto: "${oferta.titulo}" | Preço: R$ ${oferta.precoPor}`;

        const ollamaPromise = ollama.chat({
            model: OLLAMA_MODEL,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            options: {
                temperature: 0.1,
                num_predict: 80
            }
        });

        const fallback = { message: { content: '{"aprovar": true, "motivo": "Aprovado por padrão devido ao timeout da IA."}' } };
        const response = await withTimeout(ollamaPromise, OLLAMA_TIMEOUT_MS, fallback);

        if (response?.message?.content) {
            const rawContent = response.message.content.trim();
            const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return {
                    aprovar: Boolean(parsed.aprovar),
                    motivo: parsed.motivo || 'Sem justificativa fornecida.'
                };
            }
        }

        return { aprovar: true, motivo: 'Aprovado por padrão.' };
    } catch (error) {
        logError('ia.curarOferta', error);
        return { aprovar: true, motivo: 'Aprovado por padrão devido à indisponibilidade do filtro.' };
    }
}

async function gerarMensagemComIA(oferta) {
    let fraseAbertura = '';

    const now = Date.now();
    if (now - lastIACallAt >= IA_COOLDOWN_MS) {
        try {
            lastIACallAt = now;

            const exemplos = [
                'No precinho!',
                'Olha essa oferta!',
                'Preço sensacional!',
                'Oportunidade imbatível!',
                'Vale super a pena!',
                'Baixou demais!',
                'Achado do dia!'
            ];
            const exemploSorteado = exemplos[Math.floor(Math.random() * exemplos.length)];

            const systemPrompt = `Você é um gerador de frases de abertura para promoções no WhatsApp.
Sua ÚNICA tarefa é criar UMA frase curta e empolgante de no máximo 5 palavras acompanhada de 1 emoji no final.

REGRAS RÍGIDAS:
1. Responda APENAS a frase e o emoji. NADA MAIS.
2. NÃO escreva explicações, NÃO inclua links, NENHUM preço e NENHUM nome de produto.
3. NÃO use a frase "Tá num preço top!". Ela está proibida.
4. Exemplo de saída esperada: ${exemploSorteado} 🔥`;

            const userPrompt = `Gere uma frase de abertura variada para divulgar o produto: ${oferta.titulo}`;

            const ollamaPromise = ollama.chat({
                model: OLLAMA_MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                options: {
                    temperature: 0.85,
                    num_predict: 25
                }
            });

            const response = await withTimeout(ollamaPromise, OLLAMA_TIMEOUT_MS, null);

            if (response?.message?.content) {
                fraseAbertura = response.message.content.trim().replace(/^["'\s]+|["'\s]+$/g, '');
            }
        } catch (error) {
            console.warn('⚠️ Ollama indisponível. Usando frase alternativa do JS.');
            logError('ia.gerarMensagem', error);
        }
    }

    if (!fraseAbertura) {
        const fallbacks = [
            '🔥 *OFERTA IMPERDÍVEL!*',
            '💥 *OLHA ESSA PROMOÇÃO!*',
            '⚡ *BAIXOU O PREÇO!*',
            '🚀 *DESTAQUE DO DIA!*',
            '👀 *ACHADINHO EM CONTA!*'
        ];
        fraseAbertura = fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }

    let msg = `${fraseAbertura}\n\n`;
    msg += `📦 *${oferta.titulo}*\n`;
    if (oferta.precoDe) msg += `De: ~R$ ${oferta.precoDe}~\n`;
    msg += `Por apenas: *R$ ${oferta.precoPor}*\n`;
    if (oferta.cupom) msg += `🎟️ Cupom: *${oferta.cupom}*\n`;
    msg += `\n👉 Compre agora: ${oferta.link}`;

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
            if (isReady && targetGroupIds.length > 0 && ofertasQueue.length > 0) {

                if (!eHorarioPermitido()) {
                    console.log(`[${getHorarioAtual()}] 🌙 Fora do horário comercial (8h-22h). Aguardando 15 minutos...`);
                    await new Promise(resolve => setTimeout(resolve, 15 * 60 * 1000));
                    continue;
                }

                const oferta = ofertasQueue.shift();
                console.log(`[${getHorarioAtual()}] 📤 Processando oferta com IA: "${oferta.titulo}"`);

                const mensagem = await gerarMensagemComIA(oferta);

                await client.sendPresenceAvailable().catch(() => {});
                await new Promise(resolve => setTimeout(resolve, 2000));

                for (const targetGroupId of targetGroupIds) {
                    try {
                        let enviadoComImagem = false;

                        // Tenta baixar e enviar a imagem se houver uma URL disponível
                        if (oferta.imagemUrl) {
                            try {
                                const media = await MessageMedia.fromUrl(oferta.imagemUrl, { unsafeMime: true });
                                await client.sendMessage(targetGroupId, media, { caption: mensagem });
                                enviadoComImagem = true;
                                console.log(`[${getHorarioAtual()}] 🖼️ Oferta com imagem enviada para ${targetGroupId}`);
                            } catch (imgError) {
                                console.warn(`⚠️ Falha ao carregar mídia (${oferta.imagemUrl}). Enviando apenas texto...`, imgError.message);
                            }
                        }

                        // Fallback: se não tiver imagem ou falhar o envio da mídia, envia texto puro
                        if (!enviadoComImagem) {
                            await client.sendMessage(targetGroupId, mensagem, { linkPreview: true });
                            console.log(`[${getHorarioAtual()}] ✅ Oferta em texto enviada para ${targetGroupId}`);
                        }

                    } catch (error) {
                        console.warn(`⚠️ Falha ao enviar para ${targetGroupId}:`, error.message || error);
                        if (error.message && error.message.includes('detached Frame')) {
                            console.error('🚨 Detectado erro de frame desanexado no Puppeteer. Reiniciando a página...');
                            try {
                                if (client.pupPage) await client.pupPage.reload();
                            } catch (e) {
                                logError('puppeteer.reload', e);
                            }
                        }
                    }
                }

                console.log(`[${getHorarioAtual()}] ✅ Oferta processada. Restantes na fila: ${ofertasQueue.length}`);

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
        grupoIds: targetGroupIds,
        grupoNome: targetGroupName || 'Não identificado',
        totalFila: ofertasQueue.length,
        modeloIa: OLLAMA_MODEL
    });
});

app.post('/set-grupo', checkValidBody, (req, res) => {
    try {
        const { groupId } = req.body;
        if (!groupId) {
            return res.status(400).json(buildErrorPayload('Parâmetro groupId é obrigatório.', new Error('groupId ausente')));
        }

        const cleanId = groupId.toString().trim();
        const normalizedIds = normalizeTargetGroupIds(cleanId);
        if (normalizedIds.length === 0) {
            return res.status(400).json(buildErrorPayload('groupId inválido. Envie um ID de grupo ou canal válido.', new Error('groupId inválido')));
        }

        targetGroupIds = mergeTargetGroupIds(targetGroupIds, normalizedIds);
        targetGroupName = targetGroupName || 'Grupo Vinculado';

        console.log(`📌 Grupo(s) de destino configurado(s): ${targetGroupIds.join(', ')}`);
        return res.json({ success: true, message: 'Grupo(s) configurado(s) com sucesso!', targetGroupIds });
    } catch (error) {
        logError('route.set-grupo', error, { body: req.body });
        return res.status(500).json(buildErrorPayload('Erro ao configurar grupo.', error));
    }
});

app.post('/ofertas', checkValidBody, async (req, res) => {
    try {
        const { titulo, precoPor, precoDe, cupom, link, imagemUrl, imagem } = req.body;

        if (!titulo || !precoPor || !link) {
            return res.status(400).json(buildErrorPayload('Os campos "titulo", "precoPor" e "link" são obrigatórios.', new Error('payload inválido')));
        }

        const novaOferta = { 
            titulo, 
            precoPor, 
            precoDe, 
            cupom, 
            link, 
            imagemUrl: imagemUrl || imagem || null, 
            adicionadoEm: new Date() 
        };

        const analise = await curarOfertaComIA(novaOferta);

        if (!analise.aprovar) {
            console.log(`🗑️ [Curadoria IA] Oferta descartada: "${titulo}" | Motivo: ${analise.motivo}`);
            return res.json({
                success: false,
                descartado: true,
                message: 'A oferta foi descartada pelo filtro inteligente da IA.',
                motivo: analise.motivo
            });
        }

        ofertasQueue.push(novaOferta);
        console.log(`✨ [Curadoria IA] Oferta aprovada: "${titulo}" | Motivo: ${analise.motivo}`);

        return res.json({
            success: true,
            message: 'Oferta avaliada, aprovada e adicionada à fila com sucesso!',
            posicaoNaFila: ofertasQueue.length,
            oferta: novaOferta
        });
    } catch (error) {
        logError('route.ofertas', error, { body: req.body });
        return res.status(500).json(buildErrorPayload('Erro ao processar oferta.', error));
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

            if (!chatId || (!isChatTargetCompatible(chatId) && !isChatTargetCompatible(chat))) {
                console.log('⚠️ O comando foi enviado fora de um grupo ou canal de broadcast.');
                return;
            }

            targetGroupIds = mergeTargetGroupIds(targetGroupIds, [chatId]);
            targetGroupName = chat ? chat.name : 'Grupo Vinculado';

            console.log('\n======================================');
            console.log(`🎯 ALVO SELECIONADO COM SUCESSO!`);
            console.log(`📌 Nome: ${targetGroupName}`);
            console.log(`👉 ID: ${chatId}`);
            console.log('======================================\n');

            await client.sendMessage(chatId, `✅ *Bot de Ofertas Vinculado!*\nAs ofertas serão enviadas neste grupo/canal.`);
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
        if (client) {
            await client.destroy().catch(() => {});
            console.log('📱 Instância do WhatsApp encerrada.');
        }

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
    isChatTargetCompatible,
    normalizeTargetGroupIds,
    mergeTargetGroupIds
};