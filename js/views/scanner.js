import { html, useState, useEffect, useRef } from '../lib.js';
import { Icon } from '../components.js';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];

// Escáner: usa BarcodeDetector nativo (Chrome/Android) y si no existe, ZXing (iPhone/Safari).
export function ScanPanel({ onCode }) {
  const video = useRef();
  const [status, setStatus] = useState('starting');
  const [error, setError] = useState(null);
  const [manual, setManual] = useState('');
  const done = useRef(false);

  useEffect(() => {
    let stream, timer, controls, stopped = false;
    const found = (code) => {
      if (done.current || !/^\d{6,14}$/.test(code)) return;
      done.current = true;
      navigator.vibrate?.(80);
      setStatus('found');
      onCode(code);
    };

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no permite usar la cámara (necesita HTTPS).');
        if ('BarcodeDetector' in window) {
          const supported = await window.BarcodeDetector.getSupportedFormats();
          const detector = new window.BarcodeDetector({ formats: FORMATS.filter((f) => supported.includes(f)) });
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } } });
          if (stopped) return stream.getTracks().forEach((t) => t.stop());
          video.current.srcObject = stream;
          await video.current.play();
          setStatus('scanning');
          timer = setInterval(async () => {
            if (done.current || !video.current || video.current.readyState < 2) return;
            try {
              const codes = await detector.detect(video.current);
              if (codes[0]) found(codes[0].rawValue);
            } catch {}
          }, 250);
        } else {
          const { BrowserMultiFormatReader } = await import('https://esm.sh/@zxing/browser@0.1.5');
          const reader = new BrowserMultiFormatReader();
          controls = await reader.decodeFromConstraints({ video: { facingMode: 'environment' } }, video.current, (res) => res && found(res.getText()));
          if (stopped) controls.stop();
          setStatus('scanning');
        }
      } catch (e) {
        setError(e.name === 'NotAllowedError' ? 'Permiso de cámara denegado. Habilitalo en la configuración del navegador.' : e.message);
        setStatus('error');
      }
    })();

    return () => {
      stopped = true;
      clearInterval(timer);
      controls?.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const submitManual = (e) => {
    e.preventDefault();
    if (manual.trim()) { done.current = true; onCode(manual.trim()); }
  };

  return html`
    <div class="stack">
      <div class="scanner">
        <video ref=${video} playsinline muted></video>
        <div class="scan-frame"></div>
        ${status === 'starting' && html`<div class="scan-msg">Abriendo cámara…</div>`}
        ${status === 'found' && html`<div class="scan-msg">¡Código leído! Buscando…</div>`}
        ${status === 'error' && html`<div class="scan-msg">${error}</div>`}
      </div>
      <p class="muted small center">Apuntá al código de barras del envase. Funciona con productos de Open Food Facts y con los que cargues vos.</p>
      <form class="search-box" onSubmit=${submitManual}>
        <${Icon} name="barcode" />
        <input inputmode="numeric" placeholder="O escribí el código" value=${manual} onInput=${(e) => setManual(e.target.value)} />
        <button class="btn small">Buscar</button>
      </form>
    </div>`;
}
