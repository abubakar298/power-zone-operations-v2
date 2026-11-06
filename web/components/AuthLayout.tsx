import type { ReactNode } from 'react';
import { Brand } from './Brand.js';

export function AuthLayout({ children }: { children: ReactNode }) {
  return <div className="auth-layout">
    <aside className="auth-story">
      <Brand />
      <div className="story-content"><span className="eyebrow">POWER ZONE ENGINEERING & SERVICES</span>
        <h1>A clearer way<br />to work.</h1>
        <p>Your team’s workspace for project operations. Built around the details that matter.</p>
        <div className="story-rule" /><span className="story-caption">Precision at every step.</span>
      </div>
      <span className="story-footer">Power Zone Operations · V2</span>
    </aside>
    <main className="auth-main"><div className="mobile-brand"><Brand compact /></div>{children}
      <footer>Power Zone Engineering & Services</footer>
    </main>
  </div>;
}
