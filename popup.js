/**
 * Chameleon DOM — Popup Controller (`popup.js`)
 * Persists user settings in `chrome.storage.local` and syncs live across open tabs.
 */
(() => {
  const DEFAULT_SETTINGS = {
    enabled: true,
    pausedDomains: {},
    skinMode: 'auto',
    geckoCount: 2,
    size: 1.0,
    speed: 1.0,
    ledgeClimbing: true,
    cursorReaction: 'curious'
  };

  const SWATCH_STYLES = {
    auto: 'conic-gradient(#2ee07a, #3b82f6, #f59e0b, #ec4899, #2ee07a)',
    emerald: 'radial-gradient(circle at 35% 35%, #ff4e2a 0%, #2ecc40 55%, #1b7a2c 100%)',
    leopard: 'radial-gradient(circle at 35% 35%, #2b1d14 0%, #f2b749 55%, #c88a28 100%)',
    tokay: 'radial-gradient(circle at 35% 35%, #ff5a26 0%, #5d8aa8 55%, #3b5f78 100%)'
  };

  const elEnabled = document.getElementById('toggle-enabled');
  const elPauseSite = document.getElementById('toggle-pause-site');
  const elDomainPill = document.getElementById('current-domain');
  const elSkin = document.getElementById('select-skin');
  const elSwatch = document.getElementById('skin-swatch');
  const elCount = document.getElementById('range-count');
  const elValCount = document.getElementById('val-count');
  const elSize = document.getElementById('range-size');
  const elValSize = document.getElementById('val-size');
  const elSpeed = document.getElementById('range-speed');
  const elValSpeed = document.getElementById('val-speed');
  const elLedges = document.getElementById('toggle-ledges');
  const segButtons = Array.from(document.querySelectorAll('.seg-btn'));

  let activeHostname = 'local';
  let currentSettings = { ...DEFAULT_SETTINGS };

  function updateSwatch(mode) {
    if (elSwatch) {
      elSwatch.style.background = SWATCH_STYLES[mode] || SWATCH_STYLES.auto;
    }
  }

  function renderSettingsToUI(s) {
    elEnabled.checked = Boolean(s.enabled);
    elPauseSite.checked = Boolean(s.pausedDomains && s.pausedDomains[activeHostname]);
    elSkin.value = s.skinMode || 'auto';
    updateSwatch(elSkin.value);

    const count = Number(s.geckoCount) || 2;
    elCount.value = String(count);
    elValCount.textContent = String(count);

    const size = Number(s.size) || 1.0;
    elSize.value = size.toFixed(1);
    elValSize.textContent = `${size.toFixed(1)}x`;

    const speed = Number(s.speed) || 1.0;
    elSpeed.value = speed.toFixed(1);
    elValSpeed.textContent = `${speed.toFixed(1)}x`;

    elLedges.checked = s.ledgeClimbing !== false;

    const reaction = s.cursorReaction || 'curious';
    segButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.reaction === reaction);
    });
  }

  function savePatch(patch) {
    currentSettings = { ...currentSettings, ...patch };
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set(patch);
    }
  }

  // Detect active tab's hostname for per-domain pause
  function initActiveTabAndSettings() {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        if (tab && tab.url) {
          try {
            const url = new URL(tab.url);
            activeHostname = url.hostname || 'local';
          } catch (_) {
            activeHostname = 'local';
          }
        }
        elDomainPill.textContent = activeHostname;
        loadStoredSettings();
      });
    } else {
      elDomainPill.textContent = activeHostname;
      loadStoredSettings();
    }
  }

  function loadStoredSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(DEFAULT_SETTINGS, (items) => {
        currentSettings = { ...DEFAULT_SETTINGS, ...items };
        renderSettingsToUI(currentSettings);
      });
    } else {
      renderSettingsToUI(currentSettings);
    }
  }

  // Event bindings
  elEnabled.addEventListener('change', () => {
    savePatch({ enabled: elEnabled.checked });
  });

  elPauseSite.addEventListener('change', () => {
    const nextPaused = { ...(currentSettings.pausedDomains || {}) };
    if (elPauseSite.checked) {
      nextPaused[activeHostname] = true;
    } else {
      delete nextPaused[activeHostname];
    }
    savePatch({ pausedDomains: nextPaused });
  });

  elSkin.addEventListener('change', () => {
    updateSwatch(elSkin.value);
    savePatch({ skinMode: elSkin.value });
  });

  elCount.addEventListener('input', () => {
    const val = parseInt(elCount.value, 10);
    elValCount.textContent = String(val);
    savePatch({ geckoCount: val });
  });

  elSize.addEventListener('input', () => {
    const val = parseFloat(elSize.value);
    elValSize.textContent = `${val.toFixed(1)}x`;
    savePatch({ size: val });
  });

  elSpeed.addEventListener('input', () => {
    const val = parseFloat(elSpeed.value);
    elValSpeed.textContent = `${val.toFixed(1)}x`;
    savePatch({ speed: val });
  });

  elLedges.addEventListener('change', () => {
    savePatch({ ledgeClimbing: elLedges.checked });
  });

  segButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.reaction;
      segButtons.forEach((b) => b.classList.toggle('active', b === btn));
      savePatch({ cursorReaction: mode });
    });
  });

  initActiveTabAndSettings();
})();
