import Link from 'next/link';
import { Logo } from './logo';

export default function Home() {
  return (
    <main className="home">
      <Logo size={96} title="Notation kata" />
      <h1>Notation kata</h1>
      <p>Selon le règlement de compétition kata WKF 2026.0</p>
      <nav>
        <Link href="/admin" className="home-link">
          <strong>Administration</strong>
          <span>Compétitions, inscriptions, officiels, tirages</span>
        </Link>
        <Link href="/table" className="home-link">
          <strong>Table officielle</strong>
          <span>Appel, katas, panel, déroulement et confirmation des combats</span>
        </Link>
        <Link href="/judge" className="home-link">
          <strong>Juge</strong>
          <span>Saisir mes notes sur la tablette</span>
        </Link>
        <Link href="/display" className="home-link">
          <strong>Affichage</strong>
          <span>Écran public de la salle</span>
        </Link>
      </nav>
    </main>
  );
}
