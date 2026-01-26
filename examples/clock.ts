import { HUB75 } from '../src/api.js';
import { ip, port } from './config.js';

const api = new HUB75({ ip, port });

(async () => {
  try {
    const bgColor: [number, number, number] = [0, 0, 0];

    api.clear();

    // api.setBrightness(15);

    api.setColor(60, 60, 20);

    api.clockStart(8, 10, 1, bgColor);

    // api.invalid();

    api.setColor(0, 10, 20);

    api.fillRect(0, 0, 64, 3);

    api.setColor(0, 100, 100);

    api.progressStart(0, 0, 64, 3, 1000);

    // api.drawRect(0, 18, 64, 38);
    // api.setColor(95, 100, 100);
    // api.textBlock(0, 8, 64, 50, 1, "Paksas geriausias, tu viska pas dieva gali");

    // api.setColor(0, 0, 100);
    // api.drawLine(0, 18, 63, 64);
    api.scrollTextStart(2, 28, 60, 16, 1, 4, 'Paksas geriausias!', bgColor);

    api.regionBitmap(0, 50, 4, 4, new Uint8Array([0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0]));

    await api.send();

    // api.drawLine(0, 0, 62, 0);
    // await delay(3000);
    // api.policeStop();
    // await delay(20);
    // api.policeStart(100);
    // api.drawLine(0, 20, 62, 20);
    // api.setColor(0, 255, 0);
    // api.drawLine(63, 0, 0, 31);
    // api.drawRect(0, 0, 64, 64);
    // api.setColor(255, 0, 0);
    // api.drawRect(0, 0, 64, 64);

    // api.fillScreen(...bgColor);

    // api.setBrightness(100);

    // api.scrollTextStart(2, 20, 60, 32, 2, 4, "Broliai Aliukai ir sesutės -- Žiauriai kieta daina", bgColor);
    // api.scrollTextStop();

    // api.setFont(5);

    // api.setCursor(0, 10);
    // api.print("Hello, world!");

    // await delay(100);

    // api.setCursor(10, 20);
    // api.print("21:45:14");

    // await delay(100);

    // api.setFont(2);

    // api.textBlock(0, 20, 64, 60, 1, "This is a longer text that should wrap around to the next line.");
    // api.setCursor(0, 30);
    // api.print("Hello from the other side!");

    // await delay(3000);
    // api.scrollTextStop();

    // api.setColor(255, 255, 255);
    // api.setFont(0);

    // await delay(1000);
  } finally {
    setTimeout(() => api.close(), 50);
  }
})();

// process.exit(0);
