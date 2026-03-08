const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get, update, push, set } = require('firebase/database');

// --- CONFIGURACIÓN DE FIREBASE ---
const firebaseConfig = {
    apiKey: "AIzaSyDrNambFw1VNXSkTR1yGq6_B9jWWA1LsxM",
    authDomain: "clientesvip-be9bd.firebaseapp.com",
    projectId: "clientesvip-be9bd",
    storageBucket: "clientesvip-be9bd.firebasestorage.app",
    messagingSenderId: "131036295027",
    appId: "1:131036295027:web:3cc360dca16d4873f55f06"
};
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// --- CONFIGURACIÓN DE WHATSAPP ---
const BOT_NUMBER = '584166318181'; // Número del bot sin el '+'
const ADMIN_ID = '5732142369516@c.us'; // Número del admin con el sufijo de WhatsApp

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        // Esta línea le dice a WhatsApp que use el navegador de Termux
        executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--single-process' // Recomendado para Termux
        ]
    }
});


// SISTEMA DE ESTADOS 
const userStates = {}; 

// --- MENÚS DE TEXTO ---
const getMenu = (isAdmin) => {
    if (isAdmin) {
        return `👑 *Menú de Administrador*\nResponde con el número de la opción:\n\n*1.* 📦 Crear Producto\n*2.* 🔑 Añadir Stock\n*3.* 💰 Añadir Saldo\n*4.* 📢 Mensaje Global\n*5.* 🔄 Revisar Reembolsos\n*0.* ❌ Cancelar Acción`;
    } else {
        return `🛒 *Menú Principal*\nResponde con el número de la opción:\n\n*1.* 🛒 Tienda\n*2.* 👤 Mi Perfil\n*3.* 💳 Recargas\n*4.* 🔄 Solicitar Reembolso`;
    }
};

// MIDDLEWARE: Verifica si el usuario está autorizado en la web
async function getAuthUser(userPhone) {
    // Buscamos en la rama whatsapp_auth usando el número de teléfono
    const authSnap = await get(ref(db, `whatsapp_auth/${userPhone}`));
    if (authSnap.exists()) return authSnap.val();
    return null;
}

// INICIO Y VINCULACIÓN DEL BOT
client.once('ready', () => {
    console.log('🤖 Bot de WhatsApp sincronizado e interactivo iniciado...');
});

// Generar código de vinculación para el número del bot
client.once('qr', async () => {
    console.log('⏳ Solicitando código de vinculación para el número:', BOT_NUMBER);
    try {
        const pairingCode = await client.requestPairingCode(BOT_NUMBER);
        console.log('\n=============================================');
        console.log(`🔑 TU CÓDIGO DE VINCULACIÓN ES: ${pairingCode}`);
        console.log('Ingresa este código en el WhatsApp del bot.');
        console.log('=============================================\n');
    } catch (error) {
        console.error('Error al generar código de vinculación:', error);
    }
});

