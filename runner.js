//runner.js
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const sense = require("./sensors");
const act = require("./actuators");

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

let progressStage = "HOME";

async function nextCommand(ap, page) {
  const find = (txt) =>
    ap.actions.find((a) =>
      a.label.toLowerCase().includes(txt.toLowerCase())
    );

  // HOME
  if (ap.url.includes("index.html")) {
    console.log(`Policy: On HOME [stage=${progressStage}]`);
    if (progressStage === "HOME") {
      const ordersBtn = find("orders");
      if (ordersBtn) { progressStage = "ORDERS"; return `CLICK ${ordersBtn.id}`; }
    }
    if (progressStage === "CART") {
      const cartBtn = find("cart");
      if (cartBtn) { progressStage = "PRODUCTS"; return `CLICK ${cartBtn.id}`; }
    }
    if (progressStage === "PRODUCTS") {
      const productsBtn = find("products");
      if (productsBtn) return `CLICK ${productsBtn.id}`;
    }
    return "STOP";
  }

  // ORDERS
  if (ap.url.includes("orders.html")) {
    console.log(`Policy: On ORDERS [stage=${progressStage}]`);

    const hasOrder = await page.evaluate(() => {
      const t = document.body.innerText.toLowerCase();
      return t.includes("order total") || t.includes("mark as delivered") || t.includes("items:");
    });

    if (hasOrder) {
      const deliverBtn = ap.actions.find(a => a.label.toLowerCase().includes("mark as delivered"));
      if (deliverBtn) {
        console.log("Will mark order as delivered...");
        
        await page.click(`[data-abs-id="${deliverBtn.id}"]`).catch(() => {});
        await delay(1000);

        
        progressStage = "FEEDBACK";
        await page.goto("http://localhost:8080/feedback.html", { waitUntil: "domcontentloaded" });
        return "FORM_FEEDBACK";
      }
    }

    
    console.log("No orders present → returning to HOME to continue scan");
    progressStage = "CART";
    const homeBtn = ap.actions.find(a => a.label.toLowerCase().includes("home")) ||
                    ap.actions.find(a => a.label.toLowerCase().includes("← home")) ||
                    ap.actions.find(a => a.label.toLowerCase().includes("back"));
    if (homeBtn) return `CLICK ${homeBtn.id}`;
    await page.goto("http://localhost:8080/index.html", { waitUntil: "domcontentloaded" });
    return "STOP";
  }

  
  if (ap.url.includes("feedback.html") || progressStage === "FEEDBACK") {
    console.log(`Policy: On FEEDBACK [stage=${progressStage}]`);
    
    return "FORM_FEEDBACK";
  }

  // CART
  if (ap.url.includes("cart.html")) {
    console.log(`Policy: On CART [stage=${progressStage}]`);
    const hasItems = await page.evaluate(() => {
      const t = document.body.innerText.toLowerCase();
      return ((t.includes("remove") || t.includes("order total")) && !t.includes("empty"));
    });

    if (hasItems) {
      const place = find("place order");
      if (place) { progressStage = "PRODUCTS"; return `CLICK ${place.id}`; }
    } else {
      const cont = find("continue shopping") || find("home");
      if (cont) { progressStage = "PRODUCTS"; return `CLICK ${cont.id}`; }
    }
    return "STOP";
  }

  // PRODUCTS
  if (ap.url.includes("product.html")) {
    console.log(`Policy: On PRODUCTS [stage=${progressStage}]`);
    const cartCount = await page.evaluate(() => {
      const el = document.querySelector('#cartCount');
      return el ? parseInt(el.textContent) || 0 : 0;
    });

    const MAX_ITEMS = 4;
    if (cartCount < MAX_ITEMS) {
      const adds = ap.actions.filter(a => a.label.toLowerCase().includes("add to cart"));
      if (adds.length) {
        const idx = cartCount % adds.length;
        const next = adds[idx];
        if (next) { console.log(`Adding #${cartCount+1}/${MAX_ITEMS}`); return `CLICK ${next.id}`; }
      }
    }

    const cartBtn = ap.actions.find(a => a.label.toLowerCase().includes("cart"));
    if (cartBtn) { progressStage = "FINALIZE"; return `CLICK ${cartBtn.id}`; }
    return "STOP";
  }

  return "STOP";
}

