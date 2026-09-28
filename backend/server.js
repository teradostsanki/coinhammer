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
  ALTER TABLE users
  ADD COLUMN IF NOT EXISTS daily_earn_count INTEGER DEFAULT 0
`);

await pool.query(`
  ALTER TABLE users
  ADD COLUMN IF NOT EXISTS daily_earn_date DATE
`);
await pool.query(`
  ALTER TABLE users
  ADD COLUMN IF NOT EXISTS streak_count INTEGER DEFAULT 0
`);
await pool.query(`
  ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_spin_date DATE
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
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    reward INTEGER NOT NULL DEFAULT 100,
    category TEXT NOT NULL DEFAULT 'social',
    icon TEXT DEFAULT '🎯',
    link TEXT DEFAULT '',
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);
await pool.query(`
  ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS link TEXT DEFAULT ''
`);
  await pool.query(`
    INSERT INTO tasks (id, title, description, reward, category, icon)
    VALUES
      ('telegram', 'Join Telegram', 'Join CoinHammer Telegram', 100, 'social', '📨'),
      ('social', 'Follow Social Media', 'Follow CoinHammer social media', 100, 'social', '📱'),
      ('youtube', 'Subscribe YouTube', 'Subscribe to CoinHammer YouTube', 100, 'social', '▶️'),
      ('instagram', 'Follow Instagram', 'Follow CoinHammer Instagram', 100, 'social', '📷'),
      ('facebook', 'Follow Facebook', 'Follow CoinHammer Facebook', 100, 'social', '👍'),
      ('twitter', 'Follow X', 'Follow CoinHammer on X', 100, 'social', '✖️'),
      ('channel', 'Join Telegram Channel', 'Join our Telegram channel', 100, 'social', '📢'),
      ('community', 'Join Community', 'Join CoinHammer community', 100, 'social', '💬'),
      ('share', 'Share CoinHammer', 'Share CoinHammer with friends', 100, 'special', '🔗'),
      ('visit', 'Visit CoinHammer', 'Visit CoinHammer website', 100, 'apps', '🌐')
    ON CONFLICT (id) DO NOTHING;
  `);
  await pool.query(`
  ALTER TABLE user_tasks
  ADD COLUMN IF NOT EXISTS reward_given BOOLEAN DEFAULT FALSE
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS activities (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount INTEGER DEFAULT 0,
      description TEXT,
      status TEXT,
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
app.get("/health", (req,res) => {
  res.send("OK");
});
app.get("/api/user/:id", async (req,res) => {
  const u = await getUser(String(req.params.id));
  res.json(u);
});

app.post("/api/earn", async (req,res) => {
  try {
    const id = String(req.body.id || "");
    if (!id) return res.status(400).json({error:"Missing user id"});

    await getUser(id);

    const updated = await pool.query(
      `UPDATE users
       SET daily_earn_count =
             CASE
               WHEN daily_earn_date IS NULL OR daily_earn_date < CURRENT_DATE
               THEN 1
               ELSE daily_earn_count + 1
             END,
           daily_earn_date = CURRENT_DATE,
           balance = balance + 100
       WHERE id = $1
         AND (
           daily_earn_date IS NULL
           OR daily_earn_date < CURRENT_DATE
           OR daily_earn_count < 5
         )
       RETURNING *`,
      [id]
    );

    if (updated.rows.length === 0) {
      return res.status(429).json({
        error:"Daily earning limit reached"
      });
    }

    await pool.query(
  `INSERT INTO activities
   (user_id, type, amount, description, status)
   VALUES ($1, $2, $3, $4, $5)`,
  [id, "ad", 100, "Rewarded ad earning", "completed"]
);

res.json({
  ok:true,
  reward:100,
  balance:updated.rows[0].balance,
  dailyEarnCount:updated.rows[0].daily_earn_count
});
  } catch(e) {
    res.status(500).json({error:e.message});
  }
});

const STREAK_REWARDS = [100, 150, 200, 250, 300, 400, 500];

app.post("/api/daily", async (req,res) => {
  const client = await pool.connect();
  try {
    const id = String(req.body.id || "");
    if(!id) { client.release(); return res.status(400).json({error:"Missing user id"}); }

    await getUser(id);

    const today = new Date().toISOString().slice(0,10);

    await client.query("BEGIN");

    const userRow = await client.query(
      "SELECT last_daily, streak_count FROM users WHERE id = $1 FOR UPDATE",
      [id]
    );

    const lastDaily = userRow.rows[0]?.last_daily
      ? new Date(userRow.rows[0].last_daily).toISOString().slice(0,10)
      : null;
    const prevStreak = userRow.rows[0]?.streak_count || 0;

    if (lastDaily === today) {
      await client.query("ROLLBACK");
      client.release();
      return res.status(409).json({ error:"Daily bonus already claimed today" });
    }

    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0,10);
    const newStreak = (lastDaily === yesterday) ? (prevStreak % 7) + 1 : 1;
    const reward = STREAK_REWARDS[newStreak - 1];

    const updated = await client.query(
      `UPDATE users
       SET last_daily = $1,
           streak_count = $2,
           balance = balance + $3
       WHERE id = $4
       RETURNING *`,
      [today, newStreak, reward, id]
    );

    await client.query(
      `INSERT INTO activities
       (user_id, type, amount, description, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, "daily", reward, `Daily bonus (Day ${newStreak})`, "completed"]
    );

    await client.query("COMMIT");

    res.json({
      ok:true,
      reward,
      streak:newStreak,
      balance:updated.rows[0].balance
    });

  } catch(e) {
    await client.query("ROLLBACK");
    res.status(500).json({error:e.message});
  } finally {
    client.release();
  }
});

