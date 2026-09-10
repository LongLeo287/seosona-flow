// Hạ tầng WebGL dùng chung cho các landing page SEOSONA.
// three.js pin ở 0.184.0, nạp bằng URL tuyệt đối nên không cần import map.
const THREE_URL = 'https://unpkg.com/three@0.184.0/build/three.module.js';

let threePromise = null;
export function loadThree() {
  if (!threePromise) threePromise = import(THREE_URL);
  return threePromise;
}

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Dựng một stage WebGL bám theo kích thước của canvas.
 * onFrame(t, dt, ctx) được gọi mỗi khung hình; trả về ctx để build scene bên ngoài.
 *
 * Trả về { THREE, scene, camera, renderer, setFrame, dispose, pointer }
 * - pointer: {x, y} trong [-1, 1], đã làm mượt, cập nhật trong đúng một vòng rAF
 * - scrollProgress(): tiến độ cuộn của canvas qua khung nhìn, [0, 1]
 * - reduced: true nếu hệ điều hành bật giảm chuyển động (vẫn vẽ một khung tĩnh)
 */
export async function createStage(canvas, opts = {}) {
  const THREE = await loadThree();
  const reduced = prefersReducedMotion();

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: opts.alpha !== false,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  if (opts.shadows) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  if (opts.background) scene.background = new THREE.Color(opts.background);
  if (opts.fog) scene.fog = new THREE.Fog(opts.fog.color, opts.fog.near, opts.fog.far);

  const camera = new THREE.PerspectiveCamera(opts.fov || 45, 1, 0.1, 200);
  camera.position.set(...(opts.cameraPos || [0, 0, 8]));
  camera.lookAt(0, 0, 0);

  const size = { w: 1, h: 1 };
  // Gán sau khi ctx tồn tại; ở lần resize() đầu tiên nó còn null nên được bỏ qua.
  let renderOnce = null;
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    if (w === size.w && h === size.h) return;
    size.w = w; size.h = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (opts.onResize) opts.onResize(w, h, camera);
    // Nhánh giảm chuyển động không chạy vòng lặp, nên phải tự vẽ lại
    // sau mỗi lần đổi kích thước — nếu không canvas trắng tới lúc tải lại trang.
    if (renderOnce) renderOnce();
  };
  resize();

  let ro = null;
  if ('ResizeObserver' in window) {
    ro = new ResizeObserver(resize);
    ro.observe(canvas);
  } else {
    window.addEventListener('resize', resize);
  }

  // Con trỏ — một vòng rAF duy nhất, không restyle mỗi mousemove
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const onPointer = (e) => {
    const r = canvas.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) return;
    pointer.tx = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.ty = ((e.clientY - r.top) / r.height) * 2 - 1;
  };
  if (!reduced) window.addEventListener('pointermove', onPointer, { passive: true });

  const scrollProgress = () => {
    const r = canvas.getBoundingClientRect();
    const span = window.innerHeight + r.height;
    if (span <= 0) return 0;
    return Math.min(1, Math.max(0, (window.innerHeight - r.top) / span));
  };

  let visible = true;
  let io = null;
  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver((es) => { visible = es[0].isIntersecting; }, { rootMargin: '120px' });
    io.observe(canvas);
  }

  let frameCb = null;
  const setFrame = (cb) => { frameCb = cb; };

  let raf = null, last = performance.now(), t = 0, stopped = false, onVisible = null;
  const ctx = { THREE, scene, camera, renderer, pointer, scrollProgress, size };

  const tick = (now) => {
    if (stopped) return;
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!visible) return;
    if (!reduced) {
      t += dt;
      pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 5);
      pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 5);
    }
    if (frameCb) frameCb(t, reduced ? 0 : dt, ctx);
    renderer.render(scene, camera);
  };

  if (reduced) {
    renderOnce = () => { if (frameCb) frameCb(t, 0, ctx); renderer.render(scene, camera); };
    // Vẽ ngay một khung, đồng bộ — không chờ rAF vì tab ẩn thì rAF không chạy
    renderOnce();
  } else {
    renderOnce = () => { if (frameCb) frameCb(t, 0, ctx); renderer.render(scene, camera); };
    renderOnce();
    raf = requestAnimationFrame(tick);
    // Tab ẩn lúc mount thì vòng lặp không bắt đầu — khởi động lại khi hiện ra
    onVisible = () => {
      if (stopped || document.hidden) return;
      last = performance.now();
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    document.addEventListener('visibilitychange', onVisible);
  }

  const dispose = () => {
    stopped = true;
    renderOnce = null;
    if (onVisible) document.removeEventListener('visibilitychange', onVisible);
    if (raf) cancelAnimationFrame(raf);
    if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
    if (io) io.disconnect();
    window.removeEventListener('pointermove', onPointer);
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((x) => x && x.dispose());
      else if (m) m.dispose();
    });
    renderer.dispose();
  };

  return Object.assign(ctx, { reduced, setFrame, dispose, resize, forceRender: () => { if (renderOnce) renderOnce(); } });
}

/** Chờ một phần tử xuất hiện trong DOM — template stream sau khi logic class mount,
 *  nên querySelector ngay lúc componentDidMount có thể trả null. */
export function waitForElement(selector, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const now = document.querySelector(selector);
    if (now) return resolve(now);
    const t0 = performance.now();
    let mo = null;
    const done = (el, err) => {
      if (mo) mo.disconnect();
      err ? reject(err) : resolve(el);
    };
    if ('MutationObserver' in window) {
      mo = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) done(el);
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
    }
    const poll = () => {
      const el = document.querySelector(selector);
      if (el) return done(el);
      if (performance.now() - t0 > timeout) return done(null, new Error('waitForElement quá hạn: ' + selector));
      setTimeout(poll, 32);
    };
    setTimeout(poll, 0);
  });
}

/** Lịch một lần gọi theo khung hình, nhưng KHÔNG phụ thuức rAF:
 *  tab ẩn thì rAF không chạy, và mọi latch dựa vào rAF sẽ chết vĩnh viễn. */
export function schedule(fn) {
  let pending = false;
  return function scheduled() {
    if (pending) return;
    pending = true;
    const run = () => { pending = false; fn(); };
    if (typeof document !== 'undefined' && document.hidden) setTimeout(run, 0);
    else if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 16);
  };
}

/** Bọc một promise bằng hạn thỏi gian dựa trên setTimeout — một dynamic import
 *  treo mãi sẽ thành lỗi bắt được, thay vì đứng im không dấu vết. */
export function withTimeout(promise, ms, what) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('quá hạn ' + ms + 'ms: ' + what)), ms))
  ]);
}

/** Tải webgl-stage.js bằng URL tuyệt đối suy từ document.baseURI.
 *  Logic class có thể được đánh giá ở ngự cảnh có base khác, nên './x.js' không đáng tin. */
export function stageModuleUrl() {
  return new URL('webgl-stage.js', document.baseURI).href;
}

/** Ba đèn kiểu studio, đủ để MeshStandardMaterial đọc được khối. */
export function studioLights(THREE, scene, { key = 0xffffff, fill = 0x8899aa, intensity = 1 } = {}) {
  const amb = new THREE.HemisphereLight(key, fill, 0.55 * intensity);
  scene.add(amb);
  const k = new THREE.DirectionalLight(key, 1.15 * intensity);
  k.position.set(4, 6, 5);
  scene.add(k);
  const r = new THREE.DirectionalLight(fill, 0.5 * intensity);
  r.position.set(-5, 2, -4);
  scene.add(r);
  return { amb, key: k, rim: r };
}
