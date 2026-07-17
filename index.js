// Supprimer les logs Baileys verbeux
const originalLog = console.log;
console.log = (...args) => {
    const msg = args[0]?.toString() || '';
    if (
        msg.includes('Closing session') ||
        msg.includes('Removing old closed') ||
        msg.includes('SessionEntry') ||
        msg.includes('_chains') ||
        msg.includes('registrationId') ||
        msg.includes('ephemeralKeyPair') ||
        msg.includes('Buffer') ||
        msg.includes('baseKey') ||
        msg.includes('preKeyId') ||
        msg.includes('chainKey')
    ) return; // bloquer ces logs
    originalLog(...args);
};
const { handleIncomingMessage, lancerRattrapageAutomatique, etatAttente, setRedisClient } = require('./services/messageRouter');
const { initialiserTourDeControle } = require('./services/tourDeControle');
const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const Redis = require('ioredis');
const QRCode = require('qrcode');
const express = require('express');
const db = require('./services/database'); // Ajuste le chemin vers ton fichier DB
const config = require('./config');
const redisStore = require('./auth/redisStore');
const traiterMessage = require('./services/reportService');
const creerMemoire = require('./services/memoire');
const creerAssistant = require('./services/assistant');
const { agentBrief } = require('./services/agents');
const { detecterTypeRapport, verifierCompletude, getDestination } = require('./services/routeurRapports');



const app = express();
let currentQR = null;
let isConnected = false;
let processusDemarres = false; // 👈 Le fameux cadenas anti-doublon
const redis = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    username: config.redis.username,
    password: config.redis.password,
    tls: {}
});

redis.on('connect', () => console.log('✅ Connecté à Upstash Redis'));
redis.on('error', (err) => console.error('❌ Erreur Redis:', err));



function planifierBriefs(assistant) {
    const verifierHeure = () => {
        const now = new Date();
        const heure = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
        const minutes = now.getMinutes();

        // Briefs automatiques
        if (config.heuresBrief.includes(heure)) assistant.briefAutomatique();

        // Demandes coffre
        if (heure === '10:00') assistant.demanderCoffre();
        if (heure === '22:30') assistant.demanderCoffre();

        // Demande fixture
        if (heure === '10:30') assistant.demanderFixture();

        // Vérification rapports toutes les 30 minutes
        if (minutes === 0 || minutes === 30) assistant.verifierRapportsManquants();
    };

    setInterval(verifierHeure, 60000);
}


async function startBot() {
    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await redisStore(redis, 'kinkole-session-v7');
    const memoire = creerMemoire(redis);

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: ['Kinkole Bot', 'Chrome', '2.0.0']
    });

    // Nouveau
    const creerContexte = require('./services/contexte');
    const contexteConv = creerContexte(redis);
    const assistant = creerAssistant(sock, memoire, contexteConv);

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
                const keys = await redis.keys('kinkole-session-v7:*');
                if (keys.length > 0) await redis.del(keys);
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
        
            setRedisClient(redis);

            // 🛑 LE CADENAS ANTI-DOUBLON EST ICI 🛑
            if (!processusDemarres) {
                lancerRattrapageAutomatique(sock, db);
                initialiserTourDeControle(sock, etatAttente, memoire, redis);
                planifierBriefs(assistant);
                
                processusDemarres = true; // On verrouille pour les prochaines reconnexions
                console.log('🗼 Processus de fond activés (Sécurité anti-doublon ON)');
            } else {
                console.log('🔄 Reconnexion réseau (Les processus tournent déjà, pas de doublon).');
            }
    
            // --- SCRIPT TEMPORAIRE POUR LISTER LES MEMBRES ---
            const groupeJid = "120363021280044937@g.us";
            
            try {
                const metadata = await sock.groupMetadata(groupeJid);
                console.log(`\n📋 Liste des membres du groupe : ${metadata.subject}`);
                
                for (const participant of metadata.participants) {
                    const idMembre = participant.id;
                    const role = participant.admin ? `(Admin)` : `(Membre)`;
                    console.log(`- ${idMembre} ${role}`);
                }
            } catch (erreur) {
                console.error(`❌ Erreur lors de la récupération des membres :`, erreur);
            }
            // -------------------------------------------------

            // Pré-charger groupes destination
            setTimeout(async () => {
                const cibles = Object.values(config.groupesDestination).map(g => g.id);
                for (const jid of cibles) {
                    try {
                        await sock.groupMetadata(jid);
                        console.log(`✅ Groupe chargé: ${jid}`);
                    } catch(e) {
                        console.error(`❌ Groupe non accessible: ${jid}`);
                    }
                }
            }, 5000);
        }
    });

    sock.ev.on('messages.upsert', async (payload) => {
        await handleIncomingMessage(sock, payload, memoire, assistant);
    });

}
   
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