app.get("/api/referral/:id", async (req,res) => {
  try {
    const id = String(req.params.id);
    const bot = process.env.BOT_USERNAME || "Coinhammer_bot";

    const stats = await pool.query(
      `SELECT
         COUNT(*)::int AS total_referrals,
         COALESCE(SUM(CASE WHEN reward_given THEN 500 ELSE 0 END),0)::int AS total_earned
       FROM referrals
       WHERE referrer_id = $1`,
      [id]
    );

    const recent = await pool.query(
      `SELECT r.referred_id, r.reward_given, r.created_at, u.username, u.tasks_completed
       FROM referrals r
       LEFT JOIN users u ON u.id = r.referred_id
       WHERE r.referrer_id = $1
       ORDER BY r.created_at DESC
       LIMIT 10`,
      [id]
    );

    res.json({
      link:`https://t.me/${bot}/coinhammer?startapp=${encodeURIComponent(id)}`,
      totalReferrals: stats.rows[0].total_referrals,
      totalEarned: stats.rows[0].total_earned,
      recent: recent.rows
    });
  } catch(e) {
    res.status(500).json({error:e.message});
  }
});
app.get("/api/activities/:id", async (req,res) => {
  try {
    const result = await pool.query(
  `SELECT
     a.type,
     a.amount,
     a.description,
     a.status,
     a.created_at,
     w.created_at AS withdrawal_requested_at,
     w.processed_at AS withdrawal_processed_at
   FROM activities a
   LEFT JOIN LATERAL (
  SELECT created_at, processed_at
  FROM withdrawals
  WHERE user_id = a.user_id
    AND a.type = 'withdrawal'
    AND a.description LIKE 'Withdrawal ₹' || amount::text || '%'
    AND created_at <= a.created_at
  ORDER BY created_at DESC
  LIMIT 1
) w ON TRUE
   WHERE a.user_id = $1
   ORDER BY a.created_at DESC
   LIMIT 20`,
  [String(req.params.id)]
);

    res.json(result.rows);
  } catch(e) {
    res.status(500).json({error:e.message});
  }
});
app.post("/api/referral/claim", async (req,res) => {
  const referrerId = String(req.body.referrerId || "");
  const referredId = String(req.body.referredId || "");
  console.log("REFERRAL CLAIM:", { referrerId, referredId });

  if (!referrerId || !referredId) {
    return res.status(400).json({error:"Missing referral data"});
  }

  if (referrerId === referredId) {
    return res.status(400).json({error:"Self referral not allowed"});
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await getUser(referrerId);
    await getUser(referredId);

    await client.query(
      `INSERT INTO referrals (referrer_id, referred_id)
       VALUES ($1, $2)
       ON CONFLICT (referred_id) DO NOTHING`,
      [referrerId, referredId]
    );

    const referral = await client.query(
      `SELECT r.*, u.tasks_completed
       FROM referrals r
       JOIN users u ON u.id = r.referred_id
       WHERE r.referred_id = $1
       FOR UPDATE`,
      [referredId]
    );

    console.log("REFERRAL ROW:", referral.rows[0]);
    let rewardGiven = false;

    if (
      referral.rows.length > 0 &&
      referral.rows[0].reward_given === false &&
      referral.rows[0].tasks_completed >= 10
    ) {
      await client.query(
        `UPDATE users
         SET balance = balance + 500
         WHERE id = $1`,
        [referral.rows[0].referrer_id]
      );

      await client.query(
        `UPDATE referrals
         SET reward_given = TRUE
         WHERE id = $1`,
        [referral.rows[0].id]
      );

      rewardGiven = true;
    }

    await client.query("COMMIT");

    res.json({
      ok:true,
      reward_given:rewardGiven
    });

  } catch(e) {
    await client.query("ROLLBACK");
    res.status(500).json({error:e.message});
  } finally {
    client.release();
  }
});
app.get("/api/tasks", async (req,res) => {
  try {
    const result = await pool.query(`
      SELECT id, title, description, reward, category, icon, link
      FROM tasks
      WHERE active = TRUE
      ORDER BY created_at ASC
    `);

    res.json({
      tasks: result.rows
    });
  } catch (e) {
    console.error("TASKS LOAD ERROR:", e);
    res.status(500).json({
      error: "Failed to load tasks"
    });
  }
});
app.get("/api/tasks/completed/:id", async (req,res) => {
  try {
    const result = await pool.query(
      "SELECT task_id FROM user_tasks WHERE user_id = $1 AND reward_given = TRUE",
      [String(req.params.id)]
    );
    res.json({ taskIds: result.rows.map(r => r.task_id) });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/tasks/complete", async (req,res) => {
  const id = String(req.body.id || "");
  const taskId = String(req.body.taskId || "");

  if (!id || !taskId) {
    return res.status(400).json({
      error: "Missing user id or task id"
    });
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
      return res.status(404).json({
        error: "User not found"
      });
    }

    const taskResult = await client.query(
      `INSERT INTO user_tasks (user_id, task_id, reward_given)
       VALUES ($1, $2, TRUE)
       ON CONFLICT (user_id, task_id) DO NOTHING
       RETURNING id`,
      [id, taskId]
    );
        const taskInfoResult = await client.query(
      `SELECT reward FROM tasks
       WHERE id = $1 AND active = TRUE`,
      [taskId]
    );

    if (taskInfoResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "Task not found or inactive"
      });
    }

    const taskReward = Number(taskInfoResult.rows[0].reward);
    const randomReward = Math.floor(Math.random() * taskReward) + 1;

    // Old completed task: recover missing reward once
    if (taskResult.rows.length === 0) {
      const existingTask = await client.query(
        `SELECT * FROM user_tasks
         WHERE user_id = $1 AND task_id = $2
         FOR UPDATE`,
        [id, taskId]
      );

      if (existingTask.rows[0]?.reward_given === false) {
        const recoveredUser = await client.query(
          `UPDATE users
           SET balance = balance + randomReward
           WHERE id = $1
           RETURNING *`,
          [id]
        );

        await client.query(
          `UPDATE user_tasks
           SET reward_given = TRUE
           WHERE user_id = $1 AND task_id = $2`,
          [id, taskId]
        );

        await client.query("COMMIT");

        return res.json({
          ok: true,
          task_id: taskId,
          reward: randomReward,
          balance: recoveredUser.rows[0].balance,
          recovered: true
        });
      }

      await client.query("ROLLBACK");

      return res.status(409).json({
        error: "Task already completed",
        duplicate: true
      });
    }

    const updatedUser = await client.query(
      `UPDATE users
       SET tasks_completed = tasks_completed + 1,
           balance = balance + randomReward
       WHERE id = $1
       RETURNING *`,
      [id, randomReward]
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
          `UPDATE users
           SET balance = balance + 500
           WHERE id = $1`,
          [referral.rows[0].referrer_id]
        );

        await client.query(
          `UPDATE referrals
           SET reward_given = TRUE
           WHERE id = $1`,
          [referral.rows[0].id]
        );

        referralReward = true;
      }
    }

    await client.query("COMMIT");

    res.json({
      ok: true,
      task_id: taskId,
      tasks_completed: user.tasks_completed,
      reward: randomReward,
      balance: user.balance,
      referral_reward: referralReward
    });

  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);

    res.status(500).json({
      error: "Task completion failed"
    });

  } finally {
    client.release();
  }
});
await pool.query(`
  CREATE TABLE IF NOT EXISTS withdrawals (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    method TEXT NOT NULL,
    account_holder_name TEXT,
    account_number TEXT,
    ifsc TEXT,
    upi_id TEXT,
    amount NUMERIC(12,2) NOT NULL,
    status TEXT DEFAULT 'pending',
    admin_note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP
  )
`);  
app.post("/api/withdraw", async (req,res) => {
  const client = await pool.connect();

  try {
    const id = String(req.body.id || "");
    const method = String(req.body.method || "").toLowerCase();
    const amount = Number(req.body.amount);

    const accountHolderName = String(req.body.accountHolderName || "");
    const accountNumber = String(req.body.accountNumber || "");
    const ifsc = String(req.body.ifsc || "");
    const upiId = String(req.body.upiId || "");

    if (!id || !["bank", "upi"].includes(method)) {
      return res.status(400).json({
        error: "Invalid withdrawal method"
      });
    }

    if (!Number.isFinite(amount) || amount < 10) {
      return res.status(400).json({
        error: "Minimum withdrawal is ₹10"
      });
    }

    if (method === "bank") {
      if (!accountHolderName || !accountNumber || !ifsc) {
        return res.status(400).json({
          error: "Bank details are required"
        });
      }
    }

    if (method === "upi") {
      if (!upiId) {
        return res.status(400).json({
          error: "UPI ID is required"
        });
      }
    }

    await client.query("BEGIN");

    const userResult = await client.query(
      "SELECT * FROM users WHERE id = $1 FOR UPDATE",
      [id]
    );

    if (userResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "User not found"
      });
    }

    const user = userResult.rows[0];

    if (amount * 100 > user.balance) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Insufficient balance"
      });
    }

    const countResult = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM withdrawals
       WHERE user_id = $1
       AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
