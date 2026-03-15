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
                  "Simplemente envíame un enlace válido de **TikTok** o **YouTube** y yo me encargaré de enviarte el video al instante. 🚀";

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
    
    // Generar un nombre temporal único
    const outputFilename = `luck_xit_yt_${chatId}_${Date.now()}.mp4`;

    try {
      console.log(`[YT-DLP] Intentando descargar: ${text.trim()}`);
      
      // Configuración simplificada y más estable
      await youtubedl(text.trim(), {
        format: 'best', // Descarga la mejor calidad que venga en un solo archivo
        output: outputFilename,
        noWarnings: true,
        noCheckCertificates: true
      });

      console.log(`[YT-DLP] Descarga completada. Verificando archivo...`);

      // Validar si el archivo de verdad se descargó
      if (fs.existsSync(outputFilename)) {
        
        // Verificar el peso para que Telegram no rechace el envío (Límite 50MB)
        const stats = fs.statSync(outputFilename);
        const fileSizeInMegabytes = stats.size / (1024 * 1024);
        
        if (fileSizeInMegabytes > 49) {
            fs.unlinkSync(outputFilename); // Borrar el archivo pesado
            throw new Error("FILE_TOO_LARGE");
        }

        await botTiktok.sendVideo(chatId, outputFilename, { 
            caption: `✅ ¡Aquí tienes tu video de YouTube!\n\n📊 *Usuarios totales en tiempo real:* ${totalUsuarios}\n🤖 _Bot by: sebastian (LUCK XIT OFC)_`, 
            parse_mode: "Markdown" 
        });
        
        // Borramos el video del servidor después de enviarlo
        fs.unlinkSync(outputFilename);
        botTiktok.deleteMessage(chatId, waitMsg.message_id).catch(()=>{});
        console.log(`[YT-DLP] Video enviado exitosamente al chat ${chatId}`);

      } else {
        throw new Error("El archivo no se generó correctamente.");
      }

    } catch (error) {
      console.error("❌ ERROR REAL DE YOUTUBE:", error); 
      
      botTiktok.deleteMessage(chatId, waitMsg.message_id).catch(()=>{});
      
      const errorStr = (error.message || "").toUpperCase();
      
      if (errorStr.includes('FILE_TOO_LARGE')) {
        botTiktok.sendMessage(chatId, "❌ El video supera los 50MB, Telegram no permite enviar archivos tan pesados por bots normales.");
      } else if (errorStr.includes('SIGN IN') || errorStr.includes('403')) {
        botTiktok.sendMessage(chatId, "❌ YouTube bloqueó la descarga temporalmente (Protección anti-bots). Intenta más tarde.");
      } else {
        botTiktok.sendMessage(chatId, "❌ Error al procesar la descarga de YouTube. Revisa el enlace.");
      }

      // Si falló a la mitad, borramos el rastro del archivo corrupto
      if (fs.existsSync(outputFilename)) {
          try { fs.unlinkSync(outputFilename); } catch(e){}
      }
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
