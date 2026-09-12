import express from "express";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const users = new Map();

function getUser(id, username="DemoUser") {
  if (!users.has(id)) users.set(id, {
    id, username, balance: 1250, lastDaily: null, referrals: 0
  });
  return users.get(id);
}

app.get("/api/user/:id", (req,res) => {
  const u = getUser(String(req.params.id));
  res.json(u);
});

app.post("/api/earn", (req,res) => {
  const id = String(req.body.id || "");
  if (!id) return res.status(400).json({error:"Missing user id"});
  const u = getUser(id);
  u.balance += 100;
  res.json({ok:true, reward:100, balance:u.balance});
});

app.post("/api/daily", (req,res) => {
  const id = String(req.body.id || "");
  if (!id) return res.status(400).json({error:"Missing user id"});
  const u = getUser(id);
  const today = new Date().toISOString().slice(0,10);
  if (u.lastDaily === today) return res.status(409).json({error:"Daily bonus already claimed"});
  u.lastDaily = today;
  u.balance += 250;
  res.json({ok:true, reward:250, balance:u.balance});
});

app.get("/api/referral/:id", (req,res) => {
  const bot = process.env.BOT_USERNAME || "Coinhammer_bot";
  res.json({link:`https://t.me/${bot}/app?startapp=${encodeURIComponent(req.params.id)}`});
});

app.post("/api/withdraw", (req,res) => {
  const id = String(req.body.id || "");
  const amount = Number(req.body.amount);
  if (!id || !Number.isFinite(amount) || amount <= 0) return res.status(400).json({error:"Invalid request"});
  const u = getUser(id);
  if (amount > u.balance) return res.status(400).json({error:"Insufficient balance"});
  u.balance -= amount;
  res.json({ok:true, status:"pending", balance:u.balance});
});

app.get("/api/leaderboard", (req,res) => {
  const list=[...users.values()].sort((a,b)=>b.balance-a.balance).slice(0,10);
  res.json(list);
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`CoinHammer backend running on port ${process.env.PORT || 3000}`);
});
