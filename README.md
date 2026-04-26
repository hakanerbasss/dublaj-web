# 🎬 Dublaj Studio Pro v2.0

**%100 Web Tabanlı AI Dublaj Sistemi**  
*ElevenLabs API + MyMemory Translate ile çalışır*

🔗 **Canlı:** https://hakanerbasss.github.io/dublaj-web

---

## ✨ Özellikler

| Özellik | Açıklama |
|---------|----------|
| 🎵 **Ses Ayrıştırma** | Web Audio API ile videodan ses çıkarma |
| 📝 **Speech-to-Text** | ElevenLabs STT ile konuşma tanıma |
| 🌐 **Çeviri** | MyMemory ile 10+ dil desteği |
| 🎤 **Seslendirme** | ElevenLabs TTS ile doğal ses |
| 🎬 **Ses Birleştirme** | Orijinal zamanlamaya uygun otomatik senkron |

## 🌍 Desteklenen Diller

🇹🇷 Türkçe · 🇬🇧 İngilizce · 🇩🇪 Almanca · 🇫🇷 Fransızca · 🇪🇸 İspanyolca  
🇮🇹 İtalyanca · 🇵🇹 Portekizce · 🇷🇺 Rusça · 🇯🇵 Japonca · 🇰🇷 Korece

## 🚀 Kullanım

1. **ElevenLabs API Anahtarı** gir (ücretsiz: [elevenlabs.io](https://elevenlabs.io))
2. Ses ve dil ayarlarını yap
3. Video yükle (MP4, AVI, MOV, WebM)
4. "Dublajı Başlat" butonuna bas
5. İşlem tamamlanınca WAV ses dosyasını indir

## ⚡ Teknik Detaylar

- **Termux bağlantısı YOK** - Tamamen tarayıcıda çalışır
- **Sunucu yok** - Dosyalarınız asla gönderilmez
- **Web Audio API** ile ses işleme
- **OfflineAudioContext** ile ses karıştırma
- **LocalStorage** ile ayarları hatırlama

## 🔧 Gereksinimler

- ElevenLabs API anahtarı ([ücretsiz kaydol](https://elevenlabs.io))
- Modern bir tarayıcı (Chrome, Firefox, Edge, Safari)
- İnternet bağlantısı (API çağrıları için)

## 📂 Dosya Yapısı

```
dublaj-web/
├── index.html   # Ana sayfa
├── style.css    # Tasarım
└── app.js       # Dublaj motoru
```

---

*Made with ❤️ by hakanerbasss*
