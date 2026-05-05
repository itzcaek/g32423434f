/**
 * Raw WebSocket client for nekto.me audio chat
 * Handles Socket.IO framing manually without socket.io-client library
 */

export type AudioStatus =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'authenticated'
  | 'searching'
  | 'ringing'
  | 'connected'
  | 'error';

export interface AudioSearchParams {
  sex: string;
  searchSex: string;
  ageFrom: number;
  ageTo: number;
  searchAgeFrom: number;
  searchAgeTo: number;
}

export interface AudioClientCallbacks {
  onStatusChange: (status: AudioStatus) => void;
  onLog: (msg: string, type: 'info' | 'success' | 'error' | 'warning') => void;
  onIncomingStream: (stream: MediaStream) => void;
  onConnected: () => void;
  onDisconnected: () => void;
}

/**
 * Socket.IO over WebSocket framing:
 * 0{json} = Engine.IO OPEN
 * 2       = Engine.IO PING
 * 3       = Engine.IO PONG
 * 40      = Socket.IO CONNECT
 * 42[arr] = Socket.IO EVENT → 42["event_name", data]
 * 43[ack] = Socket.IO ACK
 */
export class NektoAudioClient {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private audioContext: AudioContext;
  private gainNode: GainNode;
  private outputDestination: MediaStreamAudioDestinationNode;
  public userId: string;
  public connectionId: string | null = null;
  public status: AudioStatus = 'disconnected';
  private crossInputStream: MediaStream | null = null;
  private searchParams: AudioSearchParams | null = null;
  private callbacks: AudioClientCallbacks;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micGain: GainNode | null = null;

  constructor(userId: string, callbacks: AudioClientCallbacks) {
    this.userId = userId;
    this.callbacks = callbacks;
    this.audioContext = new AudioContext();
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = 1.0;
    this.outputDestination = this.audioContext.createMediaStreamDestination();
    this.gainNode.connect(this.outputDestination);
  }

  get outputStream(): MediaStream {
    return this.outputDestination.stream;
  }

  private setStatus(s: AudioStatus) {
    this.status = s;
    this.callbacks.onStatusChange(s);
  }

  private log(msg: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') {
    this.callbacks.onLog(`[${this.userId.slice(0, 8)}] ${msg}`, type);
  }

  setCrossInput(stream: MediaStream) {
    this.crossInputStream = stream;
  }

  setSearchParams(params: AudioSearchParams) {
    this.searchParams = params;
  }

  connect() {
    this.setStatus('connecting');

    // Connect to local proxy via raw WebSocket
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const proxyUrl = `${wsProto}//${window.location.host}/audio-ws?token=${encodeURIComponent(this.userId)}`;

    this.log(`Подключение через прокси…`);
    this.ws = new WebSocket(proxyUrl);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.log('WebSocket открыт', 'success');
      this.setStatus('authenticating');
    };

    this.ws.onmessage = (event) => {
      const msg = typeof event.data === 'string' ? event.data : '';
      if (!msg) return;
      this.handleRawMessage(msg);
    };

    this.ws.onclose = (event) => {
      this.log(`WebSocket закрыт: code=${event.code} reason=${event.reason}`, 'warning');
      this.cleanup();
    };

