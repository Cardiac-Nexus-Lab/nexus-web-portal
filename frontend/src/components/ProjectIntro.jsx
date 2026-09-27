import React, { useEffect, useRef } from 'react';
import './project-intro.css';
import { GUIDE, TEAM } from './TeamPage';

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

/*
 * The first screen of the landing page: project guide and team, centred.
 * Lines rise in one at a time on load, as on the team page. Scrolling away
 * writes progress to one CSS variable, --p, which lifts and fades the block
 * so it hands over to the hero without re-rendering React.
 */
export function ProjectIntro() {
  const ref = useRef(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = node.getBoundingClientRect();
      node.style.setProperty('--p', clamp(-rect.top / (rect.height * 0.8 || 1)).toFixed(4));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <section className="pi" ref={ref} aria-label="Project guide and team">
      <div className="pi-inner">
        <p className="pi-eyebrow pi-in" style={{ '--d': '0.1s' }}>Project Guide</p>
        <h2 className="pi-guide pi-in" style={{ '--d': '0.25s' }}>{GUIDE.name}</h2>
        <p className="pi-role pi-in" style={{ '--d': '0.4s' }}>{GUIDE.role}</p>
        <p className="pi-dept pi-in" style={{ '--d': '0.5s' }}>{GUIDE.department}</p>

        <span className="pi-rule pi-in" style={{ '--d': '0.65s' }} aria-hidden="true" />

        <p className="pi-eyebrow pi-in" style={{ '--d': '0.75s' }}>Team Members</p>
        <ol className="pi-list">
          {TEAM.map((member, i) => (
            <li key={member.usn} className="pi-in" style={{ '--d': `${0.9 + i * 0.14}s` }}>
              <span className="pi-num">{String(i + 1).padStart(2, '0')}</span>
              <span className="pi-name">{member.name}</span>
              <span className="pi-usn">{member.usn}</span>
            </li>
          ))}
        </ol>
      </div>
      <a className="pi-scroll" href="#start" aria-label="Scroll to the platform"><i /></a>
    </section>
  );
}

export default ProjectIntro;
