/* =============================================================================
   heart.js — the anatomical schematic and its conduction animation.
   -----------------------------------------------------------------------------
   The heart is drawn as a technical cross-section rather than a naturalistic
   illustration: chambers as cavities, walls as mass, and the conduction system
   as an explicit branching path. The impulse that travels that path is driven
   by the SAME phase variable that draws the ECG, so the P wave appears exactly
   as the atria light and the QRS lands exactly as the ventricles do. The
   diagram and the trace are two views of one event, not two animations that
   happen to sit near each other.
   ========================================================================== */
(function (global) {
  'use strict';

  /* --- Geometry ---------------------------------------------------------
     Anterior view, conventionally mirrored: the patient's right heart is on
     the left of the image. Apex points down and to the viewer's left.     */
  const VB = { w: 620, h: 740 };

  const PATHS = {
    /* Outer myocardial silhouette. Deliberately asymmetric: the left heart
       is bulkier and the apex points down and toward the viewer's left,
       which is what stops the drawing reading as a symmetrical valentine. */
    silhouette:
      'M300 150 C384 128 470 158 492 226 C520 302 520 384 494 452 ' +
      'C462 542 398 626 306 700 C246 644 190 558 166 468 ' +
      'C142 380 148 268 186 214 C214 172 258 158 300 150 Z',

    /* Great vessels. Short, thick, and butt-capped so they read as cut
       tubes emerging from the mass rather than as thin antennae. */
    aorta:
      'M340 186 C344 138 352 86 368 26',
    pulmonaryArtery:
      'M292 180 C286 136 276 92 262 40',
    svc:
      'M224 202 C218 162 212 122 206 58',

    /* Atrial cavities — above the valve plane, small relative to the
       ventricles, which is the proportion textbook diagrams get right and
       decorative hearts get wrong. */
    rightAtrium:
      'M200 214 C238 196 296 200 302 232 C308 264 292 288 252 290 ' +
      'C214 292 190 272 190 248 C189 230 190 220 200 214 Z',
    leftAtrium:
      'M400 208 C444 196 480 214 480 246 C480 278 452 294 414 292 ' +
      'C380 290 352 272 354 244 C356 220 376 214 400 208 Z',

    /* Ventricular cavities. The right is a crescent wrapped against the
       septum; the left is rounder and carries a far thicker wall, because
       it pumps against the whole body rather than only the lungs. */
    rightVentricle:
      'M228 330 C268 316 300 336 302 386 C304 458 292 536 268 596 ' +
      'C240 556 210 486 196 420 C184 366 194 342 228 330 Z',
    leftVentricle:
      'M388 334 C442 334 462 378 458 434 C453 508 418 582 378 634 ' +
      'C348 588 336 508 336 434 C336 376 350 334 388 334 Z',

    // Interventricular septum: the wall between the two ventricles
    septum:
      'M310 306 C328 306 332 348 332 434 C332 514 348 586 374 638 ' +
      'L350 668 C314 606 304 514 304 430 C304 356 298 318 310 306 Z',

    valveTricuspid: 'M200 306 L302 306',
    valveMitral:    'M340 308 L462 308',

    /* Conduction system — the wiring, drawn as one continuous descent from
       the sinoatrial node through the AV node and into the bundle of His. */
    conduction:
      'M222 200 C250 232 276 276 302 306 L306 328 C310 350 314 364 318 380',
    leftBundle:
      'M318 380 C348 402 376 440 392 496 C402 536 404 574 400 606',
    rightBundle:
      'M318 380 C302 408 286 448 276 500 C268 542 266 578 268 608',

    purkinjeLeft:
      'M400 606 L428 632 M400 606 L406 650 M400 606 L376 640 M400 606 L356 622',
    purkinjeRight:
      'M268 608 L242 636 M268 608 L264 654 M268 608 L292 644 M268 608 L306 626',

    /* Coronary arteries, routed over the surface: the LAD down the anterior
       interventricular groove, the circumflex around the left border, the
       right coronary around the other side. */
    lad: 'M340 150 C352 214 356 296 350 376 C344 456 328 546 300 626',
    lcx: 'M356 158 C404 186 446 228 462 288 C474 334 470 380 456 422',
    rca: 'M262 152 C216 182 182 226 170 282 C160 332 166 386 184 432 ' +
         'C204 486 234 538 262 578'
  };

  /* --- Landmark points, used for labels and for the travelling impulse --- */
  const NODES = {
    sa:  { x: 222, y: 200, r: 9, label: 'Sinoatrial node' },
    av:  { x: 304, y: 322, r: 8, label: 'Atrioventricular node' },
    his: { x: 318, y: 380, r: 5, label: 'Bundle of His' }
  };

  /* --- The five chapters of the breakdown -------------------------------
     Each names the parts that light up and the window of the cardiac cycle
     it corresponds to, so the trace can highlight the matching segment.   */
  const CHAPTERS = [
    { id: 'sa',        parts: ['sa'],                              cycle: [0.09, 0.22] },
    { id: 'atria',     parts: ['rightAtrium', 'leftAtrium'],        cycle: [0.12, 0.24] },
    { id: 'av',        parts: ['av', 'his', 'leftBundle', 'rightBundle'], cycle: [0.22, 0.29] },
    { id: 'ventricles',parts: ['rightVentricle', 'leftVentricle', 'septum'], cycle: [0.27, 0.35] },
    { id: 'coronary',  parts: ['lad', 'lcx', 'rca'],                cycle: [0.34, 0.52] }
  ];

  /* --- Build the SVG ------------------------------------------------------ */
  function build(mount) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${VB.w} ${VB.h}`);
    svg.setAttribute('class', 'heart-svg');
    svg.setAttribute('aria-hidden', 'true');

    svg.innerHTML = `
      <defs>
        <linearGradient id="wallGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="#1B2433"/>
          <stop offset="100%" stop-color="#10161F"/>
        </linearGradient>
        <radialGradient id="chamberGrad" cx="50%" cy="30%" r="75%">
          <stop offset="0%"   stop-color="#070B12"/>
          <stop offset="100%" stop-color="#0B111B"/>
        </radialGradient>
        <linearGradient id="vesselFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stop-color="#1A2330" stop-opacity="0"/>
          <stop offset="45%" stop-color="#1A2330" stop-opacity="0.75"/>
          <stop offset="100%" stop-color="#1A2330" stop-opacity="1"/>
        </linearGradient>
        <filter id="softGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="7" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="hardGlow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="3.5" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>

      <!-- great vessels -->
      <g class="h-vessels" fill="none" stroke-width="21" stroke-linecap="butt">
        <path d="${PATHS.aorta}"           class="h-part" data-part="aorta"/>
        <path d="${PATHS.pulmonaryArtery}" class="h-part" data-part="pulmonaryArtery"/>
        <path d="${PATHS.svc}"             class="h-part" data-part="svc"/>
      </g>

      <!-- myocardial mass -->
      <path d="${PATHS.silhouette}" class="h-wall" data-part="myocardium"/>

      <!-- chamber cavities -->
      <g class="h-chambers">
        <path d="${PATHS.rightAtrium}"    class="h-part h-chamber" data-part="rightAtrium"/>
        <path d="${PATHS.leftAtrium}"     class="h-part h-chamber" data-part="leftAtrium"/>
        <path d="${PATHS.rightVentricle}" class="h-part h-chamber" data-part="rightVentricle"/>
        <path d="${PATHS.leftVentricle}"  class="h-part h-chamber" data-part="leftVentricle"/>
      </g>

      <path d="${PATHS.septum}" class="h-part h-septum" data-part="septum"/>

      <!-- valve planes -->
      <g class="h-valves" stroke-width="2.5" stroke-linecap="round">
        <path d="${PATHS.valveTricuspid}"/>
        <path d="${PATHS.valveMitral}"/>
      </g>

      <!-- coronary arteries -->
      <g class="h-coronaries" fill="none" stroke-linecap="round">
        <path d="${PATHS.rca}" class="h-part h-coronary" data-part="rca" stroke-width="7"/>
        <path d="${PATHS.lad}" class="h-part h-coronary" data-part="lad" stroke-width="7"/>
        <path d="${PATHS.lcx}" class="h-part h-coronary" data-part="lcx" stroke-width="6"/>
      </g>

      <!-- conduction system -->
      <g class="h-conduction" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <path d="${PATHS.conduction}"    class="h-part h-wire" data-part="conduction"   stroke-width="4"/>
        <path d="${PATHS.leftBundle}"    class="h-part h-wire" data-part="leftBundle"   stroke-width="3.5"/>
        <path d="${PATHS.rightBundle}"   class="h-part h-wire" data-part="rightBundle"  stroke-width="3.5"/>
        <path d="${PATHS.purkinjeLeft}"  class="h-part h-wire h-purkinje" data-part="purkinjeLeft"  stroke-width="2"/>
        <path d="${PATHS.purkinjeRight}" class="h-part h-wire h-purkinje" data-part="purkinjeRight" stroke-width="2"/>
      </g>

      <!-- nodes -->
      <g class="h-nodes">
        <circle cx="${NODES.sa.x}"  cy="${NODES.sa.y}"  r="${NODES.sa.r}"  class="h-part h-node" data-part="sa"/>
        <circle cx="${NODES.av.x}"  cy="${NODES.av.y}"  r="${NODES.av.r}"  class="h-part h-node" data-part="av"/>
        <circle cx="${NODES.his.x}" cy="${NODES.his.y}" r="${NODES.his.r}" class="h-part h-node" data-part="his"/>
      </g>

      <!-- the travelling impulse -->
      <circle class="h-impulse" r="7" cx="${NODES.sa.x}" cy="${NODES.sa.y}"/>
    `;
    mount.appendChild(svg);
    return svg;
  }

  global.Heart = { VB, PATHS, NODES, CHAPTERS, build };
})(window);
