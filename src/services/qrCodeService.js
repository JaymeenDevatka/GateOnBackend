import QRCode from 'qrcode';

/**
 * Generates a base64 encoded PNG Data URL for a given string (e.g., ticket code).
 * @param {string} text - The text to encode in the QR code.
 * @returns {Promise<string>} Base64 Data URL or null if failed.
 */
export async function generateQR(text) {
  try {
    const dataUrl = await QRCode.toDataURL(text, {
      errorCorrectionLevel: 'H',
      margin: 2,
      scale: 8,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });
    return dataUrl;
  } catch (err) {
    console.error('Failed to generate QR code:', err);
    return null;
  }
}
