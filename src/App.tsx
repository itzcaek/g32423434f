import { useState, useRef, useCallback, useEffect } from 'react';
import { NektoAudioClient, type AudioStatus } from './nektoAudioClient';
import { Background } from './components/Background';
import { Header } from './components/Header';
import { Glitch } from './components/Glitch';
import { Toggle } from './components/Toggle';
import { Icon } from './components/Icon';

/* ─── Types ─── */
type LogType = 'info' | 'success' | 'error' | 'warning';
interface ClientConfig {
  token: string; sex: string; searchSex: string;
  ageFrom: number; ageTo: number; searchAgeFrom: number; searchAgeTo: number;
}
type Screen = 'warning' | 'welcome' | 'token' | 'options' | 'dashboard';

/* ─── Constants ─── */
const STORAGE_KEY = 'forgotten-society-audio-config';
const AVATAR_POOL = [
  '/images/cat-link-zero.png',
  '/images/sad-cat.png',
  '/images/hackerman.png',
  '/images/pasha.png',
  '/images/okami.png',
  '/images/kvas-taras.png',
  '/images/yu.png',
  '/images/cry-of-fear.png',
];

const statusLabel: Record<AudioStatus, string> = {
  disconnected: 'Отключён', connecting: 'Подключение…', authenticating: 'Авторизация…',
  authenticated: 'Готов', searching: 'Поиск…', ringing: 'Звонок…',
  connected: '● В эфире', error: 'Ошибка',
};
const statusDot: Record<AudioStatus, string> = {
  disconnected: '#666', connecting: '#facc15', authenticating: '#facc15',
  authenticated: '#00ff88', searching: '#00ff88', ringing: '#f97316',
  connected: '#00ff88', error: '#ef4444',
};

function loadConfig(): { c1: ClientConfig; c2: ClientConfig } | null {
  try { const r = localStorage.getItem(STORAGE_KEY); if (r) return JSON.parse(r); } catch {}
  return null;
}
function saveConfig(c: { c1: ClientConfig; c2: ClientConfig }) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(c)); } catch {}
}
function getToken() {
  try { const r = localStorage.getItem(STORAGE_KEY); if (r) { const c = JSON.parse(r); return [c.c1?.token, c.c2?.token]; } } catch {}
  return null;
}
function pickAvatar(token: string): string {
  let h = 0;
  for (let i = 0; i < token.length; i++) h = (h * 31 + token.charCodeAt(i)) >>> 0;
  return AVATAR_POOL[h % AVATAR_POOL.length];
}

/* ─── StatusBadge ─── */
function StatusBadge({ status }: { status: AudioStatus }) {
  const c = statusDot[status];
  const pulse = ['connecting', 'authenticating', 'searching', 'ringing', 'connected'].includes(status);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: c, boxShadow: `0 0 8px ${c}`, animation: pulse ? 'pulseDot 1.4s infinite ease-in-out' : 'none' }} />
      <span style={{ color: c }}>{statusLabel[status]}</span>
    </span>
  );
}

/* ─── AudioVisualizer (canvas waveform under each avatar) ─── */
function AudioVisualizer({ stream, color }: { stream: MediaStream | null; color: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const acRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const draw = () => {
      animRef.current = requestAnimationFrame(draw);
      const w = canvas.width, h = canvas.height;
      ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, w, h);
      if (!analyserRef.current) {
        ctx.strokeStyle = `${color}22`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke(); return;
      }
      const a = analyserRef.current, bl = a.frequencyBinCount, d = new Uint8Array(bl);
      a.getByteTimeDomainData(d);
      ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 6;
      ctx.beginPath();
      const sw = w / bl; let x = 0;
      for (let i = 0; i < bl; i++) { const v = d[i] / 128.0, y = (v * h) / 2; i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); x += sw; }
      ctx.lineTo(w, h / 2); ctx.stroke(); ctx.shadowBlur = 0;
    };
    draw(); return () => cancelAnimationFrame(animRef.current);
  }, [color]);

  useEffect(() => {
    if (!stream) { analyserRef.current = null; return; }
    try {
      const ac = new AudioContext(), s = ac.createMediaStreamSource(stream), a = ac.createAnalyser();
      a.fftSize = 256; s.connect(a); analyserRef.current = a; acRef.current = ac;
    } catch {}
    return () => {
      analyserRef.current = null;
      const ac = acRef.current; acRef.current = null;
      if (ac) ac.close().catch(() => {});
    };
  }, [stream]);

  return <canvas ref={canvasRef} width={400} height={40} style={{ width: '100%', height: 28, borderRadius: 6, marginTop: 6 }} />;
}