`,
[id]
    );

    if (countResult.rows[0].count >= 2) {
      await client.query("ROLLBACK");
      return res.status(429).json({
        error: "Daily withdrawal limit reached. Maximum 2 withdrawals per day."
      });
    }

    await client.query(
      `UPDATE users
       SET balance = balance - ($1 * 100)
       WHERE id = $2`,
      [amount, id]
    );

    const withdrawal = await client.query(
      `INSERT INTO withdrawals
       (
         user_id,
         method,
         account_holder_name,
         account_number,
         ifsc,
         upi_id,
         amount,
         status
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')
       RETURNING *`,
      [
        id,
        method,
        method === "bank" ? accountHolderName : null,
        method === "bank" ? accountNumber : null,
        method === "bank" ? ifsc : null,
        method === "upi" ? upiId : null,
        amount
      ]
    );
await client.query(`
  INSERT INTO activities
  (user_id, type, amount, description, status)
  VALUES ($1, 'withdrawal', $2, $3, 'pending')
`, [
  id,
  Math.round(amount * 100),
  `Withdrawal ₹${amount.toFixed(2)} requested`
]);
    await client.query("COMMIT");
  await masterSend(
  process.env.MASTER_ADMIN_ID,
  `🚨 New Withdrawal Request\n\n` +
  `🆔 ID: ${withdrawal.rows[0].id}\n` +
  `👤 User: ${id}\n` +
  `💰 Amount: ₹${amount}\n` +
  `💳 Method: ${method.toUpperCase()}\n` +
  `${method === "upi"
    ? `📱 UPI: ${upiId}`
    : `🏦 Account: ${accountNumber}\n🏦 IFSC: ${ifsc}\n👤 Holder: ${accountHolderName}`}\n` +
  `⏳ Status: Pending`,
  {
  inline_keyboard: [
    [
      { text: "✅ Approve", callback_data: `approve_${withdrawal.rows[0].id}` },
      { text: "❌ Reject", callback_data: `reject_${withdrawal.rows[0].id}` }
        ]
  ]
}
);

    res.json({
      ok: true,
      status: "pending",
      message: "Withdrawal request submitted successfully",
      withdrawalId: withdrawal.rows[0].id,
      balance: user.balance - (amount * 100)
    });

  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);

    res.status(500).json({
      error: "Withdrawal request failed"
    });
  } finally {
    client.release();
  }
});

app.get("/api/wallet/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const user = await getUser(id);

    const earned = await pool.query(
      `SELECT COALESCE(SUM(amount),0)::int AS total
       FROM activities
       WHERE user_id = $1 AND type != 'withdrawal' AND amount > 0`,
      [id]
    );

    const withdrawn = await pool.query(
      `SELECT COALESCE(SUM(amount),0)::numeric AS total
       FROM withdrawals
       WHERE user_id = $1 AND status = 'approved'`,
      [id]
    );

    res.json({
      balance: user.balance,
      totalEarned: earned.rows[0].total,
      totalWithdrawn: Math.round(Number(withdrawn.rows[0].total) * 100)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/leaderboard", async (req,res) => {
  const result = await pool.query(
    "SELECT id, username, balance FROM users ORDER BY balance DESC LIMIT 10"
  );
  res.json(result.rows);
});

// Prizes on the spin wheel (weight = relative chance; higher weight = more common)
const SPIN_PRIZES = [
  { amount: 20,  weight: 30 },
  { amount: 50,  weight: 25 },
  { amount: 100, weight: 20 },
  { amount: 150, weight: 12 },
  { amount: 200, weight: 7 },
  { amount: 500, weight: 4 },
  { amount: 1000, weight: 2 }
];

function pickSpinPrize() {
  const totalWeight = SPIN_PRIZES.reduce((s, p) => s + p.weight, 0);
  let r = Math.random() * totalWeight;
  for (const p of SPIN_PRIZES) {
    if (r < p.weight) return p.amount;
    r -= p.weight;
  }
  return SPIN_PRIZES[0].amount;
}

app.get("/api/spin/status/:id", async (req, res) => {
  const id = String(req.params.id);
  await getUser(id);
  const u = await pool.query("SELECT last_spin_date FROM users WHERE id = $1", [id]);
  const today = new Date().toISOString().slice(0, 10);
  const lastSpin = u.rows[0]?.last_spin_date
    ? new Date(u.rows[0].last_spin_date).toISOString().slice(0, 10)
    : null;
  res.json({ canSpin: lastSpin !== today });
});

app.post("/api/spin", async (req, res) => {
  const client = await pool.connect();
  try {
    const id = String(req.body.id || "");
    if (!id) { client.release(); return res.status(400).json({ error: "Missing user id" }); }

    await getUser(id);
    const today = new Date().toISOString().slice(0, 10);

    await client.query("BEGIN");

    const userRow = await client.query(
      "SELECT last_spin_date FROM users WHERE id = $1 FOR UPDATE",
      [id]
    );

    const lastSpin = userRow.rows[0]?.last_spin_date
      ? new Date(userRow.rows[0].last_spin_date).toISOString().slice(0, 10)
      : null;

    if (lastSpin === today) {
      await client.query("ROLLBACK");
      client.release();
      return res.status(409).json({ error: "You already spun today. Come back tomorrow!" });
    }

    const reward = pickSpinPrize();

    const updated = await client.query(
      `UPDATE users
       SET last_spin_date = $1,
           balance = balance + $2
       WHERE id = $3
       RETURNING *`,
      [today, reward, id]
    );

    await client.query(
      `INSERT INTO activities
       (user_id, type, amount, description, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, "spin", reward, "Spin & Earn reward", "completed"]
    );

    await client.query("COMMIT");

    res.json({ ok: true, reward, balance: updated.rows[0].balance });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});
