/**
 * BrandingService — single source of truth for logos and brand identity.
 *
 * Logos are stored directly as raw strings in their own localStorage keys
 * (vift_logo_dark / vift_logo_light), bypassing the settings JSON blob.
 * This avoids QuotaExceededError from JSON.stringify on large base64 images.
 *
 * Falls back to static PNG files if no upload exists.
 * Dispatches 'brandingUpdated' so sidebar/login can refresh.
 *
 * Auto-contrast: logo variant is chosen based on background luminance.
 *   surfaceIsDark(hex) uses WCAG relative luminance.
 *   logoDark()    → white logo (for dark surfaces — never falls back to black)
 *   logoLight()   → black logo (for light surfaces)
 *   logoForBg(hex) → picks correct variant automatically
 */
const BrandingService = {
  /* Static fallbacks — PNG files, transparent background */
  FALLBACK_DARK:  '/assets/vift-logo-white.png',  /* dark surface  → white logo */
  FALLBACK_LIGHT: '/assets/vift-logo-black.png',  /* light surface → black logo */

  _LS_DARK:  'vift_logo_dark',   /* custom logo for dark surfaces */
  _LS_LIGHT: 'vift_logo_light',  /* custom logo for light surfaces */

  /* ── Luminance & surface detection ─────────────────────── */

  /* WCAG relative luminance, 0=black 1=white */
  _lum(hex) {
    try {
      let h = (hex || '').replace('#', '');
      if (h.length === 3) h = h.split('').map(c => c + c).join('');
      const lin = s => { const v = parseInt(s, 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * lin(h.slice(0, 2)) + 0.7152 * lin(h.slice(2, 4)) + 0.0722 * lin(h.slice(4, 6));
    } catch (e) { return 0; } /* default dark on parse error */
  },

  /* Returns true when the surface is dark enough to need a white logo */
  surfaceIsDark(hex) {
    return this._lum(hex || '#0A1628') < 0.18;
  },

  /* ── Logo getters ───────────────────────────────────────── */

  /* Logo for dark surfaces (always returns a light/white logo) */
  logoDark() {
    try { return localStorage.getItem(this._LS_DARK) || this.FALLBACK_DARK; }
    catch (e) { return this.FALLBACK_DARK; }
  },

  /* Logo for light surfaces (always returns a dark/black logo) */
  logoLight() {
    try { return localStorage.getItem(this._LS_LIGHT) || this.FALLBACK_LIGHT; }
    catch (e) { return this.FALLBACK_LIGHT; }
  },

  /* Auto-pick logo based on background hex colour */
  logoForBg(hex) {
    return this.surfaceIsDark(hex) ? this.logoDark() : this.logoLight();
  },

  /* Absolute URL of the light-surface (black) logo — for email/PDF */
  logoLightAbsolute() {
    const u = this.logoLight();
    return u.startsWith('data:') ? u : window.location.origin + u;
  },

  /* ── DOM helpers ─────────────────────────────────────────── */

  /* Apply correct logo to the login screen (login bg is always dark navy) */
  applyToLogin() {
    const img = document.getElementById('login-logo-img');
    if (img) img.src = this.logoDark();
  },


  /* Reads computed bg colour from surfaceEl, picks logo automatically.
     Never uses CSS filter/invert. */
  applyAutoLogo(imgEl, surfaceEl) {
    if (!imgEl || !surfaceEl) return;
    try {
      const bg = getComputedStyle(surfaceEl).backgroundColor || '';
      /* parse rgb(r,g,b) or rgba(r,g,b,a) */
      const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (m) {
        const r = parseInt(m[1]), g = parseInt(m[2]), b = parseInt(m[3]);
        const hex = '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
        imgEl.src = this.logoForBg(hex);
        return;
      }
    } catch (e) {}
    imgEl.src = this.logoDark(); /* safe default */
  },

  /* Apply logo to any <img> element based on the hex background colour */
  applyLogoForBg(imgEl, hexBg) {
    if (!imgEl) return;
    imgEl.src = this.logoForBg(hexBg);
  },

  /* ── Brand updates ──────────────────────────────────────── */

  update(data) {
    try {
      if (data.logoLight !== undefined) {
        if (data.logoLight) localStorage.setItem(this._LS_LIGHT, data.logoLight);
        else localStorage.removeItem(this._LS_LIGHT);
      }
      if (data.logoDark !== undefined) {
        if (data.logoDark) localStorage.setItem(this._LS_DARK, data.logoDark);
        else localStorage.removeItem(this._LS_DARK);
      }
    } catch (e) {
      console.warn('[BrandingService] logo storage failed — image may be too large', e);
    }
    const nonLogo = Object.assign({}, data);
    delete nonLogo.logoLight;
    delete nonLogo.logoDark;
    if (Object.keys(nonLogo).length > 0) {
      state.settings = Object.assign({}, state.settings || {}, nonLogo);
      persist();
    }
    this.applyColors();
    document.dispatchEvent(new CustomEvent('brandingUpdated'));
  },

  clearLogo(field) {
    try {
      if (field === 'logoLight') localStorage.removeItem(this._LS_LIGHT);
      if (field === 'logoDark')  localStorage.removeItem(this._LS_DARK);
    } catch (e) {}
    document.dispatchEvent(new CustomEvent('brandingUpdated'));
  },

  _yiqText(hex) {
    try {
      const h = hex.replace('#', '');
      const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
      const r = parseInt(full.slice(0, 2), 16), g = parseInt(full.slice(2, 4), 16), b = parseInt(full.slice(4, 6), 16);
      return (r * 299 + g * 587 + b * 114) / 1000 >= 128 ? '#111827' : '#ffffff';
    } catch (e) { return '#ffffff'; }
  },

  applyColors() {
    const s = state && state.settings ? state.settings : {};
    const hexRe = /^#[0-9a-fA-F]{3,6}$/;
    const primary   = hexRe.test(s.primaryColor   || '') ? s.primaryColor   : '#0f3763';
    const secondary = hexRe.test(s.secondaryColor || '') ? s.secondaryColor : '#1d75d8';
    try {
      document.documentElement.style.setProperty('--brand-primary',        primary);
      document.documentElement.style.setProperty('--brand-secondary',      secondary);
      document.documentElement.style.setProperty('--brand-primary-text',   this._yiqText(primary));
      document.documentElement.style.setProperty('--brand-secondary-text', this._yiqText(secondary));
    } catch (e) {}

    /* Auto-refresh logos when brand colour changes */
    this.applyToLogin();
    const navBrandImg = document.querySelector('.nav-brand-img');
    if (navBrandImg) navBrandImg.src = this.logoForBg(primary);
  },
};
