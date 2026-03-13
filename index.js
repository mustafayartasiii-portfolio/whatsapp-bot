const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// ─── STATE YÖNETİMİ ────────────────────────────────────────────────
const STATE_FILE = './hasta_durumu.json';

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {}
}

let userState = loadState();
let qrCodeData = null;
let isReady = false;
let sock = null;

// ─── MESAJ ŞABLONLARI ──────────────────────────────────────────────
const HOSGELDINIZ = `Merhaba, *Prof. Dr. Alp Yentür Kliniği*'ne hoş geldiniz. 👋

Size hizmet verebilmemiz için yasal yükümlülüğümüz gereği kişisel verilerinizin işlenmesi hakkında sizi bilgilendirmemiz ve onayınızı almamız gerekmektedir.`;

const KVKK = `📋 *AÇIK RIZA METNİ*

İşbu Açık Rıza Metni, Prof. Dr. Alp Yentür Kliniği tarafından sunulan randevu, danışma ve bilgilendirme süreçleri kapsamında tarafınıza ait kişisel verilerin işlenmesine ilişkindir.

*1) İşlenen Veri Kategorileri*
• Kimlik ve iletişim verileri (ad-soyad, telefon)
• Başvuru içeriği (randevu talebi ve açıklamalar)
• Sağlık verisi niteliğinde olabilecek bilgiler (şikâyet/ağrı bilgisi)

*2) İşleme Amaçları*
• Randevu talebinin alınması ve yönetilmesi
• Sizinle iletişime geçilmesi ve geri dönüş yapılması
• Başvurunuzun değerlendirilmesi ve uygun planlamanın yapılması
• Hizmet kalitesinin artırılması ve kayıtların tutulması

*3) Aktarım*
Verileriniz; yalnızca yukarıdaki amaçlarla sınırlı olmak üzere yetkili personel ve teknik hizmet sağlayıcılarla paylaşılabilir.

*4) Rıza ve Geri Alma Hakkı*
Bu metni onaylayarak kişisel verilerinizin işlenmesine açık rıza vermiş olursunuz. Rızanızı dilediğiniz zaman geri alabilirsiniz.

━━━━━━━━━━━━━━━━━━━━━━━
Kişisel verilerinizin işlenmesini kabul ediyorsanız, lütfen şunu yazınız:

👉 *Okudum, onaylıyorum*`;

