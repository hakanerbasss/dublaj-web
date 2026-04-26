/**
 * Dublaj Studio Pro - AI Video Dubbing Engine
 * ElevenLabs API + MyMemory Translate ile çalışır
 * Tarayıcı tabanlı - hiçbir sunucu gerekmez
 */

// =============================================
// STATE
// =============================================
const state = {
  videoFile: null,
  videoUrl: null,
  apiKey: 'sk_5fbe34c76bd3e993d620ba42f3dbff9aaf2a4cf81bbc81cc',
  voiceId: 'JBFqnCBsd6RMkjVDRZzb',
  sourceLang: 'tr',
  targetLang: 'en',
  audioBlob: null,
  segments: [],
  translatedSegments: [],
  resultBlob: null,
  isProcessing: false
};

// =============================================
// DOM REFS
// =============================================
const $ = (id) => document.getElementById(id);

// =============================================
// API HELPERS
// =============================================
const API = {
  // ElevenLabs Speech-to-Text
  async stt(audioBlob, apiKey, language) {
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.wav');
    formData.append('model_id', 'scribe_v2');
    formData.append('language_code', language);
    formData.append('timestamps_granularity', 'word');

    const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: formData
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`STT hatası (${res.status}): ${err.substring(0, 200)}`);
    }
    return await res.json();
  },

  // Translate via MyMemory
  async translate(text, source, target) {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${source}|${target}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Çeviri hatası: ${res.status}`);
    const data = await res.json();
    return data.responseData.translatedText || text;
  },

  // ElevenLabs Text-to-Speech
  async tts(text, voiceId, apiKey) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        text: text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.8
        }
      })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`TTS hatası (${res.status}): ${err.substring(0, 200)}`);
    }
    return await res.blob();
  },

  // Extract audio from video using Web Audio API
  async extractAudio(videoBlob) {
    const arrayBuffer = await videoBlob.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    if (!audioBuffer || audioBuffer.numberOfChannels === 0) {
      throw new Error('Videoda ses kanalı bulunamadı!');
    }

    return this.audioBufferToWav(audioBuffer);
  },

  // AudioBuffer -> WAV Blob (yüksek kalite)
  audioBufferToWav(audioBuffer) {
    return new Promise((resolve) => {
      const numChannels = audioBuffer.numberOfChannels;
      const sampleRate = audioBuffer.sampleRate;
      const format = 1; // PCM
      const bitDepth = 16;

      const bytesPerSample = bitDepth / 8;
      const blockAlign = numChannels * bytesPerSample;
      const dataSize = audioBuffer.length * blockAlign;
      const headerSize = 44;
      const totalSize = headerSize + dataSize;

      const arrayBuffer = new ArrayBuffer(totalSize);
      const view = new DataView(arrayBuffer);

      // WAV Header
      this.writeString(view, 0, 'RIFF');
      view.setUint32(4, totalSize - 8, true);
      this.writeString(view, 8, 'WAVE');
      this.writeString(view, 12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, format, true);
      view.setUint16(22, numChannels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * blockAlign, true);
      view.setUint16(32, blockAlign, true);
      view.setUint16(34, bitDepth, true);
      this.writeString(view, 36, 'data');
      view.setUint32(40, dataSize, true);

      // Kanalları interleave et
      const channels = [];
      for (let c = 0; c < numChannels; c++) {
        channels.push(audioBuffer.getChannelData(c));
      }

      let offset = 44;
      for (let i = 0; i < audioBuffer.length; i++) {
        for (let c = 0; c < numChannels; c++) {
          const sample = Math.max(-1, Math.min(1, channels[c][i]));
          const val = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
          view.setInt16(offset, val, true);
          offset += 2;
        }
      }

      const blob = new Blob([arrayBuffer], { type: 'audio/wav' });
      resolve(blob);
    });
  },

  writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  },

  // Ses süresini al
  async getAudioDuration(blob) {
    const url = URL.createObjectURL(blob);
    return new Promise((resolve) => {
      const audio = new Audio();
      audio.src = url;
      audio.addEventListener('loadedmetadata', () => {
        resolve(audio.duration);
        URL.revokeObjectURL(url);
      });
      audio.addEventListener('error', () => {
        // WAV için: süre = data_bytes / (sample_rate * channels * bytes_per_sample)
        const header = 44;
        const dataBytes = blob.size - header;
        const dur = dataBytes / (44100 * 2 * 2);
        resolve(dur);
        URL.revokeObjectURL(url);
      });
    });
  }
};

// =============================================
// DUBBING ENGINE
// =============================================
const DubbingEngine = {
  async process(videoBlob, settings, callbacks) {
    const { onLog, onProgress, onStep } = callbacks;
    const results = { segments: [], translatedSegments: [], audioBlob: null };

    try {
      // === STEP 1: Extract Audio ===
      onStep('audio', 'active');
      onLog('🎵 Ses ayrıştırılıyor...', 'info');
      onProgress(5);

      const audioBlob = await API.extractAudio(videoBlob);
      const audioDur = await API.getAudioDuration(audioBlob);
      results.audioBlob = audioBlob;
      onLog(`✅ Ses ayrıştırıldı: ${audioDur.toFixed(1)}s`, 'success');
      onStep('audio', 'done');
      onProgress(10);

      // === STEP 2: Speech-to-Text ===
      onStep('stt', 'active');
      onLog('📝 Konuşma tanıma başlıyor (ElevenLabs STT)...', 'info');
      onProgress(15);

      const sttResult = await API.stt(audioBlob, settings.apiKey, settings.sourceLang);
      const words = sttResult.words || [];
      onLog(`✅ ${words.length} kelime tanındı`, 'success');

      // Kelimeleri segmentlere ayır (0.8s boşluk = yeni segment)
      const segments = [];
      let currentWords = [];
      let currentStart = null;

      for (const w of words) {
        if (w.type === 'spacing') continue;
        const wstart = w.start || 0;
        const wend = w.end || 0;
        const wtext = w.text || '';

        if (currentWords.length === 0) {
          currentStart = wstart;
          currentWords.push(w);
        } else {
          const prevEnd = currentWords[currentWords.length - 1].end || 0;
          const gap = wstart - prevEnd;
          if (gap > 0.8) {
            const segText = currentWords.filter(x => x.type !== 'spacing').map(x => x.text).join(' ');
            segments.push({ start: currentStart, end: prevEnd, text: segText });
            currentWords = [w];
            currentStart = wstart;
          } else {
            currentWords.push(w);
          }
        }
      }

      if (currentWords.length > 0) {
        const segText = currentWords.filter(x => x.type !== 'spacing').map(x => x.text).join(' ');
        segments.push({ start: currentStart, end: currentWords[currentWords.length - 1].end || 0, text: segText });
      }

      results.segments = segments;
      onLog(`✅ ${segments.length} segment oluşturuldu`, 'success');
      onStep('stt', 'done');
      onProgress(25);

      // === STEP 3: Translate ===
      onStep('translate', 'active');
      onLog('🌐 Segmentler çevriliyor...', 'info');
      onProgress(30);

      const translatedSegments = [];
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        onLog(`   ↪ ${i+1}/${segments.length}: "${seg.text.substring(0, 50)}..."`, 'info');
        const translatedText = await API.translate(seg.text, settings.sourceLang, settings.targetLang);
        translatedSegments.push({ ...seg, translatedText });
        onProgress(30 + ((i + 1) / segments.length) * 15);
      }

      results.translatedSegments = translatedSegments;
      onLog(`✅ Tüm segmentler çevrildi`, 'success');
      onStep('translate', 'done');
      onProgress(45);

      // === STEP 4: Text-to-Speech ===
      onStep('tts', 'active');
      onLog('🎤 Seslendirme (TTS) başlıyor...', 'info');
      onProgress(50);

      const ttsSegments = [];
      for (let i = 0; i < translatedSegments.length; i++) {
        const seg = translatedSegments[i];
        onLog(`   🎙 ${i+1}/${translatedSegments.length}: "${seg.translatedText.substring(0, 50)}..."`, 'info');

        const ttsBlob = await API.tts(seg.translatedText, settings.voiceId, settings.apiKey);
        const ttsDur = await API.getAudioDuration(ttsBlob);

        ttsSegments.push({ ...seg, ttsBlob, ttsDuration: ttsDur });
        onProgress(50 + ((i + 1) / translatedSegments.length) * 30);
      }

      onLog(`✅ ${ttsSegments.length} segment seslendirildi`, 'success');
      onStep('tts', 'done');
      onProgress(80);

      // === STEP 5: Merge Audio ===
      onStep('merge', 'active');
      onLog('🎬 Ses parçaları birleştiriliyor...', 'info');
      onProgress(85);

      // OfflineAudioContext ile sesleri karıştır
      const sampleRate = 44100;
      const totalDuration = Math.max(audioDur, ...ttsSegments.map(s => s.start + s.ttsDuration)) + 1;
      const totalSamples = Math.floor(sampleRate * totalDuration);

      const offlineCtx = new OfflineAudioContext(1, totalSamples, sampleRate);
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

      // Her TTS segmentini kendi start zamanında schedule et
      for (let i = 0; i < ttsSegments.length; i++) {
        const seg = ttsSegments[i];
        const arrayBuffer = await seg.ttsBlob.arrayBuffer();
        const segBuffer = await audioCtx.decodeAudioData(arrayBuffer);

        const source = offlineCtx.createBufferSource();
        source.buffer = segBuffer;

        const gain = offlineCtx.createGain();
        gain.gain.value = 1.0;
        source.connect(gain);
        gain.connect(offlineCtx.destination);

        source.start(seg.start);
      }

      onLog('⏳ Ses karıştırılıyor...', 'info');
      onProgress(92);

      const renderedBuffer = await offlineCtx.startRendering();
      const finalWavBlob = await API.audioBufferToWav(renderedBuffer);

      onLog('✅ Ses parçaları başarıyla birleştirildi!', 'success');
      onStep('merge', 'done');
      onProgress(100);

      return {
        audioBlob: finalWavBlob,
        segments: ttsSegments,
        duration: renderedBuffer.duration
      };

    } catch (err) {
      onLog(`❌ HATA: ${err.message}`, 'error');
      throw err;
    }
  }
};

// =============================================
// UI CONTROLLER
// =============================================
const UI = {
  init() {
    this.bindEvents();
    this.checkAPI();
    this.loadSettings();
  },

  bindEvents() {
    const uploadArea = $('uploadArea');
    const fileInput = $('fileInput');

    uploadArea.addEventListener('click', () => fileInput.click());
    uploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadArea.classList.add('dragover');
    });
    uploadArea.addEventListener('dragleave', () => {
      uploadArea.classList.remove('dragover');
    });
    uploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadArea.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) this.handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) this.handleFile(e.target.files[0]);
    });

    $('apiKey').addEventListener('input', () => {
      this.checkAPI();
      this.saveSettingsToStorage();
    });
    $('voiceSelect').addEventListener('change', () => this.saveSettingsToStorage());
    $('sourceLang').addEventListener('change', () => this.saveSettingsToStorage());
    $('targetLang').addEventListener('change', () => this.saveSettingsToStorage());
    $('startBtn').addEventListener('click', () => this.startDubbing());
    $('downloadBtn').addEventListener('click', () => this.downloadResult());
    $('resetBtn').addEventListener('click', () => this.reset());
  },

  handleFile(file) {
    if (!file.type.startsWith('video/')) {
      this.log('❌ Lütfen bir video dosyası seçin!', 'error');
      return;
    }

    state.videoFile = file;
    if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
    state.videoUrl = URL.createObjectURL(file);

    $('previewVideo').src = state.videoUrl;
    $('videoPreview').style.display = 'block';
    $('videoName').textContent = `📄 ${file.name}`;
    $('videoSize').textContent = `📦 ${(file.size / (1024*1024)).toFixed(1)} MB`;

    $('previewVideo').addEventListener('loadedmetadata', () => {
      const dur = $('previewVideo').duration;
      const mins = Math.floor(dur / 60);
      const secs = Math.floor(dur % 60);
      $('videoDuration').textContent = `⏱ ${mins}:${secs.toString().padStart(2, '0')}`;
    });

    $('startBtn').disabled = false;
    this.log(`✅ Video yüklendi: ${file.name}`, 'success');
  },

  checkAPI() {
    const key = $('apiKey').value.trim();
    const badge = $('apiStatus');

    if (key && key.startsWith('sk_')) {
      state.apiKey = key;
      badge.textContent = '🟢 API Hazır';
      badge.className = 'badge badge-api active';
    } else {
      badge.textContent = '🔴 API Anahtarı Gerekli';
      badge.className = 'badge badge-api';
    }
  },

  saveSettingsToStorage() {
    try {
      localStorage.setItem('dublaj_settings', JSON.stringify({
        apiKey: $('apiKey').value,
        voiceId: $('voiceSelect').value,
        sourceLang: $('sourceLang').value,
        targetLang: $('targetLang').value
      }));
    } catch(e) {}
  },

  loadSettings() {
    try {
      const saved = localStorage.getItem('dublaj_settings');
      if (saved) {
        const s = JSON.parse(saved);
        if (s.apiKey) $('apiKey').value = s.apiKey;
        if (s.voiceId) $('voiceSelect').value = s.voiceId;
        if (s.sourceLang) $('sourceLang').value = s.sourceLang;
        if (s.targetLang) $('targetLang').value = s.targetLang;
        this.checkAPI();
      }
    } catch(e) {}
  },

  log(msg, type = 'info') {
    const log = $('progressLog');
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.textContent = msg;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
  },

  setStep(id, status) {
    const stepId = 'step' + id.charAt(0).toUpperCase() + id.slice(1);
    const step = $(stepId);
    if (!step) return;

    const statusEl = step.querySelector('.step-status');
    step.className = 'progress-step';

    if (status === 'active') {
      step.classList.add('active');
      statusEl.textContent = '⏳ İşleniyor...';
    } else if (status === 'done') {
      step.classList.add('done');
      statusEl.textContent = '✅ Tamam';
    } else if (status === 'error') {
      step.classList.add('error');
      statusEl.textContent = '❌ Hata';
    }
  },

  async startDubbing() {
    if (state.isProcessing) return;
    if (!state.videoFile) {
      this.log('❌ Lütfen önce bir video yükleyin!', 'error');
      return;
    }

    const key = $('apiKey').value.trim();
    if (!key || !key.startsWith('sk_')) {
      this.log('❌ Geçerli bir ElevenLabs API anahtarı girin!', 'error');
      return;
    }

    state.apiKey = key;
    state.voiceId = $('voiceSelect').value;
    state.sourceLang = $('sourceLang').value;
    state.targetLang = $('targetLang').value;
    this.saveSettingsToStorage();

    state.isProcessing = true;

    $('uploadSection').style.display = 'none';
    $('progressSection').style.display = 'block';
    $('resultSection').style.display = 'none';

    ['audio', 'stt', 'translate', 'tts', 'merge'].forEach(id => this.setStep(id, ''));
    $('progressLog').innerHTML = '<div class="log-entry log-info">⏳ Hazırlanıyor...</div>';
    $('progressFill').style.width = '0%';

    try {
      const result = await DubbingEngine.process(state.videoFile, {
        apiKey: state.apiKey,
        voiceId: state.voiceId,
        sourceLang: state.sourceLang,
        targetLang: state.targetLang
      }, {
        onLog: (msg, type) => this.log(msg, type),
        onProgress: (pct) => { $('progressFill').style.width = `${pct}%`; },
        onStep: (id, status) => this.setStep(id, status)
      });

      state.resultBlob = result.audioBlob;
      this.showResult(result);

    } catch (err) {
      this.log(`❌ Dublaj başarısız: ${err.message}`, 'error');
      state.isProcessing = false;

      setTimeout(() => {
        if (confirm('❌ Dublaj başarısız oldu. Tekrar denemek ister misiniz?')) {
          this.startDubbing();
        } else {
          this.reset();
        }
      }, 500);
    }
  },

  showResult(result) {
    state.isProcessing = false;

    $('progressSection').style.display = 'none';
    $('resultSection').style.display = 'block';

    // Orijinal videoyu göster (dublaj sesi ayrı dosya)
    $('resultVideo').src = state.videoUrl;

    // Segmentleri göster
    this.renderSegments(result.segments);

    this.log('✅ Dublaj tamamlandı! Ses dosyasını indirebilirsiniz.', 'success');
  },

  renderSegments(segments) {
    const container = $('segmentsContainer');
    container.innerHTML = '';

    segments.forEach((seg, i) => {
      const el = document.createElement('div');
      el.className = 'segment-item';

      const start = seg.start || 0;
      const end = seg.end || 0;
      const m1 = Math.floor(start / 60);
      const s1 = Math.floor(start % 60);
      const m2 = Math.floor(end / 60);
      const s2 = Math.floor(end % 60);

      el.innerHTML = `
        <div class="segment-meta">#${i+1} · ${m1}:${s1.toString().padStart(2,'0')} - ${m2}:${s2.toString().padStart(2,'0')}</div>
        <div class="segment-text">
          <div class="source">🗣 ${seg.text}</div>
          <div class="target">🎤 ${seg.translatedText}</div>
        </div>
      `;
      container.appendChild(el);
    });
  },

  downloadResult() {
    if (!state.resultBlob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(state.resultBlob);
    const baseName = state.videoFile.name.replace(/\.[^.]+$/, '');
    a.download = `${baseName}_dublaj.wav`;
    a.click();
  },

  reset() {
    if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
    state.videoFile = null;
    state.videoUrl = null;
    state.audioBlob = null;
    state.segments = [];
    state.translatedSegments = [];
    state.resultBlob = null;
    state.isProcessing = false;

    $('uploadSection').style.display = 'block';
    $('progressSection').style.display = 'none';
    $('resultSection').style.display = 'none';
    $('videoPreview').style.display = 'none';
    $('startBtn').disabled = true;
    $('fileInput').value = '';
  }
};

// =============================================
// INIT
// =============================================
document.addEventListener('DOMContentLoaded', () => UI.init());
