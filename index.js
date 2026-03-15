import TelegramBot from 'node-telegram-bot-api';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, set } from 'firebase/database';
import youtubedl from 'youtube-dl-exec';
import fs from 'fs';

// --- 1. CONFIGURACIÓN DE FIREBASE ---
const firebaseConfig = {
  apiKey: "AIzaSyBCk_6-UQu_8js-Rof_Vps7QWPBw6dJFcg",
  authDomain: "temo-store.firebaseapp.com",
  databaseURL: "https://temo-store-default-rtdb.firebaseio.com", 
  projectId: "temo-store",
  storageBucket: "temo-store.firebasestorage.app",
  messagingSenderId: "502364316401",
  appId: "1:502364316401:web:201b9e9c6e426acdb33f50"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// --- 2. CONFIGURACIÓN DEL BOT ---
const tokenTiktok = '8038521927:AAH32NbJJwzNgZTResVyHi24kVycRhPRt7U';
const botTiktok = new TelegramBot(tokenTiktok, { polling: true });

// --- 3. FUNCIONES GLOBALES ---
async function isBanned(chatId) {
  const banSnap = await get(ref(db, `banned_users/${chatId}`));
  return banSnap.exists();
}

async function getTikTokVideo(url) {
  try {
    const response = await fetch("https://www.tikwm.com/api/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ url: url, hd: 1 })
    });
    const data = await response.json();
    if (data.code === 0 && data.data) {
      return data.data.hdplay || data.data.play;
    }
    return null;
  } catch (error) {
    console.error("Error obteniendo TikTok:", error);
    return null;
  }
}

async function getAndTrackTiktokUsers(chatId) {
  const userRef = ref(db, `tiktok_bot_users/${chatId}`);
  const userSnap = await get(userRef);
  const statsRef = ref(db, `tiktok_bot_stats/total_users`);
  
  let totalUsers = 0;
  const statsSnap = await get(statsRef);
  if (statsSnap.exists()) {
    totalUsers = statsSnap.val();
  }

  if (!userSnap.exists()) {
    totalUsers += 1;
    await set(userRef, true);
    await set(statsRef, totalUsers);
  }
  return totalUsers;
}

// --- 4. LÓGICA PRINCIPAL DEL BOT ---
botTiktok.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (await isBanned(chatId)) return botTiktok.sendMessage(chatId, "🚫 Estás baneado y no puedes usar este bot.");

  const totalUsuarios = await getAndTrackTiktokUsers(chatId);
  
  const mensaje = "🤖 *Este bot está 100% programado por sebastian (LUCK XIT OFC)*\n\n" +
                  "👋 ¡Hola! Soy un bot totalmente gratuito para descargar videos.\n\n" +
                  `📊 *Usuarios totales que me usan:* ${totalUsuarios}\n\n` +
                  "📖 *¿Cómo usar el bot?*\n" +
                  "Simplemente envíame un enlace válido de **TikTok** o **YouTube** (hasta 20 minutos de duración) y yo me encargaré de enviarte el video al instante. 🚀";

  const opciones = {
    parse_mode: "Markdown",
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [
        [{ text: "📞 Contacto en WhatsApp", url: "https://wa.me/573142369516" }]
      ]
    }
  };

  botTiktok.sendMessage(chatId, mensaje, opciones);
});

