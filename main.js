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
    this.canvas = document.getElementById('visualizer');
    this.canvasCtx = this.canvas.getContext('2d');

    this.init();
  }

  init() {
    this.startBtn.addEventListener('click', () => this.startCapture());
    this.recordBtn.addEventListener('click', () => this.toggleRecording());
    this.stopBtn.addEventListener('click', () => this.stopRecording());

    // Set canvas resolution
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
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

    const draw = () => {
      this.animationId = requestAnimationFrame(draw);
      this.analyser.getByteFrequencyData(dataArray);

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
    
    // 音声トラックのみを抽出してレコーダーに渡す（映像はいらない場合）
    // もし映像も録画したいなら this.stream をそのまま使う
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
      
      if (format === 'wav') {
        this.statusIndicator.querySelector('.text').textContent = 'Encoding WAV...';
        finalBlob = await this.convertToWav(webmBlob);
        extension = 'wav';
      }

      this.handleRecordingStop(finalBlob, extension);
    };

    this.mediaRecorder.start();
    
    this.recordBtn.classList.add('record-active');
    this.recordBtn.innerHTML = '<span class="record-icon"></span> 録音中...';
    this.stopBtn.disabled = false;
    this.statusIndicator.classList.add('recording');
    this.statusIndicator.querySelector('.text').textContent = 'Recording';
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
    this.recordBtn.classList.remove('record-active');
    this.recordBtn.innerHTML = '<span class="record-icon"></span> 録音開始';
    this.stopBtn.disabled = true;
    this.statusIndicator.classList.remove('recording');
    this.statusIndicator.querySelector('.text').textContent = 'Capturing...';

    const url = URL.createObjectURL(blob);
    this.addRecordingToList(url, blob.size, extension);
  }

  addRecordingToList(url, size, extension) {
    const item = document.createElement('div');
    item.className = 'recording-item';
    
    const now = new Date();
    const timeStr = now.toLocaleTimeString();
    const sizeStr = (size / 1024 / 1024).toFixed(2) + ' MB';

    item.innerHTML = `
      <div class="info">
        <span class="name">録音データ (${extension.toUpperCase()}) ${timeStr}</span>
        <span class="date">${sizeStr}</span>
      </div>
      <audio controls src="${url}"></audio>
      <a href="${url}" download="recording_${now.getTime()}.${extension}" class="btn secondary" style="padding: 0.5rem 1rem; font-size: 0.8rem;">
        保存
      </a>
    `;

    this.recordingsList.prepend(item);
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
