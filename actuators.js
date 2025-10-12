// actuators.js
// Executes commands from the planner/LLM on the Puppeteer page.

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = async function act(page, cmd) {
  if (!cmd) return;
  cmd = cmd.trim();

  // CLICK
  if (/^CLICK/i.test(cmd)) {
    const id = cmd.split(/\s+/)[1];

    // Validate element exists
    const exists = await page.evaluate(id =>
      !!document.querySelector(`[data-abs-id="${id}"]`), id);
    if (!exists) {
      console.warn('Invalid ID chosen:', id);
      return;
    }

    console.log(`Clicking element ID=${id}`);

    // Perform the click first
    await page.evaluate(id => {
      const el = document.querySelector(`[data-abs-id="${id}"]`);
      if (!el) return;
      if (el.tagName.toLowerCase() === 'a') {
        el.setAttribute('target', '_self'); // ensure same tab
      }
      el.click();
    }, id);

    // Then wait for navigation (if it happens)
    try {
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 3000 });
    } catch {
      // no navigation — continue
    }

    await delay(500);
    return;
  }

  // FILL & SUBMIT FORM
  if (/^FILL/i.test(cmd)) {
    const parts = cmd.split(/\s+/);
    const id = parts[parts.length - 1];

    const exists = await page.evaluate(id =>
      !!document.querySelector(`[data-abs-id="${id}"]`), id);
    if (!exists) {
      console.warn('Invalid FORM ID chosen:', id);
      return;
    }

    console.log(`Filling and submitting form ID=${id}`);

    await page.evaluate(id => {
      const form = document.querySelector(`[data-abs-id="${id}"]`);
      if (!form) return;
      const inputs = form.querySelectorAll('input, textarea, select');
      inputs.forEach(el => {
        const t = (el.getAttribute('type') || '').toLowerCase();
        if (el.tagName === 'SELECT') {
          if (el.options.length > 1) el.selectedIndex = 1;
        } else if (t === 'checkbox' || t === 'radio') {
          if (!el.checked) el.click();
        } else if (!el.disabled) {
          el.value = el.value || 'test';
        }
      });
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      } else {
        form.submit();
      }
    }, id);

    try {
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 4000 });
    } catch {
      // form submit might not navigate
    }

    await delay(400);
    return;
  }

  // STOP
  if (/^STOP/i.test(cmd)) {
    console.log('Stopping execution as commanded.');
    return;
  }

  console.warn('Unknown command:', cmd);
};
