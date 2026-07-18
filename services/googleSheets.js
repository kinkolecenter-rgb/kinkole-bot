const { google } = require('googleapis');

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

/**
 * Calcule la cellule exacte (Ex: "Jul!V5" pour le 18 juillet)
 */
function getCelluleDuJour() {
    const date = new Date();
    
    // Noms des onglets tels qu'ils sont en bas de ton image
    const moisOnglets = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const nomOnglet = moisOnglets[date.getMonth()];
    
    const jour = date.getDate();
    
    // Le 1er est en colonne E. On fait la carte des colonnes de 1 à 31.
    const colonnes = [
        "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", 
        "AA", "AB", "AC", "AD", "AE", "AF", "AG", "AH", "AI"
    ];
    
    const lettreColonne = colonnes[jour - 1]; // jour 1 = E, jour 18 = V
    
    return `${nomOnglet}!${lettreColonne}5`; // Ligne 5 selon ton image
}

/**
 * Met à jour la cellule avec les USD du jour
 */
async function enregistrerRecetteUSD(montant) {
    const cellule = getCelluleDuJour();
    
    try {
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: cellule,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [[montant]], // Les crochets doubles sont importants ici
            },
        });
        console.log(`✅ [SHEETS] Montant de ${montant}$ inséré avec succès dans la cellule ${cellule} !`);
        return true;
    } catch (error) {
        console.error('❌ Erreur Google Sheets (Mise à jour) :', error.message);
        return false;
    }
}

module.exports = { enregistrerRecetteUSD };
