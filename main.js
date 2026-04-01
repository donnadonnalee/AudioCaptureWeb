/**
 * Audio Capture Pro
 * JavaScript System Audio Recording Demo
 */

class AudioRecorder {
  constructor() {
    this.stream = null;
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.audioCtx = null;
    this.analyser = null;
    this.animationId = null;

    // Elements
    this.startBtn = document.getElementById('startBtn');
    this.recordBtn = document.getElementById('recordBtn');
    this.stopBtn = document.getElementById('stopBtn');
    this.recordingControls = document.getElementById('recordingControls');
    this.statusIndicator = document.getElementById('statusIndicator');
    this.recordingsList = document.getElementById('recordingsList');
    this.formatOptions = document.getElementsByName('format');
    this.bitrateSelector = document.getElementById('bitrateSelector');
    this.mp3Bitrate = document.getElementById('mp3Bitrate');
    this.autoSplitCheckbox = document.getElementById('autoSplit');
    this.silenceDurationContainer = document.getElementById('silenceDurationContainer');
    this.silenceDurationInput = document.getElementById('silenceDuration');
    this.silenceValueLabel = document.getElementById('silenceValue');
    this.canvas = document.getElementById('visualizer');
    this.canvasCtx = this.canvas.getContext('2d');

    // State for Auto-splitting
    this.autoSplit = false;
    this.silenceDurationThreshold = 2.0;
    this.silenceStartTime = null;
    this.currentTrackHasSound = false;
    this.isAutoSplitInProgress = false;
    this.silenceVolumeThreshold = 0.015; // Noise floor threshold

    this.init();
  }

  init() {
    if (!this.checkDeviceSupport()) return;

    this.startBtn.addEventListener('click', () => this.startCapture());
    this.recordBtn.addEventListener('click', () => this.toggleRecording());
    this.stopBtn.addEventListener('click', () => this.stopRecording());

    // Format selection change
    this.formatOptions.forEach(opt => {
        opt.addEventListener('change', (e) => {
            if (e.target.value === 'mp3') {
                this.bitrateSelector.classList.remove('hidden');
            } else {
                this.bitrateSelector.classList.add('hidden');
            }
        });
    });

    // Auto split settings
    this.autoSplitCheckbox.addEventListener('change', (e) => {
        this.autoSplit = e.target.checked;
        if (this.autoSplit) {
            this.silenceDurationContainer.classList.remove('hidden');
        } else {
            this.silenceDurationContainer.classList.add('hidden');
        }
    });

    this.silenceDurationInput.addEventListener('input', (e) => {
        this.silenceDurationThreshold = parseFloat(e.target.value);
        this.silenceValueLabel.textContent = this.silenceDurationThreshold.toFixed(1);
    });

    // Set canvas resolution
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
  }

  checkDeviceSupport() {
    // 1. User Agent によるモバイル検知
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    // 2. 必要な API (getDisplayMedia) の有無を確認
    const hasDisplayMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
    
    if (isMobile || !hasDisplayMedia) {
      console.warn('This device/browser is not supported for system audio capture.');
      const warning = document.getElementById('mobileWarning');
      warning.classList.remove('hidden');
      
      // ボタンを無効化し、メッセージを更新（API未サポートの場合用）
      if (!hasDisplayMedia && !isMobile) {
        warning.querySelector('h2').textContent = 'ブラウザが未対応です';
        warning.querySelector('p').textContent = 'お使いのブラウザは画面共有（音声キャプチャ）に対応していません。最新の Chrome, Edge, Firefox 等をご利用ください。';
      }
      
      this.startBtn.disabled = true;
      return false;
    }
    return true;
  }

  resizeCanvas() {
    this.canvas.width = this.canvas.offsetWidth * window.devicePixelRatio;
    this.canvas.height = this.canvas.offsetHeight * window.devicePixelRatio;
  }