    this.ws.onerror = () => {
      this.log('WebSocket ошибка! Прокси запущен? (node proxy.mjs)', 'error');
      this.setStatus('error');
    };
  }

  /**
   * Parse raw Socket.IO / Engine.IO messages
   */
  private handleRawMessage(msg: string) {
    // Engine.IO OPEN: 0{json}
    if (msg.startsWith('0')) {
      const jsonStr = msg.slice(1);
      try {
        const handshake = JSON.parse(jsonStr);
        this.log(`Engine.IO open: pingInterval=${handshake.pingInterval} pingTimeout=${handshake.pingTimeout}`);
      } catch {}
      // Send Socket.IO CONNECT
      this.sendRaw('40');
      this.log('→ Socket.IO connect');
      return;
    }

    // Engine.IO PING from server (v3): "2"
    if (msg === '2') {
      this.sendRaw('3'); // PONG
      this.log('💓 Engine.IO ping → pong');
      return;
    }

    // Engine.IO PONG from server (v4): "3"
    if (msg === '3') {
      this.log('💓 Pong received');
      return;
    }

    // Socket.IO messages start with '4'
    if (msg.startsWith('4')) {
      const suffix = msg.slice(1);

      // Socket.IO CONNECT ACK: "40"
      if (suffix === '0' || suffix.startsWith('0')) {
        this.log('Socket.IO подключён', 'success');
        // Now send register
        this.sendRegister();
        return;
      }

      // Socket.IO EVENT: "42["event_name", data]"
      if (suffix.startsWith('2')) {
        try {
          const arr = JSON.parse(suffix.slice(1));
          const eventName = arr[0];
          const eventData = arr[1];
          if (eventName === 'event') {
            this.handleEvent(eventData);
          }
        } catch (e) {
          this.log(`Parse error: ${e}`, 'error');
        }
        return;
      }

      // Other Socket.IO packets
      this.log(`Socket.IO packet: 4${suffix.slice(0, 20)}`);
    }
  }

  /**
   * Send Socket.IO event via raw WebSocket
   * Format: 42["event_name", data]
   */
  private emit(eventName: string, data: any) {
    const packet = `42${JSON.stringify([eventName, data])}`;
    this.sendRaw(packet);
  }

  private sendRaw(data: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  private sendRegister() {
    this.log('→ register');
    this.emit('event', {
      type: 'register',
      android: false,
      version: 21,
      userId: this.userId,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow',
      locale: 'ru',
    });
  }

  private async handleEvent(data: any) {
    if (!data || typeof data !== 'object') {
      this.log(`Invalid event payload: ${JSON.stringify(data)}`, 'warning');
      return;
    }
    const type = data.type;
    const extra: string[] = [];
    if (data.initiator !== undefined) extra.push(`initiator=${data.initiator}`);
    if (data.connectionId) extra.push(`conn=${(data.connectionId as string).slice(0, 8)}`);
    this.log(`← ${type}${extra.length ? ' ' + extra.join(' ') : ''}`);

    switch (type) {
      case 'registered': {
        const internalId = data.internal_id;
        this.log(`Зарегистрирован (internal_id=${internalId})`, 'success');
        const webAgent = await this.generateWebAgent(internalId);
        this.log(`→ web-agent`);
        this.emit('event', { type: 'web-agent', data: webAgent });
        if (this.searchParams) {
          this.startSearch();
        } else {
          this.setStatus('authenticated');
        }
        break;
      }
      case 'users-count': {
        this.log(`Онлайн: ${JSON.stringify(data.count ?? '...')}`);
        break;
      }
      case 'search.success': {
        this.log('Поиск начат, ожидание собеседника…', 'success');
        this.setStatus('searching');
        break;
      }
      case 'peer-connect': {
        this.connectionId = data.connectionId;
        this.log(`peer-connect! conn=${this.connectionId}`, 'success');
        const turnConfig = this.parseTurnParams(data.turnParams);
        this.setupPeerConnection(turnConfig, data.initiator);
        break;
      }
      case 'offer': {
        this.log('← SDP Offer');
        await this.handleOffer(data.offer);
        break;
      }
      case 'answer': {
        this.log('← SDP Answer');
        await this.handleAnswer(data.answer);
        break;
      }
      case 'ice-candidate': {
        await this.handleIceCandidate(data.candidate);
        break;
      }
      case 'peer-connection': {
        this.log('WebRTC подтверждено', 'success');
        break;
      }
      case 'stream-received': {
        this.log('Аудиопоток получен');
        break;
      }
      case 'peer-mute': {
        this.log(`Mute: ${data.muted}`);
        break;
      }
      case 'peer-disconnect': {
        this.log('Собеседник отключился', 'warning');
        this.callbacks.onDisconnected();
        this.cleanup();
        break;
      }
      case 'stop-scan': {
        this.log('Поиск остановлен', 'warning');
        this.setStatus('authenticated');
        this.callbacks.onDisconnected();
        break;
      }
      case 'error': {
        this.log(`Ошибка: ${data.description || data.id || JSON.stringify(data)}`, 'error');
        break;
      }
      case 'ban': {
        this.log(`ЗАБАНЕН: ${JSON.stringify(data.banInfo)}`, 'error');
        this.setStatus('error');
        break;
      }
      default: {
        this.log(`Событие: ${type}`);
      }
    }
  }

  private async generateWebAgent(internalId: string): Promise<string> {
    const payload = this.userId + 'BYdKPTYYGZ7ALwA' + '8oNm2' + String(internalId);
    const encoded = new TextEncoder().encode(payload);
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
    const hexHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return btoa(hexHash);
  }

  startSearch() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.searchParams) return;
    this.setStatus('searching');
    const p = this.searchParams;
    this.emit('event', {
      type: 'scan-for-peer',
      peerToPeer: true,
      token: null,
      searchCriteria: {
        group: 0,
        userSex: p.sex || 'ANY',
        peerSex: p.searchSex || 'ANY',
        userAge: { from: p.ageFrom, to: p.ageTo },
        peerAges: [{ from: p.searchAgeFrom, to: p.searchAgeTo }],
      },
    });
    this.log(`→ scan-for-peer (${p.sex}→${p.searchSex})`);
  }

  stopSearch() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.log('→ stop-scan');
      this.emit('event', { type: 'stop-scan' });
    }
  }

  private parseTurnParams(turnParams: unknown): RTCConfiguration {
    try {
      const parsed = typeof turnParams === 'string' ? JSON.parse(turnParams) : turnParams;
      const iceServers: RTCIceServer[] = [];
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (entry.url && !entry.url.startsWith('turn:[')) {
            iceServers.push({
              urls: entry.url,
              username: entry.username || '',
              credential: entry.credential || ''
            });
          }
        }
      }
      return { iceServers };
    } catch {
      return { iceServers: [] };
    }
  }

  private setupPeerConnection(config: RTCConfiguration, initiator: boolean) {
    this.pc = new RTCPeerConnection({
      ...config,
      iceServers: config.iceServers?.length ? config.iceServers : [
        { urls: 'stun:stun-bvp.nekto.me' },
        { urls: 'stun:stun-vky.nekto.me' },
        { urls: 'stun:stun-fvs.nekto.me' },
      ],
    });
    this.setStatus('ringing');

    this.pc.ontrack = (event) => {
      this.log('Получен аудиотрек!', 'success');
      try {
        const source = this.audioContext.createMediaStreamSource(event.streams[0]);
        source.connect(this.gainNode);
      } catch (e) {
        this.log(`Audio route error: ${e}`, 'error');
      }
      this.emit('event', { type: 'stream-received', connectionId: this.connectionId });
      this.callbacks.onIncomingStream(event.streams[0]);
    };

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.emit('event', {
          type: 'ice-candidate',
          candidate: JSON.stringify({
            candidate: {
              candidate: event.candidate.candidate,
              sdpMid: event.candidate.sdpMid ?? 0,
              sdpMLineIndex: event.candidate.sdpMLineIndex ?? 0,
            },
          }),
          connectionId: this.connectionId,
        });
      }
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc!.connectionState;
      this.log(`WebRTC: ${state}`);
      if (state === 'connected') {
        this.emit('event', {
          type: 'peer-connection',
          connectionId: this.connectionId,
          connection: true
        });
        this.setStatus('connected');
        this.callbacks.onConnected();
      } else if (state === 'failed' || state === 'closed') {
        this.log(`WebRTC ${state}`, 'error');
        this.callbacks.onDisconnected();
        this.cleanup();
      }
    };

    if (initiator) {
      this.log('Я инициатор — создаю Offer');
      const inputStream = this.crossInputStream || this.createSilentStream();
      const audioTracks = inputStream.getAudioTracks();
      if (audioTracks.length > 0) {
        this.pc.addTrack(audioTracks[0], inputStream);
        this.log('Кросс-трек добавлен');
      }
      this.pc.createOffer()
        .then((offer) => this.pc!.setLocalDescription(offer))
        .then(() => {
          const ld = this.pc!.localDescription!;
          this.emit('event', {
            type: 'offer',
            offer: JSON.stringify({ sdp: ld.sdp, type: ld.type }),
            connectionId: this.connectionId
          });
          this.emit('event', {
            type: 'peer-mute',
            connectionId: this.connectionId,
            muted: false
          });
          this.log('→ Offer отправлен');
        })
        .catch((e) => this.log(`Offer error: ${e}`, 'error'));
    }
  }

  private async handleOffer(offerStr: string) {
    if (!this.pc) return this.log('No PC for offer!', 'error');
    try {
      const offer = JSON.parse(offerStr);
      await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
      const inputStream = this.crossInputStream || this.createSilentStream();
      const audioTracks = inputStream.getAudioTracks();
      if (audioTracks.length > 0) {
        this.pc.addTrack(audioTracks[0], inputStream);
        this.log('Кросс-трек (answerer)');
      }
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.emit('event', {
        type: 'answer',
        answer: JSON.stringify({ sdp: answer.sdp, type: answer.type }),
        connectionId: this.connectionId
      });
      this.log('→ Answer отправлен');
    } catch (e) {
      this.log(`handleOffer: ${e}`, 'error');
    }
  }

  private async handleAnswer(answerStr: string) {
    if (!this.pc) return;
    try {
      const answer = JSON.parse(answerStr);
      await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
      this.log('Remote SDP установлен');
    } catch (e) {
      this.log(`handleAnswer: ${e}`, 'error');
    }
  }

  private async handleIceCandidate(candidateStr: string) {
    if (!this.pc) return;
    try {
      const outer = JSON.parse(candidateStr);
      const inner = outer.candidate;
      await this.pc.addIceCandidate(new RTCIceCandidate({
        candidate: inner.candidate,
        sdpMid: String(inner.sdpMid ?? 0),
        sdpMLineIndex: inner.sdpMLineIndex ?? 0,
      }));
    } catch (e) {
      this.log(`ICE: ${e}`, 'error');
    }
  }

  private createSilentStream(): MediaStream {
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    const osc = ctx.createOscillator();
    osc.connect(dest);
    osc.start();
    dest.stream.getAudioTracks()[0].enabled = false;
    return dest.stream;
  }

  disconnectPeer() {
    if (this.ws?.readyState === WebSocket.OPEN && this.connectionId) {
      this.log('→ peer-disconnect');
      this.emit('event', { type: 'peer-disconnect', connectionId: this.connectionId });
    }
    this.cleanup();
  }

  private cleanup() {
    /* Always clear the lags interval — cleanup() runs on peer-disconnect,
       ws.onclose, and onconnectionstatechange in addition to explicit
       disconnect(), so leaving the interval running would keep mutating
       gainNode.gain.value at high frequency long after the peer is gone. */
    if (this.lagsInterval) {
      clearInterval(this.lagsInterval);
      this.lagsInterval = null;
      this.gainNode.gain.value = 1.0;
    }
    if (this.pc) {
      this.pc.ontrack = null;
      this.pc.onicecandidate = null;
      this.pc.onconnectionstatechange = null;
      this.pc.close();
      this.pc = null;
    }
    this.connectionId = null;
    if (this.status !== 'error') {
      this.setStatus(this.ws?.readyState === WebSocket.OPEN ? 'authenticated' : 'disconnected');
    }
  }

  /**
   * Add microphone input — mixes your voice into the output stream
   * so BOTH strangers hear you through the cross-routing.
   */
  addMicSource(stream: MediaStream) {
    try {
      this.micGain = this.audioContext.createGain();
      this.micGain.gain.value = 1.0;
      this.micSource = this.audioContext.createMediaStreamSource(stream);
      this.micSource.connect(this.micGain);
      this.micGain.connect(this.outputDestination);
    } catch (e) {
      console.error('[NektoAudioClient] mic source error:', e);
    }
  }

  removeMicSource() {
    if (this.micSource) {
      this.micSource.disconnect();
      this.micSource = null;
    }
    if (this.micGain) {
      this.micGain.disconnect();
      this.micGain = null;
    }
  }

  setMicMuted(muted: boolean) {
    if (this.micGain) {
      this.micGain.gain.value = muted ? 0 : 1.0;
    }
  }

  /**
   * Deafen this peer — disables the audio track that goes out via WebRTC
   * to them. Mirrors the toggleSound handler from the original
   * ForgottenSociety client (`this.input.stream.getTracks()[0].enabled = !`).
   * The peer will hear silence; the other side's mic stream is unaffected.
   */
  setCrossInputEnabled(enabled: boolean) {
    if (!this.crossInputStream) return;
    const track = this.crossInputStream.getAudioTracks()[0];
    if (track) track.enabled = enabled;
  }

  /**
   * Lag injection: randomly oscillates the outgoing gain between 0 and 1
   * at a random sub-50ms cadence, so the peer hears choppy, glitchy audio.
   * Mirrors the toggleLags handler from the original ForgottenSociety client.
   */
  private lagsInterval: ReturnType<typeof setInterval> | null = null;
  setLags(enabled: boolean) {
    if (enabled) {
      if (this.lagsInterval) return;
      const period = Math.max(5, Math.floor(Math.random() * 50));
      this.lagsInterval = setInterval(() => {
        this.gainNode.gain.value = Math.floor(Math.random() * 2);
      }, period);
    } else {
      if (this.lagsInterval) {
        clearInterval(this.lagsInterval);
        this.lagsInterval = null;
      }
      this.gainNode.gain.value = 1.0;
    }
  }

  disconnect() {
    if (this.lagsInterval) { clearInterval(this.lagsInterval); this.lagsInterval = null; }
    this.removeMicSource();
    this.cleanup();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.audioContext.close().catch(() => {});
    this.setStatus('disconnected');
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
