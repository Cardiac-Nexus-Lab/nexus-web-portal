import React, { useEffect, useRef } from 'react';
import { ArrowLeft } from 'lucide-react';
import './team-page.css';

const GUIDE = {
  name: 'Dr. Shrihari M R',
  role: 'Associate Professor',
  department: 'Department of CSE',
  photo: '/guide-shrihari.jpg',
};

const TEAM = [
  { name: 'Sahana N S', usn: '1SJ23CS143' },
  { name: 'Samhitha P', usn: '1SJ23CS146' },
  { name: 'Vishnu R', usn: '1SJ23CS190' },
  { name: 'Yashas M', usn: '1SJ23CS193' },
];

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/*
 * Two scenes. The guide scene is sticky: its details appear alone first, and
 * scrolling grows the photo in above them, so the page settles into a centred
 * profile. Scroll progress is written to one CSS variable, --t, so the motion
 * never re-renders React. The team scene reveals its rows once it is on screen.
 */
export function TeamPage({ onBack }) {
  const guideRef = useRef(null);
  const teamRef = useRef(null);

  useEffect(() => {
    window.scrollTo(0, 0);
    let frame = 0;
    const update = () => {
      frame = 0;
      const section = guideRef.current;
      if (!section) return;
      const rect = section.getBoundingClientRect();
      const p = clamp(-rect.top / (rect.height - window.innerHeight || 1));
      section.style.setProperty('--t', ease(clamp((p - 0.12) / 0.6)).toFixed(4));
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

  useEffect(() => {
    const node = teamRef.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { node.classList.add('is-in'); observer.disconnect(); } },
      { threshold: 0.35 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onBack(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  return (
    <div className="tp">
      <header className="tp-bar">
        <button type="button" className="tp-back" onClick={onBack}>
          <ArrowLeft size={16} /> Cardiac Nexus
        </button>
        <div className="tp-college">
          <img src="/sjcit-logo.png" alt="" />
          <span>SJC Institute of Technology</span>
        </div>
      </header>

      <section className="tp-guide" ref={guideRef} aria-label="Project guide">
        <div className="tp-sticky">
          <div className="tp-profile">
            <div className="tp-photo-slot" aria-hidden="true">
              <figure className="tp-photo">
                <img src={GUIDE.photo} alt="" />
              </figure>
            </div>
            <p className="tp-eyebrow tp-in" style={{ '--d': '0.1s' }}>Project Guide</p>
            <h1 className="tp-in" style={{ '--d': '0.25s' }}>{GUIDE.name}</h1>
            <p className="tp-role tp-in" style={{ '--d': '0.4s' }}>{GUIDE.role}</p>
            <p className="tp-dept tp-in" style={{ '--d': '0.52s' }}>{GUIDE.department}</p>
          </div>
          <span className="tp-scroll" aria-hidden="true"><i /></span>
        </div>
      </section>

      <section className="tp-team" ref={teamRef} aria-labelledby="tp-team-title">
        <h2 id="tp-team-title">Team Members</h2>
        <ol className="tp-list">
          {TEAM.map((member, i) => (
            <li key={member.usn} style={{ '--i': i }}>
              <span className="tp-num">{String(i + 1).padStart(2, '0')}</span>
              <span className="tp-name">{member.name}</span>
              <span className="tp-usn">{member.usn}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export default TeamPage;