  async startCapture() {
    try {
      // 画面共有（音声込み）のリクエスト
      // getDisplayMedia を使うと、ユーザーが「システムオーディオを共有」を選択できる
      this.stream = await navigator.mediaDevices.getDisplayMedia({
        video: true, // ほとんどのブラウザで video: true が必要
        audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
        }
      });

      // 映像トラック（不要だがブラウザの仕様上必要）を取得して、停止時にストリームを止めるようにする
      const videoTrack = this.stream.getVideoTracks()[0];
      videoTrack.onended = () => this.handleStreamEnd();

      // 音声トラックがあるか確認
      const audioTracks = this.stream.getAudioTracks();
      if (audioTracks.length === 0) {
        alert('音声トラックが見つかりませんでした。共有設定で「システムオーディオを共有」にチェックを入れたか確認してください。');
        this.stopCapture();
        return;
      }

      this.setupVisualizer();
      
      this.startBtn.classList.add('hidden');
      this.recordingControls.classList.remove('hidden');
      this.statusIndicator.classList.add('capturing');
      this.statusIndicator.querySelector('.text').textContent = 'Capturing...';

    } catch (err) {
      console.error('Error starting capture:', err);
      if (err.name !== 'NotAllowedError') {
        alert('キャプチャの開始中にエラーが発生しました: ' + err.message);
      }
    }
  }

  setupVisualizer() {
    if (this.audioCtx) this.audioCtx.close();
    
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = this.audioCtx.createMediaStreamSource(this.stream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 256;
    source.connect(this.analyser);

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const dataArrayTime = new Uint8Array(this.analyser.fftSize);

    const draw = () => {
      this.animationId = requestAnimationFrame(draw);
      this.analyser.getByteFrequencyData(dataArray);

      // Silence Detection
      if (this.mediaRecorder && this.mediaRecorder.state === 'recording' && this.autoSplit) {
        this.analyser.getByteTimeDomainData(dataArrayTime);
        let maxVal = 0;
        for (let i = 0; i < dataArrayTime.length; i++) {
          const val = Math.abs(dataArrayTime[i] - 128) / 128;
          if (val > maxVal) maxVal = val;
        }

        if (maxVal > this.silenceVolumeThreshold) {
          this.currentTrackHasSound = true;
          this.silenceStartTime = null;
        } else {
          if (this.silenceStartTime === null) {
            this.silenceStartTime = Date.now();
          } else if (Date.now() - this.silenceStartTime > this.silenceDurationThreshold * 1000) {
            // Check if we already have sound in this track
            // If we don't have sound and we hit the threshold, we just reset and keep going (discarding happened in onstop)
            this.isAutoSplitInProgress = true;
            this.stopRecording();
          }
        }
      }

      const width = this.canvas.width;
      const height = this.canvas.height;
      this.canvasCtx.clearRect(0, 0, width, height);

      const barWidth = (width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = (dataArray[i] / 255) * height;

        // Gradient color based on frequency
        const hue = (i / bufferLength) * 360;
        this.canvasCtx.fillStyle = `hsla(${hue}, 80%, 60%, 0.6)`;
        
        this.canvasCtx.fillRect(x, height - barHeight, barWidth, barHeight);
        x += barWidth + 2;
      }
    };

    draw();
  }

  toggleRecording() {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      // Logic for pause if needed, but here we just toggle start/stop behavior
    } else {
      this.startRecording();
    }
  }

  startRecording() {
    this.recordedChunks = [];
    this.currentTrackHasSound = false;
    this.silenceStartTime = null;
    
    const audioStream = new MediaStream(this.stream.getAudioTracks());
    
    this.mediaRecorder = new MediaRecorder(audioStream, {
        mimeType: 'audio/webm'
    });

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.recordedChunks.push(event.data);
      }
    };

    this.mediaRecorder.onstop = async () => {
      const format = Array.from(this.formatOptions).find(opt => opt.checked).value;
      const webmBlob = new Blob(this.recordedChunks, { type: 'audio/webm' });
      
      let finalBlob = webmBlob;
      let extension = 'webm';
      
      // Handle Auto-split discard
      if (this.isAutoSplitInProgress && !this.currentTrackHasSound) {
        console.log("Discarding silent track");
      } else {
        if (format === 'wav') {
          this.statusIndicator.querySelector('.text').textContent = 'Encoding WAV...';
          finalBlob = await this.convertToWav(webmBlob);
          extension = 'wav';
        } else if (format === 'mp3') {
          const bitrate = parseInt(this.mp3Bitrate.value);
          this.statusIndicator.querySelector('.text').textContent = `Encoding MP3 (${bitrate}k)...`;
          finalBlob = await this.convertToMp3(webmBlob, bitrate);
          extension = 'mp3';
        }
        this.handleRecordingStop(finalBlob, extension);
      }

      if (this.isAutoSplitInProgress) {
        this.isAutoSplitInProgress = false;
        // Don't restart if capture ended
        if (this.stream && this.stream.active) {
            this.startRecording();
        }
      } else {
        this.resetRecordingUI();
      }
    };

    this.mediaRecorder.start();
    
    this.recordBtn.classList.add('record-active');
    this.recordBtn.innerHTML = '<span class="record-icon"></span> 録音中...';
    this.stopBtn.disabled = false;
    this.statusIndicator.classList.add('recording');
    this.statusIndicator.querySelector('.text').textContent = 'Recording';
  }

  async convertToMp3(blob, bitrate) {
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const audioBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);
      return this.audioBufferToMp3(audioBuffer, bitrate);
    } catch (e) {
      console.error('MP3 conversion failed:', e);
      alert('MP3への変換に失敗しました。WebM形式で保存します。');
      return blob;
    }
  }

  audioBufferToMp3(buffer, bitrate) {
    const channels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const mp3Encoder = new lamejs.Mp3Encoder(channels, sampleRate, bitrate);
    const mp3Data = [];

    const sampleBlockSize = 1152; // standard for MP3
    
    const left = buffer.getChannelData(0);
    const right = channels > 1 ? buffer.getChannelData(1) : left;

    // Convert float to 16bit PCM
    const convert = (f32) => {
        let s = Math.max(-1, Math.min(1, f32));
        return s < 0 ? s * 0x8000 : s * 0x7FFF;
    };

    for (let i = 0; i < left.length; i += sampleBlockSize) {
      const leftChunk = new Int16Array(sampleBlockSize);
      const rightChunk = new Int16Array(sampleBlockSize);
      for (let j = 0; j < sampleBlockSize; j++) {
        if (i + j < left.length) {
          leftChunk[j] = convert(left[i + j]);
          rightChunk[j] = convert(right[i + j]);
        }
      }
      
      let mp3buf;
      if (channels === 1) {
        mp3buf = mp3Encoder.encodeBuffer(leftChunk);
      } else {
        mp3buf = mp3Encoder.encodeBuffer(leftChunk, rightChunk);
      }
      if (mp3buf.length > 0) {
        mp3Data.push(mp3buf);
      }
    }

    const mp3buf = mp3Encoder.flush();
    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf);
    }

    return new Blob(mp3Data, { type: 'audio/mp3' });
  }

  async convertToWav(blob) {
    try {
      const arrayBuffer = await blob.arrayBuffer();
      // decodeAudioDataは録音されたWebMをPCMに変換する
      const audioBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);
      return this.audioBufferToWav(audioBuffer);
    } catch (e) {
      console.error('WAV conversion failed:', e);
      alert('WAVへの変換に失敗しました。WebM形式で保存します。');
      return blob;
    }
  }

  // AudioBufferをWAV(RIFF)形式のBlobに変換するヘルパー
  audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;
    
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    
    const dataLength = buffer.length * blockAlign;
    const bufferLength = 44 + dataLength;
    const arrayBuffer = new ArrayBuffer(bufferLength);
    const view = new DataView(arrayBuffer);
    
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    // RIFF header
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeString(8, 'WAVE');
    
    // fmt chunk
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    
    // data chunk
    writeString(36, 'data');
    view.setUint32(40, dataLength, true);
    
    // PCM samples
    const offset = 44;
    const channelData = [];
    for(let i=0; i<numChannels; i++) channelData.push(buffer.getChannelData(i));
    
    let index = 0;
    for (let i = 0; i < buffer.length; i++) {
      for (let channel = 0; channel < numChannels; channel++) {
        let sample = channelData[channel][i];
        // クリッピング防止
        sample = Math.max(-1, Math.min(1, sample));
        // 16-bit PCMに変換
        const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset + (index * 2), intSample, true);
        index++;
      }
    }
    
    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  stopRecording() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
  }

  handleRecordingStop(blob, extension) {
    const url = URL.createObjectURL(blob);
    this.addRecordingToList(url, blob.size, extension, blob);
  }

  resetRecordingUI() {
    this.recordBtn.classList.remove('record-active');
    this.recordBtn.innerHTML = '<span class="record-icon"></span> 録音開始';
    this.stopBtn.disabled = true;
    this.statusIndicator.classList.remove('recording');
    this.statusIndicator.querySelector('.text').textContent = 'Capturing...';
  }

  async addRecordingToList(url, size, extension, blob) {
    const item = document.createElement('div');
    item.className = 'recording-item';
    
    const now = new Date();
    const timeStr = now.toLocaleTimeString();
    const sizeStr = (size / 1024 / 1024).toFixed(2) + ' MB';

    item.innerHTML = `
      <div class="recording-info-row">
        <div class="info">
          <span class="name">録音データ (${extension.toUpperCase()}) ${timeStr}</span>
          <span class="date">${sizeStr}</span>
        </div>
        <a href="${url}" download="recording_${now.getTime()}.${extension}" class="btn secondary" style="padding: 0.5rem 1rem; font-size: 0.8rem;">
          保存
        </a>
      </div>
      <div class="waveform-wrapper">
        <canvas class="waveform-canvas"></canvas>
      </div>
      <div class="recording-controls-row">
        <audio controls src="${url}"></audio>
      </div>
    `;

    this.recordingsList.prepend(item);

    // 波形描画
    const canvas = item.querySelector('.waveform-canvas');
    this.renderWaveform(blob, canvas);
  }

  async renderWaveform(blob, canvas) {
    try {
      const arrayBuffer = await blob.arrayBuffer();
      // 新しい AudioContext を作るか既存のを使う
      // audioCtx が閉じている可能性があるので必要に応じて作成
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      
      this.drawWaveform(canvas, audioBuffer);
      ctx.close();
    } catch (e) {
      console.error('Waveform visualization failed:', e);
    }
  }

  drawWaveform(canvas, audioBuffer) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    
    // Resize canvas based on container
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    
    const data = audioBuffer.getChannelData(0);
    const step = Math.ceil(data.length / canvas.width);
    const amp = canvas.height / 2;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Gradient for waveform
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#00ffff'); // Primary
    gradient.addColorStop(0.5, '#6c5ce7'); // Secondary
    gradient.addColorStop(1, '#00ffff');
    
    ctx.fillStyle = gradient;
    
    for (let i = 0; i < canvas.width; i++) {
        let min = 1.0;
        let max = -1.0;
        for (let j = 0; j < step; j++) {
            const datum = data[(i * step) + j];
            if (datum < min) min = datum;
            if (datum > max) max = datum;
        }
        
        const y = (1 + min) * amp;
        const height = Math.max(1, (max - min) * amp);
        
        // Slightly rounded bars look better
        ctx.fillRect(i, y, 1, height);
    }
  }

  handleStreamEnd() {
    this.stopCapture();
  }

  stopCapture() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }

    this.startBtn.classList.remove('hidden');
    this.recordingControls.classList.add('hidden');
    this.statusIndicator.className = 'status-indicator';
    this.statusIndicator.querySelector('.text').textContent = 'Ready';
    
    if (this.canvasCtx) {
        this.canvasCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }
}

// Instantiate the app
window.addEventListener('DOMContentLoaded', () => {
  new AudioRecorder();
});
