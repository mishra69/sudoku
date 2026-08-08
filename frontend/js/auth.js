// Google Identity Services glue.
//
// GIS is loaded from Google's CDN, so it is the one part of the app that can't
// work offline. That's fine — signing in needs the network anyway — but the
// rest of the shell must not depend on it having loaded.

const Auth = {
  _clientId: null,
  _rendered: false,

  // Mount the Google button on the login screen. Safe to call repeatedly.
  async mountButton() {
    if (this._rendered) return;
    const slot = document.getElementById('google-btn');
    const err = document.getElementById('login-error');
    if (!slot) return;

    const fail = msg => {
      if (err) { err.textContent = msg; err.style.display = 'block'; }
    };

    if (!navigator.onLine) {
      fail('You need to be online to sign in.');
      return;
    }

    try {
      if (!this._clientId) {
        const cfg = await fetch(CONFIG.API_BASE + '/auth/config').then(r => r.json());
        this._clientId = cfg.clientId;
      }
      if (!this._clientId) {
        fail('Sign-in is not configured on the server.');
        return;
      }

      const gis = await this._waitForGis();
      if (!gis) {
        fail("Couldn't reach Google sign-in. Check your connection and reload.");
        return;
      }

      gis.initialize({
        client_id: this._clientId,
        callback: resp => this._onCredential(resp),
        // Chrome's One Tap prompt is skipped: in an installed PWA it competes
        // with the app's own UI, and the explicit button is more predictable.
        auto_select: false,
        cancel_on_tap_outside: true,
      });

      gis.renderButton(slot, {
        type: 'standard',
        theme: document.documentElement.dataset.theme === 'dark' ? 'filled_black' : 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'pill',
        logo_alignment: 'center',
        width: Math.min(320, slot.clientWidth || 280),
      });
      this._rendered = true;
    } catch (e) {
      fail("Couldn't start sign-in. Please reload.");
      console.error('[auth] mount failed', e);
    }
  },

  // GIS loads async from a <script defer>; poll briefly rather than racing it.
  _waitForGis(timeoutMs = 8000) {
    const start = Date.now();
    return new Promise(resolve => {
      const tick = () => {
        const gis = window.google && window.google.accounts && window.google.accounts.id;
        if (gis) return resolve(gis);
        if (Date.now() - start > timeoutMs) return resolve(null);
        setTimeout(tick, 100);
      };
      tick();
    });
  },

  async _onCredential(response) {
    const err = document.getElementById('login-error');
    try {
      const data = await API.googleSignIn(response.credential);
      document.getElementById('welcome-name').textContent = data.name;
      UI.showScreen('menu');
      Sound.tap();
      App.maybePromptInstall();
    } catch (e) {
      if (err) { err.textContent = e.message || 'Sign-in failed.'; err.style.display = 'block'; }
    }
  },

  // Stop Google from silently re-signing the user in after an explicit logout.
  signOutHint() {
    const gis = window.google && window.google.accounts && window.google.accounts.id;
    if (gis) gis.disableAutoSelect();
    this._rendered = false;
  },
};
