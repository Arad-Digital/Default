/**
 * Slack UI Tweaker — tiny DOM helpers shared by the popup and the in-page UI.
 *
 * Everything is built with createElement/createElementNS, never innerHTML: it works on pages that
 * enforce Trusted Types and text coming from Slack or from imported rules is never parsed as markup.
 */
(function (root) {
  'use strict';

  const SUT = (root.SUT = root.SUT || {});
  const SVG_NS = 'http://www.w3.org/2000/svg';

  /** Feather-style 24×24 stroke icons, described as [tag, attributes] pairs. */
  const ICONS = Object.freeze({
    target: [
      ['circle', { cx: 12, cy: 12, r: 9 }],
      ['circle', { cx: 12, cy: 12, r: 3 }],
      ['line', { x1: 12, y1: 1, x2: 12, y2: 5 }],
      ['line', { x1: 12, y1: 19, x2: 12, y2: 23 }],
      ['line', { x1: 1, y1: 12, x2: 5, y2: 12 }],
      ['line', { x1: 19, y1: 12, x2: 23, y2: 12 }],
    ],
    eyeOff: [
      ['path', { d: 'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94' }],
      ['path', { d: 'M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19' }],
      ['path', { d: 'M14.12 14.12a3 3 0 1 1-4.24-4.24' }],
      ['line', { x1: 1, y1: 1, x2: 23, y2: 23 }],
    ],
    eye: [
      ['path', { d: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z' }],
      ['circle', { cx: 12, cy: 12, r: 3 }],
    ],
    pointer: [
      ['path', { d: 'M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z' }],
      ['path', { d: 'M13 13l6 6' }],
    ],
    droplet: [['path', { d: 'M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z' }]],
    compress: [
      ['polyline', { points: '4 14 10 14 10 20' }],
      ['polyline', { points: '20 10 14 10 14 4' }],
      ['line', { x1: 14, y1: 10, x2: 21, y2: 3 }],
      ['line', { x1: 3, y1: 21, x2: 10, y2: 14 }],
    ],
    chevrons: [
      ['polyline', { points: '7 13 12 18 17 13' }],
      ['polyline', { points: '7 6 12 11 17 6' }],
    ],
    code: [
      ['polyline', { points: '16 18 22 12 16 6' }],
      ['polyline', { points: '8 6 2 12 8 18' }],
    ],
    sliders: [
      ['line', { x1: 4, y1: 21, x2: 4, y2: 14 }],
      ['line', { x1: 4, y1: 10, x2: 4, y2: 3 }],
      ['line', { x1: 12, y1: 21, x2: 12, y2: 12 }],
      ['line', { x1: 12, y1: 8, x2: 12, y2: 3 }],
      ['line', { x1: 20, y1: 21, x2: 20, y2: 16 }],
      ['line', { x1: 20, y1: 12, x2: 20, y2: 3 }],
      ['line', { x1: 1, y1: 14, x2: 7, y2: 14 }],
      ['line', { x1: 9, y1: 8, x2: 15, y2: 8 }],
      ['line', { x1: 17, y1: 16, x2: 23, y2: 16 }],
    ],
    arrowUp: [
      ['line', { x1: 12, y1: 19, x2: 12, y2: 5 }],
      ['polyline', { points: '5 12 12 5 19 12' }],
    ],
    arrowDown: [
      ['line', { x1: 12, y1: 5, x2: 12, y2: 19 }],
      ['polyline', { points: '19 12 12 19 5 12' }],
    ],
    close: [
      ['line', { x1: 18, y1: 6, x2: 6, y2: 18 }],
      ['line', { x1: 6, y1: 6, x2: 18, y2: 18 }],
    ],
    check: [['polyline', { points: '20 6 9 17 4 12' }]],
    alert: [
      ['path', { d: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z' }],
      ['line', { x1: 12, y1: 9, x2: 12, y2: 13 }],
      ['line', { x1: 12, y1: 17, x2: 12.01, y2: 17 }],
    ],
    trash: [
      ['polyline', { points: '3 6 5 6 21 6' }],
      ['path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }],
    ],
    edit: [['path', { d: 'M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z' }]],
    download: [
      ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
      ['polyline', { points: '7 10 12 15 17 10' }],
      ['line', { x1: 12, y1: 15, x2: 12, y2: 3 }],
    ],
    upload: [
      ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
      ['polyline', { points: '17 8 12 3 7 8' }],
      ['line', { x1: 12, y1: 3, x2: 12, y2: 15 }],
    ],
    external: [
      ['path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }],
      ['polyline', { points: '15 3 21 3 21 9' }],
      ['line', { x1: 10, y1: 14, x2: 21, y2: 3 }],
    ],
    refresh: [
      ['polyline', { points: '23 4 23 10 17 10' }],
      ['path', { d: 'M20.49 15a9 9 0 1 1-2.12-9.36L23 10' }],
    ],
  });

  /**
   * Creates an element.
   * - `class`, `text` and `on<event>` (functions) are handled specially;
   * - `value`, booleans and numbers are assigned as properties when the element has them;
   * - everything else becomes an attribute. `null`/`undefined` props and children are skipped.
   * @param {string} tag
   * @param {Object<string, any>|null} [props]
   * @param {...any} children Nodes, strings or (nested) arrays of them
   * @returns {HTMLElement}
   */
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (value == null) continue;
        if (key === 'class') el.className = value;
        else if (key === 'text') el.textContent = value;
        else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
        else if (key === 'value' || typeof value === 'boolean' || typeof value === 'number') {
          if (key in el) el[key] = value;
          else if (value !== false) el.setAttribute(key, value === true ? '' : String(value));
        } else el.setAttribute(key, String(value));
      }
    }
    for (const child of children.flat(Infinity)) {
      if (child == null || child === false) continue;
      el.append(child instanceof Node ? child : String(child));
    }
    return el;
  }

  /**
   * @param {keyof typeof ICONS} name
   * @param {number} [size]
   * @returns {SVGSVGElement}
   */
  function icon(name, size = 16) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    const attrs = {
      viewBox: '0 0 24 24',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      focusable: 'false',
    };
    for (const [key, value] of Object.entries(attrs)) svg.setAttribute(key, String(value));
    for (const [tag, shapeAttrs] of ICONS[name] || []) {
      const shape = document.createElementNS(SVG_NS, tag);
      for (const [key, value] of Object.entries(shapeAttrs)) shape.setAttribute(key, String(value));
      svg.append(shape);
    }
    return svg;
  }

  SUT.dom = Object.freeze({ h, icon, ICONS });
})(globalThis);
