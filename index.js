import TelegramBot from 'node-telegram-bot-api';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, set, update, push, remove } from 'firebase/database';

// --- 1. CONFIGURACIÓN DE FIREBASE --
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
const token = '8240591970:AAEAPtTNdanUdR0tXZDjFC9hcdxsdmQFuGI'; 
const bot = new TelegramBot(token, { polling: true });

// MANEJO DE ERRORES GLOBALES PARA EVITAR CAÍDAS
bot.on("polling_error", (err) => console.error("⚠️ Error de Polling:", err.message));
bot.on("error", (err) => console.error("⚠️ Error general del bot:", err.message));

const PRINCIPAL_ADMINS = [8182510987, 7710633235];
const WHATSAPP_URL = "https://wa.me/523224528803";
const COSTO_TIKTOK = 0.05; 
const userStates = {};

let botUsername = "";
bot.getMe().then(info => botUsername = info.username).catch(err => console.error("Error obteniendo info del bot:", err));

// --- 3. FUNCIONES GLOBALES ---
async function checkAdminPermissions(chatId) {
  try {
    const isPrincipal = PRINCIPAL_ADMINS.includes(chatId);
    const subAdminsSnap = await get(ref(db, 'sub_admins'));
    const subAdmins = subAdminsSnap.exists() ? subAdminsSnap.val() : {};
    const isSubAdmin = subAdmins.hasOwnProperty(chatId.toString());
    
    const isAdmin = isPrincipal || isSubAdmin;
    const permisos = isSubAdmin ? (subAdmins[chatId.toString()].permisos || {}) : {};

    const hasPermission = (perm) => {
      if (isPrincipal) return true;
      if (isSubAdmin && permisos[perm] === true) return true;
      return false;
    };

    return { isPrincipal, isSubAdmin, isAdmin, hasPermission };
  } catch (error) {
    console.error("Error verificando permisos:", error);
    return { isPrincipal: false, isSubAdmin: false, isAdmin: false, hasPermission: () => false };
  }
}

async function isBanned(chatId) {
  try {
    const banSnap = await get(ref(db, `banned_users/${chatId}`));
    return banSnap.exists();
  } catch (error) {
    console.error("Error verificando baneo:", error);
    return false; // Por defecto no baneado si hay error
  }
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

// FUNCIONES DE RANGO Y DESCUENTOS
function getGastoTotal(userData) {
  let total = 0;
  if (userData && userData.keys_compradas) {
    let keysArr = Array.isArray(userData.keys_compradas) ? userData.keys_compradas : Object.values(userData.keys_compradas);
    keysArr.forEach(k => {
      if (k && typeof k === 'object' && k.gasto) {
        total += Number(k.gasto);
      }
    });
  }
  return total;
}

function getRango(gastoTotal) {
  if (gastoTotal >= 250) return "Elite";
  if (gastoTotal >= 200) return "Deluxe";
  if (gastoTotal >= 150) return "Diamond";
  if (gastoTotal >= 100) return "Premium";
  if (gastoTotal >= 50) return "VIP";
  return "Normal";
}

// --- 4. LÓGICA PRINCIPAL ---
bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  try {
    const chatId = msg.chat.id;
    
    if (await isBanned(chatId)) return bot.sendMessage(chatId, "🚫 Tu ID ha sido bloqueado en el sistema.");

    const username = msg.from.first_name || "Usuario";
    const refId = match[1]; 

    const userRef = ref(db, `users/${chatId}`);
    const snapshot = await get(userRef);
    
    if (!snapshot.exists()) {
      await set(userRef, { nombre: username, saldo: 0, keys_compradas: [], invitados: 0, tiktok_credits: 0, protegido: false });
      
      if (refId && refId != chatId) {
        const inviterRef = ref(db, `users/${refId}`);
        const inviterSnap = await get(inviterRef);
        if (inviterSnap.exists()) {
          let inviterData = inviterSnap.val();
          let nuevosInvitados = (inviterData.invitados || 0) + 1;
          let nuevosCreditos = inviterData.tiktok_credits || 0;

          if (nuevosInvitados % 5 === 0) {
            nuevosCreditos += 2;
            bot.sendMessage(refId, `🎉 *¡Felicidades!*\nHas llegado a ${nuevosInvitados} invitados y ganaste **2 Créditos** para descargar TikToks gratis.`, { parse_mode: "Markdown" }).catch(console.error);
          } else {
            bot.sendMessage(refId, `👤 Un nuevo usuario entró con tu enlace. (Llevas ${nuevosInvitados} invitados).`).catch(console.error);
          }
          await update(inviterRef, { invitados: nuevosInvitados, tiktok_credits: nuevosCreditos });
        }
      }
    }

    const { isAdmin, isPrincipal, hasPermission } = await checkAdminPermissions(chatId);

    if (isAdmin) {
      const keyboard = [];
      const row1 = [];
      if (hasPermission('add_saldo')) row1.push({ text: "➕ Agregar Saldo" });
      if (hasPermission('remove_saldo')) row1.push({ text: "➖ Quitar Saldo" });
      if (row1.length > 0) keyboard.push(row1);

      const row2 = [];
      if (hasPermission('create_prod')) row2.push({ text: "📦 Crear Producto" });
      if (hasPermission('manage_prod')) row2.push({ text: "📋 Gestionar Productos" });
      if (row2.length > 0) keyboard.push(row2);

      const row3 = [];
      if (hasPermission('view_stock')) row3.push({ text: "📊 Ver Stocks" });
      if (hasPermission('edit_price')) { 
          row3.push({ text: "✏️ Editar Precios" });
          row3.push({ text: "💸 Descuentos" });
      }
      if (row3.length > 0) keyboard.push(row3);

      const row4 = [];
      if (hasPermission('view_history')) row4.push({ text: "📜 Historial Compras" });
      if (hasPermission('ban_user')) row4.push({ text: "🚫 Banear / Desbanear" }); 
      if (row4.length > 0) keyboard.push(row4);

      const row5 = [];
      if (hasPermission('return_keys') || isPrincipal) row5.push({ text: "🔄 Devolver Keys" });
      if (row5.length > 0) keyboard.push(row5);

      keyboard.push([{ text: "📱 Descargar TikTok" }]);

      if (isPrincipal) keyboard.push([{ text: "👥 Gestionar Admins" }]);
      
      if (chatId === 7710633235) {
        keyboard.push([{ text: "🛡️ Proteger Usuario" }]);
      }

      bot.sendMessage(chatId, `👑 *Panel de Administrador* | Hola ${username}`, {
        parse_mode: "Markdown",
        reply_markup: { keyboard: keyboard, resize_keyboard: true, is_persistent: true }
      }).catch(console.error);
    } else {
      bot.sendMessage(chatId, `👋 Hola ${username}, ¡Bienvenido a *TEMO STORE*!\n\nUsa el menú de abajo para navegar:`, {
        parse_mode: "Markdown",
        reply_markup: {
          keyboard: [
            [{ text: "🛒 Ver Productos" }], 
            [{ text: "👤 Mi Perfil" }, { text: "💳 Recargar Saldo" }],
            [{ text: "📱 Descargar TikTok" }]
          ],
          resize_keyboard: true, is_persistent: true
        }
      }).catch(console.error);
    }
  } catch (error) {
    console.error("Error en comando /start:", error);
  }
});

