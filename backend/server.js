import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const initDb = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT,
  balance INTEGER DEFAULT 1250,
  last_daily DATE,
  tasks_completed INTEGER DEFAULT 0
);
  `);

  await pool.query(`
  ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tasks_completed INTEGER DEFAULT 0;
`);
  await pool.query(`
  CREATE TABLE IF NOT EXISTS user_tasks (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, task_id)
  );
`);
  await pool.query(`
  CREATE TABLE IF NOT EXISTS referrals (
      id SERIAL PRIMARY KEY,
      referrer_id TEXT NOT NULL,
      referred_id TEXT UNIQUE NOT NULL,
      reward_given BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
};
const app = express();
initDb().catch(err => console.error("Database init error:", err));
app.use(cors());
app.use(express.json());

async function getUser(id, username="DemoUser") {
  const result = await pool.query(
    "SELECT * FROM users WHERE id = $1",
    [id]
  );

  if (result.rows.length > 0) {
    return result.rows[0];
  }

  const created = await pool.query(
    "INSERT INTO users (id, username, balance) VALUES ($1, $2, 1250) RETURNING *",
    [id, username]
  );

  return created.rows[0];
}

app.get("/api/user/:id", async (req,res) => {
  const u = await getUser(String(req.params.id));
  res.json(u);
});

app.post("/api/earn", async (req,res) => {
  const id = String(req.body.id || "");
  if (!id) return res.status(400).json({error:"Missing user id"});

  const u = await getUser(id);
  const updated = await pool.query(
    "UPDATE users SET balance = balance + 100 WHERE id = $1 RETURNING *",
    [id]
  );

  res.json({ok:true, reward:100, balance:updated.rows[0].balance});
});

app.post("/api/daily", async (req,res) => {
  const id = String(req.body.id || "");
  if (!id) return res.status(400).json({error:"Missing user id"});
  const u = await getUser(id);
  const today = new Date().toISOString().slice(0,10);
  if (String(u.last_daily).slice(0,10) === today) return res.status(409).json({error:"Daily bonus already claimed"});
  const updated = await pool.query(
  "UPDATE users SET last_daily = $1, balance = balance + 250 WHERE id = $2 RETURNING *",
  [today, id]
);
  
  res.json({ok:true, reward:250, balance:updated.rows[0].balance});
});

app.get("/api/referral/:id", (req,res) => {
  const bot = process.env.BOT_USERNAME || "Coinhammer_bot";
  res.json({
    link:`https://t.me/${bot}/coinhammer?startapp=${encodeURIComponent(req.params.id)}`
  });
});

app.post("/api/referral/claim", async (req,res) => {
  const referrerId = String(req.body.referrerId || "");
  const referredId = String(req.body.referredId || "");

  if (!referrerId || !referredId) {
    return res.status(400).json({error:"Missing referral data"});
  }

  if (referrerId === referredId) {
    return res.status(400).json({error:"Self referral not allowed"});
  }

  await getUser(referrerId);
  await getUser(referredId);

  await pool.query(
    `INSERT INTO referrals (referrer_id, referred_id)
     VALUES ($1, $2)
     ON CONFLICT (referred_id) DO NOTHING`,
    [referrerId, referredId]
  );

  res.json({ok:true});
});
app.get("/api/tasks", (req,res) => {
  res.json({
    tasks: [
      {
        id: "telegram",
        title: "Join Telegram",
        reward: 100
      },
      {
        id: "social",
        title: "Follow Social Media",
        reward: 100
      }
    ]
  });
});
app.post("/api/tasks/complete", async (req,res) => {
  const id = String(req.body.id || "");
  const taskId = String(req.body.taskId || "");

  if (!id || !taskId) {
    return res.status(400).json({error:"Missing user id or task id"});
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      "SELECT * FROM users WHERE id = $1 FOR UPDATE",
      [id]
    );

    if (userResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({error:"User not found"});
    }

    const taskResult = await client.query(
      `INSERT INTO user_tasks (user_id, task_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, task_id) DO NOTHING
       RETURNING id`,
      [id, taskId]
    );

    if (taskResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error:"Task already completed",
        duplicate:true
      });
    }

    const updatedUser = await client.query(
      "UPDATE users SET tasks_completed = tasks_completed + 1 WHERE id = $1 RETURNING *",
      [id]
    );

    const user = updatedUser.rows[0];
    let referralReward = false;

    if (user.tasks_completed >= 10) {
      const referral = await client.query(
        `SELECT * FROM referrals
         WHERE referred_id = $1
         AND reward_given = FALSE
         FOR UPDATE`,
        [id]
      );

      if (referral.rows.length > 0) {
        await client.query(
          "UPDATE users SET balance = balance + 500 WHERE id = $1",
          [referral.rows[0].referrer_id]
        );

        await client.query(
          "UPDATE referrals SET reward_given = TRUE WHERE id = $1",
          [referral.rows[0].id]
        );

        referralReward = true;
      }
    }

    await client.query("COMMIT");

    res.json({
      ok:true,
      task_id:taskId,
      tasks_completed:user.tasks_completed,
      referral_reward:referralReward
    });

  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    res.status(500).json({error:"Task completion failed"});
  } finally {
    client.release();
  }
});
app.post("/api/withdraw", async (req,res) => {
  const id = String(req.body.id || "");
  const amount = Number(req.body.amount);
  if (!id || !Number.isFinite(amount) || amount <= 0) return res.status(400).json({error:"Invalid request"});
  const u = await getUser(id);
  if (amount > u.balance) return res.status(400).json({error:"Insufficient balance"});
  const updated = await pool.query(
  "UPDATE users SET balance = balance - $1 WHERE id = $2 RETURNING *",
  [amount, id]
);
  res.json({ok:true, status:"pending", balance:updated.rows[0].balance});
});

app.get("/api/leaderboard", async (req,res) => {
  const result = await pool.query(
    "SELECT id, username, balance FROM users ORDER BY balance DESC LIMIT 10"
  );
  res.json(result.rows);
});

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/../frontend/index.html");
});
app.listen(process.env.PORT || 3000, () => {
  console.log(`CoinHammer backend running on port ${process.env.PORT || 3000}`);
});
