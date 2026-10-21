import { toString as qrString } from 'qrcode';
import { assetLabelUrl } from '@trendlix/shared';

// An asset's QR code (spec §5: the label's QR opens https://people.trendlix.com/assets/{code}, its page on the site,
// which the phone pages and the app open too), drawn on the server as SVG with the `qrcode` package (pinned at 1.5.4):
// no script in the browser, crisp at any size on screen and on a printed label. Medium error correction, so a label a
// little worn still reads; no quiet zone of its own (the label leaves white round it). Without a width the package
// writes only a viewBox, so the box it is put in decides its size.

/** The SVG of the QR code holding the asset's address. */
export function assetQrSvg(code: string): Promise<string> {
  return qrString(assetLabelUrl(code), { type: 'svg', errorCorrectionLevel: 'M', margin: 0, color: { dark: '#12161f', light: '#ffffff' } });
}