// MANEJADOR DE MENSAJES
client.on('message', async (msg) => {
    const chatId = msg.from; // Ej: 5732142369516@c.us
    const userPhone = chatId.split('@')[0]; // Extrae solo el número
    const text = msg.body.trim();
    const isAdmin = chatId === ADMIN_ID;

    // Verificar usuario en Firebase
    const webUid = await getAuthUser(userPhone);
    
    // Si no está registrado en la web
    if (!webUid) {
        if (text.toLowerCase() === 'hola' || text.toLowerCase() === 'menu') {
            const textoBloqueo = `🛑 *ACCESO DENEGADO*\n\nTu número no está vinculado a una cuenta web.\n\n🔑 *TU NÚMERO ES:* ${userPhone}\n\nVe a la web, vincula tu cuenta y vuelve a escribir "hola".`;
            return client.sendMessage(chatId, textoBloqueo);
        }
        return;
    }

    // --- MANEJO DE ENVÍO DE COMPROBANTES (FOTOS) ---
    if (msg.hasMedia && userStates[chatId] && userStates[chatId].step === 'WAITING_FOR_RECEIPT') {
        const stateData = userStates[chatId].data; 
        const media = await msg.downloadMedia();
        
        const adminMsg = `💳 *NUEVO COMPROBANTE DE PAGO*\n\n👤 Usuario: ${stateData.username}\n📱 Teléfono: ${userPhone}\n💰 Monto Solicitado: *$${stateData.amount} USD*\n\n*Para APROBAR, copia y envía esto:*\n!aprobar ${stateData.webUid} ${stateData.amount} ${userPhone}\n\n*Para RECHAZAR, copia y envía esto:*\n!rechazar ${userPhone}`;

        await client.sendMessage(ADMIN_ID, media, { caption: adminMsg });
        
        userStates[chatId] = null; 
        return client.sendMessage(chatId, '✅ Comprobante enviado exitosamente al administrador. Por favor espera a que se valide y acredite tu saldo.');
    }

    // Comandos directos de Admin (Reemplazo de botones Inline)
    if (isAdmin && text.startsWith('!')) {
        const args = text.split(' ');
        const command = args[0].toLowerCase();

        if (command === '!aprobar' && args.length === 4) {
            const targetWebUid = args[1];
            const amount = parseFloat(args[2]);
            const targetPhone = args[3];

            client.sendMessage(chatId, '⚙️ Acreditando saldo al usuario...');
            const userSnap = await get(ref(db, `users/${targetWebUid}`));
            
            if (userSnap.exists()) {
                const currentBal = parseFloat(userSnap.val().balance || 0);
                const nuevoSaldo = currentBal + amount;

                const updates = {};
                updates[`users/${targetWebUid}/balance`] = nuevoSaldo;
                const rechRef = push(ref(db, `users/${targetWebUid}/recharges`));
                updates[`users/${targetWebUid}/recharges/${rechRef.key}`] = { amount: amount, date: Date.now() };

                await update(ref(db), updates);

                client.sendMessage(chatId, `✅ Pago aprobado. Se añadieron $${amount} USD a ${userSnap.val().username}.`);
                client.sendMessage(`${targetPhone}@c.us`, `🎉 *¡RECARGA APROBADA!*\n\nTu pago ha sido confirmado. Se han añadido *$${amount} USD* a tu cuenta.\n💰 Nuevo saldo: *$${nuevoSaldo.toFixed(2)} USD*`);
            }
            return;
        }

        if (command === '!rechazar' && args.length === 2) {
            const targetPhone = args[1];
            client.sendMessage(chatId, '❌ Comprobante rechazado.');
            client.sendMessage(`${targetPhone}@c.us`, '❌ *RECARGA RECHAZADA*\n\nTu comprobante no fue válido. Contacta a soporte si crees que es un error.');
            return;
        }

        if (command === '!reembolsar' && args.length === 3) {
            const targetUid = args[1];
            const histId = args[2];

            const userSnap = await get(ref(db, `users/${targetUid}`));
            if (userSnap.exists()) {
                const userData = userSnap.val();
                const compra = userData.history[histId];

                if (compra && !compra.refunded) {
                    const price = parseFloat(compra.price || 0);
                    const nuevoSaldo = parseFloat(userData.balance || 0) + price;

                    const updates = {};
                    updates[`users/${targetUid}/balance`] = nuevoSaldo;
                    updates[`users/${targetUid}/history/${histId}/refunded`] = true; 

                    await update(ref(db), updates);
                    client.sendMessage(chatId, `✅ *Reembolso completado.* Se devolvieron $${price} USD.`);

                    // Buscar el teléfono del usuario para avisarle
                    const authSnap = await get(ref(db, 'whatsapp_auth'));
                    let targetPhone = null;
                    if (authSnap.exists()) {
                        authSnap.forEach(child => {
                            if (child.val() === targetUid) targetPhone = child.key;
                        });
                    }

                    if (targetPhone) {
                        client.sendMessage(`${targetPhone}@c.us`, `🔄 *REEMBOLSO APROBADO*\n\nSe te ha devuelto el dinero de la key de *${compra.product}*.\n💰 Se añadieron *$${price} USD* a tu saldo.\n💳 Nuevo saldo: *$${nuevoSaldo.toFixed(2)} USD*`);
                    }
                }
            }
            return;
        }

        if (command === '!rechazar_reembolso' && args.length === 2) {
            const targetPhone = args[1];
            client.sendMessage(chatId, '❌ Solicitud de reembolso rechazada.');
            client.sendMessage(`${targetPhone}@c.us`, '❌ *SOLICITUD RECHAZADA*\n\nTu solicitud de reembolso no fue aprobada. Contacta a soporte.');
            return;
        }
    }

    // --- CANCELAR ACCIÓN GLOBAL ---
    if (text === '0') {
        userStates[chatId] = null;
        return client.sendMessage(chatId, `✅ Acción cancelada.\n\n${getMenu(isAdmin)}`);
    }

    // Saludo inicial para mostrar menú
    if (text.toLowerCase() === 'hola' || text.toLowerCase() === 'menu') {
        userStates[chatId] = null;
        const userSnap = await get(ref(db, `users/${webUid}`));
        const webUser = userSnap.val();
        const greeting = isAdmin ? `👑 ¡Bienvenido Admin Supremo, *${webUser.username}*!` : `🌌 Bienvenido a LUCK XIT, *${webUser.username}*.`;
        return client.sendMessage(chatId, `${greeting}\n\n${getMenu(isAdmin)}`);
    }

    // --- FLUJOS DE ESTADO ACTIVOS ---
    if (userStates[chatId]) {
        const state = userStates[chatId];

        // SELECCIÓN DE PRODUCTO PARA COMPRAR (Usuario)
        if (state.step === 'WAITING_FOR_PRODUCT_SELECTION') {
            const choice = text;
            if (state.data.options[choice]) {
                const productId = state.data.options[choice];
                client.sendMessage(chatId, '⚙️ Procesando transacción...');

                const userSnap = await get(ref(db, `users/${webUid}`));
                const prodSnap = await get(ref(db, `products/${productId}`));
                
                let currentBalance = parseFloat(userSnap.val().balance || 0);
                let product = prodSnap.val();

                if (currentBalance < product.price) return client.sendMessage(chatId, '❌ Saldo insuficiente en la Web.');
                
                if (product.keys && Object.keys(product.keys).length > 0) {
                    const firstKeyId = Object.keys(product.keys)[0];
                    const keyToDeliver = product.keys[firstKeyId];

                    const updates = {};
                    updates[`products/${productId}/keys/${firstKeyId}`] = null; 
                    updates[`users/${webUid}/balance`] = currentBalance - product.price; 
                    
                    const historyRef = push(ref(db, `users/${webUid}/history`));
                    updates[`users/${webUid}/history/${historyRef.key}`] = { product: product.name, key: keyToDeliver, price: product.price, date: Date.now(), refunded: false }; 

                    await update(ref(db), updates);
                    userStates[chatId] = null;
                    return client.sendMessage(chatId, `✅ *¡COMPRA EXITOSA!*\n\nTu Key es:\n\n*${keyToDeliver}*\n\nEscribe "menu" para volver al inicio.`);
                } else {
                    return client.sendMessage(chatId, '❌ Producto agotado justo ahora.');
                }
            } else {
                return client.sendMessage(chatId, '❌ Opción inválida. Escribe el número del producto que deseas o 0 para cancelar.');
            }
        }

        // SELECCIÓN DE MÉTODO DE ENVÍO DE COMPROBANTE
        if (state.step === 'WAITING_FOR_RECEIPT_METHOD') {
            if (text === '1') {
                userStates[chatId] = null;
                return client.sendMessage(chatId, 'Puedes enviarlo directamente a este enlace: https://wa.me/573142369516\nEscribe "menu" para volver.');
            } else if (text === '2') {
                state.step = 'WAITING_FOR_RECEIPT';
                return client.sendMessage(chatId, '📸 Por favor, *envía la foto* de tu comprobante de pago ahora mismo.\n_(Asegúrate de que la captura se vea clara)_');
            } else {
                return client.sendMessage(chatId, '❌ Opción inválida. Responde 1 o 2.');
            }
        }

        // FLUJO: USUARIO SOLICITANDO REEMBOLSO
        if (state.step === 'WAITING_FOR_USER_REFUND_KEY') {
            const searchKey = text.trim();
            client.sendMessage(chatId, '🔎 Verificando tu solicitud...');

            const userSnap = await get(ref(db, `users/${webUid}`));
            let found = false; let foundData = null;

            if (userSnap.exists()) {
                const userData = userSnap.val();
                if (userData.history) {
                    Object.keys(userData.history).forEach(histId => {
                        const compra = userData.history[histId];
                        if (compra.key === searchKey) {
                            found = true;
                            foundData = { uid: webUid, username: userData.username, histId: histId, compra: compra, targetPhone: userPhone };
                        }
                    });
                }
            }

            if (found) {
                if (foundData.compra.refunded) {
                    client.sendMessage(chatId, '⚠️ *Esta Key ya fue reembolsada anteriormente.*');
                } else {
                    const dateStr = new Date(foundData.compra.date).toLocaleString('es-CO');
                    const msgInfo = `🔔 *NUEVA SOLICITUD DE REEMBOLSO*\n\n👤 *Usuario:* ${foundData.username}\n📦 *Producto:* ${foundData.compra.product}\n🔑 *Key:* ${foundData.compra.key}\n💰 *Monto:* $${parseFloat(foundData.compra.price).toFixed(2)} USD\n📅 *Fecha:* ${dateStr}\n\n*Para APROBAR:*\n!reembolsar ${foundData.uid} ${foundData.histId}\n\n*Para RECHAZAR:*\n!rechazar_reembolso ${foundData.targetPhone}`;
                    
                    client.sendMessage(ADMIN_ID, msgInfo);
                    client.sendMessage(chatId, '✅ Tu solicitud ha sido enviada al administrador.');
                }
            } else {
                client.sendMessage(chatId, '❌ No se encontró esta Key en tu historial. Verifica e intenta de nuevo.');
            }
            userStates[chatId] = null;
            return;
        }

        // FLUJO: USUARIO ESCRIBE CUÁNTO QUIERE RECARGAR
        if (state.step === 'WAITING_FOR_RECHARGE_AMOUNT') {
            const amountUsd = parseFloat(text.replace(',', '.').replace('$', ''));
            const minUsd = state.data.minUsd;

            if (isNaN(amountUsd)) return client.sendMessage(chatId, '❌ Cantidad inválida. Escribe solo el número.');
            if (amountUsd < minUsd) return client.sendMessage(chatId, `❌ El monto mínimo para ti es de *$${minUsd} USD*.`);

            const amountCop = amountUsd * 3800;
            const mensajePago = `✅ *MONTO CALCULADO*\n\n💰 Vas a recargar: *$${amountUsd.toFixed(2)} USD*\n💵 Total a pagar: *$${amountCop.toLocaleString('es-CO')} COP*\n\n🏦 *PASOS PARA PAGAR:*\n1. Envía exactamente *$${amountCop.toLocaleString('es-CO')} COP* a Nequi: 3214701288\n2. ¿Por dónde enviarás el comprobante?\n\n*1.* Al WhatsApp personal\n*2.* Por aquí mismo (Mandar foto)`;

            state.step = 'WAITING_FOR_RECEIPT_METHOD';
            state.data.amount = amountUsd;
            state.data.username = state.data.username; // Pasado desde el paso anterior
            return client.sendMessage(chatId, mensajePago);
        }

        // --- FLUJOS DE ADMINISTRADOR ---
        
        if (state.step === 'WAITING_FOR_REFUND_KEY') {
            const searchKey = text.trim();
            client.sendMessage(chatId, '🔎 Buscando la Key globalmente...');

            const usersSnap = await get(ref(db, 'users'));
            let found = false; let foundData = null;

            if (usersSnap.exists()) {
                usersSnap.forEach(userChild => {
                    if (userChild.val().history) {
                        Object.keys(userChild.val().history).forEach(histId => {
                            if (userChild.val().history[histId].key === searchKey) {
                                found = true;
                                foundData = { uid: userChild.key, username: userChild.val().username, histId: histId, compra: userChild.val().history[histId] };
                            }
                        });
                    }
                });
            }

            if (found) {
                if (foundData.compra.refunded) {
                    client.sendMessage(chatId, '⚠️ *Ya reembolsada.*');
                } else {
                    const msgInfo = `🧾 *COMPRA ENCONTRADA*\n\n👤 ${foundData.username}\n📦 ${foundData.compra.product}\n💰 $${parseFloat(foundData.compra.price).toFixed(2)}\n\n*Para reembolsar copia esto:*\n!reembolsar ${foundData.uid} ${foundData.histId}`;
                    client.sendMessage(chatId, msgInfo);
                }
            } else {
                client.sendMessage(chatId, '❌ No encontrada.');
            }
            userStates[chatId] = null;
            return;
        }

        if (state.step === 'WAITING_FOR_BROADCAST_MESSAGE') {
            client.sendMessage(chatId, '⏳ Enviando mensaje masivo...');
            const authSnap = await get(ref(db, 'whatsapp_auth'));
            let count = 0;
            if (authSnap.exists()) {
                authSnap.forEach(child => {
                    client.sendMessage(`${child.key}@c.us`, `📢 *Anuncio Oficial LUCK XIT*\n\n${text}`).catch(() => {});
                    count++;
                });
            }
            client.sendMessage(chatId, `✅ Enviado a ${count} usuarios.\n\n${getMenu(isAdmin)}`);
            userStates[chatId] = null;
            return;
        }

        // Crear producto
        if (state.step === 'CREATE_PROD_NAME') { state.data.name = text; state.step = 'CREATE_PROD_PRICE'; return client.sendMessage(chatId, 'Ingresa el *precio* en USD (ej: 2.5):'); }
        if (state.step === 'CREATE_PROD_PRICE') { state.data.price = parseFloat(text); state.step = 'CREATE_PROD_DURATION'; return client.sendMessage(chatId, 'Ingresa la *duración* (ej: 24 horas):'); }
        if (state.step === 'CREATE_PROD_DURATION') {
            await set(push(ref(db, 'products')), { name: state.data.name, price: state.data.price, duration: text });
            client.sendMessage(chatId, `✅ Producto *${state.data.name}* creado.\n\n${getMenu(isAdmin)}`);
            userStates[chatId] = null; return;
        }

        // Añadir saldo
        if (state.step === 'ADD_BALANCE_USER') { state.data.targetUser = text.trim(); state.step = 'ADD_BALANCE_AMOUNT'; return client.sendMessage(chatId, `Dime la *cantidad* en USD para ${state.data.targetUser}:`); }
        if (state.step === 'ADD_BALANCE_AMOUNT') {
            const amount = parseFloat(text);
            const usersSnap = await get(ref(db, 'users'));
            let foundUid = null; let currentBal = 0;

            usersSnap.forEach(child => { if (child.val().username === state.data.targetUser) { foundUid = child.key; currentBal = parseFloat(child.val().balance || 0); } });

            if (foundUid) {
                const nuevoSaldo = currentBal + amount;
                await update(ref(db), { [`users/${foundUid}/balance`]: nuevoSaldo, [`users/${foundUid}/recharges/${push(ref(db)).key}`]: { amount: amount, date: Date.now() } });
                client.sendMessage(chatId, `✅ Saldo añadido. Nuevo saldo: $${nuevoSaldo.toFixed(2)}`);

                const authSnap = await get(ref(db, 'whatsapp_auth'));
                authSnap.forEach(child => {
                    if (child.val() === foundUid) client.sendMessage(`${child.key}@c.us`, `🎉 tu papá luck xit te puso : $${amount} USD de saldo. Nuevo saldo: $${nuevoSaldo.toFixed(2)} USD`);
                });
            } else {
                client.sendMessage(chatId, `❌ Usuario no encontrado.`);
            }
            userStates[chatId] = null; return;
        }

        // Añadir Stock: Elegir producto
        if (state.step === 'SELECT_PROD_FOR_STOCK') {
            const choice = text;
            if (state.data.options[choice]) {
                state.data.prodId = state.data.options[choice];
                state.step = 'ADD_STOCK_KEYS';
                return client.sendMessage(chatId, 'Pega todas las *Keys* ahora. Puedes separarlas por espacios, comas o saltos de línea:');
            } else {
                return client.sendMessage(chatId, '❌ Opción inválida.');
            }
        }

        // Añadir Stock: Pegar Keys
        if (state.step === 'ADD_STOCK_KEYS') {
            const cleanKeys = text.split(/[\n,\s]+/).map(k => k.trim()).filter(k => k.length > 0);
            if (cleanKeys.length === 0) { userStates[chatId] = null; return client.sendMessage(chatId, '❌ No hay keys válidas.'); }

            const updates = {};
            cleanKeys.forEach(k => { updates[`products/${state.data.prodId}/keys/${push(ref(db)).key}`] = k; });
            await update(ref(db), updates);

            client.sendMessage(chatId, `✅ Agregadas ${cleanKeys.length} keys.\n\n${getMenu(isAdmin)}`);
            userStates[chatId] = null; return;
        }
    }

    // --- ACCIONES DEL MENÚ PRINCIPAL (CUANDO NO HAY ESTADO) ---
    
    // MENÚ USUARIO
    if (!isAdmin) {
        if (text === '1') { // Tienda
            const productsSnap = await get(ref(db, 'products'));
            if (!productsSnap.exists()) return client.sendMessage(chatId, 'Tienda vacía en este momento.');
            
            let menuTienda = `🛒 *ARSENAL DISPONIBLE*\nResponde con el número del producto a comprar:\n\n`;
            let options = {};
            let counter = 1;

            productsSnap.forEach(child => {
                const p = child.val();
                const stock = p.keys ? Object.keys(p.keys).length : 0;
                if (stock > 0) {
                    menuTienda += `*${counter}.* ${p.name} - $${p.price} (${stock} disp)\n`;
                    options[counter.toString()] = child.key;
                    counter++;
                }
            });

            if(counter === 1) return client.sendMessage(chatId, '❌ Todos los productos están agotados.');
            
            menuTienda += `\n*0.* ❌ Cancelar`;
            userStates[chatId] = { step: 'WAITING_FOR_PRODUCT_SELECTION', data: { options: options, webUid: webUid } };
            return client.sendMessage(chatId, menuTienda);
        }
        
        if (text === '2') { // Perfil
            const userSnap = await get(ref(db, `users/${webUid}`));
            const user = userSnap.val();
            return client.sendMessage(chatId, `👤 *PERFIL LUCK XIT*\n\nUsuario: ${user.username}\n💰 Saldo: *$${parseFloat(user.balance).toFixed(2)} USD*\n\nEscribe "menu" para volver.`);
        }

        if (text === '3') { // Recargas
            const userSnap = await get(ref(db, `users/${webUid}`));
            const userData = userSnap.val();
            let totalRecharged = 0;
            if (userData.recharges) Object.values(userData.recharges).forEach(r => { totalRecharged += parseFloat(r.amount || 0); });

            const minUsd = totalRecharged > 5 ? 2 : 3;
            userStates[chatId] = { step: 'WAITING_FOR_RECHARGE_AMOUNT', data: { minUsd: minUsd, webUid: webUid, username: userData.username } };

            const msgRecarga = `💳 *NUEVA RECARGA*\n\n💵 *Tasa:* $1 USD = $3,800 COP\n✅ *Mínimo:* *$${minUsd} USD*\n\n👇 *Escribe la cantidad en USD* que deseas recargar (ej: 3 o 5.5):`;
            return client.sendMessage(chatId, msgRecarga);
        }

        if (text === '4') { // Solicitar Reembolso
            userStates[chatId] = { step: 'WAITING_FOR_USER_REFUND_KEY', data: { webUid: webUid } };
            return client.sendMessage(chatId, '🔄 *SOLICITUD DE REEMBOLSO*\n\nEscribe y envía la *Key* exacta de la compra:');
        }
    }

    // MENÚ ADMIN
    if (isAdmin) {
        if (text === '1') { userStates[chatId] = { step: 'CREATE_PROD_NAME', data: {} }; return client.sendMessage(chatId, 'Escribe el *Nombre* del nuevo producto:'); }
        
        if (text === '2') { 
            const productsSnap = await get(ref(db, 'products'));
            if (!productsSnap.exists()) return client.sendMessage(chatId, '❌ No hay productos.');
            
            let menuStock = `📦 *AÑADIR STOCK*\nSelecciona el producto:\n\n`;
            let options = {}; let counter = 1;

            productsSnap.forEach(child => {
                menuStock += `*${counter}.* ${child.val().name}\n`;
                options[counter.toString()] = child.key;
                counter++;
            });
            menuStock += `\n*0.* ❌ Cancelar`;
            
            userStates[chatId] = { step: 'SELECT_PROD_FOR_STOCK', data: { options: options } };
            return client.sendMessage(chatId, menuStock);
        }
        
        if (text === '3') { userStates[chatId] = { step: 'ADD_BALANCE_USER', data: {} }; return client.sendMessage(chatId, 'Escribe el *Usuario* exacto al que deseas añadir saldo:'); }
        if (text === '4') { userStates[chatId] = { step: 'WAITING_FOR_BROADCAST_MESSAGE', data: {} }; return client.sendMessage(chatId, '📝 *MENSAJE GLOBAL*\n\nEscribe el mensaje para todos:'); }
        if (text === '5') { userStates[chatId] = { step: 'WAITING_FOR_REFUND_KEY', data: {} }; return client.sendMessage(chatId, '🔎 *REEMBOLSOS GLOBALES*\n\nPega la *Key* exacta a buscar:'); }
    }
});

// INICIAR CLIENTE
client.initialize();