/* ─── Participant card with right-click / tap context menu ─── */
function Participant({
  status,
  stream,
  avatarSrc,
  label,
  audioMuted,
  micMuted,
  lags,
  onToggleSound,
  onToggleMic,
  onToggleLags,
  onDisconnect,
  color,
}: {
  status: AudioStatus;
  stream: MediaStream | null;
  avatarSrc: string;
  label: string;
  audioMuted: boolean;
  micMuted: boolean;
  lags: boolean;
  onToggleSound: () => void;
  onToggleMic: () => void;
  onToggleLags: () => void;
  onDisconnect: () => void;
  color: string;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  /* When a new context menu is opened, the same `contextmenu` event also bubbles
     up to the window-level close handler installed below — React batches both
     state updates and `null` would win, instantly closing the menu we just
     opened. `skipCloseRef` lets the close handler ignore exactly one synthetic
     close that happens within the current event loop tick. */
  const skipCloseRef = useRef(false);
  const loaded = status === 'connected';

  useEffect(() => {
    if (!menu) return;
    const close = () => {
      if (skipCloseRef.current) return;
      setMenu(null);
    };
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
    };
  }, [menu]);

  const openMenuAt = (x: number, y: number) => {
    skipCloseRef.current = true;
    requestAnimationFrame(() => { skipCloseRef.current = false; });
    /* clamp inside viewport — menu is ~200x180px */
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = 200, h = 180;
    setMenu({ x: Math.min(x, vw - w - 8), y: Math.min(y, vh - h - 8) });
  };

  return (
    <div className={`participant ${loaded ? '' : 'disconnected'}`}>
      <div
        className={`avatar ${loaded ? 'loaded' : ''} ${stream && !audioMuted ? 'active' : ''} ${lags ? 'lags' : ''}`}
        onContextMenu={(e) => { e.preventDefault(); openMenuAt(e.clientX, e.clientY); }}
        onClick={(e) => {
          /* mobile fallback: a tap on the avatar opens the same menu */
          const isCoarse = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
          if (isCoarse) { e.stopPropagation(); openMenuAt(e.clientX, e.clientY); }
        }}
        title="ПКМ для управления"
      >
        <div className="avatar-frame">
          <img src={avatarSrc} alt="" />
        </div>
        {micMuted && <span className="mute-badge mic">🎤</span>}
        {audioMuted && <span className="mute-badge sound">🔇</span>}
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>{label}</div>
      <StatusBadge status={status} />
      <AudioVisualizer stream={stream} color={color} />

      {menu && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { onToggleMic(); setMenu(null); }}>
            🎤 {micMuted ? 'Размутить' : 'Замутить'}
          </button>
          <button onClick={() => { onToggleSound(); setMenu(null); }}>
            🔇 {audioMuted ? 'Включить звук' : 'Отключить звук'}
          </button>
          <hr />
          <button onClick={() => { onToggleLags(); setMenu(null); }}>
            {lags ? '👿 Выключить лаги' : '😈 Включить лаги'}
          </button>
          <button className="danger" onClick={() => { onDisconnect(); setMenu(null); }}>
            ⛔ Отключить
          </button>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════ */
/*  MAIN APP                                                  */
/* ═══════════════════════════════════════════════════════════ */

export default function App() {
  const saved = useRef(loadConfig());
  const [screen, setScreen] = useState<Screen>('warning');
  const [countdown, setCountdown] = useState(2.5);
  const [continueReady, setContinueReady] = useState(false);

  const [cfg1, setCfg1] = useState<ClientConfig>(saved.current?.c1 ?? { token: '', sex: 'MALE', searchSex: 'FEMALE', ageFrom: 18, ageTo: 25, searchAgeFrom: 18, searchAgeTo: 25 });
  const [cfg2, setCfg2] = useState<ClientConfig>(saved.current?.c2 ?? { token: '', sex: 'FEMALE', searchSex: 'MALE', ageFrom: 18, ageTo: 25, searchAgeFrom: 18, searchAgeTo: 25 });

  const [status1, setStatus1] = useState<AudioStatus>('disconnected');
  const [status2, setStatus2] = useState<AudioStatus>('disconnected');
  const [stream1, setStream1] = useState<MediaStream | null>(null);
  const [stream2, setStream2] = useState<MediaStream | null>(null);
  const [audio1Muted, setAudio1Muted] = useState(false);
  const [audio2Muted, setAudio2Muted] = useState(false);
  const [mic1Muted, setMic1Muted] = useState(false);
  const [mic2Muted, setMic2Muted] = useState(false);
  const [lags1, setLags1] = useState(false);
  const [lags2, setLags2] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [callDuration, setCallDuration] = useState('00:00');
  const [finalDuration, setFinalDuration] = useState('00:00');
  const [micActive, setMicActive] = useState(false);
  const [micMuted, setMicMuted] = useState(true);
  const [autoRestart, setAutoRestart] = useState(true);
  const [refind, setRefind] = useState(true);
  const [dialogEnded, setDialogEnded] = useState(false);

  const client1Ref = useRef<NektoAudioClient | null>(null);
  const client2Ref = useRef<NektoAudioClient | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recAudioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioEl1 = useRef<HTMLAudioElement | null>(null);
  const audioEl2 = useRef<HTMLAudioElement | null>(null);

  const addLog = useCallback((text: string, type: LogType = 'info') => {
    const m = `[forgotten] ${text}`;
    if (type === 'error') console.error(m);
    else if (type === 'warning') console.warn(m);
    else console.log(m);
  }, []);

  useEffect(() => { if (cfg1.token || cfg2.token) saveConfig({ c1: cfg1, c2: cfg2 }); }, [cfg1, cfg2]);

  /* ─── Warning countdown ─── */
  useEffect(() => {
    let iv: ReturnType<typeof setInterval> | null = null;
    const delay = Math.random() * 3000;
    const t = setTimeout(() => {
      let cd = 2500;
      iv = setInterval(() => {
        if (cd <= 0) { setContinueReady(true); if (iv) clearInterval(iv); iv = null; return; }
        setCountdown(Math.floor(cd / 100) / 10);
        cd -= 10;
      }, 10);
    }, delay);
    return () => { clearTimeout(t); if (iv) clearInterval(iv); };
  }, []);

  /* ─── Cleanup on unmount ─── */
  useEffect(() => () => { client1Ref.current?.disconnect(); client2Ref.current?.disconnect(); }, []);

  const startTimer = useCallback(() => {
    const s = Date.now();
    timerRef.current = setInterval(() => {
      const d = Math.floor((Date.now() - s) / 1000);
      setCallDuration(`${String(Math.floor(d / 60)).padStart(2, '0')}:${String(d % 60).padStart(2, '0')}`);
    }, 1000);
  }, []);
  const stopTimer = useCallback(() => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } setCallDuration('00:00'); }, []);

  /* ─── Recording ─── */
  const startRecording = useCallback(() => {
    try {
      const ctx = new AudioContext();
      const dest = ctx.createMediaStreamDestination();
      if (stream1) ctx.createMediaStreamSource(stream1).connect(dest);
      if (stream2) ctx.createMediaStreamSource(stream2).connect(dest);
      recAudioCtxRef.current = ctx;
      const rec = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus' });
      const chunks: BlobPart[] = [];
      rec.ondataavailable = e => chunks.push(e.data);
      rec.onstop = () => {
        const b = new Blob(chunks, { type: 'audio/webm' });
        setRecordedUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(b); });
        if (recAudioCtxRef.current) {
          recAudioCtxRef.current.close().catch(() => {});
          recAudioCtxRef.current = null;
        }
      };
      rec.start(); recorderRef.current = rec; setIsRecording(true);
      setRecordedUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
      addLog('🎙 Запись начата', 'success');
    } catch (e) { addLog(`Ошибка записи: ${e}`, 'error'); }
  }, [stream1, stream2, addLog]);
  const stopRecording = useCallback(() => {
    if (recorderRef.current) { recorderRef.current.stop(); recorderRef.current = null; }
    if (recAudioCtxRef.current) {
      recAudioCtxRef.current.close().catch(() => {});
      recAudioCtxRef.current = null;
    }
    setIsRecording(false);
    addLog('⏹ Запись остановлена', 'info');
  }, [addLog]);

  /* ─── Mic ─── */
  const enableMic = useCallback(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = s;
      client1Ref.current?.addMicSource(s); client2Ref.current?.addMicSource(s);
      client1Ref.current?.setMicMuted(true); client2Ref.current?.setMicMuted(true);
      setMicActive(true); setMicMuted(true); addLog('🎤 Микрофон подключён (замьючен)', 'success');
    } catch (e) { addLog(`Микрофон ошибка: ${e}`, 'error'); }
  }, [addLog]);

  const disableMic = useCallback(() => {
    client1Ref.current?.removeMicSource(); client2Ref.current?.removeMicSource();
    if (micStreamRef.current) { micStreamRef.current.getTracks().forEach(t => t.stop()); micStreamRef.current = null; }
    setMicActive(false); setMicMuted(true);
  }, []);

  const toggleMicMute = useCallback(() => {
    const m = !micMuted;
    client1Ref.current?.setMicMuted(m); client2Ref.current?.setMicMuted(m);
    setMicMuted(m);
    /* global mic toggle wins over per-peer mic mutes — keep displayed badges in sync */
    setMic1Muted(m); setMic2Muted(m);
    addLog(m ? '🔇 Замьючен' : '🔊 Говорю!', m ? 'warning' : 'success');
  }, [micMuted, addLog]);

  /* ─── Connect ─── */
  const connect = useCallback(() => {
    if (!cfg1.token || !cfg2.token) { addLog('Оба токена обязательны!', 'error'); return; }
    saveConfig({ c1: cfg1, c2: cfg2 }); setStream1(null); setStream2(null); stopTimer();
    setAudio1Muted(false); setAudio2Muted(false); setMic1Muted(false); setMic2Muted(false); setLags1(false); setLags2(false); client1Ref.current?.setCrossInputEnabled(true); client2Ref.current?.setCrossInputEnabled(true);
    setDialogEnded(false);
    if (audioEl1.current) audioEl1.current.muted = false;
    if (audioEl2.current) audioEl2.current.muted = false;
    client1Ref.current?.disconnect(); client2Ref.current?.disconnect();
    client1Ref.current = null; client2Ref.current = null;
    addLog('═══ Запуск Audio MITM ═══', 'success');

    const c1 = new NektoAudioClient(cfg1.token, {
      onStatusChange: setStatus1, onLog: addLog,
      onIncomingStream: s => { setStream1(s); if (!audioEl1.current) { audioEl1.current = new Audio(); audioEl1.current.autoplay = true; audioEl1.current.volume = 0.5; } audioEl1.current.srcObject = s; audioEl1.current.muted = false; },
      onConnected: () => addLog('✅ Клиент 1 подключён', 'success'),
      onDisconnected: () => {
        /* Clear per-peer toggles so the UI doesn't show stale badges
           or shake-animation on an empty avatar after the stranger hangs
           up. The track itself is already gone — these are just visuals. */
        setStream1(null);
        if (audioEl1.current) { audioEl1.current.srcObject = null; audioEl1.current.muted = false; }
        setAudio1Muted(false); setMic1Muted(false); setLags1(false);
      },
    });
    const c2 = new NektoAudioClient(cfg2.token, {
      onStatusChange: setStatus2, onLog: addLog,
      onIncomingStream: s => { setStream2(s); if (!audioEl2.current) { audioEl2.current = new Audio(); audioEl2.current.autoplay = true; audioEl2.current.volume = 0.5; } audioEl2.current.srcObject = s; audioEl2.current.muted = false; },
      onConnected: () => { addLog('✅ Клиент 2 подключён', 'success'); startTimer(); },
      onDisconnected: () => {
        setStream2(null);
        if (audioEl2.current) { audioEl2.current.srcObject = null; audioEl2.current.muted = false; }
        setAudio2Muted(false); setMic2Muted(false); setLags2(false);
        stopTimer();
      },
    });
    c1.setCrossInput(c2.outputStream); c2.setCrossInput(c1.outputStream);
    c1.setSearchParams({ sex: cfg1.sex, searchSex: cfg1.searchSex, ageFrom: cfg1.ageFrom, ageTo: cfg1.ageTo, searchAgeFrom: cfg1.searchAgeFrom, searchAgeTo: cfg1.searchAgeTo });
    c2.setSearchParams({ sex: cfg2.sex, searchSex: cfg2.searchSex, ageFrom: cfg2.ageFrom, ageTo: cfg2.ageTo, searchAgeFrom: cfg2.searchAgeFrom, searchAgeTo: cfg2.searchAgeTo });
    client1Ref.current = c1; client2Ref.current = c2;
    if (micStreamRef.current) {
      c1.addMicSource(micStreamRef.current);
      c2.addMicSource(micStreamRef.current);
      c1.setMicMuted(micMuted);
      c2.setMicMuted(micMuted);
    }
    c1.connect(); setTimeout(() => c2.connect(), 1500);
    setScreen('dashboard');
  }, [cfg1, cfg2, addLog, startTimer, stopTimer, micMuted]);

  /* ─── Disconnect / Restart ─── */
  const fullDisconnect = useCallback(() => {
    disableMic();
    client1Ref.current?.disconnect(); client2Ref.current?.disconnect();
    client1Ref.current = null; client2Ref.current = null;
    setStream1(null); setStream2(null); stopTimer();
    setAudio1Muted(false); setAudio2Muted(false); setMic1Muted(false); setMic2Muted(false); setLags1(false); setLags2(false);
    if (audioEl1.current) audioEl1.current.muted = false;
    if (audioEl2.current) audioEl2.current.muted = false;
    if (isRecording) stopRecording();
    addLog('Все отключены', 'warning');
  }, [stopTimer, isRecording, stopRecording, addLog, disableMic]);

  const endDialog = useCallback(() => {
    setFinalDuration(callDuration);
    stopTimer();
    if (isRecording) stopRecording();
    const c1 = client1Ref.current; const c2 = client2Ref.current;
    c1?.setLags(false); c2?.setLags(false);
    c1?.disconnectPeer(); c2?.disconnectPeer();
    setStream1(null); setStream2(null);
    setAudio1Muted(false); setAudio2Muted(false); setMic1Muted(false); setMic2Muted(false); setLags1(false); setLags2(false); client1Ref.current?.setCrossInputEnabled(true); client2Ref.current?.setCrossInputEnabled(true);
    if (audioEl1.current) audioEl1.current.muted = false;
    if (audioEl2.current) audioEl2.current.muted = false;
    addLog('🔌 Диалог закончен', 'warning');
    setDialogEnded(true);
  }, [stopTimer, isRecording, stopRecording, addLog, callDuration]);

  const disconnectDialogs = useCallback(() => {
    const c1 = client1Ref.current; const c2 = client2Ref.current;
    if (refind && c1?.isConnected() && c2?.isConnected()) {
      stopTimer(); if (isRecording) stopRecording();
      c1.setLags(false); c2.setLags(false);
      c1.disconnectPeer(); c2.disconnectPeer();
      setStream1(null); setStream2(null);
      setAudio1Muted(false); setAudio2Muted(false); setMic1Muted(false); setMic2Muted(false); setLags1(false); setLags2(false); client1Ref.current?.setCrossInputEnabled(true); client2Ref.current?.setCrossInputEnabled(true);
      if (audioEl1.current) audioEl1.current.muted = false;
      if (audioEl2.current) audioEl2.current.muted = false;
      addLog('🔁 Повторный поиск…', 'info');
      setTimeout(() => c1.startSearch(), 500);
      setTimeout(() => c2.startSearch(), 2000);
      return;
    }
    if (autoRestart) {
      stopTimer(); if (isRecording) stopRecording();
      c1?.setLags(false); c2?.setLags(false);
      c1?.disconnectPeer(); c2?.disconnectPeer();
      setStream1(null); setStream2(null);
      setAudio1Muted(false); setAudio2Muted(false); setMic1Muted(false); setMic2Muted(false); setLags1(false); setLags2(false); client1Ref.current?.setCrossInputEnabled(true); client2Ref.current?.setCrossInputEnabled(true);
      if (audioEl1.current) audioEl1.current.muted = false;
      if (audioEl2.current) audioEl2.current.muted = false;
      addLog('🔌 Диалоги отключены', 'warning');
      setTimeout(() => connect(), 1000);
      return;
    }
    endDialog();
  }, [stopTimer, isRecording, stopRecording, addLog, refind, autoRestart, connect, endDialog]);

  const startNewDialog = useCallback(() => {
    setDialogEnded(false);
    if (recordedUrl) { URL.revokeObjectURL(recordedUrl); setRecordedUrl(null); }
    connect();
  }, [connect, recordedUrl]);

  /* ─── Per-peer "Отключить звук": deafen the peer (track.enabled = false on
        the cross-stream we send them; matches Client.toggleSound from the
        original obfuscated client). The peer stops hearing the other side. ─── */
  const togglePeerAudio = useCallback((which: 1 | 2) => {
    const c = which === 1 ? client1Ref.current : client2Ref.current;
    if (!c) return;
    const next = !(which === 1 ? audio1Muted : audio2Muted);
    c.setCrossInputEnabled(!next);
    if (which === 1) setAudio1Muted(next); else setAudio2Muted(next);
    addLog(next ? `🔇 S${which} больше не слышит собеседника` : `🔊 S${which} снова слышит собеседника`, 'info');
  }, [addLog, audio1Muted, audio2Muted]);

  /* ─── Per-peer "Замутить" (mute MY mic going only to that side) ─── */
  const togglePeerMic = useCallback((which: 1 | 2) => {
    const c = which === 1 ? client1Ref.current : client2Ref.current;
    if (!c) return;
    const next = !(which === 1 ? mic1Muted : mic2Muted);
    c.setMicMuted(next);
    if (which === 1) setMic1Muted(next); else setMic2Muted(next);
    addLog(next ? `🎤 Мой микрофон → S${which} замьючен` : `🎤 Мой микрофон → S${which} размьючен`, 'info');
  }, [addLog, mic1Muted, mic2Muted]);

  /* ─── Per-peer "Включить лаги" (random gain oscillation on outgoing track) ─── */
  const togglePeerLags = useCallback((which: 1 | 2) => {
    const c = which === 1 ? client1Ref.current : client2Ref.current;
    if (!c) return;
    const next = !(which === 1 ? lags1 : lags2);
    c.setLags(next);
    if (which === 1) setLags1(next); else setLags2(next);
    addLog(next ? `😈 Лаги → S${which} включены` : `👿 Лаги → S${which} выключены`, 'warning');
  }, [addLog, lags1, lags2]);

  const disconnectPeer = useCallback((which: 1 | 2) => {
    const c = which === 1 ? client1Ref.current : client2Ref.current;
    c?.setLags(false);
    c?.setCrossInputEnabled(true);
    c?.disconnectPeer();
    if (which === 1) {
      setStream1(null); setAudio1Muted(false); setMic1Muted(false); setLags1(false);
      if (audioEl1.current) audioEl1.current.muted = false;
    } else {
      setStream2(null); setAudio2Muted(false); setMic2Muted(false); setLags2(false);
      if (audioEl2.current) audioEl2.current.muted = false;
    }
    addLog(`🔌 Собеседник ${which} отключён`, 'warning');
  }, [addLog]);

  /* ─── Derived state ─── */
  const isActive = status1 !== 'disconnected' && status1 !== 'error';
  const bothConnected = status1 === 'connected' && status2 === 'connected';
  const t1valid = cfg1.token.length === 36;
  const t2valid = cfg2.token.length === 36;
  const tokensValid = t1valid && t2valid && cfg1.token !== cfg2.token;

  /* ─── Auto-reconnect on load ─── */
  useEffect(() => {
    try {
      if (localStorage.getItem('forgotten-society-auto') === 'true') {
        localStorage.removeItem('forgotten-society-auto');
        const sc = loadConfig();
        if (sc?.c1.token && sc?.c2.token) { setScreen('dashboard'); setTimeout(() => connect(), 500); }
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app-root">
      <Background />
      <Header />

      {/* ═══ WARNING SCREEN ═══ */}
      {screen === 'warning' && (
        <div className="card-screen error">
          <div className="heading-wrap">
            <Glitch text="ВНИМАНИЕ" variant="error" size={28} />
          </div>
          <p className="subtitle" style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)' }}>
            Это приложение предназначено исключительно для образовательных целей.<br />
            Использование без согласия сторон является незаконным.
          </p>
          <p className="subtitle" style={{ marginTop: 14, fontSize: 12 }}>
            <span className="muted">Подписывайтесь на телеграм-канал, чтобы следить за разработкой:</span><br />
            <a className="btn-link telegram" href="#" onClick={(e) => e.preventDefault()}>@forgotten_bio</a>
          </p>
          <div className="countdown-bar" style={{ ['--p' as never]: continueReady ? 1 : 1 - countdown / 2.5 }}>
            <button
              onClick={() => {
                const t = getToken();
                const has = !!(t && t[0] && t[1]);
                setScreen(has ? 'options' : 'welcome');
              }}
              disabled={!continueReady}
              className="btn-link btn-success"
              style={{ background: continueReady ? undefined : 'transparent', color: continueReady ? undefined : 'rgba(255,255,255,0.6)' }}
            >
              {continueReady ? 'Продолжить' : `${countdown.toFixed(2)} с.`}
            </button>
          </div>
        </div>
      )}

      {/* ═══ WELCOME SCREEN ═══ */}
      {screen === 'welcome' && (
        <div className="card-screen">
          <div className="icon">
            <img src="/images/dark-triad.png" alt="The Dark Triad" />
          </div>
          <div className="heading-wrap">
            <Glitch text="FORGOTTEN" />
          </div>
          <p className="subtitle">
            <span className="accent">Анонимный аудио MITM</span> для голосового чата nekto.me<br />
            <span className="muted">Stranger 1 ⟷ Client 1 ⟷ Вы ⟷ Client 2 ⟷ Stranger 2</span>
          </p>
          <div style={{ marginTop: 30, display: 'grid', gap: 8 }}>
            <button onClick={() => setScreen('token')} className="btn-link btn-success">Начать</button>
          </div>
        </div>
      )}

      {/* ═══ TOKEN SCREEN ═══ */}
      {screen === 'token' && (
        <div className="card-screen">
          <div className="heading-wrap">
            <Glitch text="ТОКЕНЫ" size={28} />
          </div>
          <p className="subtitle" style={{ marginBottom: 20, fontSize: 13 }}>
            <span className="muted">Введите два UUID-токена из nekto.me/audiochat</span>
          </p>
          <div style={{ marginBottom: 14 }}>
            <label className="field-label">Токен 1 (Leader)</label>
            <input
              className="input-field"
              value={cfg1.token}
              onChange={e => setCfg1({ ...cfg1, token: e.target.value })}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              style={{ borderColor: cfg1.token ? (t1valid ? 'rgba(0,255,136,0.4)' : 'rgba(239,68,68,0.4)') : undefined }}
            />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label className="field-label">Токен 2 (Follower)</label>
            <input
              className="input-field"
              value={cfg2.token}
              onChange={e => setCfg2({ ...cfg2, token: e.target.value })}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              style={{ borderColor: cfg2.token ? (t2valid ? 'rgba(0,255,136,0.4)' : 'rgba(239,68,68,0.4)') : undefined }}
            />
          </div>
          {cfg1.token && cfg2.token && cfg1.token === cfg2.token && (
            <div style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '8px 12px', marginBottom: 15, fontSize: 12, color: '#ef4444' }}>
              ⚠️ Токены должны быть разными
            </div>
          )}
          <div style={{ display: 'grid', gap: 8 }}>
            <button onClick={() => setScreen('options')} disabled={!tokensValid} className="btn-link btn-success">
              Сохранить и продолжить
            </button>
            <button onClick={() => setScreen('welcome')} className="btn-link" style={{ background: 'transparent', color: 'rgba(255,255,255,0.5)' }}>
              ← Назад
            </button>
          </div>
        </div>
      )}

      {/* ═══ OPTIONS SCREEN ═══ */}
      {screen === 'options' && (
        <div className="card-screen">
          <div className="icon">
            <img src="/images/icon-nekto.svg" alt="" style={{ width: 80, height: 80, opacity: 0.85 }} />
          </div>
          <div className="heading-wrap">
            <Glitch text="НАСТРОЙКИ" size={28} />
          </div>
          <p className="subtitle" style={{ marginBottom: 16, fontSize: 13 }}>
            <span className="muted">Настройте параметры поиска для каждого клиента</span>
          </p>
          <div className="options-panel">
            <div className="client-options">
              <h3>КЛИЕНТ 1</h3>
              <label className="field-label">Пол</label>
              <select value={cfg1.sex} onChange={e => setCfg1({ ...cfg1, sex: e.target.value })}>
                <option value="MALE">Мужской</option>
                <option value="FEMALE">Женский</option>
              </select>
              <label className="field-label">Ищу пол</label>
              <select value={cfg1.searchSex} onChange={e => setCfg1({ ...cfg1, searchSex: e.target.value })}>
                <option value="FEMALE">Женский</option>
                <option value="MALE">Мужской</option>
                <option value="">Любой</option>
              </select>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label className="field-label">От</label>
                  <input className="input-field" type="number" min={0} max={99} value={cfg1.ageFrom} onChange={e => setCfg1({ ...cfg1, ageFrom: +e.target.value })} />
                </div>
                <div>
                  <label className="field-label">До</label>
                  <input className="input-field" type="number" min={0} max={99} value={cfg1.ageTo} onChange={e => setCfg1({ ...cfg1, ageTo: +e.target.value })} />
                </div>
              </div>
            </div>
            <div className="client-options">
              <h3>КЛИЕНТ 2</h3>
              <label className="field-label">Пол</label>
              <select value={cfg2.sex} onChange={e => setCfg2({ ...cfg2, sex: e.target.value })}>
                <option value="MALE">Мужской</option>
                <option value="FEMALE">Женский</option>
              </select>
              <label className="field-label">Ищу пол</label>
              <select value={cfg2.searchSex} onChange={e => setCfg2({ ...cfg2, searchSex: e.target.value })}>
                <option value="FEMALE">Женский</option>
                <option value="MALE">Мужской</option>
                <option value="">Любой</option>
              </select>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label className="field-label">От</label>
                  <input className="input-field" type="number" min={0} max={99} value={cfg2.ageFrom} onChange={e => setCfg2({ ...cfg2, ageFrom: +e.target.value })} />
                </div>
                <div>
                  <label className="field-label">До</label>
                  <input className="input-field" type="number" min={0} max={99} value={cfg2.ageTo} onChange={e => setCfg2({ ...cfg2, ageTo: +e.target.value })} />
                </div>
              </div>
            </div>
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            <button onClick={connect} className="btn-link btn-success">
              НАЧАТЬ ПОИСК 🔍
            </button>
            <button onClick={() => setScreen('token')} className="btn-link btn-warning">
              ИЗМЕНИТЬ ТОКЕНЫ 🖉
            </button>
          </div>
        </div>
      )}

      {/* ═══ DASHBOARD SCREEN ═══ */}
      {screen === 'dashboard' && !dialogEnded && (
        <div className="card-screen">
          <div className="heading-wrap">
            <Glitch text="FORGOTTEN" size={32} />
          </div>
          <p className="subtitle" style={{ marginTop: 8, marginBottom: 16, fontSize: 12 }}>
            <span className="muted">Подсказка: нажмите ПКМ на иконку собеседника, чтобы управлять им. Для телефонов — просто нажмите на иконку.</span>
          </p>

          <div style={{ marginBottom: 12 }}>
            <Toggle checked={refind} onChange={setRefind} label="Искать всегда новый разговор" />
            <Toggle checked={autoRestart} onChange={setAutoRestart} label="При отключении, искать нового собеседника" />
          </div>

          <div className="time">{callDuration}</div>

          <div className="call-header">
            <Participant
              status={status1}
              stream={stream1}
              avatarSrc={pickAvatar(cfg1.token)}
              label="Stranger 1"
              audioMuted={audio1Muted}
              micMuted={mic1Muted}
              lags={lags1}
              onToggleSound={() => togglePeerAudio(1)}
              onToggleMic={() => togglePeerMic(1)}
              onToggleLags={() => togglePeerLags(1)}
              onDisconnect={() => disconnectPeer(1)}
              color="#00ff88"
            />
            <Participant
              status={status2}
              stream={stream2}
              avatarSrc={pickAvatar(cfg2.token)}
              label="Stranger 2"
              audioMuted={audio2Muted}
              micMuted={mic2Muted}
              lags={lags2}
              onToggleSound={() => togglePeerAudio(2)}
              onToggleMic={() => togglePeerMic(2)}
              onToggleLags={() => togglePeerLags(2)}
              onDisconnect={() => disconnectPeer(2)}
              color="#a855f7"
            />
          </div>

          <div className="controls">
            {!micActive ? (
              <button onClick={enableMic} className="mute-btn" title="Включить микрофон">
                <Icon name="mic" size={28} />
              </button>
            ) : (
              <button
                onClick={toggleMicMute}
                className={`mute-btn ${micMuted ? 'muted' : ''}`}
                title={micMuted ? 'Включить микрофон' : 'Замьютить'}
              >
                <Icon name={micMuted ? 'mic-mute' : 'mic'} size={28} />
              </button>
            )}
            <button
              onClick={disconnectDialogs}
              disabled={!isActive}
              className="back-btn"
              title="Сбросить диалоги"
            >
              <Icon name="phone" size={26} />
            </button>
          </div>

          {bothConnected && (
            <div style={{ marginTop: 18, background: 'rgba(0,255,136,0.06)', border: '1px solid rgba(0,255,136,0.18)', borderRadius: 8, padding: 12, textAlign: 'center', fontSize: 12 }}>
              <span style={{ color: '#00ff88', fontWeight: 700 }}>🎯 MITM Активен</span>
              <span style={{ color: 'rgba(255,255,255,0.5)' }}> · S1 ⟷ S2</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 14, flexWrap: 'wrap' }}>
            {!isRecording ? (
              <button onClick={startRecording} disabled={!bothConnected} className="btn-link" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', maxWidth: 160 }}>💾 Записать</button>
            ) : (
              <button onClick={stopRecording} className="btn-link btn-danger" style={{ maxWidth: 160 }}>⏹ Стоп запись</button>
            )}
            <button onClick={() => { fullDisconnect(); setScreen('options'); }} className="btn-link" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', maxWidth: 160 }}>⏹ Выйти</button>
          </div>
        </div>
      )}

      {/* ═══ DIALOG ENDED ═══ */}
      {screen === 'dashboard' && dialogEnded && (
        <div className="card-screen ended-screen">
          <img className="hackerman" src="/images/hackerman.png" alt="" />
          <div className="heading-wrap">
            <Glitch text="ДИАЛОГ ЗАКОНЧЕН" size={26} />
          </div>
          <p className="subtitle" style={{ marginTop: 6 }}>
            <span className="muted">Длительность: {finalDuration === '00:00' ? '—' : finalDuration}</span>
          </p>
          <div className="ended-actions">
            <a
              href={recordedUrl ?? undefined}
              download={recordedUrl ? `mitm-${Date.now()}.webm` : undefined}
              onClick={e => { if (!recordedUrl) e.preventDefault(); }}
              className={`btn-link btn-success ${!recordedUrl ? 'disabled' : ''}`}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: recordedUrl ? 1 : 0.45, cursor: recordedUrl ? 'pointer' : 'not-allowed' }}
            >
              <Icon name="download" size={18} />
              {recordedUrl ? 'Скачать запись' : 'Запись не велась'}
            </a>
            <button onClick={startNewDialog} className="btn-link btn-warning" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <Icon name="refresh" size={18} />
              Новый диалог
            </button>
            <button onClick={() => { fullDisconnect(); setDialogEnded(false); setScreen('options'); }} className="btn-link" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>
              ⏹ К настройкам
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
