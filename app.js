/**
 * Dublaj Studio Pro v2.0 - AI Video Dubbing Engine
 * 
 * ⚡ Tamamen web tabanlı (Termux bağlantısı YOK)
 * 🎯 ElevenLabs API + MyMemory Translate
 * 🔒 Her şey tarayıcıda işlenir, dosyalar sunucuya GİTMEZ
 */

// =============================================
// STATE MANAGEMENT
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
  isProcessing: false,
  cancelled: false
};

// =============================================
// DOM REFS (caching)
// =============================================
const $ = (id) => document.getElementById(id);

const DOM = {
  apiKey: $('apiKey'),
  apiStatus: $('apiStatus'),
  voiceSelect: $('voiceSelect'),
  sourceLang: $('sourceLang'),
  targetLang: $('targetLang'),
  fileInput: $('fileInput'),
  uploadArea: $('uploadArea'),
  videoPreview: $('videoPreview'),
  previewVideo: $('previewVideo'),
  videoName: $('videoName'),
  videoDuration: $('videoDuration'),
  videoSize: $('videoSize'),
  startBtn: $('startBtn'),
  uploadSection: $('uploadSection'),
  progressSection: $('progressSection'),
  progressFill: $('progressFill'),
  progressText: $('progressText'),
  progressPercent: $('progressPercent'),
  progressLog: $('progressLog'),
  resultSection: $('resultSection'),
  resultVideo: $('resultVideo'),
  downloadBtn: $('downloadBtn'),
  copyBtn: $('copyBtn'),
  resetBtn: $('resetBtn'),
  segmentsContainer: $('segmentsContainer'),
  rSegCount: $('rSegCount'),
  rDuration: $('rDuration'),
  rLangs: $('rLangs')
};

