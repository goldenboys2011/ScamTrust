import express from 'express';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { getDiscordStatus } from './discordBot.js';
import { getRedditStatus } from './redditBot.js';
import log,{color} from './logger.js'

const config = JSON.parse(fs.readFileSync(new URL('./config.json', import.meta.url)));
const app = express();

// Track status per API endpoint
const apiEndpointsStatus = {
  '/scammer/add': 'running',
  '/report/add': 'running',
  '/scammer/:id': 'running',
  '/scammers': 'running',
  '/admins': 'running'
};

let apiStatus = 'running';  // Overall API status

// Middleware to log requests (optional)
app.use((req, res, next) => {
  log("API", `${req.method} ${req.url}`, color.grey);
  next();
});

const authMiddleware = (req, res, next) => {
  if (req.headers['authorization'] !== config.authToken) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  next();
};

const loadDB = () => JSON.parse(fs.readFileSync('./db.json'));
const saveDB = (data) => fs.writeFileSync('./db.json', JSON.stringify(data, null, 2));

app.post('/scammer/add', express.json(), authMiddleware, (req, res) => {
  try {
    const { discordId, redditUsername, note, displayName } = req.body;
    const db = loadDB();
    const id = uuidv4();

    db.scammers.push({
      id,
      discordId,
      redditUsername,
      note,
      displayName
    });
    db.redditBan.push({
      id,
      redditUsername,
      note
    });
    saveDB(db);
    res.json({ success: true });
  } catch (e) {
    apiEndpointsStatus['/scammer/add'] = 'error';
    res.status(500).json({ error: 'Failed to add scammer' });
  }
});

app.post('/report/add', express.json(), authMiddleware, (req, res) => {
  try {
    const { discord, reddit, scam, displayName, proofUrl } = req.body;
    const db = loadDB();
    db.reports.push({
      id: uuidv4(),
      discord,
      reddit,
      scam,
      displayName,
      proofUrl
    });
    saveDB(db);
    res.json({ success: true });
  } catch (e) {
    apiEndpointsStatus['/report/add'] = 'error';
    res.status(500).json({ error: 'Failed to add report' });
  }
});

app.get('/scammer/:id', express.json(), (req, res) => {
  try {
    const db = loadDB();
    const result = db.scammers.find(s =>
      s.id === req.params.id ||
      s.discordId === req.params.id ||
      s.redditUsername === req.params.id
    );
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json(result);
  } catch (e) {
    apiEndpointsStatus['/scammer/:id'] = 'error';
    res.status(500).json({ error: 'Failed to fetch scammer' });
  }
});

app.get('/scammers', express.json(), (req, res) => {
  try {
    const db = loadDB();
    res.json(db.scammers);
  } catch (e) {
    apiEndpointsStatus['/scammers'] = 'error';
    res.status(500).json({ error: 'Failed to fetch scammers' });
  }
});

app.get('/admins', express.json(), (req, res) => {
  try {
    const db = loadDB();
    res.json(db.verifiedAdmins);
  } catch (e) {
    apiEndpointsStatus['/admins'] = 'error';
    res.status(500).json({ error: 'Failed to fetch admins' });
  }
});

app.get('/status', (req, res) => {
  res.json({
    services: [
      { name: 'discordBot', status: getDiscordStatus() },
      { name: 'redditBot', status: getRedditStatus() },
      { name: 'api', status: apiStatus },
      ...Object.entries(apiEndpointsStatus).map(([name, status]) => ({ name, status })),
    ]
  });
});

app.listen(3000, () => log("API", 'listening on port 3000', color.white));
