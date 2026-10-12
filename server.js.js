const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Allow requests from your live Vercel frontend and local testing
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE']
}));

app.use(express.json());

// Initialize SQLite Database
const db = new Database(path.join(__dirname, 'liquidation.db'));

// Initialize Database Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS fund_downloads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id TEXT NOT NULL,
    month_of_liquidation TEXT NOT NULL,
    liquidation_type TEXT DEFAULT 'Regular MOOE',
    tracking_number TEXT,
    ada_check_number TEXT,
    date_downloaded TEXT,
    amount_downloaded REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS procurement_encodings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fund_download_id INTEGER NOT NULL,
    school_id TEXT NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    supplier_name TEXT NOT NULL,
    account_used TEXT DEFAULT 'MOOE',
    date_of_receipt TEXT,
    pr_date TEXT,
    check_number TEXT,
    check_amount REAL DEFAULT 0,
    cash_amount REAL DEFAULT 0,
    status TEXT DEFAULT 'active',
    cancellation_reason TEXT,
    FOREIGN KEY (fund_download_id) REFERENCES fund_downloads(id)
  );
`);

// 1. Get all fund downloads with computed expenditure & remaining balance
app.get('/api/funds', (req, res) => {
  try {
    const funds = db.prepare(`
      SELECT f.*, 
        COALESCE(SUM(CASE WHEN p.status = 'active' THEN (p.check_amount + p.cash_amount) ELSE 0 END), 0) AS total_spent,
        (f.amount_downloaded - COALESCE(SUM(CASE WHEN p.status = 'active' THEN (p.check_amount + p.cash_amount) ELSE 0 END), 0)) AS remaining_balance
      FROM fund_downloads f
      LEFT JOIN procurement_encodings p ON f.id = p.fund_download_id
      GROUP BY f.id
      ORDER BY f.id DESC
    `).all();
    res.json(funds);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Get single fund download details and its encodings
app.get('/api/funds/:id', (req, res) => {
  try {
    const fund = db.prepare('SELECT * FROM fund_downloads WHERE id = ?').get(req.params.id);
    if (!fund) return res.status(404).json({ error: 'Fund download record not found' });

    const encodings = db.prepare('SELECT * FROM procurement_encodings WHERE fund_download_id = ? ORDER BY id DESC').all(req.params.id);
    
    const totals = db.prepare(`
      SELECT COALESCE(SUM(check_amount + cash_amount), 0) as total_spent
      FROM procurement_encodings
      WHERE fund_download_id = ? AND status = 'active'
    `).get(req.params.id);

    const summary = {
      ...fund,
      total_spent: totals.total_spent,
      remaining_balance: fund.amount_downloaded - totals.total_spent
    };

    res.json({ summary, encodings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Register a new Fund Download
app.post('/api/funds', (req, res) => {
  try {
    const { school_id, month_of_liquidation, liquidation_type, tracking_number, ada_check_number, date_downloaded, amount_downloaded } = req.body;
    const stmt = db.prepare(`
      INSERT INTO fund_downloads (school_id, month_of_liquidation, liquidation_type, tracking_number, ada_check_number, date_downloaded, amount_downloaded)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(school_id, month_of_liquidation, liquidation_type || 'Regular MOOE', tracking_number, ada_check_number, date_downloaded, amount_downloaded);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Encode a new Procurement Item
app.post('/api/procurement', (req, res) => {
  try {
    const { fund_download_id, school_id, year, month, supplier_name, account_used, date_of_receipt, pr_date, check_number, check_amount, cash_amount } = req.body;
    const stmt = db.prepare(`
      INSERT INTO procurement_encodings (fund_download_id, school_id, year, month, supplier_name, account_used, date_of_receipt, pr_date, check_number, check_amount, cash_amount, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `);
    const result = stmt.run(fund_download_id, school_id, year, month, supplier_name, account_used, date_of_receipt, pr_date, check_number, check_amount || 0, cash_amount || 0);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Edit an existing Procurement Item
app.patch('/api/procurement/:id', (req, res) => {
  try {
    const { supplier_name, account_used, date_of_receipt, pr_date } = req.body;
    const stmt = db.prepare(`
      UPDATE procurement_encodings 
      SET supplier_name = ?, account_used = ?, date_of_receipt = ?, pr_date = ?
      WHERE id = ?
    `);
    stmt.run(supplier_name, account_used, date_of_receipt, pr_date, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Void a Procurement Item
app.patch('/api/procurement/:id/void', (req, res) => {
  try {
    const { cancellation_reason } = req.body;
    const stmt = db.prepare(`
      UPDATE procurement_encodings 
      SET status = 'cancelled', cancellation_reason = ?
      WHERE id = ?
    `);
    stmt.run(cancellation_reason || 'Cancelled by user', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`DepEd Backend listening on port ${PORT}`));