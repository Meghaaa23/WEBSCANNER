// runner.js
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const sense = require('./sensors');
const decideLLM = require('./bridge');
const act = require('./actuators');

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// Flow state: HOME -> PRODUCTS -> CART -> ORDERS
let flowState = "HOME";

module.exports = async function runTask(seedUrl, task, maxSteps = 30) {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  // Handle alerts
  page.on('dialog', async dialog => {
    console.log("Dialog shown:", dialog.message());
    await dialog.accept();
  });

  console.log("Navigating to seed:", seedUrl);
  await page.goto(seedUrl, { waitUntil: 'domcontentloaded' });

  const history = [];
  const report = [];
  const reportPath = path.join(__dirname, 'scan-report.json');

  for (let step = 0; step < maxSteps; step++) {
    console.log("\n___ Step", step + 1, "___");

    // SENSE
    const ap = await sense(page);
    const actionsPreview = ap.actions.map(a => `${a.id}:${a.label}`);
    console.log("Abstract actions:", actionsPreview);

    // Decide next command
    let cmd;
    try {
      // Structured sub-task guidance
      let subTask = task;
      if (flowState === "HOME") subTask = "Go to Products page";
      if (flowState === "PRODUCTS") subTask = "Add all products, then go to Cart";
      if (flowState === "CART") subTask = "Place order, then go to Orders";
      if (flowState === "ORDERS") subTask = "Stop";

      cmd = await decideLLM(ap, subTask, history);

      // Guard: Products page — must click Add if available
      if (ap.url.includes("product.html")) {
        const addBtn = ap.actions.find(a => a.label.toLowerCase().includes("add"));
        if (addBtn && !cmd.startsWith("CLICK")) {
          console.warn("Forcing Add on Products page:", addBtn.label);
          cmd = `CLICK ${addBtn.id}`;
        }
      }

      // Guard: Cart page — handle empty vs non-empty cart
      if (ap.url.includes("cart.html")) {
        const isEmpty = await page.evaluate(() =>
          document.body.innerText.includes("Your cart is empty.")
        );

        const placeBtn = ap.actions.find(a => a.label.toLowerCase().includes("place order"));

        if (!isEmpty && placeBtn && cmd !== `CLICK ${placeBtn.id}`) {
          console.warn("Forcing Place Order on Cart page");
          cmd = `CLICK ${placeBtn.id}`;
        } else if (isEmpty) {
          console.warn("Cart is empty, navigating to Orders page");
          const ordersBtn = ap.actions.find(a => a.label.toLowerCase().includes("orders"));
          if (ordersBtn) {
            cmd = `CLICK ${ordersBtn.id}`;
          } else {
            cmd = "STOP";
          }
        }
      }

      // Guard: Orders page — must Delete Order if available, else STOP
      if (ap.url.includes("orders.html")) {
        const deleteBtn = ap.actions.find(a => a.label.toLowerCase().includes("delete order"));
        if (deleteBtn && cmd !== `CLICK ${deleteBtn.id}`) {
          console.warn("Forcing Delete Order on Orders page");
          cmd = `CLICK ${deleteBtn.id}`;
        } else if (!deleteBtn) {
          console.warn("No Delete Order button, forcing STOP");
          cmd = "STOP";
        }
      }
    } catch (e) {
      console.warn("LLM decide failed, STOP. Reason:", e.message);
      cmd = "STOP";
    }

    console.log("LLM Command ->", cmd);
    history.push(cmd);

    // Save to report
    report.push({
      step: step + 1,
      url: ap.url,
      state: flowState,
      actions: ap.actions,
      llm_command: cmd,
      time: new Date().toISOString()
    });

    // Update flow state
    if (ap.url.includes("index.html")) flowState = "HOME";
    if (ap.url.includes("product.html")) flowState = "PRODUCTS";
    if (ap.url.includes("cart.html")) flowState = "CART";
    if (ap.url.includes("orders.html")) flowState = "ORDERS";

    // Stop if needed
    if (/^STOP/i.test(cmd)) break;

    // ACT
    await act(page, cmd);

    // Settle delay
    await delay(1000);
  }

  // Save full report
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log("\nSaved report to", reportPath);

  const finalUrl = page.url();
  await browser.close();
  return { finalUrl, report };
};
