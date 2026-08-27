import NavBar from '../../components/nav-bar';
import GhostDashboard from '../../components/ghost-dashboard';
import ToastHost from '../../components/toast';

export const metadata = { title: 'Ghost — Persona' };

export default function GhostPage() {
  return (
    <>
      <NavBar />
      <ToastHost />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <GhostDashboard />
      </main>
    </>
  );
}
