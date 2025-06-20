import './discordBot.js';
import { getDiscordStatus } from './discordBot.js';

let interval;

async function checkIfDiscord() {
  if (getDiscordStatus() !== 'starting') {
    await import('./api.js');
    await import('./redditBot.js');

    console.log('[System] System is running...');
    clearInterval(interval); // 🔥 Stop the interval
  } else {
    console.log('[System] Waiting for Discord to be ready...');
  }
}

// Start checking every 6 seconds
interval = setInterval(checkIfDiscord, 6000);