app.get("/api/admin/stats", async (req, res) => {
  if (req.headers["x-admin-key"] !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const users = await pool.query(`
      SELECT
        COUNT(*)::int AS total_users,
        COALESCE(SUM(balance), 0)::int AS total_coins
      FROM users
    `);

    const withdrawals = await pool.query(`
      SELECT
        COUNT(*)::int AS total_withdrawals,
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_withdrawals,
        COALESCE(SUM(amount), 0)::numeric AS total_withdrawal_amount
      FROM withdrawals
    `);

    res.json({
      total_users: users.rows[0].total_users,
      total_coins: users.rows[0].total_coins,
      total_withdrawals: withdrawals.rows[0].total_withdrawals,
      pending_withdrawals: withdrawals.rows[0].pending_withdrawals,
      total_withdrawal_amount: withdrawals.rows[0].total_withdrawal_amount
    });
  } catch (e) {
    console.error("ADMIN STATS ERROR:", e);
    res.status(500).json({ error: "Failed to load admin stats" });
  }
});
app.get("/", (req, res) => {
  res.sendFile("frontend/index.html", { root: process.cwd() });
});
// ================= MASTER ADMIN BOT =================

const MASTER_BOT_TOKEN = process.env.MASTER_BOT_TOKEN;
const MASTER_ADMIN_ID = String(process.env.MASTER_ADMIN_ID || "");

