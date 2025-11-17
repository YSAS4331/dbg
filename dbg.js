(() => {
  let Win = null;
  function camelToDot(key) {
    return key.replace(/([A-Z])/g, (match) => "." + match.toLowerCase());
  }
  function Pathset(key, value, moduleName) {
    moduleName = `_${moduleName}`;
    const path = camelToDot(key).split(".");
    let target = window.dbgMinJs_DBG[moduleName];
    for (let i = 0; i<path.length-1;i++) {
      if (!(path[i] in target)) {
        throw new Error(`Invalid path: ${path.slice(0, i+1).join(".")}`);
      }
      target = target[path[i]];
    }
    const lastKey = path[path.length-1];
    if (!(lastKey in target)) {
      throw new Error(`Invalid key: ${path.join(".")}`);
    }
    const oldValue = target[lastKey];
    target[lastKey] = value;

    window.dispatchEvent(new CustomEvent("DBGChanged", {
      detail: {
        key,
        path: path.join("."),
        oldValue,
        newValue: value,
        timestamp: Date.now()
      }
    }));

    return value;
  }
  function Pathget(key, moduleName) {
    moduleName = `_${moduleName}`;
    const path = camelToDot(key).split(".");
    let target = window.dbgMinJs_DBG[moduleName];
  
    for (let p of path) {
      if (!(p in target)) {
        throw new Error(`Invalid key: ${path.join(".")}`);
      }
      target = target[p];
    }
  
    return target;
  }
  window.dbgMinJs_DBG = {
    _settings: {
      logs: {
        max: 1000
      },
      mode: 'tab',
      highlight: 'vs',
      theme: 'light'
    },
    _consoles: {
      logs: []
    },
    setting: {
      set(key, value) {
        return Pathset(key, value, 'settings');
      },
      get(key) {
        return Pathget(key, 'settings');
      }
    },
    logs: {
      set(key, value) {
        return Pathset(key, value, 'consoles');
      },
      get(key) {
        return Pathget(key, 'consoles');
      }
    }
  };
  window.addEventListener('DBGChanged', (e) => {
    const { path, newValue } = e.detail;

    switch (path) {
      case 'logs':
        if (Win && !Win.closed) {
          const htmlLogs = API.logs.get('logs').map(entry => {
            const argsStr = entry.args.map(a =>
              (typeof a === "string" ? a : JSON.stringify(a))
            ).join(" ");
  
            const safeArgsStr = argsStr.replace(/</g, "&lt;").replace(/>/g, "&gt;");
            const safeLocation = entry.location.replace(/</g, "&lt;").replace(/>/g, "&gt;");
            const timeStr = new Date(entry.timestamp).toLocaleString();
  
            return `
                <div class="${entry.type}">
                  <p>${safeArgsStr}</p>
                  <time>${timeStr}</time>
                  <div class="at">${safeLocation}</div>
                </div>
              `;
          }).join("");
          Win.document.querySelector('#log').innerHTML = htmlLogs;
        }
      default:
        break;
    }
  });
  let MDNLink = '';
  const API = window.dbgMinJs_DBG;
  try {
    const trackedEvents = new WeakMap();
    const origAdd = Element.prototype.addEventListener;
    
    Element.prototype.addEventListener = function(type, listener, options) {
      if (!trackedEvents.has(this)) {
        trackedEvents.set(this, []);
      }
      trackedEvents.get(this).push({ type, listener, options });
      return origAdd.call(this, type, listener, options);
    };
    function getCallerLocation() {
      const err = new Error();
      const stack = err.stack.split("\n");
      const callerLine = stack[3] || stack[2]; 
      return callerLine.trim();
    }
    
    const origConsole = { ...console };
    let logHistory = API.logs.get('logs');
    const MAX_LOGS = 1000;
    
    Object.keys(console).forEach(type => {
      if (typeof console[type] === "function") {
        if (type === "clear") {
          console.clear = () => {
            origConsole.clear();
            logHistory = [];
            API.logs.set('logs', []);
          };
        } else {
          console[type] = (...args) => {
            const location = getCallerLocation();
            logHistory.push({ type, args, location, timestamp: Date.now() });
            if (logHistory.length > MAX_LOGS) logHistory.shift();
            origConsole[type].apply(origConsole, args);
            API.logs.set('logs', logHistory);
          };
        }
      }
    });


    const thisScript = document.currentScript;
    if (!thisScript) return;
    try {
      const url = new URL(thisScript.src, window.location.href);
      if (url.searchParams.get("db") !== "tr") return;
    } catch { return; }

    window.addEventListener("DOMContentLoaded", () => {
      const INSPECTOR_Z = 2147483647;

      const highlight = document.createElement("div");
      Object.assign(highlight.style, {
        position: "fixed",
        pointerEvents: "none",
        border: "2px solid #00e1ff",
        background: "rgba(0, 225, 255, 0.08)",
        boxShadow: "0 0 0 1px rgba(0, 225, 255, 0.35) inset",
        zIndex: String(INSPECTOR_Z - 1),
        transition: "all 60ms ease",
      });

      const panel = document.createElement("div");
      Object.assign(panel.style, {
        position: "fixed",
        right: "12px",
        top: "12px",
        maxWidth: "36rem",
        background: "rgba(20, 22, 26, 0.92)",
        color: "#e8eef7",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
        fontSize: "12px",
        lineHeight: "1.5",
        border: "1px solid rgba(255,255,255,0.15)",
        borderRadius: "8px",
        padding: "10px 12px",
        zIndex: String(INSPECTOR_Z),
        backdropFilter: "saturate(1.2) blur(4px)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        pointerEvents: "none",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        opacity: "0.85",
      });
      panel.id = "DBG_PANEL"

      const title = document.createElement("div");
      title.textContent = "Element Inspector (hover + events)";
      Object.assign(title.style, { fontWeight: "600", marginBottom: "8px", color: "#9bdcff" });

      const content = document.createElement("div");
      const detailsLink = document.createElement("a");
      Object.assign(detailsLink.style, {
        display: "block",
        marginTop: "8px",
        color: "#9bdcff",
        textDecoration: "underline",
        pointerEvents: "auto"
      });
      detailsLink.target = "_blank";
      detailsLink.textContent = "Open MDN Reference";

      panel.appendChild(title);
      panel.appendChild(content);
      panel.appendChild(detailsLink);

      document.body.appendChild(highlight);
      document.body.appendChild(panel);

      const elementLabel = el => {
        if (!el || el.nodeType !== 1) return "(none)";
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : "";
        const cls = el.classList.length ? "." + [...el.classList].join(".") : "";
        const attrs = [];
        ["name", "type", "role"].forEach(attr => {
          if (el.hasAttribute(attr)) {
            attrs.push(`${attr}="${el.getAttribute(attr)}"`);
          }
        });
        [...el.attributes].forEach(a => {
          if (a.name.startsWith("data-") || a.name.startsWith("aria-")) {
            attrs.push(`${a.name}="${a.value}"`);
          }
        });
        const attrStr = attrs.length ? `[${attrs.join(",")}]` : "";
        return `${tag}${id}${cls}${attrStr}`;
      };

      const styleSnapshot = el => {
        const cs = getComputedStyle(el);
        const pick = prop => cs.getPropertyValue(prop);
        return {
          display: pick("display"),
          position: pick("position"),
          visibility: pick("visibility"),
          opacity: pick("opacity"),
          color: pick("color"),
          backgroundColor: pick("background-color"),
          fontSize: pick("font-size"),
          zIndex: pick("z-index"),
          overflow: pick("overflow"),
          pointerEvents: pick("pointer-events"),
          cursor: pick("cursor"),
          margin: `${pick("margin-top")} ${pick("margin-right")} ${pick("margin-bottom")} ${pick("margin-left")}`,
          padding: `${pick("padding-top")} ${pick("padding-right")} ${pick("padding-bottom")} ${pick("padding-left")}`,
          border: `${pick("border-top-width")} ${pick("border-right-width")} ${pick("border-bottom-width")} ${pick("border-left-width")}`,
        };
      };

      const domPath = (el, max = 6) => {
        const parts = [];
        let cur = el, count = 0;
        while (cur && cur.nodeType === 1 && count < max) {
          parts.unshift(elementLabel(cur));
          cur = cur.parentElement;
          count++;
        }
        return parts.join("  >  ");
      };

      const directTextContent = el => {
        return [...el.childNodes]
          .filter(n => n.nodeType === Node.TEXT_NODE)
          .map(n => n.textContent.trim())
          .filter(Boolean)
          .join(" ") || "-";
      };

      let currentEl = null; 
      let FPS = 30; // 初期FPS
      let realtimeMode = false;
      let lastUpdate = 0;
      let pending = false;
      let lastPointer = { x: 0, y: 0 };

      function renderInfo(el, rect, pointer) {
        if (!el) { 
          if (API.setting.get('mode') === 'tab') content.textContent = "Hover an element to see details.";
          return; 
        }
        currentEl = el;

        const styles = styleSnapshot(el);
        const dataset = el.dataset ? JSON.stringify(Object.fromEntries(Object.entries(el.dataset)), null, 2) : "{}";
        const eventsForEl = (trackedEvents.get(el) || [])
          .map(ev => `  ${ev.type} ${ev.listener.name || "anonymous"}`)
          .join("\n") || "-";
        const lines = [
          `Target: ${elementLabel(el)}`,
          `Path:   ${domPath(el)}`,
          "",
          `Position: viewport(${Math.round(rect.left)}, ${Math.round(rect.top)})`,
          `Size:     ${Math.round(rect.width)} × ${Math.round(rect.height)} px`,
          `Pointer:  (${Math.round(pointer.x)}, ${Math.round(pointer.y)})`,
          "",
          "Attributes:",
          `  id:           ${el.id || "-"}`,
          `  classes:      ${el.classList.length ? [...el.classList].join(" ") : "-"}`,
          `  role:         ${el.getAttribute("role") || "-"}`,
          `  name:         ${el.getAttribute("name") || "-"}`,
          `  aria*:        ${[...el.attributes].filter(a => a.name.startsWith("aria-")).map(a => a.name + "=" + a.value).join(", ") || "-"}`,
          `  textContent:  ${directTextContent(el)}`,
          `  value:        ${el.value || "-"}`,
          `  checked:      ${el.checked || "-"}`,
          "",
          "Computed style (subset):",
          `  display:        ${styles.display}`,
          `  position:       ${styles.position}`,
          `  visibility:     ${styles.visibility}`,
          `  opacity:        ${styles.opacity}`,
          `  z-index:        ${styles.zIndex}`,
          `  color:          ${styles.color}`,
          `  background:     ${styles.backgroundColor}`,
          `  font-size:      ${styles.fontSize}`,
          `  overflow:       ${styles.overflow}`,
          `  pointer-events: ${styles.pointerEvents}`,
          `  cursor:         ${styles.cursor}`,
          `  margin:         ${styles.margin}`,
          `  padding:        ${styles.padding}`,
          `  border-widths:  ${styles.border}`,
          "",
          "Dataset:",
          dataset,
          "",
          "Event listeners:",
          eventsForEl,
          "",
          "details:",
          `  Press Alt+D to open MDN reference for <${el.tagName.toLowerCase()}>`
        ];

        if (API.setting.get('mode') === 'window') {
          Win.document.querySelector('#content > .Selected').innerHTML = `<pre>${lines.join("\n").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`;
        } else {
          content.textContent = lines.join("\n");
          const elTag = el.tagName.toLowerCase();
          MDNLink = `https://developer.mozilla.org/ja/docs/Web/HTML/Reference/Elements/${elTag}`;
          if (/^h[1-6]$/.test(elTag)) MDNLink = "https://developer.mozilla.org/ja/docs/Web/HTML/Reference/Elements/Heading_Elements";
          const svgs = ["svg", "rect", "circle", "line"];
          const matchedSvg = svgs.find(tag => tag === elTag);
          if (matchedSvg) MDNLink = `https://developer.mozilla.org/ja/docs/Web/SVG/Reference/Element/${matchedSvg}`
          detailsLink.href = MDNLink;
        }
      }

      function renderHighlight(rect) {
        Object.assign(highlight.style, {
          left: `${Math.round(rect.left)}px`,
          top: `${Math.round(rect.top)}px`,
          width: `${Math.round(Math.max(0, rect.width))}px`,
          height: `${Math.round(Math.max(0, rect.height))}px`,
        });
      }

      window.addEventListener("beforeunload", () => {
        if (Win && !Win.closed) {
          Win.close();
        }
      });
      
      window.addEventListener('message', e => {
        switch (e.data?.type) {
          case 'closed':
            API.setting.set('mode', 'tab');
            Win = null;
            panel.style.display = "block";
            break;
          case 'focus':
            window.focus();
            break;
          case 'playCode':
            (()=>{try {const result=Function(e.data?.code)();if(result)console.log(result)}catch(e){console.error(e);}})();
          default:
            break;
        }
      });
      
      function DevWindow(show) {
        panel.style.display = 'none';
        if (!show) {
          if (Win && !Win.closed) {
            Win.close()
          }
          Win = null;
          panel.style.display = 'block';
          return;
        }
        if (!Win) {
          Win = window.open(
            "about:blank",
            "Dev Tools",
            "width=600,height=400,resizable,scrollbars"
          );
        }
      
        if (Win) {
          const htmlLogs = API.logs.get('logs').map(entry => {
            const argsStr = entry.args.map(a =>
              (typeof a === "string" ? a : JSON.stringify(a))
            ).join(" ");
          
            const safeArgsStr = argsStr.replace(/</g, "&lt;").replace(/>/g, "&gt;");
            const safeLocation = entry.location.replace(/</g, "&lt;").replace(/>/g, "&gt;");
            const timeStr = new Date(entry.timestamp).toLocaleString();
          
            return `
              <div class="${entry.type}">
                <p>${safeArgsStr}</p>
                <time>${timeStr}</time>
                <div class="at">${safeLocation}</div>
              </div>
            `;
          }).join("");
          let inner_HTML = document.documentElement.outerHTML.replace(/<div[^>]*id=["']DBG_PANEL["'][^>]*>[\s\S]*?<\/div>/gi, "").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          Win.document.open();
          Win.document.write(`
<!DOCTYPE html>
<html lang="en">
<head>
  <title>Dev Tools - ${document.title}</title>
  <meta charset="UTF-8">
  <style>
    body,html{padding:0;margin:0;width:100vw;min-height:100vh;font-family:"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#f9fafc;color:#333;}
    a,.show-a{color:#0078d7;text-decoration:none;cursor:pointer;background:none;border:none;padding:0;}
    a:hover,.show-a:hover{text-decoration:underline;}
    #tab{display:flex;align-items:center;width:100%;height:48px;position:sticky;top:0;background:linear-gradient(90deg,#ffffff,#f3f6fa);z-index:1000;box-shadow:0 2px 6px rgba(0,0,0,0.08);}
    #tab>*{flex:1;text-align:center;cursor:pointer;min-width:max(13%,75px);max-width:min(20%,150px);height:100%;border:none;background:transparent;font-weight:500;color:#555;transition:all 0.3s ease;}
    #tab>*:hover{background:rgba(0,120,21Fo5,0.08);color:#0078d7;}
    #tab>*.active{border-bottom:3px solid #0078d7;font-weight:bold;color:#0078d7;}
    pre{white-space:pre-wrap;word-wrap:break-word;background:#fff;padding:16px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.06);}
    #content .Console{box-sizing:border-box;padding:16px;background:#ffffff;color:#222;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace;line-height:1.5;overflow-y:visible;overflow-x:hidden;border-radius:8px;box-shadow:inset 0 0 0 1px rgba(0,0,0,0.05);}
    #content .Console div,#log{box-sizing:border-box;display:flex;flex-direction:column;gap:4px 12px;align-items:start;padding:10px 12px;margin:0 0 12px 0;border-left:4px solid transparent;background:#fdfdfd;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,0.06);transition:transform 0.2s ease,background 0.2s ease;}
    #content .Console div:hover,#log:hover{background:#f7f9fc;transform:translateY(-2px);}
    #content .Console div p,#log p{margin:0;grid-column:1/2;grid-row:1/2;white-space:pre-wrap;word-break:break-word;}
    #content .Console div time,#log time{grid-column:2/3;grid-row:1/2;color:#666;font-size:12px;white-space:nowrap;}
    #content .Console div .at,#log .at{grid-column:1/3;grid-row:2/3;color:#888;font-size:12px;margin-top:4px;border-top:1px dashed rgba(0,0,0,0.12);padding-top:4px;}
    #content .Console div.log,#log.log{border-left-color:#0078d7;}
    #content .Console div.info,#log.info{border-left-color:#2b88d8;}
    #content .Console div.warn,#log.warn{border-left-color:#f2c744;background:#fffbe6;}
    #content .Console div.error,#log.error{border-left-color:#e81123;background:#fff0f0;}
    .text-wrapper{color:#333;font-size:16px;display:block;width:90%;position:sticky;top:0;z-index:500;}
    .text-wrapper::after{content:'';position:absolute;bottom:0;left:0;width:0;height:2px;background:#0078d7;transition:width 0.4s ease;}
    .text-wrapper:has(textarea:focus)::after{width:100%;z-index:500;}
    #playCode{width:100%;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:14px;line-height:1.5;padding:12px;border:none;background:#f5f5f5;color:#222;box-shadow:inset 0 1px 3px rgba(0,0,0,0.06);transition:background 0.5s ease;resize:none;outline:none;}
    #playCode:focus{background:#fdfdfd;}

    /* プルダウン */
    .pulldownParent {display:flex;margin:0;align-items:center;position:relative;}
    .pulldown {padding:5px;margin:0;border:3px solid black;border-radius:5px;user-select:none;cursor:pointer;}
    .pulldown .menuParent {position:relative;}
    .pulldown .menuParent > * {display:none;padding:5px 12px;}
    .pulldown .menuParent > .select {display:block;background:#fff;border-radius:3px;}
    .pulldown .menuParent.open > * {display:block;background:#f0f0f0;}
    .pulldown .menuParent > .menu.selected {font-weight:bold;}
    .pulldown .menuParent.open > .select::before { content:''; position:absolute; border-radius:50%; background:#66BB6A; width:24px; height:24px; left:-35px; top:50%; transform:translateY(-50%); }
  </style>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/${API.setting.get('highlight')}.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/highlight.min.js"></script>
</head>
<body>
  <div>Dev Tools for &quot;<button id='toParent' class='show-a'>${document.title}</button>&quot;</div>
  <nav id="tab" role="tablist">
    <button role="tab" class="Elements" draggable="true">Elements</button>
    <button role="tab" class="Console" draggable="true">Console</button>
    <button role="tab" class="Network" draggable="true">Network</button>
    <button role="tab" class="Selected" draggable="true">Selected</button>
    <button role="tab" class="Info" draggable="true">Info</button>
    <button role="tab" class="Events" draggable="true">Events</button>
    <button role="tab" class="Setting" draggable="true">Setting</button>
  </nav>
  <div id="content">
    <div class="Elements"><pre><code class="language-html">&lt;!DOCTYPE html&gt;\n${document.documentElement.outerHTML.replace(/<div[^>]*id=["']DBG_PANEL["'][^>]*>[\s\S]*?<\/div>/gi, "").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre></div>
    <div class="Console"><label class="text-wrapper"><textarea id="playCode"></textarea></label><div id="log">${htmlLogs}</div></div>
    <div class="Network">under implementation</div>
    <div class="Selected">No Element Selected</div>
    <div class="Info">
      <h2>dbg.min.js Tool Information</h2>
      <p><strong>dbg.min.js</strong> is a lightweight in‑browser debugging utility. 
      It helps developers inspect DOM elements, monitor events, track network requests, 
      and capture console logs without relying on the built‑in browser DevTools.</p>
    </div>
    <div class="Events">under implementation</div>
    <div class="Setting">
      <h3>Setting</h3>
      <label class="pulldownParent">
        Theme: 
        <div class="pulldown">
          <div class="menuParent open">
            <label class="menu select">Light</label>
            <label class="menu">Dark</label>
          </div>
        </div>
      </label>
    </div>
  </div>
<script>
hljs.highlightAll();
window.addEventListener('beforeunload', () => {
  window.opener.postMessage({ type: 'closed' }, '*');
});

// タブ切替
let tabs = document.querySelectorAll('#tab > *');
tabs.forEach(el => {
  el.onclick = () => {
    const others = Array.from(tabs).filter(item => item !== el);
    others.forEach(el => {
      el.classList.remove('active');
      el.setAttribute('aria-selected', 'false');
    });
    el.classList.add('active');
    el.setAttribute('aria-selected', 'true');
    const elType = Array.from(el.classList).find(cls => cls !== 'active');
    const contents = document.querySelectorAll('#content > *');
    contents.forEach(el => el.style.display = 'none');
    document.querySelector('#content > .' + elType).style.display = 'block';
  };
});
document.querySelector('#tab > .Elements').click();

document.querySelector('#toParent').onclick = () => {
  window.opener.postMessage({ type: 'focus' }, '*');
};
document.querySelector('#playCode').addEventListener('keydown', (e) => {
  const value = e.target.value.trim();
  if (!value) return;
  if (e.key.toLowerCase() === 'enter' && !e.shiftKey) {
    e.preventDefault();
    window.opener.postMessage({ type: 'playCode', code: value }, '*');
    e.target.value = '';
  }
});

// タブドラッグ
let draggedTab = null;
const nav = document.getElementById('tab');
nav.querySelectorAll('button').forEach(tab => {
  tab.addEventListener('dragstart', e => {
    draggedTab = tab;
    e.dataTransfer.effectAllowed = 'move';
  });
  tab.addEventListener('dragover', e => {
    e.preventDefault();
    const bounding = tab.getBoundingClientRect();
    const offset = e.clientX - bounding.left;
    nav.insertBefore(draggedTab, offset > bounding.width / 2 ? tab.nextSibling : tab);
  });
  tab.addEventListener('dragend', () => { draggedTab = null; tabs = document.querySelectorAll('#tab > *'); });
});

// タブショートカット
document.addEventListener('keydown', (e) => {
  const mod = navigator.platform.includes('Mac') ? e.metaKey : e.ctrlKey;
  const keyValue = Number(e.key);
  if (!mod) return;
  if (e.key === 'Tab') {
    e.preventDefault();
    const direction = e.shiftKey ? -1 : 1;
    let current = Array.from(tabs).findIndex(t => t.classList.contains('active'));
    if (current === -1) current = 0;
    let next = (current + direction + tabs.length) % tabs.length;
    tabs[next].click();
  } else if (!isNaN(keyValue) && keyValue >= 1 && keyValue <= tabs.length) {
    tabs[keyValue-1].click();
  }
});

// 汎用カスタムプルダウン
document.querySelectorAll('.pulldownParent').forEach(wrapper => {
  const pulldown = wrapper.querySelector('.pulldown');
  const menuParent = pulldown.querySelector('.menuParent');
  const selected = menuParent.querySelector('.select');
  const options = Array.from(menuParent.querySelectorAll('.menu')).filter(m => m !== selected);

  selected.addEventListener('click', (e) => {
    e.stopPropagation();
    menuParent.classList.toggle('open');
  });

  options.forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      selected.textContent = opt.textContent;
      menuParent.querySelectorAll('.menu').forEach(m => m.classList.remove('selected'));
      opt.classList.add('selected');
      menuParent.classList.remove('open');
      const event = new CustomEvent('change', { detail: opt.textContent });
      wrapper.dispatchEvent(event);
    });
  });

  document.addEventListener('click', () => {
    menuParent.classList.remove('open');
  });
});
</script>
</body>
</html>
          `);
          Win.document.close();
        }
      }

      // --- FPS切り替え ---
      function toggleFPS() {
        realtimeMode = !realtimeMode;
        if (realtimeMode) {
          FPS = FPS === 30 ? 60 : 30;
          panel.style.borderColor = "#00e1ff";
          title.textContent = `Element Inspector (live mode ${FPS}fps)`;
          window.addEventListener("mousemove", onMove, { passive: true });
        } else {
          title.textContent = "Element Inspector (hover mode)";
          panel.style.borderColor = "rgba(255,255,255,0.15)";
          window.removeEventListener("mousemove", onMove);
        }
      }

      function onFrame() {
        pending = false;
        const now = performance.now();
        if (now - lastUpdate < 1000 / FPS) return;
        lastUpdate = now;

        const el = document.elementFromPoint(lastPointer.x, lastPointer.y);
        if (!el || el === highlight || el === panel || panel.contains(el)) return;
        if (el === currentEl) return;

        currentEl = el;
        const rect = el.getBoundingClientRect();
        renderHighlight(rect);
        renderInfo(el, rect, lastPointer);
      }

      function updatePanelSide(pointerX) {
          const isLeftSide = pointerX > window.innerWidth / 2;
          if (isLeftSide) {
            panel.style.left = "12px";
            panel.style.right = "";
          } else {
            panel.style.right = "12px";
            panel.style.left = "";
          }
      }

      function onMove(e) {
        lastPointer = { x: e.clientX, y: e.clientY };
        if (!pending) {
          pending = true;
          requestAnimationFrame(onFrame);
        }
      }

      window.addEventListener("mousemove", (e) => {updatePanelSide(e.clientX)});

      window.addEventListener("mouseover", e => {
        if (realtimeMode) return;
        const el = e.target;
        if (!el || el === highlight || el === panel || panel.contains(el)) return;
        const rect = el.getBoundingClientRect();
        renderHighlight(rect);
        renderInfo(el, rect, { x: e.clientX, y: e.clientY });
      });

      window.addEventListener("scroll", () => {
        if (currentEl) renderHighlight(currentEl.getBoundingClientRect());
      }, { passive: true });

      window.addEventListener("keydown", e => {
        if (e.altKey && e.key.toLowerCase() === "d" && currentEl) {
          window.open(MDNLink, "_blank");
        }
        
        if (e.altKey && e.key.toLowerCase() === "w") {
          API.setting.set('mode', API.setting.get('mode') === 'window'?'tab':'window');
          DevWindow(API.setting.get('mode') === 'window');
        }

        if (e.ctrlKey && e.altKey && e.key.toLowerCase() === "f") {
          toggleFPS();
        }
      });

      content.textContent = "Hover an element to see details.";
    });
  } catch (e) {
    console.error("Element Inspector failed:", e);
  }
})();