// =============================================
// API HELPERS
// =============================================
const API = {
  /**
   * ElevenLabs Speech-to-Text
   */
  async stt(audioBlob, apiKey, language) {
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.wav');
    formData.append('model_id', 'scribe_v2');
    formData.append('language_code', language);
    formData.append('timestamps_granularity', 'word');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000); // 3 dakika

    try {
      const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST',
        headers: { 'xi-api-key': apiKey },
        body: formData,
        signal: controller.signal
      });

      if (!res.ok) {
        const errText = await res.text();
        let msg = `STT hatası (${res.status})`;
        try {
          const err = JSON.parse(errText);
          msg = err.detail?.message || err.detail || msg;
        } catch(e) {}
        throw new Error(msg);
      }
      return await res.json();
    } finally {
      clearTimeout(timeout);
    }
  },

  /**
   * MyMemory Translation
   */
  async translate(text, source, target) {
    if (!text || text.trim().length === 0) return '';

    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.trim())}&langpair=${source}|${target}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Çeviri hatası: HTTP ${res.status}`);

    const data = await res.json();
    return data.responseData?.translatedText || text;
  },

  /**
   * ElevenLabs Text-to-Speech
   */
  async tts(text, voiceId, apiKey) {
    if (!text || text.trim().length === 0) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000); // 1 dakika

    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg'
        },
        body: JSON.stringify({
          text: text.trim(),
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.8,
            style: 0.3
          }
        }),
        signal: controller.signal
      });

      if (!res.ok) {
        const errText = await res.text();
        let msg = `TTS hatası (${res.status})`;
        try {
          const err = JSON.parse(errText);
          msg = err.detail?.message || err.detail || msg;
        } catch(e) {}
        throw new Error(msg);
      }
      return await res.blob();
    } finally {
      clearTimeout(timeout);
    }
  },

  /**
   * Video'dan ses ayır (Web Audio API)
   */
  async extractAudio(videoBlob) {
    const arrayBuffer = await videoBlob.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    let audioBuffer;
    try {
      audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
    } catch (err) {
      // Alternatif: MediaSource ile dene
      const url = URL.createObjectURL(videoBlob);
      try {
        audioBuffer = await this.decodeAudioFromURL(url, audioCtx);
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    if (!audioBuffer || audioBuffer.length === 0 || audioBuffer.numberOfChannels === 0) {
      throw new Error('Videoda ses kanalı bulunamadı!');
    }

    return this.audioBufferToWav(audioBuffer);
  },

  /**
   * Video URL'den ses decode et (alternatif)
   */
  async decodeAudioFromURL(url, audioCtx) {
    return new Promise((resolve, reject) => {
      const audio = new Audio();
      audio.src = url;
      audio.crossOrigin = 'anonymous';

      const source = audioCtx.createMediaElementSource(audio);
      const dest = audioCtx.createMediaStreamDestination();
      source.connect(dest);

      const recorder = new MediaRecorder(dest.stream, { mimeType: 'audio/webm' });
      const chunks = [];

      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const ab = await blob.arrayBuffer();
        try {
          const buf = await audioCtx.decodeAudioData(ab);
          resolve(buf);
        } catch(err) {
          reject(new Error('Ses decode edilemedi'));
        }
      };

      recorder.start();
      audio.play();

      audio.onended = () => {
        recorder.stop();
        audioCtx.close();
      };
      audio.onerror = () => reject(new Error('Video oynatılamadı'));

      // Maksimum 30 saniye bekle
      setTimeout(() => {
        if (recorder.state === 'recording') {
          audio.pause();
          recorder.stop();
        }
      }, 30000);
    });
  },

  /**
   * AudioBuffer -> WAV Blob
   */
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

  /**
   * Ses blob'unun süresini al
   */
  getAudioDuration(blob) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio();
      audio.src = url;

      audio.addEventListener('loadedmetadata', () => {
        const dur = audio.duration;
        URL.revokeObjectURL(url);
        resolve(dur || 0);
      });

      audio.addEventListener('error', () => {
        URL.revokeObjectURL(url);
        // WAV süresini hesapla
        const header = 44;
        const dataBytes = blob.size - header;
        const dur = dataBytes / (44100 * 2); // 16-bit mono
        resolve(Math.max(0, dur));
      });

      // Fallback timeout
      setTimeout(() => {
        URL.revokeObjectURL(url);
        resolve(0);
      }, 3000);
    });
  }
};

// =============================================
// DUBBING ENGINE
// =============================================
const DubbingEngine = {
  async process(videoBlob, settings, callbacks) {
    const { onLog, onProgress, onStep } = callbacks;

    try {
      // ========== STEP 1: Extract Audio ==========
      onStep('audio', 'active');
      onLog('🎵 Ses ayrıştırılıyor... (Web Audio API)', 'info');
      onProgress(5);

      const audioBlob = await API.extractAudio(videoBlob);
      const audioDur = await API.getAudioDuration(audioBlob);
      onLog(`✅ Ses ayrıştırıldı: ${audioDur.toFixed(1)}s · ${(audioBlob.size / 1024).toFixed(0)} KB`, 'success');
      onStep('audio', 'done');
      onProgress(10);

      // ========== STEP 2: Speech-to-Text ==========
      onStep('stt', 'active');
      onLog('📝 ElevenLabs Speech-to-Text başlıyor...', 'info');
      onProgress(15);

      const sttResult = await API.stt(audioBlob, settings.apiKey, settings.sourceLang);
      const words = sttResult.words || [];

      if (words.length === 0) {
        throw new Error('Konuşma tanıma sonuç vermedi. Videoda konuşma olduğundan emin olun.');
      }

      onLog(`✅ ${words.length} kelime tanındı (${sttResult.language_code || '?'})`, 'success');

      // Words -> segments (0.8s boşluk = yeni segment)
      const segments = this.wordsToSegments(words);
      onLog(`✅ ${segments.length} segment oluşturuldu`, 'success');
      onStep('stt', 'done');
      onProgress(25);

      // ========== STEP 3: Translate ==========
      onStep('translate', 'active');
      onLog(`🌐 ${segments.length} segment çevriliyor (${settings.sourceLang} → ${settings.targetLang})...`, 'info');
      onProgress(30);

      const translatedSegments = [];
      for (let i = 0; i < segments.length; i++) {
        if (state.cancelled) throw new Error('İşlem iptal edildi');

        const seg = segments[i];
        onLog(`   ↪ [${i+1}/${segments.length}] "${seg.text.substring(0, 45)}..."`, 'info');

        let translatedText = seg.text;
        try {
          translatedText = await API.translate(seg.text, settings.sourceLang, settings.targetLang);
        } catch (err) {
          onLog(`   ⚠️ Çeviri hatası, orijinal metin kullanılıyor: ${err.message}`, 'warning');
        }

        translatedSegments.push({
          ...seg,
          translatedText: translatedText
        });

        onProgress(30 + ((i + 1) / segments.length) * 15);
      }

      onLog(`✅ Tüm segmentler çevrildi`, 'success');
      onStep('translate', 'done');
      onProgress(45);

      // ========== STEP 4: Text-to-Speech ==========
      onStep('tts', 'active');
      onLog(`🎤 ${translatedSegments.length} segment seslendiriliyor...`, 'info');
      onProgress(50);

      const ttsSegments = [];
      for (let i = 0; i < translatedSegments.length; i++) {
        if (state.cancelled) throw new Error('İşlem iptal edildi');

        const seg = translatedSegments[i];
        const text = seg.translatedText || seg.text;

        if (!text || text.trim().length === 0) {
          ttsSegments.push({ ...seg, ttsBlob: null, ttsDuration: 0 });
          continue;
        }

        onLog(`   🎙 [${i+1}/${translatedSegments.length}] "${text.substring(0, 40)}..."`, 'info');

        try {
          const ttsBlob = await API.tts(text, settings.voiceId, settings.apiKey);
          const ttsDur = ttsBlob ? await API.getAudioDuration(ttsBlob) : 0;
          ttsSegments.push({ ...seg, ttsBlob, ttsDuration: ttsDur });
          onLog(`   ✅ ${ttsDur.toFixed(1)}s`, 'success');
        } catch (err) {
          onLog(`   ⚠️ TTS hatası: ${err.message}`, 'warning');
          ttsSegments.push({ ...seg, ttsBlob: null, ttsDuration: 0 });
        }

        onProgress(50 + ((i + 1) / translatedSegments.length) * 30);
      }

      const successCount = ttsSegments.filter(s => s.ttsBlob).length;
      onLog(`✅ ${successCount}/${ttsSegments.length} segment seslendirildi`, 'success');
      onStep('tts', 'done');
      onProgress(80);

      // ========== STEP 5: Merge Audio ==========
      onStep('merge', 'active');
      onLog('🎬 Ses parçaları birleştiriliyor...', 'info');
      onProgress(85);

      const mergedBlob = await this.mergeAudio(audioDur, ttsSegments, onLog);
      onLog('✅ Ses parçaları başarıyla birleştirildi!', 'success');
      onStep('merge', 'done');
      onProgress(100);

      return {
        audioBlob: mergedBlob,
        segments: ttsSegments,
        duration: audioDur
      };

    } catch (err) {
      if (err.message === 'İşlem iptal edildi') {
        onLog('⏹️ İşlem iptal edildi', 'warning');
      } else {
        onLog(`❌ HATA: ${err.message}`, 'error');
      }
      throw err;
    }
  },

  /**
   * Words dizisini segmentlere ayır
   */
  wordsToSegments(words) {
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
          const segText = currentWords
            .filter(x => x.type !== 'spacing')
            .map(x => x.text)
            .join(' ');
          segments.push({ start: currentStart, end: prevEnd, text: segText });
          currentWords = [w];
          currentStart = wstart;
        } else {
          currentWords.push(w);
        }
      }
    }

    if (currentWords.length > 0) {
      const segText = currentWords
        .filter(x => x.type !== 'spacing')
        .map(x => x.text)
        .join(' ');
      segments.push({
        start: currentStart,
        end: currentWords[currentWords.length - 1].end || 0,
        text: segText
      });
    }

    return segments;
  },

  /**
   * Sesleri OfflineAudioContext ile birleştir
   */
  async mergeAudio(videoDuration, ttsSegments, onLog) {
    const sampleRate = 44100;
    const totalDuration = Math.max(videoDuration, ...ttsSegments.map(s => (s.start || 0) + (s.ttsDuration || 0))) + 2;
    const totalSamples = Math.ceil(sampleRate * totalDuration);

    const offlineCtx = new OfflineAudioContext(1, totalSamples, sampleRate);
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    let loaded = 0;
    const total = ttsSegments.filter(s => s.ttsBlob).length;

    for (const seg of ttsSegments) {
      if (!seg.ttsBlob) continue;

      try {
        const arrayBuffer = await seg.ttsBlob.arrayBuffer();
        const segBuffer = await audioCtx.decodeAudioData(arrayBuffer);

        const source = offlineCtx.createBufferSource();
        source.buffer = segBuffer;

        const gain = offlineCtx.createGain();
        gain.gain.value = 1.0;

        source.connect(gain);
        gain.connect(offlineCtx.destination);
        source.start(seg.start || 0);

        loaded++;
        if (loaded % 5 === 0 || loaded === total) {
          onLog(`   🔄 Ses karıştırma: ${loaded}/${total}`, 'info');
        }
      } catch (err) {
        onLog(`   ⚠️ Segment karıştırılamadı: ${err.message}`, 'warning');
      }
    }

    onLog('⏳ Ses işleniyor...', 'info');

    // Rendering progress
    return new Promise((resolve, reject) => {
      offlineCtx.oncomplete = (event) => {
        const renderedBuffer = event.renderedBuffer;
        API.audioBufferToWav(renderedBuffer).then(blob => {
          audioCtx.close();
          resolve(blob);
        });
      };

      offlineCtx.onerror = (err) => {
        audioCtx.close();
        reject(new Error('Ses birleştirme başarısız'));
      };

      try {
        offlineCtx.startRendering();
      } catch (err) {
        audioCtx.close();
        reject(err);
      }
    });
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
    // Upload
    DOM.uploadArea.addEventListener('click', () => DOM.fileInput.click());
    DOM.uploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      DOM.uploadArea.classList.add('dragover');
    });
    DOM.uploadArea.addEventListener('dragleave', () => {
      DOM.uploadArea.classList.remove('dragover');
    });
    DOM.uploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      DOM.uploadArea.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) this.handleFile(e.dataTransfer.files[0]);
    });
    DOM.fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) this.handleFile(e.target.files[0]);
    });

    // Settings
    DOM.apiKey.addEventListener('input', () => {
      this.checkAPI();
      this.saveSettings();
    });
    DOM.voiceSelect.addEventListener('change', () => this.saveSettings());
    DOM.sourceLang.addEventListener('change', () => this.saveSettings());
    DOM.targetLang.addEventListener('change', () => this.saveSettings());

    // Buttons
    DOM.startBtn.addEventListener('click', () => this.startDubbing());
    DOM.downloadBtn.addEventListener('click', () => this.downloadResult());
    DOM.copyBtn.addEventListener('click', () => this.copyLink());
    DOM.resetBtn.addEventListener('click', () => this.reset());
  },

  handleFile(file) {
    if (!file.type.startsWith('video/')) {
      this.toast('❌ Lütfen bir video dosyası seçin!', 'error');
      return;
    }

    // Max 500MB
    if (file.size > 500 * 1024 * 1024) {
      this.toast('❌ Video çok büyük! Maksimum 500MB desteklenir.', 'error');
      return;
    }

    state.videoFile = file;
    if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
    state.videoUrl = URL.createObjectURL(file);

    DOM.previewVideo.src = state.videoUrl;
    DOM.videoPreview.style.display = 'block';
    DOM.videoName.textContent = `📄 ${file.name}`;
    DOM.videoSize.textContent = `📦 ${(file.size / (1024*1024)).toFixed(1)} MB`;

    DOM.previewVideo.addEventListener('loadedmetadata', () => {
      const dur = DOM.previewVideo.duration;
      const mins = Math.floor(dur / 60);
      const secs = Math.floor(dur % 60);
      DOM.videoDuration.textContent = `⏱ ${mins}:${secs.toString().padStart(2, '0')}`;
    }, { once: true });

    DOM.startBtn.disabled = false;
    this.log(`✅ Video yüklendi: ${file.name}`, 'success');
    this.toast('✅ Video yüklendi!', 'success');
  },

  checkAPI() {
    const key = DOM.apiKey.value.trim();
    if (key && key.startsWith('sk_')) {
      state.apiKey = key;
      DOM.apiStatus.textContent = '🟢 API Hazır';
      DOM.apiStatus.className = 'badge badge-api active';
    } else {
      DOM.apiStatus.textContent = '🔴 API Anahtarı Gerekli';
      DOM.apiStatus.className = 'badge badge-api';
    }
  },

  saveSettings() {
    try {
      localStorage.setItem('dublaj_settings', JSON.stringify({
        apiKey: DOM.apiKey.value,
        voiceId: DOM.voiceSelect.value,
        sourceLang: DOM.sourceLang.value,
        targetLang: DOM.targetLang.value
      }));
    } catch(e) {}
  },

  loadSettings() {
    try {
      const saved = localStorage.getItem('dublaj_settings');
      if (saved) {
        const s = JSON.parse(saved);
        if (s.apiKey) DOM.apiKey.value = s.apiKey;
        if (s.voiceId) DOM.voiceSelect.value = s.voiceId;
        if (s.sourceLang) DOM.sourceLang.value = s.sourceLang;
        if (s.targetLang) DOM.targetLang.value = s.targetLang;
        this.checkAPI();
      }
    } catch(e) {}
  },

  log(msg, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.textContent = msg;
    DOM.progressLog.appendChild(entry);
    DOM.progressLog.scrollTop = DOM.progressLog.scrollHeight;
  },

  setStep(id, status) {
    const stepMap = {
      'audio': 'stepAudio',
      'stt': 'stepSTT',
      'translate': 'stepTranslate',
      'tts': 'stepTTS',
      'merge': 'stepMerge'
    };

    const stepId = stepMap[id];
    if (!stepId) return;

    const step = $(stepId);
    if (!step) return;

    const statusEl = step.querySelector('.step-status');

    // Reset classes
    step.className = 'progress-step';

    if (status === 'active') {
      step.classList.add('active');
      if (statusEl) statusEl.textContent = '⏳ İşleniyor...';
    } else if (status === 'done') {
      step.classList.add('done');
      if (statusEl) statusEl.textContent = '✅ Tamam';
    } else if (status === 'error') {
      step.classList.add('error');
      if (statusEl) statusEl.textContent = '❌ Hata';
    }
  },

  async startDubbing() {
    if (state.isProcessing) return;
    if (!state.videoFile) {
      this.toast('❌ Lütfen önce bir video yükleyin!', 'error');
      return;
    }

    const key = DOM.apiKey.value.trim();
    if (!key || !key.startsWith('sk_')) {
      this.toast('❌ Geçerli bir ElevenLabs API anahtarı girin!', 'error');
      DOM.apiKey.focus();
      return;
    }

    state.apiKey = key;
    state.voiceId = DOM.voiceSelect.value;
    state.sourceLang = DOM.sourceLang.value;
    state.targetLang = DOM.targetLang.value;
    state.cancelled = false;
    this.saveSettings();

    state.isProcessing = true;
    DOM.startBtn.disabled = true;
    DOM.startBtn.innerHTML = '<span class="spinner"></span> İşleniyor...';

    // Switch to progress view
    DOM.uploadSection.style.display = 'none';
    DOM.progressSection.style.display = 'block';
    DOM.resultSection.style.display = 'none';

    // Reset progress
    ['audio', 'stt', 'translate', 'tts', 'merge'].forEach(id => this.setStep(id, ''));
    DOM.progressLog.innerHTML = '<div class="log-entry log-info">⏳ Hazırlanıyor...</div>';
    DOM.progressFill.style.width = '0%';
    DOM.progressText.textContent = 'Başlatılıyor...';
    DOM.progressPercent.textContent = '0%';

    try {
      const result = await DubbingEngine.process(state.videoFile, {
        apiKey: state.apiKey,
        voiceId: state.voiceId,
        sourceLang: state.sourceLang,
        targetLang: state.targetLang
      }, {
        onLog: (msg, type) => this.log(msg, type),
        onProgress: (pct) => {
          DOM.progressFill.style.width = `${pct}%`;
          DOM.progressPercent.textContent = `${Math.round(pct)}%`;
        },
        onStep: (id, status) => this.setStep(id, status)
      });

      state.resultBlob = result.audioBlob;
      this.showResult(result);

    } catch (err) {
      if (err.message !== 'İşlem iptal edildi') {
        this.log(`❌ Dublaj başarısız: ${err.message}`, 'error');
        this.toast('❌ Dublaj başarısız oldu!', 'error');
      }

      state.isProcessing = false;
      DOM.startBtn.disabled = false;
      DOM.startBtn.innerHTML = '<span>🎬 Dublajı Başlat</span>';

      // Hata sonrası kullanıcıya seçenek sun
      setTimeout(() => {
        if (err.message !== 'İşlem iptal edildi' && confirm('❌ Hata oluştu. Tekrar denemek ister misiniz?')) {
          this.startDubbing();
        } else {
          DOM.uploadSection.style.display = 'block';
          DOM.progressSection.style.display = 'none';
        }
      }, 1000);
    }
  },

  showResult(result) {
    state.isProcessing = false;
    DOM.startBtn.disabled = false;
    DOM.startBtn.innerHTML = '<span>🎬 Dublajı Başlat</span>';

    DOM.progressSection.style.display = 'none';
    DOM.resultSection.style.display = 'block';

    DOM.progressText.textContent = 'Tamamlandı! ✅';
    DOM.progressPercent.textContent = '100%';

    // Orijinal video
    DOM.resultVideo.src = state.videoUrl;

    // Summary
    const validSegs = result.segments.filter(s => s.ttsBlob);
    DOM.rSegCount.textContent = validSegs.length;
    DOM.rLangs.textContent = `${state.sourceLang} → ${state.targetLang}`;

    const totalDur = result.segments.reduce((acc, s) => acc + (s.ttsDuration || 0), 0);
    const mins = Math.floor(totalDur / 60);
    const secs = Math.floor(totalDur % 60);
    DOM.rDuration.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;

    // Segment list
    this.renderSegments(result.segments);

    this.toast('✅ Dublaj tamamlandı!', 'success');
  },

  renderSegments(segments) {
    DOM.segmentsContainer.innerHTML = '';

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
        <div class="segment-meta">#${i+1} · ${m1}:${s1.toString().padStart(2,'0')} - ${m2}:${s2.toString().padStart(2,'0')} ${seg.ttsDuration ? `· 🎙 ${seg.ttsDuration.toFixed(1)}s` : '· ⚠️ Atlandı'}</div>
        <div class="segment-text">
          <div class="source">🗣 ${seg.text}</div>
          <div class="target">🎤 ${seg.translatedText || seg.text}</div>
        </div>
      `;
      DOM.segmentsContainer.appendChild(el);
    });
  },

  downloadResult() {
    if (!state.resultBlob) {
      this.toast('❌ İndirilecek ses dosyası yok!', 'error');
      return;
    }

    const a = document.createElement('a');
    a.href = URL.createObjectURL(state.resultBlob);
    const baseName = state.videoFile.name.replace(/\.[^.]+$/, '');
    a.download = `${baseName}_dublaj_${state.targetLang}.wav`;
    a.click();
    this.toast('⬇️ İndirme başladı!', 'success');
  },

  copyLink() {
    const url = window.location.href;
    navigator.clipboard.writeText(url)
      .then(() => this.toast('📋 Link kopyalandı!', 'success'))
      .catch(() => this.toast('❌ Link kopyalanamadı', 'error'));
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
    state.cancelled = false;

    DOM.uploadSection.style.display = 'block';
    DOM.progressSection.style.display = 'none';
    DOM.resultSection.style.display = 'none';
    DOM.videoPreview.style.display = 'none';
    DOM.startBtn.disabled = true;
    DOM.startBtn.innerHTML = '<span>🎬 Dublajı Başlat</span>';
    DOM.fileInput.value = '';

    this.toast('🔄 Sıfırlandı', 'success');
  },

  toast(message, type = 'info') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(20px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
};

// =============================================
// INIT
// =============================================
document.addEventListener('DOMContentLoaded', () => UI.init());
