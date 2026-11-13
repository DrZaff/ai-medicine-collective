/* NextSet Sync boot code (nsync.boot.js).
 * Adds the sync service to the bootloader's shared `bleServices` object
 * (Bootloader >= 0.34 calls NRF.setServices once, after every *.boot.js),
 * so it coexists with UART, ANCS/AMS/CTS (iOS Integration) and HID.
 * Runs in every app, so the protocol code itself lives in the "nsync"
 * module and is only loaded when the phone writes something.
 */
(function() {
  var SVC = "d9a50001-3c1f-4b0e-9f5d-7a1e6c2b8f40";
  var fresh = function() { return { buf: "", auth: 0, mtu: 20, q: [], busy: 0, fails: 0 }; };
  global.NSYNC = fresh();
  var o = {};
  o["d9a50002-3c1f-4b0e-9f5d-7a1e6c2b8f40"] = { // phone -> watch
    writable: true, maxLen: 128,
    onWrite: function(e) {
      var st = global.NSYNC;
      st.buf += E.toString(e.data);
      if (st.buf.length > 8192) { st.buf = ""; return; } // garbage: drop
      var i;
      while ((i = st.buf.indexOf("\n")) >= 0) {
        var l = st.buf.substr(0, i);
        st.buf = st.buf.substr(i + 1);
        if (l.length) require("nsync").onLine(st, l);
      }
    }
  };
  o["d9a50003-3c1f-4b0e-9f5d-7a1e6c2b8f40"] = { // watch -> phone
    notify: true, readable: true, maxLen: 128, value: [0]
  };
  if (typeof bleServices == "object") bleServices[SVC] = o;
  else { var s = {}; s[SVC] = o; NRF.setServices(s, { uart: true }); } // very old bootloader
  NRF.on("disconnect", function() {
    global.NSYNC = fresh();
    if (Modules.getCached().indexOf("nsync") >= 0 && !global.NSYNC_APP) Modules.removeCached("nsync");
  });
})();
