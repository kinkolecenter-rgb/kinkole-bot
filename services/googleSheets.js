const { google } = require('googleapis');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// 🔑 Vérification de la clé de sécurité
if (!process.env.GOOGLE_CREDENTIALS) {
    console.error("❌ ERREUR FATALE : La variable GOOGLE_CREDENTIALS est introuvable !");
}

const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);

const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

// L'ID extrait de ton image URL
const SPREADSHEET_ID = '1rkdKHF-x6bP7zcJy3Y34s-t-99g1XZama6J39DTsK6s'; 

// ==========================================
// 🛠️ FONCTIONS UTILITAIRES POUR LES DATES
// ==========================================

/**
 * Retourne la date "logique" (Prend en compte le changement de jour à minuit)
 */
function getDateLogique() {
    const date = new Date();
    const heureActuelle = date.getHours();
    
    // ⏰ SI APRES MINUIT (entre 00h et 04h59) : On recule d'un jour !
    if (heureActuelle < 5) {
        date.setDate(date.getDate() - 1);
        console.log(`📆 Rapport reçu après minuit. Ajustement de la date à la veille : ${date.toLocaleDateString('fr-FR')}`);
    }
    return date;
}

/**
 * Calcule la cellule exacte pour une date donnée (Aujourd'hui ou Hier)
 */
function getCellulePourDate(dateObj) {
    const moisOnglets = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const nomOnglet = moisOnglets[dateObj.getMonth()];
    
    const jour = dateObj.getDate();
    
    // Le 1er est en colonne E.
    const colonnes = [
        "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", 
        "AA", "AB", "AC", "AD", "AE", "AF", "AG", "AH", "AI"
    ];
    
    const lettreColonne = colonnes[jour - 1];
    return `${nomOnglet}!${lettreColonne}5`;
}

// ==========================================
// 🚀 FONCTION PRINCIPALE D'INSERTION
// ==========================================

/**
 * Met à jour la cellule avec les USD (Gère le cumul ou la remise à zéro)
 */
async function enregistrerRecetteUSD(montantDuManager) {
    // 1. Obtenir les dates et cellules
    const dateAujourdhui = getDateLogique();
    const celluleAujourdhui = getCellulePourDate(dateAujourdhui);

    const dateHier = new Date(dateAujourdhui);
    dateHier.setDate(dateHier.getDate() - 1);
    const celluleHier = getCellulePourDate(dateHier);

    try {
        // 2. Définir les limites de la journée pour la recherche Prisma
        const debutJournee = new Date(dateAujourdhui);
        debutJournee.setHours(0, 0, 0, 0);
        
        const finJournee = new Date(dateAujourdhui);
        finJournee.setHours(23, 59, 59, 999);

        // 3. 🕵️‍♂️ Vérifier si le boss a écrit "sortie usd" aujourd'hui
        const messageSortie = await prisma.message.findFirst({
            where: {
                timestamp: { gte: debutJournee, lte: finJournee },
                OR: [
                    { texte: { contains: 'sortie usd', mode: 'insensitive' } },
                    { texte: { contains: 'sortie dollar', mode: 'insensitive' } }
                ]
            }
        });

        const euSortie = !!messageSortie;
        let montantFinalAInserer = montantDuManager;

        // 4. 🧮 Logique de calcul
        if (euSortie) {
            console.log(`🚨 SORTIE DÉTECTÉE le ${dateAujourdhui.toLocaleDateString('fr-FR')} ! Remise à zéro du compteur.`);
            // Le montant final reste celui du manager (pas de cumul)
        } else {
            console.log(`✅ Pas de sortie signalée. Calcul du cumul avec hier...`);
            
            // On va lire le montant d'hier dans Google Sheets (format non-formaté pour éviter les bugs de virgules)
            const responseHier = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: celluleHier,
                valueRenderOption: 'UNFORMATTED_VALUE' // 🛡️ Ramène un vrai nombre propre
            });

            let usdHier = 0;
            if (responseHier.data.values && responseHier.data.values[0] && responseHier.data.values[0][0]) {
                usdHier = parseFloat(responseHier.data.values[0][0]) || 0;
            }

            montantFinalAInserer = usdHier + montantDuManager;
            console.log(`🧮 CUMUL : Hier (${usdHier}$) + Aujourd'hui (${montantDuManager}$) = Total à insérer (${montantFinalAInserer}$)`);
        }

        // 5. 📤 Envoi final vers Google Sheets
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: celluleAujourdhui,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [[montantFinalAInserer]], // On insère le résultat du calcul
            },
        });

        console.log(`✅ [SHEETS] Montant final de ${montantFinalAInserer}$ inséré avec succès dans la cellule ${celluleAujourdhui} !`);
        return true;

    } catch (error) {
        console.error('❌ Erreur Critique lors de l\'enregistrement USD :', error.stack || error.message);
        return false;
    }
}

module.exports = { enregistrerRecetteUSD };
