import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Camera, Upload, ScanLine, RefreshCw, Check, X, Wand2 } from 'lucide-react';
import {
  detectReceiptQuad, fullImageQuad, toPreviewCanvas, scanToDataURL,
  Quad, Point,
} from '../services/docscan';

interface Props {
  isScanning: boolean;
  onExtract: (base64Image: string) => void;
}

type Stage = 'capture' | 'camera' | 'adjust';

/**
 * ReceiptScanner — CamScanner-style capture flow:
 *  capture (camera or upload) → auto edge-detection → user adjusts the
 *  4 corners if needed → perspective crop + enhance → AI extraction.
 */
export default function ReceiptScanner({ isScanning, onExtract }: Props) {
  const [stage, setStage] = useState<Stage>('capture');
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [quad, setQuad] = useState<Quad | null>(null);
  const [enhance, setEnhance] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [camError, setCamError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const dragRef = useRef<keyof Quad | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const canUseCamera =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia;

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  const autoDetect = useCallback((image: HTMLImageElement) => {
    setDetecting(true);
    // Let the preview paint first so the spinner is visible
    setTimeout(() => {
      try {
        const preview = toPreviewCanvas(image);
        const found = detectReceiptQuad(preview);
        const sx = image.naturalWidth / preview.width;
        const sy = image.naturalHeight / preview.height;
        if (found) {
          const scale = (p: Point): Point => ({ x: p.x * sx, y: p.y * sy });
          setQuad({ tl: scale(found.tl), tr: scale(found.tr), br: scale(found.br), bl: scale(found.bl) });
        } else {
          setQuad(fullImageQuad(image.naturalWidth, image.naturalHeight));
        }
      } catch {
        setQuad(fullImageQuad(image.naturalWidth, image.naturalHeight));
      }
      setDetecting(false);
    }, 60);
  }, []);

  const loadDataUrl = useCallback((dataUrl: string) => {
    const image = new Image();
    image.onload = () => {
      setImg(image);
      setStage('adjust');
      autoDetect(image);
    };
    image.src = dataUrl;
  }, [autoDetect]);

  const startCamera = async () => {
    setCamError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      setStage('camera');
      // Attach after the video element mounts
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 50);
    } catch {
      setCamError('Camera unavailable — please upload a photo instead.');
    }
  };

  const capturePhoto = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    stopCamera();
    loadDataUrl(c.toDataURL('image/jpeg', 0.95));
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => loadDataUrl(String(r.result));
    r.readAsDataURL(f);
    e.target.value = '';
  };

  // --- corner dragging ---
  const toNatural = (clientX: number, clientY: number): Point => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * (img?.naturalWidth || 1),
      y: ((clientY - rect.top) / rect.height) * (img?.naturalHeight || 1),
    };
  };
  const onHandleDown = (key: keyof Quad) => (e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = key;
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onHandleMove = (e: React.PointerEvent) => {
    const key = dragRef.current;
    if (!key || !img) return;
    const p = toNatural(e.clientX, e.clientY);
    p.x = Math.max(0, Math.min(img.naturalWidth, p.x));
    p.y = Math.max(0, Math.min(img.naturalHeight, p.y));
    setQuad((q) => (q ? { ...q, [key]: p } : q));
  };
  const onHandleUp = () => { dragRef.current = null; };

  const handleScan = () => {
    if (!img || !quad || isScanning) return;
    const dataUrl = scanToDataURL(img, quad, enhance);
    onExtract(dataUrl.split(',')[1] || '');
  };

  const reset = () => {
    stopCamera();
    setStage('capture');
    setImg(null);
    setQuad(null);
  };

  const cornerKeys: (keyof Quad)[] = ['tl', 'tr', 'br', 'bl'];

  return (
    <div className="animate-fade-in max-w-xl mx-auto py-8 md:py-12">
      {stage === 'capture' && (
        <div className="bg-white p-8 md:p-14 rounded-[3rem] shadow-2xl border-4 border-dashed border-slate-100 flex flex-col items-center text-center">
          <div className="w-16 h-16 bg-red-50 text-[#E31837] rounded-[1.5rem] flex items-center justify-center mb-6 shadow-sm">
            <ScanLine size={32} />
          </div>
          <h2 className="text-2xl font-black mb-3 tracking-tighter uppercase">Smart Receipt Scan</h2>
          <p className="text-slate-400 font-medium text-sm mb-8 px-4 leading-relaxed uppercase">
            Auto-crops to the receipt, removes background, and sharpens text before AI reads it.
          </p>
          <div className="w-full space-y-3">
            {canUseCamera && (
              <button onClick={startCamera} className="w-full py-4 bg-[#003366] text-white rounded-2xl flex items-center justify-center gap-2 font-black text-base active:scale-95 transition-all shadow-xl uppercase">
                <Camera size={20} /> Use Camera
              </button>
            )}
            <label className={`w-full py-4 rounded-2xl flex items-center justify-center gap-2 font-black text-base cursor-pointer active:scale-95 transition-all shadow-xl uppercase ${canUseCamera ? 'bg-slate-100 text-[#003366]' : 'bg-[#003366] text-white'}`}>
              <input type="file" className="sr-only" accept="image/*" onChange={onFile} aria-label="Upload receipt photo" />
              <Upload size={20} /> Upload Photo
            </label>
          </div>
          {camError && <p className="mt-4 text-xs font-bold text-red-500">{camError}</p>}
          <p className="mt-6 text-[8px] font-black uppercase text-slate-300 tracking-[0.2em]">Tip: lay the receipt flat on a dark surface</p>
        </div>
      )}

      {stage === 'camera' && (
        <div className="bg-black rounded-[2rem] overflow-hidden shadow-2xl relative">
          <video ref={videoRef} playsInline muted className="w-full aspect-[3/4] object-cover" />
          {/* viewfinder guides */}
          <div className="absolute inset-6 border-2 border-dashed border-white/60 rounded-xl pointer-events-none" />
          <p className="absolute top-8 left-0 right-0 text-center text-white/80 text-[10px] font-black uppercase tracking-widest pointer-events-none">
            Fit the receipt inside the frame
          </p>
          <div className="absolute bottom-6 left-0 right-0 flex items-center justify-center gap-6">
            <button onClick={() => { stopCamera(); setStage('capture'); }} className="w-12 h-12 rounded-full bg-white/20 text-white flex items-center justify-center active:scale-95" aria-label="Cancel camera">
              <X size={20} />
            </button>
            <button onClick={capturePhoto} className="w-16 h-16 rounded-full bg-white flex items-center justify-center active:scale-95 shadow-xl" aria-label="Capture photo">
              <div className="w-12 h-12 rounded-full border-4 border-[#E31837]" />
            </button>
            <div className="w-12" />
          </div>
        </div>
      )}

      {stage === 'adjust' && img && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-[2rem] shadow-xl border">
            <div className="flex items-center justify-between mb-3 px-1">
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-500">
                {detecting ? 'Detecting receipt edges…' : 'Drag corners to fit the receipt'}
              </h3>
              <button onClick={() => img && autoDetect(img)} className="flex items-center gap-1 text-[10px] font-black uppercase text-[#003366] hover:underline" disabled={detecting}>
                <Wand2 size={12} /> Auto-detect
              </button>
            </div>
            <div className="relative rounded-xl overflow-hidden bg-slate-900 select-none" style={{ touchAction: 'none' }}>
              <img src={img.src} alt="Receipt" className="w-full block pointer-events-none" draggable={false} />
              {quad && (
                <svg ref={svgRef} viewBox={`0 0 ${img.naturalWidth} ${img.naturalHeight}`} preserveAspectRatio="none"
                     className="absolute inset-0 w-full h-full" onPointerMove={onHandleMove} onPointerUp={onHandleUp}>
                  <polygon
                    points={cornerKeys.map((k) => `${quad[k].x},${quad[k].y}`).join(' ')}
                    fill="rgba(227,24,55,0.10)" stroke="#E31837" strokeWidth={img.naturalWidth * 0.006}
                    strokeDasharray={`${img.naturalWidth * 0.02} ${img.naturalWidth * 0.012}`} />
                  {cornerKeys.map((k) => (
                    <g key={k}>
                      <circle cx={quad[k].x} cy={quad[k].y} r={img.naturalWidth * 0.035}
                              fill="rgba(227,24,55,0.25)" />
                      <circle cx={quad[k].x} cy={quad[k].y} r={img.naturalWidth * 0.018}
                              fill="#E31837" stroke="#fff" strokeWidth={img.naturalWidth * 0.006}
                              style={{ cursor: 'grab' }}
                              onPointerDown={onHandleDown(k)} />
                    </g>
                  ))}
                </svg>
              )}
              {detecting && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                  <div className="flex items-center gap-2 text-white text-xs font-black uppercase">
                    <RefreshCw size={16} className="animate-spin" /> Finding edges…
                  </div>
                </div>
              )}
            </div>
            <label className="mt-3 flex items-center justify-between px-1 cursor-pointer" onClick={() => setEnhance((v) => !v)}>
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Sharpen text (recommended)</span>
              <span className={`w-11 h-6 rounded-full p-1 transition-colors ${enhance ? 'bg-[#003366]' : 'bg-slate-200'}`}>
                <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform ${enhance ? 'translate-x-5' : ''}`} />
              </span>
            </label>
          </div>
          <div className="flex gap-3">
            <button onClick={reset} className="px-5 py-4 bg-slate-100 text-slate-500 rounded-2xl font-black text-sm uppercase active:scale-95">
              Retake
            </button>
            <button onClick={handleScan} disabled={isScanning || detecting || !quad}
                    className="flex-1 py-4 bg-[#E31837] text-white rounded-2xl font-black text-base uppercase shadow-xl active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2">
              {isScanning ? (<><span className="w-5 h-5 border-4 border-white/20 border-t-white rounded-full animate-spin" /> Analyzing…</>) : (<><Check size={20} /> Scan Receipt</>)}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
