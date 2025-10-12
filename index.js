// index.js
const runTask = require('./runner');

const SEED = process.env.SEED_URL || 'http://localhost:8080/index.html';
const TASK = process.env.TASK || 'Add product to cart and checkout';

(async () => {
  try {
    console.log('Starting scanner for', SEED, 'task:', TASK);
    const { finalUrl, report } = await runTask(SEED, TASK, 30);
    console.log('Final URL:', finalUrl);
    console.log('Done');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