// ─── MESAJ GÖNDER ──────────────────────────────────────────────────
function bekle(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function sendMessage(to, text) {
  try {
    const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
    await sock.sendMessage(jid, { text });
    await bekle(500);
  } catch (e) {
    console.error('Mesaj gönderme hatası:', e.message);
  }
}

// ─── HASTA RAPORU ──────────────────────────────────────────────────
function formatRapor(phone, data) {
  let rapor = `📊 *YENİ HASTA BAŞVURUSU*\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
  rapor += `📞 Telefon: ${phone}\n`;
  rapor += `👤 Ad Soyad: ${data.name || '-'}\n`;
  rapor += `🎂 Yaş: ${data.age || '-'}\n`;
  rapor += `⚥ Cinsiyet: ${data.gender || '-'}\n`;
  rapor += `⚖️ Kilo: ${data.weight || '-'} kg\n`;
  rapor += `📏 Boy: ${data.height || '-'} cm\n`;
  rapor += `🏥 Şikayet: ${data.region || '-'}\n`;
  rapor += `━━━━━━━━━━━━━━━━━━━━━━━\n`;

  if (data.kol_side) {
    rapor += `\n🦾 *KOL - BOYUN*\n`;
    rapor += `• Taraf: ${data.kol_side || '-'}\n`;
    rapor += `• Yayılım: ${data.kol_extent || '-'}\n`;
    rapor += `• Uyuşukluk: ${data.kol_numbness || '-'}\n`;
    if (data.kol_fingers) rapor += `• Parmaklar: ${data.kol_fingers}\n`;
    rapor += `• Yatarken: ${data.kol_night || '-'}\n`;
    rapor += `• Kuvvetsizlik: ${data.kol_weakness || '-'}\n`;
    rapor += `• Ameliyat: ${data.kol_surgery || '-'}\n`;
    rapor += `• EMG: ${data.kol_emg || '-'}\n`;
    rapor += `• MR: ${data.kol_mr || '-'}\n`;
    rapor += `• Baş ağrısı: ${data.boyun_headache || '-'}\n`;
    rapor += `• Süre: ${data.boyun_when || '-'}\n`;
    rapor += `• Kaza: ${data.boyun_accident || '-'}\n`;
    rapor += `• Yürüyüş: ${data.boyun_walk || '-'}\n`;
    rapor += `• Boyun MR: ${data.boyun_mr || '-'}\n`;
  }

  if (data.bel_where) {
    rapor += `\n🦵 *BEL*\n`;
    rapor += `• Yer: ${data.bel_where || '-'}\n`;
    rapor += `• Taraf: ${data.bel_side || '-'}\n`;
    rapor += `• Süre: ${data.bel_duration || '-'}\n`;
    rapor += `• Bacağa iner mi: ${data.bel_leg || '-'}\n`;
    rapor += `• Diz altı: ${data.bel_knee || '-'}\n`;
    rapor += `• Parmağa gider mi: ${data.bel_toes || '-'}\n`;
    rapor += `• Uyuşukluk: ${data.bel_numbness || '-'}\n`;
    rapor += `• Parmak/topuk basma: ${data.bel_walk || '-'}\n`;
    rapor += `• Yatarken: ${data.bel_night || '-'}\n`;
    rapor += `• En kötü: ${data.bel_worst || '-'}\n`;
    rapor += `• En iyi: ${data.bel_best || '-'}\n`;
    rapor += `• Yürüme: ${data.bel_distance || '-'}\n`;
    rapor += `• Tutulma: ${data.bel_acute || '-'}\n`;
    rapor += `• Kalkarken: ${data.bel_sit_rise || '-'}\n`;
    rapor += `• Eğilirken: ${data.bel_bend || '-'}\n`;
    rapor += `• Geriye: ${data.bel_back || '-'}\n`;
    rapor += `• Yatakta: ${data.bel_bed || '-'}\n`;
    rapor += `• Dönünce: ${data.bel_turn || '-'}\n`;
    rapor += `• Uzun oturma: ${data.bel_long_sit || '-'}\n`;
    rapor += `• Sabah: ${data.bel_morning || '-'}\n`;
    rapor += `• Leğen üstü: ${data.bel_hip_top || '-'}\n`;
  }

  rapor += `━━━━━━━━━━━━━━━━━━━━━━━`;
  return rapor;
}

// ─── BOT MANTIĞI ───────────────────────────────────────────────────
async function mesajiisle(from, text) {
  const lower = text.toLowerCase().trim();
  const state = userState[from] || { step: 'new', data: {} };

  if (lower === 'yeniden başla' || lower === 'yeniden basla' || lower === 'restart') {
    delete userState[from];
    saveState(userState);
    await sendMessage(from, 'Başvurunuz sıfırlandı. Yeni başvuru için herhangi bir mesaj yazınız.');
    return;
  }

  switch (state.step) {
    case 'new':
      await sendMessage(from, HOSGELDINIZ);
      await bekle(1500);
      await sendMessage(from, KVKK);
      state.step = 'kvkk_bekleniyor';
      break;

    case 'kvkk_bekleniyor':
      if (lower.includes('onaylıyorum') || lower.includes('onayliyorum') || lower.includes('okudum')) {
        await sendMessage(from, '✅ *Onayınız alınmıştır, teşekkür ederiz.*\n\n━━━━━━━━━━━━━━━━━━━━━━━\n\n👤 *Adınız ve soyadınız nedir?*');
        state.step = 'isim_bekleniyor';
      } else {
        await sendMessage(from, '⚠️ Devam için lütfen şunu yazınız:\n\n👉 *Okudum, onaylıyorum*');
      }
      break;

    case 'isim_bekleniyor':
      state.data.name = text;
      await sendMessage(from, `Merhaba ${text.split(' ')[0]}! 😊\n\n🎂 *Yaşınız kaç?*`);
      state.step = 'yas_bekleniyor';
      break;

    case 'yas_bekleniyor':
      state.data.age = text;
      await sendMessage(from, '⚥ *Cinsiyetiniz?*\n\n• *Erkek*\n• *Kadın*');
      state.step = 'cinsiyet_bekleniyor';
      break;

    case 'cinsiyet_bekleniyor':
      state.data.gender = text;
      await sendMessage(from, '⚖️ *Kilonuz?* (kg)\n\nÖrnek: 75');
      state.step = 'kilo_bekleniyor';
      break;

    case 'kilo_bekleniyor':
      state.data.weight = text;
      await sendMessage(from, '📏 *Boyunuz?* (cm)\n\nÖrnek: 175');
      state.step = 'boy_bekleniyor';
      break;

    case 'boy_bekleniyor':
      state.data.height = text;
      await sendMessage(from, '🏥 *Hangi bölgede şikayetiniz var?*\n\n1️⃣ *Kol - Boyun*\n2️⃣ *Bel*\n3️⃣ *Sırt*');
      state.step = 'bolge_bekleniyor';
      break;

    case 'bolge_bekleniyor':
      state.data.region = text;
      if (lower.includes('kol') || lower.includes('boyun') || lower === '1') {
        await sendMessage(from, '🦾 *KOL ŞİKAYETİ*\n\nHangi tarafta?\n\n• *Sağ*\n• *Sol*\n• *İki taraf*');
        state.step = 'kol_taraf';
      } else if (lower.includes('bel') || lower === '2') {
        await sendMessage(from, '🦵 *BEL ŞİKAYETİ*\n\nNeresi ağrıyor?\n\n• *Bel*\n• *Kalça*\n• *Bacak*\n• *Bel ve bacak*');
        state.step = 'bel_yer';
      } else if (lower.includes('sırt') || lower.includes('sirt') || lower === '3') {
        state.data.region = 'Sırt';
        await bitir(from, state);
        return;
      } else {
        await sendMessage(from, '⚠️ Lütfen *1*, *2* veya *3* yazınız.');
      }
      break;

    case 'kol_taraf':
      state.data.kol_side = text;
      await sendMessage(from, 'Nereye kadar uzanıyor?\n\n• *Sadece boyun*\n• *Sırt*\n• *Dirseğe kadar*\n• *Ele kadar*\n• *Parmaklara kadar*');
      state.step = 'kol_yayilim';
      break;

    case 'kol_yayilim':
      state.data.kol_extent = text;
      await sendMessage(from, 'Kolda *uyuşukluk* veya *karıncalanma* var mı?\n\n• *Evet*\n• *Hayır*');
      state.step = 'kol_uyusma';
      break;

    case 'kol_uyusma':
      state.data.kol_numbness = text;
      if (lower.includes('evet')) {
        await sendMessage(from, 'Hangi parmaklara geliyor?');
        state.step = 'kol_parmak';
      } else {
        state.data.kol_fingers = 'Yok';
        await sendMessage(from, 'Yatarken şikayet var mı?\n\n• *Evet*\n• *Hayır*');
        state.step = 'kol_yatarken';
      }
      break;

    case 'kol_parmak':
      state.data.kol_fingers = text;
      await sendMessage(from, 'Yatarken şikayet var mı?\n\n• *Evet*\n• *Hayır*');
      state.step = 'kol_yatarken';
      break;

    case 'kol_yatarken':
      state.data.kol_night = text;
      await sendMessage(from, 'Kuvvetsizlik var mı?\n_(Elinden bir şey düşürüyor mu?)_\n\n• *Evet*\n• *Hayır*');
      state.step = 'kol_kuvvetsizlik';
      break;

    case 'kol_kuvvetsizlik':
      state.data.kol_weakness = text;
      await sendMessage(from, 'Ameliyat geçmişi var mı?\n\n• *Evet*\n• *Hayır*');
      state.step = 'kol_ameliyat';
      break;

    case 'kol_ameliyat':
      state.data.kol_surgery = text;
      await sendMessage(from, 'EMG çektirdiniz mi?\n\n• *Evet*\n• *Hayır*');
      state.step = 'kol_emg';
      break;

    case 'kol_emg':
      state.data.kol_emg = text;
      await sendMessage(from, 'MR raporunuz var mı?\n\n• *Evet*\n• *Hayır*');
      state.step = 'kol_mr';
      break;

    case 'kol_mr':
      state.data.kol_mr = text;
      await sendMessage(from, '━━━━━━━━━━━━━━━━━━━━━━━\n\n🔹 *BOYUN SORULARI*\n\nOmuz/boyun/enseden baş ağrısı var mı?\n\n• *Evet*\n• *Hayır*');
      state.step = 'boyun_bas_agrisi';
      break;

    case 'boyun_bas_agrisi':
      state.data.boyun_headache = text;
      await sendMessage(from, 'Ne zamandır?\n\n• *Sürekli*\n• *Zaman zaman*');
      state.step = 'boyun_sure';
      break;

    case 'boyun_sure':
      state.data.boyun_when = text;
      await sendMessage(from, 'Kaza veya ameliyat geçmişi var mı?\n\n• *Evet*\n• *Hayır*');
      state.step = 'boyun_kaza';
      break;

    case 'boyun_kaza':
      state.data.boyun_accident = text;
      await sendMessage(from, 'Yürüyüşünüzde bozukluk var mı?\n\n• *Evet*\n• *Hayır*');
      state.step = 'boyun_yuruyus';
      break;

    case 'boyun_yuruyus':
      state.data.boyun_walk = text;
      await sendMessage(from, 'Boyun MR raporunuz var mı?\n\n• *Evet*\n• *Hayır*');
      state.step = 'boyun_mr';
      break;

    case 'boyun_mr':
      state.data.boyun_mr = text;
      await bitir(from, state);
      return;

    case 'bel_yer':
      state.data.bel_where = text;
      await sendMessage(from, 'Hangi tarafta?\n\n• *Sağ*\n• *Sol*\n• *İki taraf*\n• *Ortada*');
      state.step = 'bel_taraf';
      break;

    case 'bel_taraf':
      state.data.bel_side = text;
      await sendMessage(from, 'Ne zamandan beri?\n\nÖrnek: 3 aydır');
      state.step = 'bel_sure';
      break;

    case 'bel_sure':
      state.data.bel_duration = text;
      await sendMessage(from, 'Kalçadan bacağa iniyor mu?\n\n• *Evet*\n• *Hayır*\n• *Sadece kalçada*');
      state.step = 'bel_bacak';
      break;

    case 'bel_bacak':
      state.data.bel_leg = text;
      await sendMessage(from, 'Dizden aşağı iniyor mu?\n\n• *Evet*\n• *Hayır*');
      state.step = 'bel_diz';
      break;

    case 'bel_diz':
      state.data.bel_knee = text;
      await sendMessage(from, 'Ayak parmağına kadar geliyor mu?\n\n• *Evet* (hangi parmaklar?)\n• *Hayır*');
      state.step = 'bel_parmak';
      break;

    case 'bel_parmak':
      state.data.bel_toes = text;
      await sendMessage(from, 'Uyuşma veya karıncalanma var mı?\n\n• *Evet*\n• *Hayır*');
      state.step = 'bel_uyusma';
      break;

    case 'bel_uyusma':
      state.data.bel_numbness = text;
      await sendMessage(from, 'Ayak parmağına/topuğa basabiliyor musunuz?\n\n• *Evet*\n• *Hayır*\n• *Zor basıyorum*');
      state.step = 'bel_parmak_bas';
      break;

    case 'bel_parmak_bas':
      state.data.bel_walk = text;
      await sendMessage(from, 'Yatarken ağrı var mı?\n\n• *Evet*\n• *Hayır*');
      state.step = 'bel_yatarken';
      break;

    case 'bel_yatarken':
      state.data.bel_night = text;
      await sendMessage(from, 'En fazla ağrı ne zaman?\n\n• *Yatarken*\n• *Otururken*\n• *Yürürken*\n• *Ayakta kalınca*');
      state.step = 'bel_en_kotu';
      break;

    case 'bel_en_kotu':
      state.data.bel_worst = text;
      await sendMessage(from, 'En rahat ne zaman?\n\n• *Yatarken*\n• *Otururken*\n• *Yürürken*');
      state.step = 'bel_en_iyi';
      break;

    case 'bel_en_iyi':
      state.data.bel_best = text;
      await sendMessage(from, 'Ne kadar yürüyebiliyorsunuz?\n\nÖrnek: 500 metre, 10 dakika');
      state.step = 'bel_mesafe';
      break;

    case 'bel_mesafe':
      state.data.bel_distance = text;
      await sendMessage(from, 'Aniden şiddetli tutulma oldu mu?\n\n• *Evet*\n• *Hayır*');
      state.step = 'bel_tutulma';
      break;

    case 'bel_tutulma':
      state.data.bel_acute = text;
      await sendMessage(from, 'Oturduğunuz yerden kalkarken ağrı oluyor mu?\n\n• *Evet*\n• *Hayır*');
      state.step = 'bel_kalkma';
      break;

    case 'bel_kalkma':
      state.data.bel_sit_rise = text;
      await sendMessage(from, 'Öne eğilirken ağrı oluyor mu?\n\n• *Evet*\n• *Hayır*');
      state.step = 'bel_egilme';
      break;

    case 'bel_egilme':
      state.data.bel_bend = text;
      await sendMessage(from, 'Geriye kaykılınca ağrı oluyor mu?\n\n• *Evet*\n• *Hayır*');
      state.step = 'bel_geriye';
      break;

    case 'bel_geriye':
      state.data.bel_back = text;
      await sendMessage(from, 'Yatarken belde ağrı var mı?\n\n• *Evet*\n• *Hayır*');
      state.step = 'bel_yatma';
      break;

    case 'bel_yatma':
      state.data.bel_bed = text;
      await sendMessage(from, 'Yatakta sağa sola dönerken ağrı var mı?\n\n• *Evet*\n• *Hayır*');
      state.step = 'bel_donme';
      break;

    case 'bel_donme':
      state.data.bel_turn = text;
      await sendMessage(from, 'Uzun süre oturunca veya ayakta kalınca ağrı artıyor mu?\n\n• *Evet*\n• *Hayır*');
      state.step = 'bel_uzun_oturma';
      break;

    case 'bel_uzun_oturma':
      state.data.bel_long_sit = text;
      await sendMessage(from, 'Sabah yataktan kalkınca ağrı oluyor mu?\n_(Hareketlenince azalıyor mu?)_\n\n• *Evet*\n• *Hayır*');
      state.step = 'bel_sabah';
      break;

    case 'bel_sabah':
      state.data.bel_morning = text;
      await sendMessage(from, 'Kalçanın üst kısmında (leğen kemiği üstünde) ağrı var mı?\n\n• *Evet*\n• *Hayır*');
      state.step = 'bel_legen';
      break;

    case 'bel_legen':
      state.data.bel_hip_top = text;
      await bitir(from, state);
      return;

    case 'done':
      await sendMessage(from, 'Başvurunuz alınmıştır. ✅\n\nMüşteri temsilcimiz en kısa sürede sizinle ilgilenecektir.\n\n_Yeni başvuru: *yeniden başla*_');
      return;

    default:
      state.step = 'new';
      await sendMessage(from, HOSGELDINIZ);
      await bekle(1500);
      await sendMessage(from, KVKK);
      state.step = 'kvkk_bekleniyor';
  }

  userState[from] = state;
  saveState(userState);
}

async function bitir(from, state) {
  state.step = 'done';
  userState[from] = state;
  saveState(userState);

  await sendMessage(from, '✅ *Bilgileriniz başarıyla alınmıştır.*\n\nMüşteri temsilcimiz en kısa sürede sizinle ilgilenecektir. 🙏\n\n*Prof. Dr. Alp Yentür Kliniği*');

  const rapor = formatRapor(from, state.data);
  console.log('\n' + '='.repeat(50));
  console.log('YENİ HASTA:', new Date().toLocaleString('tr-TR'));
  console.log(rapor);
  console.log('='.repeat(50) + '\n');
}

// ─── WHATSAPP BAĞLANTISI ───────────────────────────────────────────
async function baslat() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    browser: ['AlpYentur Bot', 'Chrome', '1.0.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('QR kod oluşturuldu!');
      qrCodeData = await qrcode.toDataURL(qr);
      isReady = false;
    }

    if (connection === 'close') {
      isReady = false;
      qrCodeData = null;
      const shouldReconnect = (lastDisconnect?.error instanceof Boom)
        ? lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut
        : true;

      if (shouldReconnect) {
        console.log('Yeniden bağlanıyor...');
        setTimeout(baslat, 3000);
      } else {
        console.log('Oturum kapatıldı, QR tekrar taranmalı.');
        // Auth bilgilerini sil, yeniden başlat
        fs.rmSync('./auth_info', { recursive: true, force: true });
        setTimeout(baslat, 3000);
      }
    }

    if (connection === 'open') {
      console.log('✅ WhatsApp bağlandı!');
      isReady = true;
      qrCodeData = null;
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const message of messages) {
      if (message.key.fromMe) continue; // Kendi mesajlarını atla
      if (message.key.remoteJid.endsWith('@g.us')) continue; // Grup mesajlarını atla

      const from = message.key.remoteJid;
      const text = message.message?.conversation ||
                   message.message?.extendedTextMessage?.text || '';

      if (!text) continue;

      console.log(`[${new Date().toLocaleTimeString('tr-TR')}] ${from}: ${text}`);
      await mesajiisle(from, text);
    }
  });
}

baslat();

// ─── WEB PANEL ─────────────────────────────────────────────────────
app.get('/', (req, res) => {
  if (!isReady && qrCodeData) {
    res.send(`<!DOCTYPE html>
<html>
<head>
  <title>WhatsApp Bot - QR Kod</title>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="10">
  <style>
    body{font-family:Arial;text-align:center;padding:50px;background:#f0f0f0}
    h1{color:#25D366}
    img{border:3px solid #25D366;border-radius:10px;padding:10px;background:white}
    p{color:#666}
    .box{background:white;padding:30px;border-radius:15px;display:inline-block;margin:20px}
  </style>
</head>
<body>
  <h1>📱 Prof. Dr. Alp Yentür WhatsApp Botu</h1>
  <div class="box">
    <h2>QR Kodu Telefonunuzdan Tarayın</h2>
    <img src="${qrCodeData}" width="280" />
    <p>📱 WhatsApp → ⋮ → Bağlı Cihazlar → Cihaz Ekle → QR Kodu Tara</p>
    <p><small>⏱ Sayfa 10 saniyede bir yenileniyor...</small></p>
  </div>
</body>
</html>`);
  } else if (isReady) {
    res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Bot Aktif</title>
  <meta charset="utf-8">
  <style>
    body{font-family:Arial;text-align:center;padding:50px;background:#f0f0f0}
    h1{color:#25D366}
    .status{background:#25D366;color:white;padding:20px 40px;border-radius:10px;display:inline-block;font-size:20px}
    .info{background:white;padding:20px;border-radius:10px;margin:20px auto;max-width:400px}
  </style>
</head>
<body>
  <h1>🤖 Prof. Dr. Alp Yentür WhatsApp Botu</h1>
  <div class="status">✅ Bot Aktif ve Çalışıyor</div>
  <div class="info">
    <p>👥 Toplam Hasta: <b>${Object.keys(userState).length}</b></p>
    <p>🕐 Sunucu Saati: ${new Date().toLocaleString('tr-TR')}</p>
  </div>
</body>
</html>`);
  } else {
    res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="5">
</head>
<body style="text-align:center;padding:50px;font-family:Arial">
  <h2>⏳ Bot başlatılıyor, lütfen bekleyin...</h2>
  <p>Sayfa otomatik yenileniyor</p>
</body>
</html>`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🤖 Prof. Dr. Alp Yentür WhatsApp Botu başlatıldı`);
  console.log(`🌐 Panel: https://whatsapp-bot-production-7fa7.up.railway.app`);
  console.log(`⏳ WhatsApp bağlantısı bekleniyor...\n`);
});
