function e(e,t){let n=e.toLowerCase();return n.includes(`booking`)||n.includes(`checkout`)?n.includes(`payment`)||n.includes(`pay`)?{state:`payment`}:{state:`booking`}:n.includes(`confirmation`)||n.includes(`ticket`)||n.includes(`success`)?{state:`confirmed`,bookingId:t.match(/booking\s*(?:id|no|ref)[:\s]*([A-Z0-9-]{4,})/i)?.[1]}:{state:`unknown`}}console.log(`[Movie Assistant] Content script active on ${window.location.hostname}${window.location.pathname}`),t(),d(),chrome.runtime.onMessage.addListener((t,n,i)=>{let{type:a,payload:o}=t;switch(a){case`PING`:return i({pong:!0,url:window.location.href}),!0;case`DETECT_BOOKING_STATE`:return i(e(window.location.href,document.body?.innerText??``)),!0;case`SELECT_AND_RESERVE`:return r(o).then(i).catch(e=>i({success:!1,error:e.message})),!0;case`SNIPER_STATE_CHANGED`:return h(o),i({ok:!0}),!0;default:return i({error:`Unknown message type: ${a}`}),!0}});async function t(){if(!window.location.pathname.includes(`/seats`))return;let e=window.location.pathname.match(/\/shows\/([^/]+)\/seats/),t=e?e[1]:null;try{let e=await chrome.storage.local.get([`pendingReservations`,`pendingReservation`]),n=null;if(t&&e.pendingReservations&&e.pendingReservations[t]){n=e.pendingReservations[t];let r={...e.pendingReservations};delete r[t],await chrome.storage.local.set({pendingReservations:r})}else e.pendingReservation&&(n=e.pendingReservation,await chrome.storage.local.remove(`pendingReservation`));n&&Array.isArray(n.seatLabels)&&n.seatLabels.length>0&&Date.now()-(n.timestamp||0)<6e4&&(console.log(`[Movie Assistant] Found active pending reservation for seats:`,n.seatLabels),await r({seatLabels:n.seatLabels,requiredSeats:n.requiredSeats||n.seatLabels.length,autoProceed:!0,allowedRows:n.allowedRows||[`B`,`C`,`D`,`E`,`F`]}))}catch(e){console.warn(`[Movie Assistant] Storage check error:`,e)}}function n(e){e.scrollIntoView({behavior:`smooth`,block:`center`}),e.dispatchEvent(new MouseEvent(`mouseover`,{bubbles:!0,cancelable:!0,view:window})),e.dispatchEvent(new MouseEvent(`mousedown`,{bubbles:!0,cancelable:!0,view:window})),e.dispatchEvent(new MouseEvent(`mouseup`,{bubbles:!0,cancelable:!0,view:window})),e.click()}async function r(e){let{seatLabels:t,autoProceed:r=!0}=e,c=e.requiredSeats||t.length,l=e.allowedRows||[`B`,`C`,`D`,`E`,`F`],d=[];if(console.log(`[Movie Assistant] Attempting automated seat selection for ${c} seats:`,t),document.body.innerText.includes(`Online sales for this show closed`)||document.body.innerText.includes(`Contact counter for tickets`))return u(),{success:!1,clickedSeats:[],proceedClicked:!1};await a(12e3);for(let e of t){if(d.length>=c)break;let t=o(e);t?(n(t),d.push(e),console.log(`[Movie Assistant] Clicked seat: ${e} (${d.length}/${c})`),await new Promise(e=>setTimeout(e,220))):console.warn(`[Movie Assistant] Could not find seat element for label: ${e}`)}if(d.length<c){console.log(`[Movie Assistant] Need ${c-d.length} more seat(s) in rows ${l.join(`, `)}...`);let e=Array.from(document.querySelectorAll(`[data-seat-id], [role="gridcell"], [data-seat-label], [data-testid*="seat"], button[aria-label*="seat"], button[aria-label*="Seat"]`));for(let t of e){if(d.length>=c)break;if(t.hasAttribute(`disabled`)||t.getAttribute(`aria-disabled`)===`true`||t.classList.contains(`occupied`)||t.classList.contains(`booked`)||t.classList.contains(`sold`)||t.classList.contains(`unavailable`)||t.classList.contains(`selected`))continue;let e=i(t);e&&l.includes(e.row)&&(d.includes(e.label)||(n(t),d.push(e.label),console.log(`[Movie Assistant] Fallback clicked available seat: ${e.label} (${d.length}/${c})`),await new Promise(e=>setTimeout(e,220))))}}console.log(`[Movie Assistant] Total seats selected: ${d.length}/${c}`);let f=!1;return r&&d.length>0&&(console.log(`[Movie Assistant] Seats clicked. Polling for Continue / Checkout button...`),f=await s(20,300),console.log(`[Movie Assistant] Proceed button clicked:`,f)),{success:d.length>0,clickedSeats:d,proceedClicked:f}}function i(e){let t=(e.getAttribute(`data-seat-id`)||e.getAttribute(`data-seat-label`)||``).trim().toUpperCase();if(t){let e=t.match(/^([A-Z]+)(\d+)$/);if(e)return{row:e[1],label:t}}let n=(e.getAttribute(`aria-label`)||``).toUpperCase(),r=n.match(/ROW:?\s*([A-Z]+)/),i=n.match(/SEAT:?\s*([A-Z0-9]+)/);if(r&&i){let e=r[1];return{row:e,label:`${e}${i[1].replace(/^[A-Z]+/,``)}`}}let a=(e.textContent||``).trim().toUpperCase(),o=a.match(/^([A-Z]+)(\d+)$/);return o?{row:o[1],label:a}:null}function a(e=12e3){return new Promise(t=>{let n=Date.now(),r=setInterval(()=>{(document.querySelectorAll(`[data-seat-id], [role="gridcell"], [data-seat-label], [data-testid*="seat"], button[aria-label*="seat"], button[aria-label*="Seat"]`).length>0||Date.now()-n>e)&&(clearInterval(r),t())},250)})}function o(e){let t=e.trim().toUpperCase(),n=t.replace(/0+(\d+)$/,`$1`),r=t.match(/^([A-Z]+)(\d+)$/),i=r?r[1]:``,a=r?parseInt(r[2],10):null,o=document.querySelector(`[data-seat-id="${t}"], [data-seat-id="${n}"], [data-seat-label="${t}"], [data-seat-label="${n}"]`);if(o)return o;if(i&&a!==null){let e=Array.from(document.querySelectorAll(`[role="gridcell"], [data-seat-id], button`));for(let r of e){let e=(r.getAttribute(`aria-label`)||``).toUpperCase();if((e.includes(`ROW ${i}`)||e.includes(`ROW: ${i}`))&&(e.includes(`SEAT ${t}`)||e.includes(`SEAT ${n}`)||e.includes(`SEAT ${a}`)))return r}}let s=document.querySelector(`[aria-label*="${t}"], [aria-label*="${n}"]`);if(s)return s;let c=Array.from(document.querySelectorAll(`[role="gridcell"], button, div[role="button"], svg text`));for(let e of c){let r=e.textContent?.trim().toUpperCase();if(r===t||r===n)return e}return null}async function s(e=20,t=300){for(let n=0;n<e;n++){if(c())return!0;await new Promise(e=>setTimeout(e,t))}return!1}function c(){let e=document.querySelector(`button[aria-label*="Proceed to checkout"], button[aria-label*="checkout"], button[aria-label*="Continue"]`);if(e&&!e.hasAttribute(`disabled`))return e.click(),!0;let t=Array.from(document.querySelectorAll(`button, a[role="button"], input[type="submit"]`)),n=[`CONTINUE`,`PROCEED`,`BUY TICKETS`,`PROCEED TO CHECKOUT`,`BOOK NOW`,`NEXT`,`CONFIRM`];for(let e of t){let t=e.textContent?.trim().toUpperCase()||``;if(n.some(e=>t.includes(e))&&!e.hasAttribute(`disabled`))return e.click(),!0}return!1}(window.location.pathname.includes(`/checkout`)||window.location.pathname.includes(`/payment`))&&l();function l(){if(document.getElementById(`movie-assistant-checkout-banner`))return;let e=document.createElement(`div`);e.id=`movie-assistant-checkout-banner`,e.style.cssText=`
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 999999;
    background: #1c1917;
    color: #ffffff;
    border: 1px solid #dc2626;
    border-radius: 8px;
    padding: 12px 16px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.4);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    max-width: 360px;
    font-size: 13px;
    line-height: 1.4;
  `,e.innerHTML=`
    <div style="display: flex; align-items: center; gap: 8px; font-weight: 600; color: #ef4444; margin-bottom: 4px;">
      <span>🎬</span>
      <span>Movie Assistant: Seats Reserved</span>
    </div>
    <div style="color: #d6d3d1;">
      Your continuous seats have been selected! Please enter your phone number and complete payment (bKash / Nagad / Card) below.
    </div>
  `,document.body.appendChild(e)}function u(){if(document.getElementById(`movie-assistant-closed-banner`))return;let e=document.createElement(`div`);e.id=`movie-assistant-closed-banner`,e.style.cssText=`
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 999999;
    background: #450a0a;
    color: #fecaca;
    border: 1px solid #dc2626;
    border-radius: 8px;
    padding: 12px 16px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.5);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    max-width: 360px;
    font-size: 13px;
    line-height: 1.4;
  `,e.innerHTML=`
    <div style="display: flex; align-items: center; gap: 8px; font-weight: 600; color: #ef4444; margin-bottom: 4px;">
      <span>⚠️</span>
      <span>Online Booking Closed</span>
    </div>
    <div style="color: #fca5a5;">
      Online sales for this show closed (starts in &lt;60 minutes). Please open the extension and select the next available showtime.
    </div>
  `,document.body.appendChild(e)}async function d(){try{let e=await chrome.storage.local.get(`sniperState`);e?.sniperState&&h(e.sniperState)}catch(e){console.warn(`[Movie Assistant] Failed to check sniper state for HUD:`,e)}}var f=null,p=null;function m(e){if(e){if(!f&&typeof chrome<`u`&&chrome.runtime?.connect)try{f=chrome.runtime.connect({name:`sniper-keepalive`}),f.onDisconnect.addListener(()=>{f=null,setTimeout(()=>{typeof chrome<`u`&&chrome.storage?.local&&chrome.storage.local.get(`sniperState`).then(e=>{e?.sniperState?.config?.active&&m(!0)}).catch(()=>{})},1e3)})}catch{}p||=setInterval(()=>{typeof chrome<`u`&&chrome.storage?.local&&chrome.storage.local.get(`sniperState`).then(e=>{e?.sniperState?.config?.active?chrome.runtime.sendMessage({type:`SNIPER_HEARTBEAT`}).then(e=>{e?.state&&h(e.state)}).catch(()=>{}):m(!1)}).catch(()=>{})},2500)}else{if(f){try{f.disconnect()}catch{}f=null}p&&=(clearInterval(p),null)}}function h(e){if(!e||!e.config||!e.config.active&&e.status!==`booked`){g();return}m(e.config.active);let{config:t,status:n,refreshCount:r=0,bookedSeats:i}=e,a=document.getElementById(`movie-assistant-sniper-hud`);a||(a=document.createElement(`div`),a.id=`movie-assistant-sniper-hud`,a.style.cssText=`
      position: fixed;
      top: 14px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 9999999;
      background: #0c0a09;
      color: #fafaf9;
      border: 1px solid #dc2626;
      border-radius: 10px;
      padding: 10px 16px;
      box-shadow: 0 12px 30px rgba(0,0,0,0.6);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-width: 320px;
      max-width: 480px;
      font-size: 12px;
      line-height: 1.4;
      display: flex;
      flex-direction: column;
      gap: 6px;
      transition: all 0.2s ease;
    `,document.body.appendChild(a));let o=n===`booked`,s=n===`waiting_schedule`;a.innerHTML=`
    <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #292524; padding-bottom: 6px;">
      <div style="display: flex; align-items: center; gap: 6px; font-weight: 700; color: ${o?`#22c55e`:`#ef4444`};">
        <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${o?`#22c55e`:`#ef4444`};"></span>
        <span>${o?`🎉 Seats Secured!`:s?`⏳ Sniper Scheduled`:`🎯 Seat Drop Sniper Active`}</span>
      </div>
      <button id="movie-assistant-stop-sniper-btn" style="background: none; border: 1px solid #44403c; border-radius: 4px; color: #a8a29e; font-size: 11px; padding: 2px 6px; cursor: pointer;">
        ${o?`Close ✖`:`Stop Sniper ✖`}
      </button>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; font-size: 11px; color: #d6d3d1;">
      <div>🎬 <strong>${t.movieName}</strong></div>
      <div>📅 Target: <strong style="color: #ef4444;">${t.targetDate}</strong></div>
      <div>💺 Required: <strong>${t.requiredSeats} seats</strong></div>
      <div>🔄 Refreshes: <strong>${r}</strong></div>
    </div>
    <div style="font-size: 11px; color: ${o?`#86efac`:`#a8a29e`}; margin-top: 2px;">
      ${o?`Selected continuous seats: <strong>${(i||[]).join(`, `)}</strong>. Ready for payment!`:s?`Waiting for scheduled drop countdown...`:`Auto-refreshing & scanning for newly opened seats every ${t.intervalSeconds}s...`}
    </div>
  `;let c=a.querySelector(`#movie-assistant-stop-sniper-btn`);c&&c.addEventListener(`click`,()=>{chrome.runtime.sendMessage({type:`STOP_SNIPER`,reason:`User closed from page HUD`},()=>{g()})})}function g(){m(!1);let e=document.getElementById(`movie-assistant-sniper-hud`);e&&e.remove()}