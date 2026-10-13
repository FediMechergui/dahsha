/* Flixer player: HLS (<video> + Hls.js) or an embedded third-party player, a server bar with
   automatic failover, and a fullscreen toggle. Playback logic ported from the Flixer React
   player (client/src/components/Player.jsx). Exposes window.FlixerPlayer.mount(container, opts). */

(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const ICON = {
    fs: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>',
    fsExit: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-14v3h3v2h-5V5h2z"/></svg>'
  };

  // Player 2 first when present: the most reliable embed in practice, then the list order.
  function initialIndex(servers) {
    const i = servers.findIndex(s => (s.name || "").toLowerCase().includes("player 2"));
    return i !== -1 ? i : 0;
  }

  function mount(container, opts) {
    const servers = Array.isArray(opts.servers) ? opts.servers : [];
    const st = { idx: initialIndex(servers), hls: null, destroyed: false, noticeTimer: null };

    container.innerHTML = `<div class="player" tabindex="-1">
      <div class="player__bar">
        <div class="player__servers" id="pl-servers"></div>
        <button type="button" class="player__fs" data-fs aria-label="Fullscreen">${ICON.fs}</button>
      </div>
      <div class="player__hot" data-hot aria-hidden="true"></div>
      <div class="player__stage" id="pl-stage"></div>
      <div class="player__notice" id="pl-notice" hidden></div>
    </div>`;
    const root = $(".player", container);
    const stage = $("#pl-stage", root);
    const notice = $("#pl-notice", root);
    const bar = $("#pl-servers", root);
    const fsBtn = $("[data-fs]", root);

    function renderBar() {
      if (servers.length <= 1) { bar.hidden = true; return; }
      bar.hidden = false;
      bar.innerHTML = `<span class="player__bar-title"><i class="dot"></i>Server</span>` +
        servers.map((s, i) => `<button type="button" class="player__srv ${i === st.idx ? "is-active" : ""}" data-i="${i}" title="Switch to ${esc(s.name)}">${esc(s.name)}</button>`).join("");
      $$("[data-i]", bar).forEach(b => b.addEventListener("click", () => load(+b.dataset.i)));
      const active = $(".is-active", bar);
      if (active && active.scrollIntoView) active.scrollIntoView({ inline: "nearest", block: "nearest" });
    }

    function showNotice(text) {
      notice.innerHTML = `<span class="spinner"></span><span>${esc(text)}</span>`;
      notice.hidden = false;
      clearTimeout(st.noticeTimer);
      st.noticeTimer = setTimeout(() => { notice.hidden = true; }, 2500);
    }

    function teardownMedia() {
      if (st.hls) { try { st.hls.destroy(); } catch { /* already gone */ } st.hls = null; }
      const v = $("video", stage);
      if (v) { try { v.pause(); v.removeAttribute("src"); v.load(); } catch { /* ignore */ } }
      stage.innerHTML = "";
    }

    function load(i) {
      if (st.destroyed) return;
      st.idx = i;
      renderBar();
      teardownMedia();
      const s = servers[i];
      if (!s) return showError();
      if (s.type === "hls" && s.streamUrl) return loadHls(s);
      if (s.embedUrl) return loadEmbed(s);
      failover();
    }

    function loadHls(s) {
      stage.innerHTML = `<video controls playsinline preload="auto" ${opts.poster ? `poster="${esc(opts.poster)}"` : ""}></video>`;
      const v = $("video", stage);
      v.addEventListener("error", () => failover());
      v.addEventListener("timeupdate", () => { if (v.duration > 0 && opts.onProgress) opts.onProgress(v.currentTime, v.duration); });
      v.addEventListener("ended", () => { if (opts.onEnded) opts.onEnded(); });
      const seek = () => { if (opts.startAt > 0) { try { v.currentTime = opts.startAt; } catch { /* not seekable yet */ } } };
      if (v.canPlayType("application/vnd.apple.mpegurl")) {
        v.src = s.streamUrl;
        v.addEventListener("loadedmetadata", seek, { once: true });
        v.play().catch(() => {});
      } else if (window.Hls && window.Hls.isSupported()) {
        const hls = new window.Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 90 });
        st.hls = hls;
        hls.loadSource(s.streamUrl);
        hls.attachMedia(v);
        hls.on(window.Hls.Events.MANIFEST_PARSED, () => { seek(); v.play().catch(() => {}); });
        hls.on(window.Hls.Events.ERROR, (_, data) => { if (data && data.fatal) { console.warn("[player] HLS fatal error:", data.type, data.details); failover(); } });
      } else {
        v.src = s.streamUrl;
        v.play().catch(() => {});
      }
    }

    function loadEmbed(s) {
      stage.innerHTML = `<iframe src="${esc(s.embedUrl)}" title="${esc(opts.title || "Player")}" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen frameborder="0" referrerpolicy="no-referrer-when-downgrade"></iframe>`;
    }

    function failover() {
      if (st.destroyed) return;
      const cur = servers[st.idx];
      let next = st.idx + 1;
      if (cur && cur.type === "hls") {
        const e = servers.findIndex((s, i) => i > st.idx && s.type === "embed");
        if (e !== -1) next = e;
      }
      if (next < servers.length) {
        showNotice(`${cur ? cur.name : "Server"} unavailable. Switching to ${servers[next].name}…`);
        setTimeout(() => load(next), 600);
      } else {
        showError();
      }
    }

    function showError() {
      teardownMedia();
      stage.innerHTML = `<div class="player__error">
        <p>Unable to play this title on any server right now.</p>
        <div class="player__error-actions">
          ${servers.length ? `<button type="button" class="btn btn--primary btn--sm" data-retry>Retry servers</button>` : ""}
          ${opts.sourceUrl ? `<a class="btn btn--outline btn--sm" href="${esc(opts.sourceUrl)}" target="_blank" rel="noopener">Open source page</a>` : ""}
        </div></div>`;
      const r = $("[data-retry]", stage);
      if (r) r.addEventListener("click", () => load(initialIndex(servers)));
    }

    /* Fullscreen: the whole player box goes fullscreen so the server bar stays reachable.
       iOS Safari only allows <video> itself, hence the webkitEnterFullscreen fallback. */
    function toggleFullscreen() {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) { const p = exit.call(document); if (p && p.catch) p.catch(() => {}); }
        return;
      }
      const v = $("video", stage);
      if (root.requestFullscreen) root.requestFullscreen().catch(() => { if (v && v.webkitEnterFullscreen) v.webkitEnterFullscreen(); });
      else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
      else if (v && v.webkitEnterFullscreen) v.webkitEnterFullscreen();
    }
    /* In fullscreen the server list is masked; a tap on the top strip (or moving the pointer
       there) shows it for a few seconds. The exit button stays visible. */
    let uiTimer = null;
    const revealUi = () => {
      if (!root.classList.contains("is-fullscreen")) return;
      root.classList.add("show-ui");
      clearTimeout(uiTimer);
      uiTimer = setTimeout(() => root.classList.remove("show-ui"), 3000);
    };
    const onFsChange = () => {
      const on = !!(document.fullscreenElement || document.webkitFullscreenElement);
      root.classList.toggle("is-fullscreen", on);
      root.classList.remove("show-ui");
      clearTimeout(uiTimer);
      fsBtn.innerHTML = on ? ICON.fsExit : ICON.fs;
      fsBtn.setAttribute("aria-label", on ? "Exit fullscreen" : "Fullscreen");
    };
    // Reveal only once the tap on the strip has completed, so the same tap can never land on a
    // server button that appears underneath it.
    const hot = $("[data-hot]", root);
    hot.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); setTimeout(revealUi, 60); });
    hot.addEventListener("pointermove", e => { if (e.pointerType === "mouse") revealUi(); });
    bar.addEventListener("pointerdown", revealUi);
    bar.addEventListener("pointermove", revealUi);
    fsBtn.addEventListener("click", toggleFullscreen);
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);

    if (servers.length) load(st.idx); else showError();

    return {
      switchTo: load,
      destroy() {
        st.destroyed = true;
        clearTimeout(st.noticeTimer);
        clearTimeout(uiTimer);
        document.removeEventListener("fullscreenchange", onFsChange);
        document.removeEventListener("webkitfullscreenchange", onFsChange);
        teardownMedia();
        container.innerHTML = "";
      }
    };
  }

  window.FlixerPlayer = { mount };
})();