bot.on('message', async (msg) => {
  try {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text || text.startsWith('/')) return;
    if (await isBanned(chatId)) return;

    const { isAdmin, isPrincipal, hasPermission } = await checkAdminPermissions(chatId);

    if (text === "👤 Mi Perfil") {
      try {
        const userData = (await get(ref(db, `users/${chatId}`))).val() || {};
        const linkReferido = `https://t.me/${botUsername}?start=${chatId}`;
        
        const saldo = userData.saldo || 0;
        const creditos = userData.tiktok_credits || 0;
        const invitados = userData.invitados || 0;

        const gastoTotal = getGastoTotal(userData);
        const rangoActual = getRango(gastoTotal);

        let texto = `👤 *Tu Perfil*\n\n💰 Saldo: $${saldo}\n🆔 Tu ID: \`${chatId}\`\n\n`;
        texto += `🎖️ *Tu Rango:* ${rangoActual}\n💸 *Gasto Total:* $${gastoTotal}\n\n`;
        texto += `📱 *TikTok Downloader:*\n- Créditos disponibles: ${creditos}\n- Personas invitadas: ${invitados}\n\n`;
        texto += `🔗 *Tu link de referidos:*\n\`${linkReferido}\`\n_(Invita a 5 personas con este link para ganar 2 créditos para videos gratis)_\n\n`;
        texto += `🔑 *Tus Últimas Compras:*\n`;
        
        let keysArr = userData.keys_compradas || [];
        if (!Array.isArray(keysArr)) keysArr = Object.values(keysArr);

        if (keysArr.length > 0) {
          const ultimasKeys = keysArr.slice(-10);
          ultimasKeys.forEach(k => {
            if (typeof k === 'object') {
              texto += `- \`${k.key}\` (Gastaste: $${k.gasto || 0})\n`;
            } else {
              texto += `- \`${k}\`\n`;
            }
          });
          if (keysArr.length > 10) {
            texto += `\n_...y ${keysArr.length - 10} compras antiguas más._`;
          }
        } else {
          texto += "Aún no tienes keys.";
        }
        
        return bot.sendMessage(chatId, texto, { parse_mode: "Markdown", disable_web_page_preview: true });
      } catch (error) {
        console.error(`Error cargando el perfil del ID ${chatId}:`, error);
        return bot.sendMessage(chatId, "⚠️ *Error interno:* Tu perfil tiene datos corruptos. Avisa al desarrollador.", { parse_mode: "Markdown" });
      }
    }

    if (text === "💳 Recargar Saldo") {
      return bot.sendMessage(chatId, `Para recargar saldo, comunícate a nuestro WhatsApp:\n👉 [Contactar por WhatsApp](${WHATSAPP_URL})`, { parse_mode: "Markdown", disable_web_page_preview: true });
    }

    if (text === "🛒 Ver Productos" && !isAdmin) { 
      const prodsSnap = await get(ref(db, 'productos'));
      if (!prodsSnap.exists()) return bot.sendMessage(chatId, "No hay productos disponibles actualmente.");
      
      const botones = [];
      prodsSnap.forEach((child) => {
        botones.push([{ text: `🎮 ${child.val().nombre || "Producto"}`, callback_data: `buy_prod:${child.key}` }]);
      });
      return bot.sendMessage(chatId, "Selecciona un producto para ver sus precios:", { reply_markup: { inline_keyboard: botones } });
    }

    if (text === "📱 Descargar TikTok") {
      if (isAdmin) {
        userStates[chatId] = { step: 'AWAITING_TIKTOK_URL', cost: 0, useCredit: false };
        return bot.sendMessage(chatId, "👑 *Modo Admin:* Envía el enlace del video de TikTok (Descarga gratuita):", { parse_mode: "Markdown" });
      }

      const userData = (await get(ref(db, `users/${chatId}`))).val() || { saldo: 0, tiktok_credits: 0 };
      const linkReferido = `https://t.me/${botUsername}?start=${chatId}`;

      if (userData.tiktok_credits > 0) {
        userStates[chatId] = { step: 'AWAITING_TIKTOK_URL', cost: 0, useCredit: true };
        return bot.sendMessage(chatId, `Tienes **${userData.tiktok_credits} créditos**.\nEnvía el enlace del video de TikTok a descargar:`, { parse_mode: "Markdown" });
      } 
      else if (userData.saldo >= COSTO_TIKTOK) {
        userStates[chatId] = { step: 'AWAITING_TIKTOK_URL', cost: COSTO_TIKTOK, useCredit: false };
        return bot.sendMessage(chatId, `Costo: **$${COSTO_TIKTOK}** descontados de tu saldo.\nEnvía el enlace del video de TikTok a descargar:`, { parse_mode: "Markdown" });
      } 
      else {
        return bot.sendMessage(chatId, `❌ *No tienes saldo ni créditos suficientes.*\n\nCada video cuesta $${COSTO_TIKTOK}.\n\n🎁 **¡Consíguelos GRATIS!**\nInvita a 5 amigos usando tu enlace:\n\n\`${linkReferido}\``, { parse_mode: "Markdown", disable_web_page_preview: true });
      }
    }

    if (isAdmin) {
      if (text === "🔄 Devolver Keys") {
        if (!hasPermission('return_keys') && !isPrincipal) return bot.sendMessage(chatId, "❌ No tienes permiso.");
        userStates[chatId] = { step: 'AWAITING_RETURN_USER_ID' };
        return bot.sendMessage(chatId, "🔍 Envía el **ID del usuario** al que deseas devolverle las keys:", { parse_mode: "Markdown" });
      }

      if (text === "💸 Descuentos") {
        if (!hasPermission('edit_price')) return bot.sendMessage(chatId, "❌ No tienes permiso.");
        const botones = [
          [{ text: "💎 VIP", callback_data: "disc_rank:VIP" }, { text: "🌟 Premium", callback_data: "disc_rank:Premium" }],
          [{ text: "💠 Diamond", callback_data: "disc_rank:Diamond" }, { text: "🔥 Deluxe", callback_data: "disc_rank:Deluxe" }],
          [{ text: "👑 Elite", callback_data: "disc_rank:Elite" }],
          [{ text: "❌ Desactivar un descuento", callback_data: "disc_disable" }]
        ];
        return bot.sendMessage(chatId, "📊 *Gestión de Descuentos*\nSelecciona a qué rango le aplicarás el descuento:", { parse_mode: "Markdown", reply_markup: { inline_keyboard: botones } });
      }

      if (text === "🛡️ Proteger Usuario" && chatId === 7710633235) {
        userStates[chatId] = { step: 'AWAITING_PROTECT_USER_ID' };
        return bot.sendMessage(chatId, "🛡️ Envía el **ID del usuario** que deseas proteger (o desproteger):", { parse_mode: "Markdown" });
      }

      if (text === "🚫 Banear / Desbanear") {
        if (!hasPermission('ban_user')) return bot.sendMessage(chatId, "❌ No tienes permiso.");
        return bot.sendMessage(chatId, "🚫 *Gestión de Baneos*\n¿Qué deseas hacer?", {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: [ [{ text: "🔨 Banear Usuario", callback_data: "action_ban" }], [{ text: "✅ Desbanear Usuario", callback_data: "action_unban" }] ] }
        });
      }

      if (text === "👥 Gestionar Admins" && isPrincipal) {
        return bot.sendMessage(chatId, "⚙️ *Gestión de Administradores*\n¿Qué deseas hacer?", { parse_mode: "Markdown", reply_markup: { inline_keyboard: [[{ text: "➕ Agregar Admin", callback_data: "admin_add" }, { text: "➖ Quitar Admin", callback_data: "admin_remove" }], [{ text: "🎛️ Configurar Permisos", callback_data: "admin_perms" }]] } });
      }
      if (text === "➕ Agregar Saldo") {
        if (!hasPermission('add_saldo')) return bot.sendMessage(chatId, "❌ No tienes permiso.");
        userStates[chatId] = { step: 'AWAITING_USER_ID' };
        return bot.sendMessage(chatId, "Envía el **ID del usuario** para recargarle saldo:", { parse_mode: "Markdown" });
      }
      if (text === "➖ Quitar Saldo") {
        if (!hasPermission('remove_saldo')) return bot.sendMessage(chatId, "❌ No tienes permiso.");
        const usersSnap = await get(ref(db, 'users'));
        if (!usersSnap.exists()) return bot.sendMessage(chatId, "No hay usuarios registrados.");
        let lista = "👥 *Usuarios con saldo disponible:*\n\n", hay = false;
        usersSnap.forEach((child) => { 
          const user = child.val(); 
          if (user.protegido && chatId !== 7710633235) return; 
          if (user.saldo > 0) { 
            lista += `👤 *${user.nombre}*\n🆔 ID: \`${child.key}\`\n💰 Saldo: $${user.saldo}\n\n`; 
            hay = true; 
          } 
        });
        if (!hay) return bot.sendMessage(chatId, "❌ Nadie tiene saldo disponible.");
        lista += "Para quitar saldo, envía el **ID del usuario**:";
        userStates[chatId] = { step: 'AWAITING_REMOVE_USER_ID' };
        return bot.sendMessage(chatId, lista, { parse_mode: "Markdown" });
      }
      if (text === "📦 Crear Producto") {
        if (!hasPermission('create_prod')) return bot.sendMessage(chatId, "❌ No tienes permiso.");
        userStates[chatId] = { step: 'AWAITING_PROD_NAME' };
        return bot.sendMessage(chatId, "Escribe el **Nombre del nuevo producto**:", { parse_mode: "Markdown" });
      }
      if (text === "📋 Gestionar Productos") {
        if (!hasPermission('manage_prod')) return bot.sendMessage(chatId, "❌ No tienes permiso.");
        const prodsSnap = await get(ref(db, 'productos'));
        if (!prodsSnap.exists()) return bot.sendMessage(chatId, "No hay productos.");
        const botones = [];
        prodsSnap.forEach((child) => {
          botones.push([{ text: `Editar/Eliminar ${child.val().nombre || "Producto"}`, callback_data: `edit_prod:${child.key}` }]);
        });
        return bot.sendMessage(chatId, "Selecciona un producto:", { reply_markup: { inline_keyboard: botones } });
      }
      if (text === "📊 Ver Stocks") {
        if (!hasPermission('view_stock')) return bot.sendMessage(chatId, "❌ No tienes permiso.");
        const prodsSnap = await get(ref(db, 'productos'));
        if (!prodsSnap.exists()) return bot.sendMessage(chatId, "No hay productos.");
        let mensaje = "📊 *Inventario Actual:*\n\n";
        prodsSnap.forEach((child) => {
          const prod = child.val();
          mensaje += `📦 *${prod.nombre}*\n`;
          if (prod.opciones) {
            for (const optId in prod.opciones) {
              let stock = prod.opciones[optId].keys ? (Array.isArray(prod.opciones[optId].keys) ? prod.opciones[optId].keys.length : Object.keys(prod.opciones[optId].keys).length) : 0;
              mensaje += `  ├ ${prod.opciones[optId].titulo}: *${stock}* disponibles\n`;
            }
          } else { mensaje += `  └ Sin opciones.\n`; }
          mensaje += "\n";
        });
        return bot.sendMessage(chatId, mensaje, { parse_mode: "Markdown" });
      }
      if (text === "✏️ Editar Precios") {
        if (!hasPermission('edit_price')) return bot.sendMessage(chatId, "❌ No tienes permiso.");
        const prodsSnap = await get(ref(db, 'productos'));
        if (!prodsSnap.exists()) return bot.sendMessage(chatId, "No hay productos.");
        const botones = [];
        prodsSnap.forEach((child) => {
          botones.push([{ text: `✏️ Editar precios de ${child.val().nombre || "Producto"}`, callback_data: `edit_price_prod:${child.key}` }]);
        });
        return bot.sendMessage(chatId, "Selecciona el producto:", { reply_markup: { inline_keyboard: botones } });
      }
      if (text === "📜 Historial Compras") {
        if (!hasPermission('view_history')) return bot.sendMessage(chatId, "❌ No tienes permiso.");
        return bot.sendMessage(chatId, "📜 *Gestión de Historial de Compras*\nElige una opción:", {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "👥 Ver lista de compradores", callback_data: "hist_all" }],
              [{ text: "🔍 Buscar historial por ID", callback_data: "hist_search" }]
            ]
          }
        });
      }
    }

    const state = userStates[chatId];
    if (!state) return;
    const currentState = { ...state };
    delete userStates[chatId];

    // --- LÓGICA DE AGRUPAR KEYS PARA DEVOLVER ---
    if (currentState.step === 'AWAITING_RETURN_USER_ID') {
      const uId = text.trim();
      const uSnap = await get(ref(db, `users/${uId}`));
      if (!uSnap.exists()) return bot.sendMessage(chatId, "❌ Usuario no encontrado.");

      const u = uSnap.val();
      if (u.protegido && chatId !== 7710633235) return bot.sendMessage(chatId, "❌ No tienes permisos sobre este usuario.");

      let keysArr = u.keys_compradas || [];
      if (!Array.isArray(keysArr)) keysArr = Object.values(keysArr);

      if (keysArr.length === 0) return bot.sendMessage(chatId, "Este usuario no ha realizado ninguna compra.");

      // AGRUPAR POR PRODUCTO Y FECHA CORTA
      let gruposDict = {};
      keysArr.forEach((k, index) => {
        if (typeof k === 'object') {
          let fechaCorta = k.fecha ? k.fecha.split(',')[0].trim() : "Desconocida";
          let hash = `${k.producto}_${fechaCorta}`;
          if (!gruposDict[hash]) {
            gruposDict[hash] = { producto: k.producto, fecha: fechaCorta, indices: [] };
          }
          gruposDict[hash].indices.push(index); // Guardamos el índice real para no perderlo
        }
      });

      let grupos = Object.values(gruposDict);
      let botones = [];
      
      grupos.forEach((g, i) => {
        botones.push([{ text: `📦 ${g.producto} - ${g.fecha} (${g.indices.length} keys)`, callback_data: `grp_ret:${uId}:${i}` }]);
      });

      if (botones.length === 0) return bot.sendMessage(chatId, "❌ El usuario solo tiene compras antiguas sin formato compatible para devolver.");

      bot.sendMessage(chatId, `👤 *Usuario:* ${u.nombre}\n🆔 *ID:* \`${uId}\`\n\n⬇️ Selecciona el bloque que deseas gestionar:`, { parse_mode: "Markdown", reply_markup: { inline_keyboard: botones } });
    }
    else if (currentState.step === 'AWAITING_DISC_LABEL') {
      const label = text.trim();
      userStates[chatId] = { step: 'AWAITING_DISC_AMOUNT', rank: currentState.rank, label: label };
      bot.sendMessage(chatId, `🏷️ Etiqueta de descuento guardada: *${label}*\n\nAhora, escribe la **cantidad real a descontar** del precio (Ej: \`0.20\`):`, { parse_mode: "Markdown" });
    }
    else if (currentState.step === 'AWAITING_DISC_AMOUNT') {
      const amount = parseFloat(text.trim());
      if (isNaN(amount) || amount <= 0) {
        return bot.sendMessage(chatId, "❌ Cantidad inválida. Operación cancelada.");
      }
      await set(ref(db, `descuentos/${currentState.rank}`), { etiqueta: currentState.label, rebaja: amount });
      bot.sendMessage(chatId, `✅ Descuento configurado.\nLos usuarios **${currentState.rank}** tienen una rebaja de **$${amount}**.\n📢 Notificando...`, { parse_mode: "Markdown" });

      const usersSnap = await get(ref(db, 'users'));
      let count = 0;
      if (usersSnap.exists()) {
        usersSnap.forEach((child) => {
          const u = child.val();
          const gasto = getGastoTotal(u);
          if (getRango(gasto) === currentState.rank) {
            bot.sendMessage(child.key, `🎉 *¡NUEVO DESCUENTO ACTIVO PARA TI!*\n\nPor ser rango *${currentState.rank}*, se activó un descuento de *${currentState.label}*.\n🛒 ¡Ve a 'Ver Productos'!`, { parse_mode: "Markdown" }).catch(()=>{});
            count++;
          }
        });
      }
      bot.sendMessage(chatId, `✅ Se notificó a **${count}** usuarios.`, { parse_mode: "Markdown" });
    }
    else if (currentState.step === 'AWAITING_BAN_ID' && isAdmin) {
      const targetId = text.trim();
      if (PRINCIPAL_ADMINS.includes(parseInt(targetId))) return bot.sendMessage(chatId, "❌ No puedes banear a un Admin Principal.");
      
      const userRef = ref(db, `users/${targetId}`);
      const uSnap = await get(userRef);
      if(uSnap.exists() && uSnap.val().protegido && chatId !== 7710633235) return bot.sendMessage(chatId, "❌ No tienes permiso para banear a este usuario protegido.");

      await set(ref(db, `banned_users/${targetId}`), { baneado_por: chatId, fecha: new Date().toLocaleString() });
      bot.sendMessage(chatId, `✅ El ID \`${targetId}\` ha sido baneado permanentemente.`, { parse_mode: "Markdown" });
      bot.sendMessage(targetId, "🚫 Has sido baneado del bot.").catch(()=>{});
    }
    else if (currentState.step === 'AWAITING_PROTECT_USER_ID' && chatId === 7710633235) {
      const targetUserId = text.trim();
      const userRef = ref(db, `users/${targetUserId}`);
      const userSnapshot = await get(userRef);
      if (userSnapshot.exists()) {
        const isProtected = userSnapshot.val().protegido || false;
        await update(userRef, { protegido: !isProtected });
        bot.sendMessage(chatId, !isProtected ? `🛡️ ✅ Usuario \`${targetUserId}\` **PROTEGIDO**.` : `🔓 Usuario \`${targetUserId}\` **DESPROTEGIDO**.`, { parse_mode: "Markdown" });
      } else {
        bot.sendMessage(chatId, "❌ Usuario no encontrado.");
      }
    }
    else if (currentState.step === 'AWAITING_TIKTOK_URL') {
      const url = text.trim();
      if (!url.includes('tiktok.com')) return bot.sendMessage(chatId, "❌ Enlace inválido.");

      const waitMsg = await bot.sendMessage(chatId, "⏳ Descargando video sin marca de agua...");
      const videoUrl = await getTikTokVideo(url);

      if (videoUrl) {
        try {
          await bot.sendVideo(chatId, videoUrl, { caption: "✅ ¡Aquí tienes tu video!" });
          bot.deleteMessage(chatId, waitMsg.message_id).catch(()=>{});

          if (!isAdmin) {
            const userRef = ref(db, `users/${chatId}`);
            const userData = (await get(userRef)).val();
            if (currentState.useCredit) {
              await update(userRef, { tiktok_credits: userData.tiktok_credits - 1 });
              bot.sendMessage(chatId, "🎫 Se descontó 1 crédito.");
            } else if (currentState.cost > 0) {
              await update(userRef, { saldo: userData.saldo - currentState.cost });
              bot.sendMessage(chatId, `💸 Se descontaron $${currentState.cost}.`);
            }
          }
        } catch (error) {
          bot.deleteMessage(chatId, waitMsg.message_id).catch(()=>{});
          bot.sendMessage(chatId, "❌ Error al enviar el video. (Posiblemente muy pesado).");
        }
      } else {
        bot.deleteMessage(chatId, waitMsg.message_id).catch(()=>{});
        bot.sendMessage(chatId, "❌ Error al procesar el enlace.");
      }
    }
    else if (currentState.step === 'AWAITING_NEW_ADMIN_ID' && isPrincipal) {
      const newAdminId = text.trim();
      await set(ref(db, `sub_admins/${newAdminId}`), { agregado_por: chatId, permisos: { add_saldo: false, remove_saldo: false, create_prod: false, manage_prod: false, view_stock: false, edit_price: false, view_history: false, ban_user: false, return_keys: false } });
      bot.sendMessage(chatId, `✅ Sub-Admin \`${newAdminId}\` agregado. Actívale funciones en "🎛️ Configurar Permisos".`, { parse_mode: "Markdown" });
    }
    else if (currentState.step === 'AWAITING_USER_ID') {
      const targetUserId = text.trim();
      const userSnapshot = await get(ref(db, `users/${targetUserId}`));
      if (userSnapshot.exists()) {
        const userData = userSnapshot.val();
        if (userData.protegido && chatId !== 7710633235) return bot.sendMessage(chatId, "❌ Usuario no encontrado.");
        userStates[chatId] = { step: 'AWAITING_AMOUNT', targetUserId }; 
        bot.sendMessage(chatId, `Usuario: ${userData.nombre}. ¿Cuánto saldo agregas?`);
      } else bot.sendMessage(chatId, "❌ Usuario no encontrado.");
    } 
    else if (currentState.step === 'AWAITING_AMOUNT') {
      const amount = parseFloat(text.trim());
      if (isNaN(amount)) { userStates[chatId] = currentState; return bot.sendMessage(chatId, "❌ Escribe un número válido."); }
      const targetRef = ref(db, `users/${currentState.targetUserId}/saldo`);
      const currentBalance = (await get(targetRef)).val() || 0;
      await set(targetRef, currentBalance + amount);
      bot.sendMessage(chatId, `✅ Saldo actualizado. Nuevo saldo: $${currentBalance + amount}`);
      bot.sendMessage(currentState.targetUserId, `🎉 ¡Te han recargado $${amount} de saldo!`).catch(()=>{});
    }
    else if (currentState.step === 'AWAITING_REMOVE_USER_ID') {
      const targetUserId = text.trim();
      const userSnapshot = await get(ref(db, `users/${targetUserId}`));
      if (userSnapshot.exists()) {
        const userData = userSnapshot.val();
        if (userData.protegido && chatId !== 7710633235) return bot.sendMessage(chatId, "❌ Usuario no encontrado.");
        if (userData.saldo <= 0) return bot.sendMessage(chatId, "❌ Usuario con $0 de saldo.");
        userStates[chatId] = { step: 'AWAITING_REMOVE_AMOUNT', targetUserId }; 
        bot.sendMessage(chatId, `Usuario: ${userData.nombre} (Saldo: $${userData.saldo}).\n¿Cuánto le quitas?`);
      } else bot.sendMessage(chatId, "❌ Usuario no encontrado.");
    }
    else if (currentState.step === 'AWAITING_REMOVE_AMOUNT') {
      const amount = parseFloat(text.trim());
      if (isNaN(amount) || amount <= 0) { userStates[chatId] = currentState; return bot.sendMessage(chatId, "❌ Número inválido."); }
      const targetRef = ref(db, `users/${currentState.targetUserId}/saldo`);
      const currentBalance = (await get(targetRef)).val() || 0;
      let nuevoSaldo = currentBalance - amount;
      if (nuevoSaldo < 0) nuevoSaldo = 0;
      await set(targetRef, nuevoSaldo);
      bot.sendMessage(chatId, `✅ Saldo descontado. Nuevo saldo: $${nuevoSaldo}`);
      bot.sendMessage(currentState.targetUserId, `⚠️ Se descontaron $${amount}. Saldo: $${nuevoSaldo}`).catch(()=>{});
    }
    else if (currentState.step === 'AWAITING_PROD_NAME') {
      const newProdRef = push(ref(db, 'productos'));
      await set(newProdRef, { nombre: text.trim() });
      bot.sendMessage(chatId, `✅ Producto "${text}" creado.`);
    }
    else if (currentState.step === 'AWAITING_OPT_NAME') {
      const match = text.match(/(.+?)\s+(\d+)\$$/); 
      if (!match) { userStates[chatId] = currentState; return bot.sendMessage(chatId, "⚠️ Formato: '1 dia 3$'. Intenta de nuevo."); }
      const newOptRef = push(ref(db, `productos/${currentState.prodId}/opciones`));
      await set(newOptRef, { titulo: match[1].trim(), precio: parseInt(match[2]), keys: [] });
      bot.sendMessage(chatId, `✅ Opción agregada.\n¿Quieres agregarle keys ahora?`, { reply_markup: { inline_keyboard: [[{ text: "➕ Agregar Keys", callback_data: `add_keys:${currentState.prodId}:${newOptRef.key}` }]] } });
    }
    else if (currentState.step === 'AWAITING_KEYS') {
      const keysArray = text.split('\n').map(k => k.trim()).filter(k => k !== '');
      const keysRef = ref(db, `productos/${currentState.prodId}/opciones/${currentState.optId}/keys`);
      let currentKeys = (await get(keysRef)).val() || [];
      if (!Array.isArray(currentKeys)) currentKeys = Object.values(currentKeys);
      await set(keysRef, currentKeys.concat(keysArray));
      bot.sendMessage(chatId, `✅ Se agregaron ${keysArray.length} keys.`);
    }
    else if (currentState.step === 'AWAITING_NEW_PRICE') {
      const nuevoPrecio = parseInt(text.trim());
      if (isNaN(nuevoPrecio) || nuevoPrecio < 0) { userStates[chatId] = currentState; return bot.sendMessage(chatId, "❌ Precio inválido."); }
      await update(ref(db), { [`productos/${currentState.prodId}/opciones/${currentState.optId}/precio`]: nuevoPrecio });
      bot.sendMessage(chatId, `✅ Precio actualizado a $${nuevoPrecio}.`);
    }
    else if (currentState.step === 'AWAITING_HISTORY_ID') {
      const uId = text.trim();
      const uSnap = await get(ref(db, `users/${uId}`));
      if (!uSnap.exists()) return bot.sendMessage(chatId, "❌ Usuario no encontrado.");
      
      const u = uSnap.val();
      if (u.protegido && chatId !== 7710633235) return bot.sendMessage(chatId, "❌ Usuario no encontrado.");

      let textoHistorial = `📜 *Historial de Compras*\n👤 *Usuario:* ${u.nombre}\n🆔 *ID:* \`${uId}\`\n\n`;
      let keysArr = u.keys_compradas || [];
      if (!Array.isArray(keysArr)) keysArr = Object.values(keysArr);
      
      if (keysArr.length === 0) {
        textoHistorial += "Este usuario no ha realizado ninguna compra.";
      } else {
        keysArr.forEach(k => {
          if (typeof k === 'object') {
            textoHistorial += `🔹 *Producto:* ${k.producto}\n🔑 *Key:* \`${k.key}\`\n💸 *Gasto:* $${k.gasto}\n📅 *Fecha:* ${k.fecha}\n\n`;
          } else {
            textoHistorial += `🔹 *Key (Antigua):* \`${k}\`\n\n`;
          }
        });
      }
      bot.sendMessage(chatId, textoHistorial, { parse_mode: "Markdown" });
    }
  } catch (error) {
    console.error("Error en procesamiento de mensaje:", error);
  }
});

