import snoowrap from 'snoowrap';
import fs from 'fs';


const config = JSON.parse(fs.readFileSync(new URL('./config.json', import.meta.url)));
const reddit = new snoowrap({
  userAgent: config.reddit.userAgent,
  clientId: config.reddit.clientId,
  clientSecret: config.reddit.clientSecret,
  username: config.reddit.username,
  password: config.reddit.password
});

function loadDB() {
  return JSON.parse(fs.readFileSync('./db.json')).scammers;
}

// Run every X mins to check and ban
setInterval(async () => {
  const scammers = loadDB();
  for (const scammer of scammers) {
    if (scammer.redditUsername) {
      try {
        await reddit.getSubreddit('minecraftcapes').banUser({ name: scammer.redditUsername, banReason: scammer.note || 'Scammer' });
        console.log(`Banned Reddit user ${scammer.redditUsername}`);
      } catch (err) {
        console.warn(`Failed to ban ${scammer.redditUsername}:`, err.message);
      }
    }
  }
}, 60000 * 5); // every 5 minutes
