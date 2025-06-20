import snoowrap from 'snoowrap';
import fs from 'fs';
import log, { color } from './logger.js';

let redditStatus = 'starting';

function setRedditStatus(status) {
  redditStatus = status;
}

export function getRedditStatus() {
  return redditStatus;
}

const config = JSON.parse(fs.readFileSync(new URL('./config.json', import.meta.url)));
const dbPath = './db.json';

const reddit = new snoowrap({
  userAgent: config.reddit.userAgent,
  clientId: config.reddit.clientId,
  clientSecret: config.reddit.clientSecret,
  username: config.reddit.username,
  password: config.reddit.password
});

function loadDB() {
  const data = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
  return data || [];
}

function saveDBBan(updatedRedditBan) {
  const data = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
  data.redditBan = updatedRedditBan;
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
}

function saveDB(data) {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
}


async function getModeratedSubreddits() {
  try {
    const subs = await reddit.getModeratedSubreddits();
    return subs.map(sub => sub.display_name);
  } catch (error) {
    //console.error('[Reddit] Failed to fetch moderated subreddits:', error.message);
    log("Reddit", 'Failed to fetch moderated subreddits:' + error, color.red)
    return [];
  }
}

async function checkModInvites() {
  try {
    const messages = await reddit.getInbox({ filter: 'messages' });
    const db = loadDB();

    for (const msg of messages) {
      const subredditName = msg.subreddit?.display_name;

      if (
        msg.subject?.toLowerCase().includes('invitation to moderate') &&
        subredditName &&
        !db.acceptedSubs.includes(subredditName)
      ) {
        log("Reddit, "`📨 Mod invite found for r/${subredditName}`, color.yellow);

        try {
          await reddit.getSubreddit(subredditName).acceptModeratorInvite();
          log("Reddit", `✅ Accepted mod invite to r/${subredditName}`, color.green);

          db.acceptedSubs.push(subredditName);
          saveDBBan(db);
        } catch (e) {
          //console.warn(`[Reddit] ⚠️ Failed to accept invite to r/${subredditName}:`, e.message);
          log("Reddit", ` ⚠️ Failed to accept invite to r/${subredditName}: ${e.message}`, color.red);
        }
      }
    }
  } catch (err) {
    //console.error('[Reddit] ❌ Error checking mod invites:', err.message);
    log("Reddit", `❌ Error checking mod invites: ${err.message}`, color.red);
  }
}


async function checkScammers() {
  try {
    //console.log('[Reddit] Checking scammers to ban...');
    log("Reddit", `Checking scammers to ban...`, color.white);
    let scammers = loadDB().redditBan;

    if (scammers.length === 0) {
      //console.log("[Reddit] No scammers to ban.");
      log("Reddit", `No scammers to ban.`, color.white);
      setRedditStatus("running");
      return;
    }

    const subreddits = await getModeratedSubreddits();
    if (subreddits.length === 0) {
      //console.warn('[Reddit] ⚠️ No moderated subreddits found.');
      log("Reddit", `⚠️ No moderated subreddits found.`, color.yellow);
      return;
    }

    for (const scammer of [...scammers]) {
      if (!scammer.redditUsername) continue;

      for (const subreddit of subreddits) {
        try {
          await reddit.getSubreddit(subreddit).banUser({
            name: scammer.redditUsername,
            banReason: scammer.note || 'Scammer',
            banMessage: `You have been banned due to confirmed scam activity. Note: ${scammer.note}`
          });
          //console.log(`[Reddit] 🔨 Banned ${scammer.redditUsername} from r/${subreddit}`);
          log("Reddit", `🔨 Banned ${scammer.redditUsername} from r/${subreddit}`, color.green);
        } catch (err) {
          //console.warn(`[Reddit] ⚠️ Failed to ban ${scammer.redditUsername} from r/${subreddit}:`, err.message);
          log("Reddit", `⚠️ Failed to ban ${scammer.redditUsername} from r/${subreddit}:`, color.red);
        }
      }

      // Remove scammer from DB after processing
      scammers = scammers.filter(s => s.id !== scammer.id);
      saveDB(scammers);
    }

    setRedditStatus("running");
  } catch (error) {
    //console.error('[Reddit] Fatal error in checkScammers:', error);
    log("Reddit", `Fatal error in checkScammers:`, color.red);
    setRedditStatus("error");
  }
}

setRedditStatus("running");
//console.log("[Reddit] 🤖 Reddit Bot Running!");
log("Reddit", `🤖 Reddit Bot Running!`, color.white);

checkScammers();
checkModInvites();

setInterval(checkScammers, 60 * 1000);
setInterval(checkModInvites, 60 * 1000);
