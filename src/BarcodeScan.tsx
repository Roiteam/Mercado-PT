import { useEffect, useRef, useState } from "react";
import { isReliableBarcode, lookupBarcode, normalizeBarcode } from "./barcode";

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<{ rawValue?: string }[]>;
};

type ScanGate = {
  busy: boolean;
  stopped: boolean;
  fails: number;
};

export function BarcodeScan({
  onClose,
  onProduct,
  onGiveUp,
}: {
  onClose: () => void;
  onProduct: (name: string, qty: number) => boolean;
  onGiveUp: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onProductRef = useRef(onProduct);
  const onGiveUpRef = useRef(onGiveUp);
  onProductRef.current = onProduct;
  onGiveUpRef.current = onGiveUp;
  const gateRef = useRef<ScanGate>({ busy: false, stopped: false, fails: 0 });
  const [status, setStatus] = useState("A apontar para o código de barras…");
  const [error, setError] = useState("");
  const [found, setFound] = useState<{ name: string; qty: number } | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const gate = gateRef.current;
    gate.busy = false;
    gate.stopped = false;
    gate.fails = 0;
    video.setAttribute("playsinline", "true");
    video.playsInline = true;
    return startScanner(video, gate, {
      setStatus,
      onFound: (name) => {
        gate.busy = true;
        setError("");
        setFound({ name, qty: 1 });
      },
      onMiss: () => {
        gate.fails += 1;
        gate.busy = false;
        if (gate.fails >= 2) {
          onGiveUpRef.current();
          return;
        }
        setError("Erro");
        window.setTimeout(() => setError(""), 1600);
        setStatus("A apontar para o código de barras…");
      },
    });
  }, []);

  function confirmFound() {
    if (!found) return;
    const ok = onProductRef.current(found.name, found.qty);
    setFound(null);
    if (ok) {
      gateRef.current.fails = 0;
      setError("");
      setStatus("Adicionado");
      window.setTimeout(() => {
        gateRef.current.busy = false;
        setStatus("A apontar para o código de barras…");
      }, 1100);
    } else {
      setError("Erro");
      gateRef.current.busy = false;
      window.setTimeout(() => setError(""), 1600);
      setStatus("A apontar para o código de barras…");
    }
  }

  return (
    <div className="scan-overlay" role="dialog" aria-modal="true" aria-label="Ler código de barras">
      <video ref={videoRef} className="scan-video" autoPlay muted playsInline />
      <div className="scan-frame" aria-hidden="true" />
      <div className={`scan-ui${found ? " scan-card" : ""}`}>
        {found ? (
          <>
            <p className="qty-ask-name">{found.name}</p>
            <p>Quantas unidades?</p>
            <div className="qty scan-qty">
              <button
                type="button"
                onClick={() =>
                  setFound((prev) => (prev ? { ...prev, qty: Math.max(1, prev.qty - 1) } : prev))
                }
              >
                −
              </button>
              <strong>{found.qty}</strong>
              <button
                type="button"
                onClick={() => setFound((prev) => (prev ? { ...prev, qty: prev.qty + 1 } : prev))}
              >
                +
              </button>
            </div>
            <button type="button" className="primary" onClick={confirmFound}>
              Adicionar
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setFound(null);
                gateRef.current.busy = false;
                setStatus("A apontar para o código de barras…");
              }}
            >
              Cancelar
            </button>
          </>
        ) : (
          <>
            <p className={error ? "scan-err" : undefined}>{error || status}</p>
            <button type="button" className="ghost" onClick={onClose}>
              Cancelar
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function startScanner(
  video: HTMLVideoElement,
  gate: ScanGate,
  hooks: {
    setStatus: (value: string) => void;
    onFound: (name: string) => void;
    onMiss: () => void;
  },
) {
  let stream: MediaStream | undefined;
  let raf = 0;
  let controls: { stop: () => void } | undefined;
  let lastFailed = "";
  let failedUntil = 0;

  function cleanup() {
    cancelAnimationFrame(raf);
    try {
      controls?.stop();
    } catch {
      /* already stopped */
    }
    stream?.getTracks().forEach((track) => track.stop());
    const src = video.srcObject;
    if (src instanceof MediaStream) src.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  }

  async function handleCode(raw: string) {
    const code = normalizeBarcode(raw);
    if (!code || gate.busy || gate.stopped) return;
    if (!isReliableBarcode(code)) return;
    if (code === lastFailed && Date.now() < failedUntil) return;
    gate.busy = true;
    hooks.setStatus("A identificar o produto…");
    try {
      const name = await lookupBarcode(code);
      if (gate.stopped) return;
      if (name) {
        hooks.onFound(name);
        return;
      }
      lastFailed = code;
      failedUntil = Date.now() + 1800;
      hooks.onMiss();
    } catch {
      if (!gate.stopped) {
        lastFailed = code;
        failedUntil = Date.now() + 1800;
        hooks.onMiss();
      }
    }
  }

  async function startNative() {
    const Detector = (
      window as Window & {
        BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorLike;
      }
    ).BarcodeDetector;
    if (typeof Detector !== "function") return false;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
    });
    if (gate.stopped) {
      stream.getTracks().forEach((track) => track.stop());
      return true;
    }
    video.srcObject = stream;
    await video.play();
    const detector = new Detector({
      formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"],
    });
    const tick = async () => {
      if (gate.stopped) return;
      if (!gate.busy) {
        try {
          const codes = await detector.detect(video);
          const raw = codes.find((item) => item.rawValue)?.rawValue;
          if (raw) void handleCode(raw);
        } catch {
          /* keep scanning */
        }
      }
      raf = requestAnimationFrame(() => void tick());
    };
    void tick();
    return true;
  }

  async function startZxing() {
    const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
      import("@zxing/browser"),
      import("@zxing/library"),
    ]);
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.CODE_128,
    ]);
    const reader = new BrowserMultiFormatReader(hints);
    controls = await reader.decodeFromConstraints(
      { audio: false, video: { facingMode: { ideal: "environment" } } },
      video,
      (result) => {
        if (result) void handleCode(result.getText());
      },
    );
  }

  void (async () => {
    try {
      if (await startNative()) return;
    } catch {
      /* BarcodeDetector failed — try ZXing */
    }
    if (gate.stopped) return;
    stream?.getTracks().forEach((track) => track.stop());
    stream = undefined;
    video.srcObject = null;
    try {
      await startZxing();
    } catch (err) {
      if (!gate.stopped) hooks.setStatus(cameraError(err));
    }
  })();

  return () => {
    gate.stopped = true;
    cleanup();
  };
}

function cameraError(err: unknown) {
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Precisamos da câmara para ler o código. Permite o acesso nas definições do telemóvel.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "Não encontrámos uma câmara neste aparelho.";
  }
  if (window.isSecureContext === false) {
    return "A leitura do código de barras só funciona em ligação segura (HTTPS).";
  }
  return "Não foi possível abrir a câmara. Podes escrever o produto à mão.";
}
