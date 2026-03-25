import RadioMain from "./components/RadioMain";
import { OrientationLock } from "./components/OrientationLock";
import { useImageColor } from "./hooks/useImageColor";

const LOGO_URL = import.meta.env.VITE_RADIO_LOGO_URL || "https://i1.sndcdn.com/avatars-000304126092-ysdpwc-t240x240.jpg";

export default function App() {
  const brandColor = useImageColor(LOGO_URL);

  const hexToRgb = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `${r}, ${g}, ${b}`;
  };

  return (
    <div 
      className="min-h-screen bg-zinc-950"
      style={{ 
        '--brand-color': brandColor,
        '--brand-color-rgb': hexToRgb(brandColor)
      } as any}
    >
      <OrientationLock />
      <RadioMain brandColor={brandColor} />
    </div>
  );
}
