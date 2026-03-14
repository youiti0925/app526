"use client";

import { useState, useEffect, useRef } from "react";
import { X, Download, Copy, CheckCircle2, QrCode, Printer } from "lucide-react";
import QRCode from "qrcode";

interface QRCodeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  documentNumber: string;
}

export default function QRCodeDialog({
  isOpen,
  onClose,
  projectId,
  projectName,
  documentNumber,
}: QRCodeDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);
  const [sopUrl, setSopUrl] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setSopUrl(`${window.location.origin}/projects/${projectId}`);
    }
  }, [projectId]);

  useEffect(() => {
    if (isOpen && canvasRef.current && sopUrl) {
      QRCode.toCanvas(canvasRef.current, sopUrl, {
        width: 256,
        margin: 2,
        color: { dark: "#1e293b", light: "#ffffff" },
      });
    }
  }, [isOpen, sopUrl]);

  if (!isOpen) return null;

  const handleDownload = () => {
    if (!canvasRef.current) return;

    // Create a larger canvas with label
    const exportCanvas = document.createElement("canvas");
    const ctx = exportCanvas.getContext("2d")!;
    const padding = 40;
    const labelHeight = 80;
    exportCanvas.width = 256 + padding * 2;
    exportCanvas.height = 256 + padding * 2 + labelHeight;

    // White background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

    // Draw QR code
    ctx.drawImage(canvasRef.current, padding, padding);

    // Draw label
    ctx.fillStyle = "#1e293b";
    ctx.font = "bold 14px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(projectName, exportCanvas.width / 2, 256 + padding + 24);
    ctx.font = "12px sans-serif";
    ctx.fillStyle = "#64748b";
    ctx.fillText(documentNumber, exportCanvas.width / 2, 256 + padding + 44);
    ctx.font = "10px sans-serif";
    ctx.fillText("スキャンして作業標準書を表示", exportCanvas.width / 2, 256 + padding + 62);

    // Download
    const link = document.createElement("a");
    link.download = `QR_${documentNumber}_${projectName}.png`;
    link.href = exportCanvas.toDataURL("image/png");
    link.click();
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(sopUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePrint = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow || !canvasRef.current) return;
    printWindow.document.write(`
      <html>
        <head><title>QR Code - ${projectName}</title></head>
        <body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;margin:0;">
          <img src="${canvasRef.current.toDataURL()}" style="width:200px;height:200px;" />
          <h2 style="margin:16px 0 4px;font-size:16px;">${projectName}</h2>
          <p style="margin:0;color:#666;font-size:12px;">${documentNumber}</p>
          <p style="margin:8px 0;color:#888;font-size:11px;">スキャンして作業標準書を表示</p>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <QrCode className="w-5 h-5 text-blue-500" />
            <h2 className="font-bold text-slate-900">QRコード</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <p className="text-xs text-slate-500 mb-4">
          このQRコードを機械や作業場に貼ると、スマートフォンからすぐに作業標準書にアクセスできます。
        </p>

        <div className="flex justify-center mb-4">
          <div className="border-2 border-slate-200 rounded-lg p-2">
            <canvas ref={canvasRef} />
          </div>
        </div>

        <div className="text-center mb-4">
          <p className="text-sm font-medium text-slate-900">{projectName}</p>
          <p className="text-xs text-slate-500">{documentNumber}</p>
        </div>

        {/* URL */}
        <div className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg mb-4">
          <input
            type="text"
            value={sopUrl}
            readOnly
            className="flex-1 bg-transparent text-xs text-slate-600 outline-none font-mono"
          />
          <button onClick={handleCopy} className="p-1 hover:bg-slate-200 rounded" title="URLをコピー">
            {copied ? (
              <CheckCircle2 className="w-4 h-4 text-green-500" />
            ) : (
              <Copy className="w-4 h-4 text-slate-400" />
            )}
          </button>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button onClick={handleDownload} className="flex-1 btn-primary flex items-center justify-center gap-1.5 text-sm py-2">
            <Download className="w-4 h-4" />
            画像保存
          </button>
          <button onClick={handlePrint} className="flex-1 btn-secondary flex items-center justify-center gap-1.5 text-sm py-2">
            <Printer className="w-4 h-4" />
            印刷
          </button>
        </div>
      </div>
    </div>
  );
}