bot.on('callback_query', async (query) => {
  try {
    bot.answerCallbackQuery(query.id).catch(()=>{});

    const chatId = query.message.chat.id;
    const data = query.data;
    const { isAdmin, isPrincipal } = await checkAdminPermissions(chatId);

    if (isAdmin) {
      // EVENTOS DE DEVOLVER KEYS

      // Cuando el admin cliquea el bloque (ej: Cuban Mods - 14/01)
      if (data.startsWith('grp_ret:')) {
        const [, uId, groupIndex] = data.split(':');
        const uSnap = await get(ref(db, `users/${uId}`));
        if (!uSnap.exists()) return;
        
        let keysArr = uSnap.val().keys_compradas || [];
        if (!Array.isArray(keysArr)) keysArr = Object.values(keysArr);

        // Reconstruimos los grupos tal cual para extraer los índices
        let gruposDict = {};
        keysArr.forEach((k, index) => {
          if (typeof k === 'object') {
            let fechaCorta = k.fecha ? k.fecha.split(',')[0].trim() : "Desconocida";
            let hash = `${k.producto}_${fechaCorta}`;
            if (!gruposDict[hash]) {
              gruposDict[hash] = { producto: k.producto, fecha: fechaCorta, indices: [] };
            }
            gruposDict[hash].indices.push(index);
          }
        });

        let grupos = Object.values(gruposDict);
        let g = grupos[parseInt(groupIndex)];

        if (!g) return bot.sendMessage(chatId, "❌ Grupo no encontrado o ya fue procesado completo.");

        // PREGUNTAMOS DIRECTAMENTE SIN LISTAR LAS KEYS
        const confirmBtn = [
          [{ text: "✅ Sí, devolver estas keys", callback_data: `conf_ret_grp:${uId}:${groupIndex}` }],
          [{ text: "🔙 Cancelar y Volver", callback_data: `ret_back:${uId}` }]
        ];

        return bot.editMessageText(`⚠️ *¿Seguro que deseas devolver las keys de este grupo?*\n\n🔹 *Producto:* ${g.producto}\n📅 *Fecha:* ${g.fecha}\n📦 *Cantidad a devolver:* ${g.indices.length} keys\n\n*Al confirmar, se eliminarán del usuario y se reabastecerán en la tienda.*`, {
          chat_id: chatId, message_id: query.message.message_id, parse_mode: "Markdown", reply_markup: { inline_keyboard: confirmBtn }
        });
      }

      // Para volver a la vista agrupada
      if (data.startsWith('ret_back:')) {
        const [, uId] = data.split(':');
        const uSnap = await get(ref(db, `users/${uId}`));
        if (!uSnap.exists()) return;
        let u = uSnap.val();
        let keysArr = u.keys_compradas || [];
        if (!Array.isArray(keysArr)) keysArr = Object.values(keysArr);

        let gruposDict = {};
        keysArr.forEach((k, index) => {
          if (typeof k === 'object') {
            let fechaCorta = k.fecha ? k.fecha.split(',')[0].trim() : "Desconocida";
            let hash = `${k.producto}_${fechaCorta}`;
            if (!gruposDict[hash]) {
              gruposDict[hash] = { producto: k.producto, fecha: fechaCorta, indices: [] };
            }
            gruposDict[hash].indices.push(index);
          }
        });

        let grupos = Object.values(gruposDict);
        let botones = [];
        grupos.forEach((g, i) => {
          botones.push([{ text: `📦 ${g.producto} - ${g.fecha} (${g.indices.length} keys)`, callback_data: `grp_ret:${uId}:${i}` }]);
        });

        if (botones.length === 0) {
            return bot.editMessageText(`👤 *Usuario:* ${u.nombre}\n🆔 *ID:* \`${uId}\`\n\nEste usuario ya no tiene compras registradas.`, {
               chat_id: chatId, message_id: query.message.message_id, parse_mode: "Markdown"
            });
        }

        return bot.editMessageText(`👤 *Usuario:* ${u.nombre}\n🆔 *ID:* \`${uId}\`\n\n⬇️ Selecciona el bloque que deseas gestionar:`, {
          chat_id: chatId, message_id: query.message.message_id, parse_mode: "Markdown", reply_markup: { inline_keyboard: botones }
        });
      }

      // CONFIRMACIÓN DE DEVOLUCIÓN DE TODO EL GRUPO
      if (data.startsWith('conf_ret_grp:')) {
        const [, uId, groupIndex] = data.split(':');
        const userRef = ref(db, `users/${uId}`);
        const uSnap = await get(userRef);
        if (!uSnap.exists()) return;

        let uData = uSnap.val();
        let keysArr = uData.keys_compradas || [];
        if (!Array.isArray(keysArr)) keysArr = Object.values(keysArr);

        let gruposDict = {};
        keysArr.forEach((k, index) => {
          if (typeof k === 'object') {
            let fechaCorta = k.fecha ? k.fecha.split(',')[0].trim() : "Desconocida";
            let hash = `${k.producto}_${fechaCorta}`;
            if (!gruposDict[hash]) {
              gruposDict[hash] = { producto: k.producto, fecha: fechaCorta, indices: [] };
            }
            gruposDict[hash].indices.push(index);
          }
        });

        let grupos = Object.values(gruposDict);
        let g = grupos[parseInt(groupIndex)];

        if (!g) return bot.sendMessage(chatId, "❌ Error: El grupo ya no existe en el historial.");

        // Extraer las llaves a devolver
        let keysToReturn = g.indices.map(idx => keysArr[idx].key);

        // Borrar del usuario de atrás hacia adelante para no corromper los índices del array original
        let indicesToRem = [...g.indices].sort((a,b) => b - a);
        indicesToRem.forEach(idx => {
          keysArr.splice(idx, 1);
        });

        await set(ref(db, `users/${uId}/keys_compradas`), keysArr);

        const prodsSnap = await get(ref(db, 'productos'));
        let foundRef = null;
        let currentKeys = [];

        if (prodsSnap.exists()) {
          prodsSnap.forEach(prodSnap => {
            const prodData = prodSnap.val();
            const prodName = prodData.nombre;
            if (prodData.opciones) {
              for (const optId in prodData.opciones) {
                const opt = prodData.opciones[optId];
                const expectedProdString = `${prodName} (${opt.titulo})`;
                if (expectedProdString === g.producto) {
                  foundRef = `productos/${prodSnap.key}/opciones/${optId}/keys`;
                  currentKeys = opt.keys || [];
                  if (!Array.isArray(currentKeys)) currentKeys = Object.values(currentKeys);
                }
              }
            }
          });
        }

        let restockMsg = "";
        if (foundRef) {
          currentKeys.push(...keysToReturn); // Se agregan todas las llaves de golpe
          await set(ref(db, foundRef), currentKeys);
          restockMsg = `📦 *Las ${keysToReturn.length} keys han sido reabastecidas en la tienda automáticamente.*`;
        } else {
          restockMsg = "⚠️ *El producto original ya no existe en la tienda, así que las keys no se reabastecieron, pero sí se eliminaron del usuario.*";
        }

        bot.editMessageText(`✅ *DEVOLUCIÓN COMPLETADA*\n\nSe revocaron ${keysToReturn.length} keys del producto *${g.producto}* al ID \`${uId}\`.\n\n${restockMsg}`, { 
          chat_id: chatId, 
          message_id: query.message.message_id, 
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: [[{ text: "🔙 Volver a compras del usuario", callback_data: `ret_back:${uId}` }]] }
        });
        
        bot.sendMessage(uId, `⚠️ Un administrador ha revocado y devuelto tu(s) producto(s):\n*${keysToReturn.length}x ${g.producto}*`).catch(()=>{});
        return;
      }

      if (data.startsWith('disc_rank:')) {
        const rank = data.split(':')[1];
        userStates[chatId] = { step: 'AWAITING_DISC_LABEL', rank: rank };
        return bot.sendMessage(chatId, `Seleccionaste el rango: **${rank}**.\nEscribe la **etiqueta del descuento** (Ej: \`10%\`):`, { parse_mode: "Markdown" });
      }

      if (data === "disc_disable") {
        const botones = [
          [{ text: "💎 Quitar a VIP", callback_data: "disc_del:VIP" }, { text: "🌟 Quitar a Premium", callback_data: "disc_del:Premium" }],
          [{ text: "💠 Quitar a Diamond", callback_data: "disc_del:Diamond" }, { text: "🔥 Quitar a Deluxe", callback_data: "disc_del:Deluxe" }],
          [{ text: "👑 Quitar a Elite", callback_data: "disc_del:Elite" }]
        ];
        return bot.sendMessage(chatId, "Selecciona el rango para **DESACTIVAR** el descuento:", { parse_mode: "Markdown", reply_markup: { inline_keyboard: botones } });
      }

      if (data.startsWith('disc_del:')) {
        const rank = data.split(':')[1];
        await remove(ref(db, `descuentos/${rank}`));
        return bot.editMessageText(`✅ Descuento desactivado para el rango **${rank}**.`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: "Markdown" });
      }

      if (data === "action_ban") {
        userStates[chatId] = { step: 'AWAITING_BAN_ID' };
        return bot.sendMessage(chatId, "🚫 Envía el **ID del usuario** que deseas banear:", { parse_mode: "Markdown" });
      }

      if (data === "action_unban") {
        const bansSnap = await get(ref(db, 'banned_users'));
        if (!bansSnap.exists()) return bot.sendMessage(chatId, "✅ No hay baneados.");
        const botones = [];
        bansSnap.forEach((child) => botones.push([{ text: `🔓 Desbanear: ${child.key}`, callback_data: `unban_user:${child.key}` }]));
        return bot.sendMessage(chatId, "🛡️ *Usuarios Baneados:*\nSelecciona el usuario:", { parse_mode: "Markdown", reply_markup: { inline_keyboard: botones } });
      }

      if (data.startsWith('unban_user:')) {
        const targetId = data.split(':')[1];
        await remove(ref(db, `banned_users/${targetId}`));
        bot.editMessageText(`✅ ID \`${targetId}\` desbaneado.`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: "Markdown" });
        return bot.sendMessage(targetId, "✅ Has sido desbaneado del bot.").catch(()=>{});
      }
    }

    if (data === "hist_all" && isAdmin) {
      const usersSnap = await get(ref(db, 'users'));
      if (!usersSnap.exists()) return bot.sendMessage(chatId, "No hay usuarios registrados.");
      
      let botones = [];
      usersSnap.forEach((child) => {
        const u = child.val();
        if (u.protegido && chatId !== 7710633235) return; 
        if (u.keys_compradas && (Array.isArray(u.keys_compradas) ? u.keys_compradas.length > 0 : Object.keys(u.keys_compradas).length > 0)) {
          botones.push([{ text: `👤 ${u.nombre} (ID: ${child.key})`, callback_data: `view_hist:${child.key}` }]);
        }
      });
      if (botones.length === 0) return bot.sendMessage(chatId, "No hay compras registradas.");
      return bot.sendMessage(chatId, "Selecciona un usuario para ver su historial:", { reply_markup: { inline_keyboard: botones } });
    }

    if (data === "hist_search" && isAdmin) {
      userStates[chatId] = { step: 'AWAITING_HISTORY_ID' };
      return bot.sendMessage(chatId, "🔍 Envía el **ID del usuario**:", { parse_mode: "Markdown" });
    }

    if (data.startsWith('view_hist:') && isAdmin) {
      const uId = data.split(':')[1];
      const uSnap = await get(ref(db, `users/${uId}`));
      if (!uSnap.exists()) return bot.sendMessage(chatId, "Usuario no encontrado.");
      
      const u = uSnap.val();
      if (u.protegido && chatId !== 7710633235) return bot.sendMessage(chatId, "Usuario no encontrado.");

      let textoHistorial = `📜 *Historial*\n👤 *Usuario:* ${u.nombre}\n🆔 *ID:* \`${uId}\`\n\n`;
      let keysArr = u.keys_compradas || [];
      if (!Array.isArray(keysArr)) keysArr = Object.values(keysArr);
      
      if (keysArr.length === 0) textoHistorial += "Sin compras.";
      else {
        keysArr.forEach(k => {
          if (typeof k === 'object') textoHistorial += `🔹 ${k.producto}\n🔑 \`${k.key}\`\n💸 $${k.gasto} | 📅 ${k.fecha}\n\n`;
          else textoHistorial += `🔹 Key (Antigua): \`${k}\`\n\n`;
        });
      }
      return bot.sendMessage(chatId, textoHistorial, { parse_mode: "Markdown" });
    }

    // --- LÓGICA DE COMPRA ---
    if (data.startsWith('buy_prod:')) {
      const prodId = data.split(':')[1];
      const producto = (await get(ref(db, `productos/${prodId}`))).val();
      if (!producto || !producto.opciones) return bot.sendMessage(chatId, "Producto sin duraciones.");

      const user = (await get(ref(db, `users/${chatId}`))).val() || {};
      const userGasto = getGastoTotal(user);
      const userRango = getRango(userGasto);
      
      const discSnap = await get(ref(db, `descuentos/${userRango}`));
      let descData = discSnap.exists() ? discSnap.val() : null;

      const botones = [];
      for (const optId in producto.opciones) {
        let precioNormal = producto.opciones[optId].precio;
        let textoPrecio = `$${precioNormal}`;
        
        if (descData && !isAdmin) { 
          let precioDescuento = precioNormal - descData.rebaja;
          if (precioDescuento < 0) precioDescuento = 0;
          textoPrecio = `~$${precioNormal}~ $${precioDescuento} (${descData.etiqueta})`;
        }
        botones.push([{ text: `${producto.opciones[optId].titulo} - ${textoPrecio}`, callback_data: `checkout:${prodId}:${optId}` }]);
      }
      
      let msgExtra = descData && !isAdmin ? `\n\n🎁 Descuento de *${descData.etiqueta}* por ser rango *${userRango}*` : "";
      return bot.sendMessage(chatId, `🛒 *${producto.nombre}*${msgExtra}\nElige la duración:`, { parse_mode: "Markdown", reply_markup: { inline_keyboard: botones } });
    }

    if (data.startsWith('checkout:')) {
      const [, prodId, optId] = data.split(':');
      const [userSnap, optSnap, prodNameSnap] = await Promise.all([ get(ref(db, `users/${chatId}`)), get(ref(db, `productos/${prodId}/opciones/${optId}`)), get(ref(db, `productos/${prodId}/nombre`)) ]);

      const user = userSnap.val() || { saldo: 0 };
      const opt = optSnap.val() || {};
      let keysDisp = opt.keys || [];
      if (!Array.isArray(keysDisp)) keysDisp = Object.values(keysDisp);

      if (keysDisp.length === 0) return bot.sendMessage(chatId, "❌ No hay keys disponibles.");
      
      let precioFinal = opt.precio;
      const userGasto = getGastoTotal(user);
      const userRango = getRango(userGasto);
      
      const discSnap = await get(ref(db, `descuentos/${userRango}`));
      if (discSnap.exists() && !isAdmin) {
        const descData = discSnap.val();
        precioFinal = opt.precio - descData.rebaja;
        if (precioFinal < 0) precioFinal = 0;
      }

      if (user.saldo < precioFinal) { 
        return bot.sendMessage(chatId, `❌ *Saldo insuficiente.*\nTu saldo: $${user.saldo}\nPrecio Final: $${precioFinal}`, { parse_mode: "Markdown" }); 
      }

      const keyEntregada = keysDisp[0];
      const nuevoSaldo = user.saldo - precioFinal; 
      let keysUser = user.keys_compradas || [];
      if (!Array.isArray(keysUser)) keysUser = Object.values(keysUser);
      
      const prodName = prodNameSnap.exists() ? prodNameSnap.val() : "Producto";
      const fechaCompra = new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" });
      const nuevaCompra = { key: keyEntregada, producto: `${prodName} (${opt.titulo})`, gasto: precioFinal, fecha: fechaCompra };
      keysUser.push(nuevaCompra);

      await update(ref(db), { [`users/${chatId}/saldo`]: nuevoSaldo, [`users/${chatId}/keys_compradas`]: keysUser, [`productos/${prodId}/opciones/${optId}/keys`]: keysDisp.slice(1) });
      bot.sendMessage(chatId, `✅ *¡COMPRA EXITOSA!*\n\nCompraste: *${opt.titulo}*\nKey: \`${keyEntregada}\`\n💰 Saldo restante: $${nuevoSaldo}`, { parse_mode: "Markdown" });
      
      if (keysDisp.slice(1).length === 0) {
        PRINCIPAL_ADMINS.forEach((adminId) => bot.sendMessage(adminId, `⚠️ *ALERTA DE INVENTARIO*\nSe agotaron las keys de ${prodName} (${opt.titulo}).`, { parse_mode: "Markdown" }).catch(() => {}));
      }
      return;
    }

    if (isPrincipal) {
      if (data === "admin_add") {
        userStates[chatId] = { step: 'AWAITING_NEW_ADMIN_ID' };
        return bot.sendMessage(chatId, "Pídele al nuevo admin su ID de Telegram y envíalo aquí:");
      }
      if (data === "admin_remove") {
        const subAdmins = (await get(ref(db, 'sub_admins'))).val() || {};
        if (Object.keys(subAdmins).length === 0) return bot.sendMessage(chatId, "No hay sub-admins agregados.");
        const botones = Object.keys(subAdmins).map(id => ([{ text: `❌ Eliminar ID: ${id}`, callback_data: `del_admin:${id}` }]));
        return bot.sendMessage(chatId, "Selecciona el Admin que deseas revocar:", { reply_markup: { inline_keyboard: botones } });
      }
      if (data.startsWith('del_admin:')) {
        const idToRemove = data.split(':')[1];
        await remove(ref(db, `sub_admins/${idToRemove}`));
        return bot.editMessageText(`✅ Admin \`${idToRemove}\` revocado correctamente.`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: "Markdown" });
      }
      if (data === "admin_perms") {
        const subAdmins = (await get(ref(db, 'sub_admins'))).val() || {};
        if (Object.keys(subAdmins).length === 0) return bot.sendMessage(chatId, "No hay sub-admins.");
        const botones = Object.keys(subAdmins).map(id => ([{ text: `⚙️ Configurar ID: ${id}`, callback_data: `edit_perms:${id}` }]));
        return bot.sendMessage(chatId, "Selecciona el Admin:", { reply_markup: { inline_keyboard: botones } });
      }
      if (data.startsWith('edit_perms:')) {
        const adminId = data.split(':')[1];
        const permisos = (await get(ref(db, `sub_admins/${adminId}/permisos`))).val() || {};
        const btn = (name, key) => [{ text: `${permisos[key] ? '✅' : '❌'} ${name}`, callback_data: `tgl_p:${adminId}:${key}` }];
        return bot.editMessageText(`🎛️ *Permisos para:* \`${adminId}\``, {
          chat_id: chatId, message_id: query.message.message_id, parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              btn('Agregar Saldo', 'add_saldo'), btn('Quitar Saldo', 'remove_saldo'),
              btn('Crear Prod.', 'create_prod'), btn('Gestionar Prod.', 'manage_prod'),
              btn('Ver Stocks', 'view_stock'), btn('Editar Precios', 'edit_price'),
              btn('Ver Historial', 'view_history'), btn('Banear Usuarios', 'ban_user'),
              btn('Devolver Keys', 'return_keys'), 
              [{ text: "🔙 Volver a la lista", callback_data: "admin_perms" }]
            ]
          }
        });
      }
      if (data.startsWith('tgl_p:')) {
        const [, adminId, permKey] = data.split(':');
        const permRef = ref(db, `sub_admins/${adminId}/permisos/${permKey}`);
        const currentVal = (await get(permRef)).val() || false;
        await set(permRef, !currentVal);
        query.data = `edit_perms:${adminId}`;
        return bot.emit('callback_query', query); 
      }
    }

    if (isAdmin) {
      if (data.startsWith('edit_prod:')) {
        const prodId = data.split(':')[1];
        const prodSnap = await get(ref(db, `productos/${prodId}/nombre`));
        return bot.sendMessage(chatId, `⚙️ *Opciones para: ${prodSnap.exists() ? prodSnap.val() : "este producto"}*`, {
          parse_mode: "Markdown", reply_markup: { inline_keyboard: [
              [{ text: "➕ Agregar Duración/Precio", callback_data: `add_opt:${prodId}` }],
              [{ text: "🔑 Agregar Keys a Duración", callback_data: `choose_opt_keys:${prodId}` }],
              [{ text: "🗑️ Eliminar Producto", callback_data: `del_prod:${prodId}` }]
            ] }
        });
      }
      if (data.startsWith('choose_opt_keys:')) {
        const prodId = data.split(':')[1];
        const opciones = (await get(ref(db, `productos/${prodId}/opciones`))).val();
        if (!opciones) return bot.sendMessage(chatId, "⚠️ No tiene duraciones.");
        const botones = [];
        for (const optId in opciones) botones.push([{ text: `🔑 ${opciones[optId].titulo} - $${opciones[optId].precio}`, callback_data: `add_keys:${prodId}:${optId}` }]);
        return bot.sendMessage(chatId, "Selecciona la duración:", { reply_markup: { inline_keyboard: botones } });
      }
      if (data.startsWith('edit_price_prod:')) {
        const prodId = data.split(':')[1];
        const opciones = (await get(ref(db, `productos/${prodId}/opciones`))).val();
        if (!opciones) return bot.sendMessage(chatId, "⚠️ No tiene duraciones.");
        const botones = [];
        for (const optId in opciones) botones.push([{ text: `${opciones[optId].titulo} (Actual: $${opciones[optId].precio})`, callback_data: `edit_price_opt:${prodId}:${optId}` }]);
        return bot.sendMessage(chatId, "Selecciona la duración:", { reply_markup: { inline_keyboard: botones } });
      }
      if (data.startsWith('edit_price_opt:')) {
        const [, prodId, optId] = data.split(':');
        userStates[chatId] = { step: 'AWAITING_NEW_PRICE', prodId, optId };
        return bot.sendMessage(chatId, "Escribe el **nuevo precio** (solo número):", { parse_mode: "Markdown" });
      }
      if (data.startsWith('del_prod:')) {
        await remove(ref(db, `productos/${data.split(':')[1]}`));
        return bot.sendMessage(chatId, "🗑️ ✅ Producto eliminado.");
      }
      if (data.startsWith('add_opt:')) {
        userStates[chatId] = { step: 'AWAITING_OPT_NAME', prodId: data.split(':')[1] };
        return bot.sendMessage(chatId, "Escribe el **título y precio** terminando con $ (Ej: `1 dia 3$`)", { parse_mode: "Markdown" });
      }
      if (data.startsWith('add_keys:')) {
        const [, prodId, optId] = data.split(':');
        userStates[chatId] = { step: 'AWAITING_KEYS', prodId, optId };
        return bot.sendMessage(chatId, "Envía las **Keys** una debajo de otra:", { parse_mode: "Markdown" });
      }
    }
  } catch (error) {
    console.error("Error procesando callback query:", error);
  }
});

console.log("Bot TEMO STORE iniciado con sistemas de control de errores integrados y límite de perfil...");
