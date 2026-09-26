import { useEffect, useRef, useState } from "react";
import { lookupBarcode, normalizeBarcode } from "./barcode";

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<{ rawValue?: string }[]>;
};

export function BarcodeScan({
  onClose,
  onProduct,
  onUnknown,
}: {
  onClose: () => void;
  onProduct: (name: string) => void;
  onUnknown: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onProductRef = useRef(onProduct);
  const onUnknownRef = useRef(onUnknown);
  onProductRef.current = onProduct;
  onUnknownRef.current = onUnknown;
  const [status, setStatus] = useState("A apontar para o código de barras…");
  const [error, setError] = useState("");

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    return startScanner(video, onProductRef, onUnknownRef, setStatus, setError);
  }, []);

  return (
    <div className="scan-overlay" role="dialog" aria-modal="true" aria-label="Ler código de barras">
      <video ref={videoRef} className="scan-video" autoPlay muted playsInline />
      <div className="scan-frame" aria-hidden="true" />
      <div className="scan-ui">
        <p>{error || status}</p>
        <button type="button" className="ghost" onClick={onClose}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

function startScanner(
  video: HTMLVideoElement,
  onProductRef: { current: (name: string) => void },
  onUnknownRef: { current: () => void },
  setStatus: (value: string) => void,
  setError: (value: string) => void,
) {
  let stopped = false;
  let handled = false;
  let stream: MediaStream | undefined;
  let raf = 0;
  let controls: { stop: () => void } | undefined;

  function cleanup() {
    cancelAnimationFrame(raf);
    controls?.stop();
    stream?.getTracks().forEach((track) => track.stop());
    const src = video.srcObject;
    if (src instanceof MediaStream) src.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  }

  async function handleCode(raw: string) {
    const code = normalizeBarcode(raw);
    if (!code || handled || stopped) return;
    handled = true;
    stopped = true;
    cleanup();
    setStatus("A identificar o produto…");
    try {
      const name = await lookupBarcode(code);
      if (name) onProductRef.current(name);
      else onUnknownRef.current();
    } catch {
      onUnknownRef.current();
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
    if (stopped) {
      stream.getTracks().forEach((track) => track.stop());
      return true;
    }
    video.srcObject = stream;
    await video.play();
    const detector = new Detector({
      formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"],
    });
    const tick = async () => {
      if (stopped) return;
      try {
        const codes = await detector.detect(video);
        const raw = codes.find((item) => item.rawValue)?.rawValue;
        if (raw) {
          await handleCode(raw);
          return;
        }
      } catch {
        /* keep scanning */
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
    if (stopped) return;
    stream?.getTracks().forEach((track) => track.stop());
    stream = undefined;
    video.srcObject = null;
    try {
      await startZxing();
    } catch (err) {
      if (!stopped) setError(cameraError(err));
    }
  })();

  return () => {
    stopped = true;
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