botTiktok.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith('/')) return;
  
  if (await isBanned(chatId)) return;

  const totalUsuarios = await getAndTrackTiktokUsers(chatId);

  // ==========================================
  // ===== LÓGICA DE TIKTOK (API TIKWM) =======
  // ==========================================
  if (text.includes('tiktok.com')) {
    const waitMsg = await botTiktok.sendMessage(chatId, "⏳ Descargando video de TikTok sin marca de agua...");
    const videoUrl = await getTikTokVideo(text.trim());

    if (videoUrl) {
      try {
        await botTiktok.sendVideo(chatId, videoUrl, { caption: `✅ ¡Aquí tienes tu video gratis!\n\n📊 *Usuarios totales en tiempo real:* ${totalUsuarios}\n🤖 _Bot by: sebastian (LUCK XIT OFC)_`, parse_mode: "Markdown" });
        botTiktok.deleteMessage(chatId, waitMsg.message_id).catch(()=>{});
      } catch (error) {
        botTiktok.deleteMessage(chatId, waitMsg.message_id).catch(()=>{});
        botTiktok.sendMessage(chatId, "❌ Error al enviar el video. Puede que sea demasiado pesado para Telegram.");
      }
    } else {
      botTiktok.deleteMessage(chatId, waitMsg.message_id).catch(()=>{});
      botTiktok.sendMessage(chatId, "❌ Error al procesar el enlace. Asegúrate de que el video sea público y el enlace esté correcto.");
    }
  } 
  
  // ==========================================
  // == LÓGICA DE YOUTUBE (USANDO YT-DLP) =====
  // ==========================================
  else if (text.includes('youtube.com') || text.includes('youtu.be')) {
    const waitMsg = await botTiktok.sendMessage(chatId, "⏳ Descargando video de YouTube, esto puede tardar unos momentos...");
    
    // Generar un nombre temporal único para evitar conflictos si 2 personas descargan al tiempo
    const outputFilename = `luck_xit_yt_${chatId}_${Date.now()}.mp4`;

    try {
      // Configuraciones idénticas a las de tu Python adaptadas a la librería de Node.js
      await youtubedl(text.trim(), {
        f: 'best[ext=mp4][filesize<49M]/best[ext=mp4]', // Busca mp4 que pese menos de 50MB (límite de Telegram)
        matchFilter: 'duration <= 1200', // Límite exacto de 20 minutos en segundos
        mergeOutputFormat: 'mp4',
        output: outputFilename,
        noWarnings: true
      });

      // Validar si el archivo de verdad se descargó
      if (fs.existsSync(outputFilename)) {
        await botTiktok.sendVideo(chatId, outputFilename, { 
            caption: `✅ ¡Aquí tienes tu video de YouTube!\n\n📊 *Usuarios totales en tiempo real:* ${totalUsuarios}\n🤖 _Bot by: sebastian (LUCK XIT OFC)_`, 
            parse_mode: "Markdown" 
        });
        
        // Borramos el video del servidor después de enviarlo para no llenar tu disco
        fs.unlinkSync(outputFilename);
        botTiktok.deleteMessage(chatId, waitMsg.message_id).catch(()=>{});
      } else {
        throw new Error("No se pudo crear el archivo.");
      }

    } catch (error) {
      botTiktok.deleteMessage(chatId, waitMsg.message_id).catch(()=>{});
      
      const errorStr = error.message || "";
      // Manejo de errores basado en los filtros de yt-dlp
      if (errorStr.includes('duration')) {
        botTiktok.sendMessage(chatId, "❌ El video excede el límite de 20 minutos permitidos.");
      } else if (errorStr.includes('filesize') || errorStr.includes('too large')) {
        botTiktok.sendMessage(chatId, "❌ El video es demasiado pesado para ser enviado por Telegram (Límite máximo de 50MB).");
      } else {
        botTiktok.sendMessage(chatId, "❌ Error al descargar el video. Asegúrate de que el enlace sea correcto y el video no sea privado.");
      }

      // Si falló a la mitad, borramos el rastro del archivo corrupto
      if (fs.existsSync(outputFilename)) fs.unlinkSync(outputFilename);
    }
  } 
  
  // ==========================================
  // =========== ENLACES INVÁLIDOS ============
  // ==========================================
  else {
    botTiktok.sendMessage(chatId, "⚠️ Por favor, envíame un enlace válido de **TikTok** o **YouTube**.");
  }
});

console.log("Bot MULTI-PLATAFORMA iniciado (TikTok + YouTube)...");
