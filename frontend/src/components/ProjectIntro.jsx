import React, { useEffect, useRef } from 'react';
import './project-intro.css';
import { GUIDE, TEAM } from './TeamPage';

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

/*
 * A compact band at the top of the landing page: project guide and team, centred.
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
        <p className="pi-role pi-in" style={{ '--d': '0.4s' }}>
          {GUIDE.role} <span aria-hidden="true">·</span> <span className="pi-dept">{GUIDE.department}</span>
        </p>

        <p className="pi-eyebrow pi-team-label pi-in" style={{ '--d': '0.55s' }}>Team Members</p>
        <ol className="pi-list">
          {TEAM.map((member, i) => (
            <li key={member.usn} className="pi-in" style={{ '--d': `${0.65 + i * 0.1}s` }}>
              <span className="pi-num">{String(i + 1).padStart(2, '0')}</span>
              <span className="pi-name">{member.name}</span>
              <span className="pi-usn">{member.usn}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export default ProjectIntro;
