import { useState } from 'react';
import QRCode from 'qrcode';

interface QrCodeButtonProps {
  value: string;
  label?: string;
}

// Small reusable toggle: renders a link as a scannable QR code on demand,
// locally via the `qrcode` package (no external service/CDN, matching the
// artifact/asset constraints the rest of this app already follows). Used
// for both the private-table Einladungslink and the Hostmodus Anzeige-Link.
export function QrCodeButton({ value, label = 'QR-Code anzeigen' }: QrCodeButtonProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle() {
    if (dataUrl) {
      setDataUrl(null);
      return;
    }
    try {
      const url = await QRCode.toDataURL(value, { margin: 1, width: 220 });
      setDataUrl(url);
      setError(null);
    } catch {
      setError('QR-Code konnte nicht erzeugt werden.');
    }
  }

  return (
    <div style={{ display: 'inline-block' }}>
      <button type="button" className="admin-btn-sm" onClick={handleToggle}>
        {dataUrl ? 'QR-Code ausblenden' : label}
      </button>
      {error && <div className="sh-error" style={{ marginTop: 8 }}>{error}</div>}
      {dataUrl && (
        <div style={{ marginTop: 10 }}>
          <img src={dataUrl} alt="QR-Code" width={220} height={220} style={{ borderRadius: 8 }} />
        </div>
      )}
    </div>
  );
}