// Main runner
module.exports = async function runTask(seedUrl, task, maxSteps = 40) {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  page.on('dialog', async dialog => {
    console.log("Dialog:", dialog.message());
    
    try { await dialog.dismiss(); } catch (e) {}
  });

  // screenshot 
  const screenshotsDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir);

  console.log("Navigating to seed:", seedUrl);
  await page.goto(seedUrl, { waitUntil: 'domcontentloaded' });

  const report = [];

  for (let step = 0; step < maxSteps; step++) {
    console.log(`\n___ Step ${step + 1} ___`);
    const ap = await sense(page);
    const actionsPreview = ap.actions.map(a => `${a.id}:${a.label}`);
    console.log("Abstract actions:", actionsPreview);

    // pre shot
    const preName = `step-${String(step+1).padStart(2,'0')}-pre.png`;
    const prePath = path.join(screenshotsDir, preName);
    await page.screenshot({ path: prePath, fullPage: true });

    const cmd = await nextCommand(ap, page);
    console.log("LLM Command ->", cmd);

    // report entry for pre-action state
    const entry = {
      step: step + 1,
      url: ap.url,
      stage: progressStage,
      command: cmd,
      time: new Date().toISOString(),
      screenshotPre: `screenshots/${preName}`,
      screenshotPost: null,
      xssDetected: false
    };

    
    if (cmd === "FORM_FEEDBACK") {
      
      const payload = `<img src=x onerror="alert('XSS-TEST')">XSS-TEST`;

      await page.evaluate((payload) => {
        const setIf = (sel, val) => {
          const el = document.querySelector(sel);
          if (el) el.value = val;
        };
        setIf('#orderId', 'ORD-XSS');
        setIf('#customerName', 'YuraScanner Bot');
        setIf('#rating', 'Excellent');
        setIf('#comments', payload);
        const form = document.querySelector('#feedbackForm');
        if (form) {
          if (typeof form.requestSubmit === 'function') form.requestSubmit();
          else form.submit();
        }
      }, payload);

      let xssDetected = false;
      const dialogListener = async (dialog) => {
        try {
          const msg = dialog.message();
          console.log("Dialog fired:", msg);
          if (msg && msg.includes('XSS-TEST')) xssDetected = true;
          await dialog.dismiss();
        } catch (e) {}
      };
      page.once('dialog', dialogListener);

      
      await delay(1400);

      // post-action screenshot
      const postName = `step-${String(step+1).padStart(2,'0')}-post.png`;
      const postPath = path.join(screenshotsDir, postName);
      await page.screenshot({ path: postPath, fullPage: true });
      entry.screenshotPost = `screenshots/${postName}`;

      // DOM reflection check (if alert didn't fire)
      const domReflected = await page.evaluate(() => {
        const html = document.documentElement.innerHTML.toLowerCase();
        return html.includes('xss-test') || html.includes('onerror="alert');
      });
      if (domReflected) xssDetected = true;
      entry.xssDetected = xssDetected;
      report.push(entry);

      // save an extra evidence screenshot
      const evidenceName = `xss-step-${String(step+1).padStart(2,'0')}.png`;
      const evidencePath = path.join(screenshotsDir, evidenceName);
      await page.screenshot({ path: evidencePath, fullPage: true });
      report.push({
        step: step + 1 + 0.1,
        url: page.url(),
        stage: progressStage,
        command: 'XSS_EVIDENCE',
        xssDetected,
        time: new Date().toISOString(),
        screenshotPre: null,
        screenshotPost: `screenshots/${evidenceName}`
      });

      console.log(xssDetected ? "XSS Vulnerability Detected!" : "No XSS detected (page safe).");
      progressStage = "STOP";
      break;
    }

    // Normal STOP handling
    if (!cmd || /^STOP/i.test(cmd)) {
      console.log("Reached STOP, ending scan.");
      // capture a post-stop screenshot
      const postName = `step-${String(step+1).padStart(2,'0')}-post.png`;
      const postPath = path.join(screenshotsDir, postName);
      await page.screenshot({ path: postPath, fullPage: true });
      entry.screenshotPost = `screenshots/${postName}`;
      report.push(entry);
      break;
    }

    // Execute the planned click / fill via actuators
    await act(page, cmd);
    await delay(800);

    // post-action screenshot
    const postName = `step-${String(step+1).padStart(2,'0')}-post.png`;
    const postPath = path.join(screenshotsDir, postName);
    await page.screenshot({ path: postPath, fullPage: true });
    entry.screenshotPost = `screenshots/${postName}`;

    report.push(entry);

    if (progressStage === "STOP") {
      console.log("Progress stage moved to STOP — finishing.");
      break;
    }
  }

  // final safety capture
  try {
    const finalName = `step-final-capture.png`;
    const finalPath = path.join(screenshotsDir, finalName);
    await page.screenshot({ path: finalPath, fullPage: true });
    report.push({
      step: 'final',
      url: page.url(),
      stage: progressStage,
      command: 'FINAL_CAPTURE',
      time: new Date().toISOString(),
      screenshotPre: null,
      screenshotPost: `screenshots/${finalName}`
    });
  } catch (e) {
    console.warn("Could not take final screenshot:", e.message);
  }

  const reportPath = path.join(__dirname, 'scan-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  //console.log("Saved report to", reportPath);

  let finalUrl = "unknown";
  try { finalUrl = page.url(); } catch (e) {}
  await browser.close();
  return { finalUrl, report };
};
