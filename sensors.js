// sensors.js
module.exports = async function sense(page) {
  // Run inside the page and return an abstract view of actions
  return await page.evaluate(() => {
    const visible = el => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };

    const labelOf = el =>
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      (el.innerText || '').trim() ||
      el.getAttribute('value') || '';

    const actions = [];
    let idx = 0;

    // Clickables
    const clickables = Array.from(document.querySelectorAll(
      'a,button,input[type=button],input[type=submit],[onclick]'
    ));
    clickables.forEach(el => {
      if (!visible(el)) return;
      const label = labelOf(el);
      if (!label || label.length > 250) return;
      el.setAttribute('data-abs-id', idx);
      actions.push({ id: idx, kind: 'click', label });
      idx++;
    });

    // Forms (if any)
    const forms = Array.from(document.querySelectorAll('form'));
    forms.forEach((f, i) => {
      if (!visible(f)) return;
      const id = 10000 + i;
      const name = f.getAttribute('name') || f.id || '';
      f.setAttribute('data-abs-id', id);
      actions.push({
        id,
        kind: 'form',
        label: `form ${name}`.trim(),
        formMeta: {
          name,
          action: f.getAttribute('action') || '',
          method: (f.getAttribute('method') || 'GET').toUpperCase()
        }
      });
    });

    return { url: location.href, title: document.title, actions };
  });
};
