import express from 'express';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

const config = JSON.parse(fs.readFileSync(new URL('./config.json', import.meta.url)));
const app = express();

app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
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
  const { discordId, redditUsername, note, displayName } = req.body;

  const db = loadDB();
  db.scammers.push({
    id: uuidv4(),
    discordId,
    redditUsername,
    note,
    displayName
  });
  saveDB(db);
  res.json({ success: true });
});

app.post('/report/add', express.json(), authMiddleware, (req, res) => {
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
});

app.get('/scammer/:id', express.json(), (req, res) => {
  const db = loadDB();
  const result = db.scammers.find(s => 
    s.id === req.params.id ||
    s.discordId === req.params.id ||
    s.redditUsername === req.params.id
  );
  if (!result) return res.status(404).json({ error: 'Not found' });
  res.json(result);
});

app.get('/scammers', express.json(), (req, res) => {
  const db = loadDB();
  console.log("bruh")
  console.log(db.scammers);
  res.json(db.scammers);
});

app.listen(3000, () => console.log('API listening on port 3000'));
