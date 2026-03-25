import { useState, useEffect } from 'react';

export function useImageColor(imageUrl: string) {
  const [color, setColor] = useState<string>('#D4AF37'); // Default color

  useEffect(() => {
    if (!imageUrl) return;

    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = imageUrl;

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Use a small version of the image for performance
      const size = 50;
      canvas.width = size;
      canvas.height = size;
      ctx.drawImage(img, 0, 0, size, size);

      try {
        const imageData = ctx.getImageData(0, 0, size, size).data;
        let r = 0, g = 0, b = 0;
        let validCount = 0;

        for (let i = 0; i < imageData.length; i += 4) {
          const pr = imageData[i];
          const pg = imageData[i + 1];
          const pb = imageData[i + 2];
          const pa = imageData[i + 3];

          if (pa < 128) continue; // Skip transparent

          const brightness = (pr * 299 + pg * 587 + pb * 114) / 1000;
          // Skip very dark or very light pixels to get a more "brand" color
          if (brightness > 40 && brightness < 220) {
            r += pr;
            g += pg;
            b += pb;
            validCount++;
          }
        }

        if (validCount > 0) {
          r = Math.floor(r / validCount);
          g = Math.floor(g / validCount);
          b = Math.floor(b / validCount);
        } else {
          // Fallback to average if no mid-range pixels
          r = 0; g = 0; b = 0;
          for (let i = 0; i < imageData.length; i += 4) {
            r += imageData[i];
            g += imageData[i + 1];
            b += imageData[i + 2];
          }
          const totalCount = imageData.length / 4;
          r = Math.floor(r / totalCount);
          g = Math.floor(g / totalCount);
          b = Math.floor(b / totalCount);
        }

        const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
        setColor(hex);
      } catch (e) {
        console.error('Error extracting color:', e);
      }
    };
  }, [imageUrl]);

  return color;
}
