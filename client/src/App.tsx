import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { HomePage } from '@/features/home/HomePage';

/* The room (WebRTC, players, panels) is by far the heaviest route — split it. */
const RoomPage = lazy(() =>
  import('@/features/room/RoomPage').then((m) => ({ default: m.RoomPage })),
);

function PageSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Loader2 size={28} className="animate-spin text-ink-faint" />
    </div>
  );
}

export default function App() {
  useTheme();
  return (
    <BrowserRouter>
      <Suspense fallback={<PageSpinner />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/room/:code" element={<RoomPage />} />
          <Route path="*" element={<HomePage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
