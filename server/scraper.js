const puppeteer = require('puppeteer');

async function scrapeTriggers(movieId) {
  const browser = await puppeteer.launch({ headless: false }); // open browser to watch
  const page = await browser.newPage();
  
  await page.goto(`https://www.doesthedogdie.com/media/${movieId}`, {
    waitUntil: 'networkidle2',
    timeout: 30000
  });

  // Wait extra time for dynamic content to load
  await new Promise(resolve => setTimeout(resolve, 5000));

  const triggers = await page.evaluate(() => {
    const items = [];
    document.querySelectorAll('.topicRow').forEach((el) => {
      const name = el.querySelector('.name')?.innerText?.trim();
      const yes = el.querySelector('.yes')?.innerText?.trim();
      const no = el.querySelector('.no')?.innerText?.trim();
      if (name) {
        items.push({ topic: name, yes: yes || '0', no: no || '0' });
      }
    });
    return items;
  });

  console.log(JSON.stringify(triggers, null, 2));
  await browser.close();
}

scrapeTriggers(10072);