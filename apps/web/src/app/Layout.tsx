import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, ScrollRestoration, useLocation, useNavigation } from 'react-router';
import { formatChips } from '@casino/engine';
import { HELPLINE, VIRTUAL_CHIPS_DISCLAIMER } from '@casino/shared';
import { useMe } from '../api/hooks.ts';
import { useTheme } from '../lib/theme.ts';
import { RealityCheck } from './RealityCheck.tsx';
import { useSignOut } from './useSignOut.ts';

const NAV_ITEMS = [
  { to: '/', label: 'Lobby', end: true },
  { to: '/storico', label: 'Storico', end: false },
  { to: '/verifica', label: 'Verifica', end: false },
  { to: '/gioco-responsabile', label: 'Gioco responsabile', end: false },
  { to: '/profilo', label: 'Profilo', end: false },
] as const;

export function Logo() {
  return (
    <svg className="logo-mark" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle cx="32" cy="32" r="29" className="logo-ring" />
      <path d="M32 3v10M32 51v10M3 32h10M51 32h10" className="logo-notches" />
      <circle cx="32" cy="32" r="15" className="logo-core" />
      <path d="M25 24l7 17 7-17" className="logo-v" />
    </svg>
  );
}

function BalancePill() {
  const { data: me } = useMe();
  if (!me) return null;
  return (
    <Link
      to="/profilo"
      className="balance-pill"
      aria-label={`Saldo: ${formatChips(me.balance)} fiches virtuali. Vai al profilo`}
    >
      <span className="balance-label">Saldo</span>
      <span className="balance-value">{formatChips(me.balance)}</span>
      <span className="balance-unit">fiches</span>
    </Link>
  );
}

function ThemeToggle() {
  const [theme, toggle] = useTheme();
  const next = theme === 'dark' ? 'chiaro' : 'scuro';
  return (
    <button
      type="button"
      className="btn btn-icon theme-toggle"
      onClick={toggle}
      aria-label={`Passa al tema ${next}`}
      title={`Tema ${next}`}
    >
      <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
    </button>
  );
}

function AccountArea() {
  const { data: me, isPending } = useMe();
  const { signOut, isPending: signingOut } = useSignOut();
  if (isPending) return null;
  if (!me) {
    return (
      <div className="account-area">
        <Link to="/accedi" className="btn btn-ghost">
          Accedi
        </Link>
        <Link to="/registrati" className="btn btn-primary">
          Registrati
        </Link>
      </div>
    );
  }
  return (
    <div className="account-area">
      <span className="account-name" title="Utente collegato">
        {me.user.username}
      </span>
      <button type="button" className="btn btn-ghost" disabled={signingOut} onClick={signOut}>
        Esci
      </button>
    </div>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-badges">
          <span className="badge-18" aria-label="Vietato ai minori di 18 anni">
            18+
          </span>
          <p>
            Gioco riservato ai maggiorenni. Nessun denaro reale: le fiches sono virtuali e non danno
            diritto a premi.
          </p>
        </div>
        <p className="footer-helpline">
          Se il gioco non è più un divertimento: {HELPLINE.name},{' '}
          <a href={`tel:${HELPLINE.phone.replace(/\s/g, '')}`} className="helpline-number">
            {HELPLINE.phone}
          </a>{' '}
          (gratuito e anonimo).
        </p>
        <nav aria-label="Informazioni" className="footer-nav">
          <Link to="/regole">Regole e probabilità</Link>
          <Link to="/gioco-responsabile">Gioco responsabile</Link>
          <Link to="/verifica">Verifica equità</Link>
        </nav>
      </div>
    </footer>
  );
}

export function Layout() {
  const location = useLocation();
  const navigation = useNavigation();
  const [menuOpen, setMenuOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const firstRender = useRef(true);

  // Close the mobile menu and move focus to the new page (screen readers start from the top).
  useEffect(() => {
    setMenuOpen(false);
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (!location.hash) mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname, location.hash]);

  // Escape closes the mobile menu and returns focus to its toggle.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  return (
    <div className="app">
      {navigation.state === 'loading' && (
        <div className="route-progress" role="progressbar" aria-label="Caricamento della pagina" />
      )}
      <a href="#main" className="skip-link">
        Vai al contenuto
      </a>
      <header className="site-header">
        <div className="header-inner">
          <Link to="/" className="brand" aria-label="Casinò Verde, vai alla lobby">
            <Logo />
            <span className="brand-name">
              Casinò <span className="brand-accent">Verde</span>
            </span>
          </Link>
          <BalancePill />
          <button
            ref={menuButtonRef}
            type="button"
            className="btn btn-icon menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="main-nav"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span aria-hidden="true">☰</span>
            <span className="visually-hidden">Menu</span>
          </button>
          <div className={`header-menu ${menuOpen ? 'is-open' : ''}`} id="main-nav">
            <nav aria-label="Principale" className="main-nav">
              {NAV_ITEMS.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className="nav-link">
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <div className="header-tools">
              <ThemeToggle />
              <AccountArea />
            </div>
          </div>
        </div>
      </header>
      <p className="disclaimer-banner">
        <strong>Solo fiches virtuali.</strong> {VIRTUAL_CHIPS_DISCLAIMER}
      </p>
      <main id="main" ref={mainRef} tabIndex={-1} className="site-main">
        <Outlet />
      </main>
      <Footer />
      <RealityCheck />
      <ScrollRestoration />
    </div>
  );
}