let masterBotOffset = 0;

async function masterTelegram(method, body = {}) {
  const response = await fetch(
    `https://api.telegram.org/bot${MASTER_BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }
  );

  return response.json();
}

async function masterSend(chatId, text, replyMarkup = null) {
  const body = {
    chat_id: chatId,
    text: text
  };

  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }

  return masterTelegram("sendMessage", body);
}

async function handleMasterMessage(message) {
  if (!message || !message.text) return;

  const chatId = String(message.chat.id);
  const text = message.text.trim();

  console.log("MASTER BOT CHAT ID:", chatId);
  if (chatId !== MASTER_ADMIN_ID) {
    await masterSend(chatId, "⛔ Unauthorized access.");
    return;
  }

  if (text === "/start") {
    await masterSend(
      chatId,
      "🔐 CoinHammer Master Admin Bot\n\n" +
"Welcome Admin!\n\n" +
"Available commands:\n" +
"/stats - View bot statistics\n" +
"/users - View users\n" +
"/withdrawals - View pending withdrawals\n" +
"/tasks - View all tasks\n" +
"/addtask - Add a new task\n" +
"/edittask - Edit an existing task\n" +
"/deletetask - Delete a task"
    );
    return;
  }

  if (text === "/stats") {
    try {
      const users = await pool.query(`
        SELECT
          COUNT(*)::int AS total_users,
          COALESCE(SUM(balance), 0)::int AS total_coins
        FROM users
      `);

      const withdrawals = await pool.query(`
        SELECT
          COUNT(*)::int AS total_withdrawals,
          COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_withdrawals,
          COALESCE(SUM(amount), 0)::numeric AS total_withdrawal_amount
        FROM withdrawals
      `);

      const u = users.rows[0];
      const w = withdrawals.rows[0];

      await masterSend(
  chatId,
  "📊 CoinHammer Statistics\n\n" +
  `👥 Total Users: ${u.total_users}\n` +
  `🪙 Total Coins: ${u.total_coins}\n` +
  `💸 Total Withdrawals: ${w.total_withdrawals}\n` +
  `⏳ Pending Withdrawals: ${w.pending_withdrawals}\n` +
  `💰 Withdrawal Amount: ₹${w.total_withdrawal_amount}`
);
    } catch (error) {
      console.error("MASTER BOT STATS ERROR:", error);
      await masterSend(chatId, "❌ Failed to load statistics.");
    }
    return;
  }
  if (text === "/users") {
  try {
    const result = await pool.query(`
      SELECT id, username, balance,
tasks_completed, last_daily
      FROM users
      ORDER BY id DESC
      LIMIT 20
    `);

    if (!result.rows.length) {
      await masterSend(chatId, "👥 No users found.");
      return;
    }

    let msg = "👥 CoinHammer Users\n\n";

    for (const u of result.rows) {
      msg +=
        `🆔 ${u.id}\n` +
        `👤 ${u.username || "No username"}\n` +
        `🪙 ${u.balance} coins\n` +
        `✅ Tasks: ${u.tasks_completed}\n` +
`📅 Daily: ${u.last_daily ? new Date(u.last_daily).toLocaleDateString("en-IN", {day:"2-digit", month:"short", year:"numeric"}) : "Not claimed"}\n\n`;
    }

    await masterSend(chatId, msg);
  } catch (error) {
    console.error("MASTER BOT USERS ERROR:", error);
    await masterSend(chatId, "❌ Failed to load users.");
  }

  return;
  }
  if (text === "/tasks") {
  try {
    const result = await pool.query(`
      SELECT id, title, description, reward, category, icon, active
      FROM tasks
      ORDER BY created_at ASC
    `);

    if (!result.rows.length) {
      await masterSend(chatId, "📋 No tasks found.");
      return;
    }

    let msg = "📋 CoinHammer Tasks\n\n";

    for (const t of result.rows) {
      msg +=
        `${t.active ? "🟢" : "🔴"} ${t.icon || "🎯"} ${t.title}\n` +
        `🆔 ID: ${t.id}\n` +
        `💰 Reward: ${t.reward} coins\n` +
        `📂 Category: ${t.category}\n` +
        `📝 ${t.description || "No description"}\n\n`;
    }

    await masterSend(chatId, msg);
  } catch (error) {
    console.error("MASTER BOT TASKS ERROR:", error);
    await masterSend(chatId, "❌ Failed to load tasks.");
  }

  return;
  }
  if (text.startsWith("/addtask")) {
  try {
    const raw = text.slice("/addtask".length).trim();

    if (!raw) {
      await masterSend(
        chatId,
        "❌ Format:\n\n" +
        "/addtask ID | Title | Description | MaxReward | Category | Icon | Link\n\n" +
        "Example:\n" +
        "/addtask insta1 | Follow Instagram | Follow our Instagram page | 100 | social | 📷 | https://instagram.com/yourpage"
      );
      return;
    }

    const parts = raw.split("|").map(v => v.trim());

    if (parts.length !== 7) {
      await masterSend(
        chatId,
        "❌ Invalid format.\n\n" +
        "Use exactly 7 fields:\n\n" +
        "ID | Title | Description | MaxReward | Category | Icon | Link"
      );
      return;
    }

    const [id, title, description, reward, category, icon, link] = parts;

    const maxReward = Number(reward);

    if (!id || !title || !description || !Number.isInteger(maxReward) || maxReward <= 0 || !link) {
      await masterSend(
        chatId,
        "❌ Invalid task details.\n\n" +
        "ID, Title, Description, MaxReward and Link are required."
      );
      return;
    }

    const existing = await pool.query(
      "SELECT id FROM tasks WHERE id = $1",
      [id]
    );

    if (existing.rows.length) {
      await masterSend(
        chatId,
        `❌ Task ID "${id}" already exists.\n\nUse /edittask to change it.`
      );
      return;
    }

    await pool.query(
      `INSERT INTO tasks
       (id, title, description, reward, category, icon, link, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)`,
      [id, title, description, maxReward, category || "social", icon || "🎯", link]
    );

    await masterSend(
      chatId,
      "✅ Task added successfully!\n\n" +
      `🆔 ID: ${id}\n` +
      `📌 ${title}\n` +
      `📝 ${description}\n` +
      `💰 Max Reward: ${maxReward} coins\n` +
      `📂 Category: ${category || "social"}\n` +
      `🔗 ${link}`
    );

  } catch (error) {
    console.error("MASTER BOT ADD TASK ERROR:", error);
    await masterSend(chatId, "❌ Failed to add task.");
  }

  return;
  }
if (text === "/withdrawals") {
  try {
    const result = await pool.query(`
      SELECT id, user_id, method, account_holder_name,
             account_number, ifsc, upi_id, amount,
             status, created_at
      FROM withdrawals
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT 10
    `);

    if (!result.rows.length) {
      await masterSend(chatId, "✅ No pending withdrawals.");
      return;
    }

    for (const w of result.rows) {
  const msg =
    `💸 Pending Withdrawal\n\n` +
    `🆔 ID: ${w.id}\n` +
    `👤 User: ${w.user_id}\n` +
    `💰 Amount: ₹${w.amount}\n` +
    `🏦 Method: ${w.method}\n` +
    (w.upi_id ? `📱 UPI: ${w.upi_id}\n` : "") +
    (w.account_number ? `🏦 Account: ${w.account_number}\n` : "") +
    (w.ifsc ? `🔑 IFSC: ${w.ifsc}\n` : "") +
    `📅 ${w.created_at}`;

  await masterSend(chatId, msg, {
    inline_keyboard: [
      [
        {
          text: "✅ Approve",
          callback_data: `approve_${w.id}`
        },
        {
          text: "❌ Reject",
          callback_data: `reject_${w.id}`
        }
      ]
    ]
  });
}
  } catch (error) {
    console.error("MASTER BOT WITHDRAWALS ERROR:", error);
    await masterSend(chatId, "❌ Failed to load withdrawals.");
  }

  return;
}
      if (text.startsWith("/approve ")) {
      const withdrawalId = text.split(" ")[1];

      try {
        const result = await pool.query(`
          UPDATE withdrawals
          SET status = 'approved',
              admin_note = 'Approved by admin',
              processed_at = CURRENT_TIMESTAMP
          WHERE id = $1
            AND status = 'pending'
          RETURNING id, user_id, amount, method
        `, [withdrawalId]);

        if (!result.rows.length) {
          await masterSend(
            chatId,
            "❌ Withdrawal not found or already processed."
          );
          return;
        }

        const w = result.rows[0];

        await pool.query(`
  UPDATE activities
  SET amount = -$3,
      description = $1,
      status = 'approved'
  WHERE id = (
    SELECT id
    FROM activities
    WHERE user_id = $2
      AND type = 'withdrawal'
      AND status = 'pending'
      AND amount = $3
    ORDER BY created_at DESC
    LIMIT 1
  )
`, [
  `Withdrawal ₹${w.amount} approved`,
  w.user_id,
  Math.round(Number(w.amount) * 100)
]);

        await masterSend(
          chatId,
          `✅ Withdrawal Approved\n\n` +
          `🆔 ID: ${w.id}\n` +
          `👤 User: ${w.user_id}\n` +
          `💰 Amount: ₹${w.amount}`
        );
        await masterSend(
          "@CoinHammerPayments",
          `🎉 Withdrawal Approved\n\n` +
          `🆔 Withdrawal ID: ${w.id}\n` +
          `👤 User: ${w.user_id}\n` +
          `💰 Amount: ₹${w.amount}\n` +
          `💳 Method: ${w.method || "Withdrawal"}\n` +
          `✅ Status: Approved`
        );
      } catch (error) {
        console.error("APPROVE WITHDRAWAL ERROR:", error);
        await masterSend(chatId, "❌ Failed to approve withdrawal.");
      }

      return;
    }

    if (text.startsWith("/reject ")) {
      const withdrawalId = text.split(" ")[1];
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        const result = await client.query(`
          UPDATE withdrawals
          SET status = 'rejected',
              admin_note = 'Rejected by admin',
              processed_at = CURRENT_TIMESTAMP
          WHERE id = $1
            AND status = 'pending'
          RETURNING id, user_id, amount
        `, [withdrawalId]);

        if (!result.rows.length) {
          await client.query("ROLLBACK");
          await masterSend(
            chatId,
            "❌ Withdrawal not found or already processed."
          );
          return;
        }

        const w = result.rows[0];
        const refundCoins = Math.round(Number(w.amount) * 100);

        await client.query(`
          UPDATE users
          SET balance = balance + $1
          WHERE id = $2
        `, [refundCoins, w.user_id]);

        await client.query(`
  UPDATE activities
  SET amount = $1,
      description = $2,
      status = 'rejected'
  WHERE id = (
    SELECT id
    FROM activities
    WHERE user_id = $3
      AND type = 'withdrawal'
      AND status = 'pending'
    ORDER BY created_at DESC
    LIMIT 1
  )
`, [
  refundCoins,
  `Withdrawal ₹${w.amount} rejected - coins refunded`,
  w.user_id
]);

        await client.query("COMMIT");

        await masterSend(
          chatId,
          `❌ Withdrawal Rejected\n\n` +
          `🆔 ID: ${w.id}\n` +
          `👤 User: ${w.user_id}\n` +
          `💰 Amount: ₹${w.amount}\n` +
          `🪙 Refunded: ${refundCoins} coins`
        );

      } catch (error) {
        await client.query("ROLLBACK");
        console.error("REJECT WITHDRAWAL ERROR:", error);
        await masterSend(chatId, "❌ Failed to reject withdrawal.");
      } finally {
        client.release();
      }

      return;
    }
  await masterSend(
    chatId,
    "❓ Unknown command.\\n\\nUse /stats"
  );
}

async function masterBotLoop() {
  if (!MASTER_BOT_TOKEN || !MASTER_ADMIN_ID) {
    console.log("Master Admin Bot variables are missing.");
    return;
  }

  try {
    const result = await masterTelegram("getUpdates", {
      offset: masterBotOffset,
      timeout: 20,
      allowed_updates: ["message", "callback_query"]
    });

    if (result.ok && result.result) {
      for (const update of result.result) {
        masterBotOffset = update.update_id + 1;

        if (update.message) {
          await handleMasterMessage(update.message);
        }
                if (update.callback_query) {
          const callback = update.callback_query;
          const callbackChatId = String(callback.message.chat.id);
          const data = callback.data || "";

          if (data.startsWith("approve_")) {
            const withdrawalId = data.split("_")[1];

            await handleMasterMessage({
              chat: { id: callbackChatId },
              text: `/approve ${withdrawalId}`
            });

            await masterTelegram("answerCallbackQuery", {
              callback_query_id: callback.id,
              text: "Withdrawal approved"
            });
          }

          if (data.startsWith("reject_")) {
            const withdrawalId = data.split("_")[1];

            await handleMasterMessage({
              chat: { id: callbackChatId },
              text: `/reject ${withdrawalId}`
            });

            await masterTelegram("answerCallbackQuery", {
              callback_query_id: callback.id,
              text: "Withdrawal rejected"
            });
          }
                }
      }
    }
  } catch (error) {
    console.error("MASTER BOT ERROR:", error.message);
  }

  setTimeout(masterBotLoop, 1000);
}

// ================= END MASTER ADMIN BOT =================
app.listen(process.env.PORT || 3000, () => {
  console.log(`CoinHammer backend running on port ${process.env.PORT || 3000}`);
});
masterBotLoop();
