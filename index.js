const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const Redis = require('ioredis');
const QRCode = require('qrcode');
const express = require('express');

const config = require('./config');
const redisStore = require('./auth/redisStore');
const traiterMessage = require('./services/reportService');

const app = express();
let currentQR = null;
let isConnected = false;

const redis = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    username: config.redis.username,
    password: config.redis.password,
    tls: {}
});

redis.on('connect', () => console.log('✅ Connecté à Upstash Redis'));
redis.on('error', (err) => console.error('❌ Erreur Redis:', err));

async function startBot() {
    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await redisStore(redis, 'kinkole-session-v5');

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: ['Kinkole Bot', 'Chrome', '2.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('🔄 QR Code généré');
            currentQR = await QRCode.toDataURL(qr);
        }

        if (connection === 'close') {
            isConnected = false;
            currentQR = null;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log('❌ Connexion fermée. Code:', statusCode);

            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                console.log('🔴 Session expirée. Nettoyage Redis...');
                const keys = await redis.keys('kinkole-session-v5:*');
                if (keys.length > 0) await redis.del(keys);
                console.log('🔄 Relance pour nouveau QR...');
                startBot();
            } else {
                console.log('🔄 Reconnexion dans 5s...');
                setTimeout(startBot, 5000);
            }
        }

        if (connection === 'open') {
            isConnected = true;
            currentQR = null;
            console.log('✅ WhatsApp connecté !');

            // Pré-charger les métadonnées des groupes cibles
            setTimeout(async () => {
                const cibles = [
                    '120363027433348642@g.us',
                    '243900435187-1560795042@g.us',
                    '243890177777-1574181414@g.us'
                ];
                for (const jid of cibles) {
                    try {
                        await sock.groupMetadata(jid);
                        console.log(`✅ Groupe chargé: ${jid}`);
                    } catch(e) {
                        console.error(`❌ Groupe non accessible: ${jid} →`, e.message);
                    }
                }
            }, 5000);
            
            sock.ev.on('messaging-history.set', async ({ chats }) => {
                try {
                    const groupes = await sock.groupFetchAllParticipating();
                    const liste = Object.values(groupes);
                    console.log(`📊 Nombre de groupes : ${liste.length}`);
                    liste.forEach(g => console.log(`📌 ${g.subject} → ${g.id}`));
                } catch(e) {
                    console.error('❌ Erreur groupes:', e.message);
                }
            });
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;
        
            for (const msg of messages) {
                // LOG TOUT sans filtre
                console.log(`📨 MSG: fromMe=${msg.key.fromMe} | JID=${msg.key.remoteJid} | texte=${msg.message?.conversation || ''}`);
        
                if (msg.key.fromMe || msg.key.remoteJid.includes('@g.us')) continue;
        
                const expediteur = msg.key.remoteJid.split('@')[0].split(':')[0];
                const autorise = [
                    String(config.monNumero),
                    String(config.monLid),
                    String(config.numeroSecondaire)
                ].filter(Boolean);
                
                console.log(`🔍 expediteur=${expediteur} | autorise=${JSON.stringify(autorise)}`);
                
                if (!autorise.includes(expediteur)) continue;
        
                const texte = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
                if (!texte) continue;
        
                console.log(`📝 "${texte}" | JID: ${msg.key.remoteJid}`);
        
                if (texte.trim().toUpperCase() === 'PING') {
                    await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, { text: 'PONG ✅' });
                    continue;
                }
        
                await sock.readMessages([msg.key]);
                await sock.sendPresenceUpdate('composing', msg.key.remoteJid);
                await traiterMessage(sock, msg.key.remoteJid, texte);
            }
        });
}

// Interface Web QR
app.get('/', (req, res) => {
    if (isConnected) {
        res.send('<h1 style="color:green;text-align:center;font-family:sans-serif;margin-top:50px">✅ Bot Kinkole connecté !</h1>');
    } else if (currentQR) {
        res.send(`
            <div style="text-align:center;font-family:sans-serif;margin-top:50px">
                <h2>📱 Scannez ce QR Code avec WhatsApp</h2>
                <img src="${currentQR}" style="width:300px;height:300px"/>
                <p>Rafraîchissement automatique toutes les 15 secondes.</p>
                <script>setTimeout(() => location.reload(), 15000)</script>
            </div>
        `);
    } else {
        res.send('<h1 style="text-align:center;font-family:sans-serif;margin-top:50px">⏳ Démarrage en cours... Rafraîchissez dans 5s.</h1>');
    }
});

app.listen(config.port, () => {
    console.log(`🌐 Serveur sur port ${config.port}`);
    startBot();
});
