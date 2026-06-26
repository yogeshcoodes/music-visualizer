// ================================================
// PREMIUM AUDIO VISUALIZER — DARK MATERIAL YOU
// ================================================

let audioCtx, analyser, source, mediaDest;
const audioEl = document.getElementById('main-audio');

const playPauseBtn = document.getElementById('play-pause-btn');
const iconPlay = document.getElementById('icon-play');
const iconPause = document.getElementById('icon-pause');
const seekBar = document.getElementById('seek-bar');
const currentTimeEl = document.getElementById('current-time');
const durationEl = document.getElementById('duration');

let frequencyData, timeDomainData;
let isRecording = false;
let mediaRecorder;
let recordedChunks = [];
let hasUserInteracted = false;

// ---------- Audio engine ----------
function initAudio() {
    if (audioCtx) return;
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        analyser.smoothingTimeConstant = 0.85;
        analyser.fftSize = 2048;

        source = audioCtx.createMediaElementSource(audioEl);
        mediaDest = audioCtx.createMediaStreamDestination();

        source.connect(analyser);
        analyser.connect(audioCtx.destination);
        analyser.connect(mediaDest);

        frequencyData = new Uint8Array(analyser.frequencyBinCount);
        timeDomainData = new Uint8Array(analyser.frequencyBinCount);

        processAudio();
    } catch (err) {
        console.warn('Audio init failed — may need user gesture first:', err);
    }
}

function processAudio() {
    requestAnimationFrame(processAudio);
    if (!analyser) return;
    analyser.getByteFrequencyData(frequencyData);
    analyser.getByteTimeDomainData(timeDomainData);
}

// Expose data to iframe patterns
window.getVisualizerData = () => {
    return { frequencyData, timeDomainData };
};

// ---------- Helpers ----------
const formatTime = (time) => {
    if (isNaN(time) || !isFinite(time)) return '0:00';
    const mins = Math.floor(time / 60) || 0;
    const secs = Math.floor(time % 60) || 0;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};

const updatePlayState = (playing) => {
    if (playing) {
        iconPlay.classList.add('hidden');
        iconPause.classList.remove('hidden');
    } else {
        iconPlay.classList.remove('hidden');
        iconPause.classList.add('hidden');
    }
};

// ---------- Play / Pause ----------
playPauseBtn.addEventListener('click', () => {
    hasUserInteracted = true;
    initAudio();
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    if (audioEl.paused) {
        audioEl.play().then(() => updatePlayState(true)).catch(() => {});
    } else {
        audioEl.pause();
        updatePlayState(false);
    }
});

// ---------- Time & Seek ----------
audioEl.addEventListener('timeupdate', () => {
    currentTimeEl.textContent = formatTime(audioEl.currentTime);
    if (!isNaN(audioEl.duration) && isFinite(audioEl.duration)) {
        seekBar.value = (audioEl.currentTime / audioEl.duration) * 100;
    }

    if (isRecording && audioEl.duration) {
        const percent = Math.min(((audioEl.currentTime / audioEl.duration) * 100), 100).toFixed(1);
        document.getElementById('progress-bar').style.width = `${percent}%`;
        document.getElementById('progress-text').textContent = `${percent}%`;
    }
});

audioEl.addEventListener('loadedmetadata', () => {
    durationEl.textContent = formatTime(audioEl.duration);
});

audioEl.addEventListener('play', () => updatePlayState(true));
audioEl.addEventListener('pause', () => updatePlayState(false));
audioEl.addEventListener('ended', () => {
    updatePlayState(false);
    if (isRecording && mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
});

seekBar.addEventListener('input', () => {
    if (audioEl.duration && isFinite(audioEl.duration)) {
        audioEl.currentTime = (seekBar.value / 100) * audioEl.duration;
    }
});

// ---------- File upload ----------
document.getElementById('audio-upload').addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (!file) return;

    hasUserInteracted = true;
    const url = URL.createObjectURL(file);
    audioEl.src = url;
    initAudio();

    audioEl.play().then(() => {
        updatePlayState(true);
    }).catch(() => {
        updatePlayState(false);
    });
});

// ---------- UI: pattern & aspect ratio ----------
const iframe = document.getElementById('pattern-frame');
const wrapper = document.getElementById('wrapper');

document.getElementById('pattern-select').addEventListener('change', (e) => {
    iframe.src = e.target.value;
});

document.getElementById('aspect-ratio').addEventListener('change', (e) => {
    wrapper.className = `canvas-wrapper aspect-${e.target.value.replace(':', '-')}`;
});

// ---------- Recording ----------
const recordBtn = document.getElementById('record-btn');
const cancelRecordBtn = document.getElementById('cancel-record-btn');
const overlay = document.getElementById('recording-overlay');

recordBtn.addEventListener('click', () => {
    hasUserInteracted = true;
    initAudio();

    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    try {
        const frameDoc = iframe.contentDocument || iframe.contentWindow.document;
        const frameCanvas = frameDoc.querySelector('canvas');
        if (!frameCanvas) throw new Error('Canvas not found inside pattern iframe.');

        const canvasStream = frameCanvas.captureStream(60);
        const combinedStream = new MediaStream([
            ...canvasStream.getVideoTracks(),
            ...mediaDest.stream.getAudioTracks()
        ]);

        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
            ? 'video/webm;codecs=vp9'
            : 'video/webm';

        mediaRecorder = new MediaRecorder(combinedStream, { mimeType });
        recordedChunks = [];

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) recordedChunks.push(e.data);
        };

        mediaRecorder.onstop = () => {
            if (!isRecording) return;
            const blob = new Blob(recordedChunks, { type: mimeType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Visualizer-${Date.now()}.webm`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            stopRecordingUI();
        };

        mediaRecorder.onerror = () => {
            alert('Recording error — please try again.');
            stopRecordingUI();
        };

        audioEl.currentTime = 0;
        audioEl.play().then(() => {
            updatePlayState(true);
        }).catch(() => {});

        mediaRecorder.start(1000);
        isRecording = true;

        overlay.classList.remove('hidden');
        document.getElementById('progress-bar').style.width = '0%';
        document.getElementById('progress-text').textContent = '0%';

    } catch (e) {
        alert('Recording unavailable.\nRun via local server (Live Server / localhost) to record video.\n\n' + e.message);
        console.error(e);
    }
});

cancelRecordBtn.addEventListener('click', () => {
    if (isRecording) {
        isRecording = false;
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
        }
        audioEl.pause();
        updatePlayState(false);
        stopRecordingUI();
    }
});

function stopRecordingUI() {
    isRecording = false;
    overlay.classList.add('hidden');
    updatePlayState(false);
}

// ---------- Responsive sidebar toggle ----------
const sidebar = document.getElementById('sidebar');
const toggleBtn = document.getElementById('sidebar-toggle');

toggleBtn.addEventListener('click', () => {
    sidebar.classList.toggle('open');
});

// Close sidebar when clicking on the visualizer area (mobile only)
document.querySelector('.visualizer-container').addEventListener('click', (e) => {
    if (window.innerWidth <= 960 && sidebar.classList.contains('open')) {
        if (!e.target.closest('.sidebar-toggle') && !e.target.closest('.sidebar')) {
            sidebar.classList.remove('open');
        }
    }
});

// Close sidebar with Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.classList.contains('open')) {
        sidebar.classList.remove('open');
    }
});