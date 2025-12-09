(function () {
  // ---- Detection helpers ----
  function isIos() {
    const ua = window.navigator.userAgent || "";
    const platform = window.navigator.platform || "";

    const iOSDevices = ["iPhone", "iPad", "iPod"];
    const isIOSPlatform = iOSDevices.some((d) => platform.includes(d));

    const isIOSUA = /iPhone|iPad|iPod/i.test(ua);

    return isIOSPlatform || isIOSUA;
  }

  function isInStandaloneMode() {
    // iOS Safari PWA
    if (window.navigator.standalone) return true;
    // Other browsers / newer spec
    return window.matchMedia &&
      window.matchMedia("(display-mode: standalone)").matches;
  }

  const STORAGE_KEY = "iosInstallHintDismissed_v1";

  function shouldShowHint() {
    if (!isIos()) return false;
    if (isInStandaloneMode()) return false;
    if (localStorage.getItem(STORAGE_KEY) === "true") return false;
    return true;
  }

  function setupHint() {
    const banner = document.getElementById("ios-install-hint");
    if (!banner) return;

    const closeBtn = banner.querySelector(".ios-install-hint-close");

    if (!shouldShowHint()) {
      banner.classList.add("ios-install-hint-hidden");
      return;
    }

    // Show banner
    banner.classList.remove("ios-install-hint-hidden");

    // Close handler
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        banner.classList.add("ios-install-hint-hidden");
        try {
          localStorage.setItem(STORAGE_KEY, "true");
        } catch (e) {
          // ignore storage issues
        }
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupHint);
  } else {
    setupHint();
  }
})();
