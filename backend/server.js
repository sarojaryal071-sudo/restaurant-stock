require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { runMigrations } = require('./migration');
const { pool } = require('./database');
const { login, logout, requireAuth, requireAdmin, validateSession, getRestaurant } = require('./auth');
const inventory = require('./inventory');
const recipes = require('./recipes');
const allocations = require('./allocations');

const app = express();

// ---------------------------------------------------------------
// CORS – MUST be the first middleware
// ---------------------------------------------------------------
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5500',
  'http://localhost:5500'
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// ---------------------------------------------------------------
// Standard middleware
// ---------------------------------------------------------------
app.use(express.json());

// ---------------------------------------------------------------
// Health endpoint – public; with token returns branded session
// ---------------------------------------------------------------
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    const token = req.query.token;
    if (token) {
      const session = await validateSession(token);
      if (session) {
        const userRes = await pool.query(`SELECT id, name, role FROM users WHERE id = $1`, [session.userId]);
        const user = userRes.rows[0] || null;
        const restaurant = await getRestaurant(session.restaurantId);
        return res.json({
          ok: true,
          initialized: true,
          user: user ? { id: user.id, name: user.name, role: user.role } : null,
          restaurant
        });
      } else {
        return res.json({ ok: false, code: 'UNAUTHORIZED', error: 'Invalid or expired token.' });
      }
    }
    // No token – just basic health
    res.json({ ok: true, initialized: true });
  } catch (err) {
    res.status(500).json({ ok: false, initialized: false, error: 'Database unavailable' });
  }
});

// ---------------------------------------------------------------
// getConfig – returns restaurant name (global if no auth, or first restaurant)
// ---------------------------------------------------------------
app.get('/api/getConfig', async (req, res) => {
  try {
    const settingRes = await pool.query(`SELECT value FROM settings WHERE key = 'requireAuth'`);
    const requireAuthSetting = settingRes.rows.length > 0 ? settingRes.rows[0].value : 'false';
    if (requireAuthSetting !== 'true') {
      const restRes = await pool.query(`SELECT display_name, name FROM restaurants ORDER BY created_at LIMIT 1`);
      const name = restRes.rows.length > 0
        ? (restRes.rows[0].display_name || restRes.rows[0].name || 'Stock Counter')
        : 'Stock Counter';
      return res.json({ ok: true, restaurantName: name });
    }
    res.json({ ok: true, restaurantName: 'Stock Counter' });
  } catch (err) {
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
});

// ---------------------------------------------------------------
// Auth routes (no action parameter)
// ---------------------------------------------------------------
app.post('/api/login', login);
app.post('/api/logout', logout);

// ---------------------------------------------------------------
// Main API router – matches old frontend ?action=... or body.action
// ---------------------------------------------------------------
app.all('/api', async (req, res, next) => {
  try {
    const action = req.body.action || req.query.action || '';
    switch (action) {
      // Inventory
      case 'loadStock':
        await requireAuth(req, res, async () => inventory.loadStock(req, res));
        break;
      case 'saveStock':
        await requireAuth(req, res, async () => inventory.saveStock(req, res));
        break;
      case 'addCustomItem':
        await requireAuth(req, res, async () => inventory.addCustomItem(req, res));
        break;
      case 'updateItem':
        await requireAuth(req, res, async () => inventory.updateItem(req, res));
        break;
      case 'deleteItem':
        await requireAuth(req, res, async () => inventory.deleteItem(req, res));
        break;
      case 'restoreItem':
        await requireAuth(req, res, async () => inventory.restoreItem(req, res));
        break;
      case 'addCategory':
        await requireAuth(req, res, async () => inventory.addCategory(req, res));
        break;
      case 'updateCategory':
        await requireAuth(req, res, async () => inventory.updateCategory(req, res));
        break;
      case 'deleteCategory':
        await requireAuth(req, res, async () => inventory.deleteCategory(req, res));
        break;
      case 'restoreCategory':
        await requireAuth(req, res, async () => inventory.restoreCategory(req, res));
        break;

      // Recipes & POS
      case 'createRecipe':
        await requireAuth(req, res, async () => recipes.createRecipe(req, res));
        break;
      case 'updateRecipe':
        await requireAuth(req, res, async () => recipes.updateRecipe(req, res));
        break;
      case 'deleteRecipe':
        await requireAuth(req, res, async () => recipes.deleteRecipe(req, res));
        break;
      case 'getRecipe':
        await requireAuth(req, res, async () => recipes.getRecipe(req, res));
        break;
      case 'listRecipes':
        await requireAuth(req, res, async () => recipes.listRecipes(req, res));
        break;
      case 'recordSale':
        await requireAuth(req, res, async () => recipes.recordSale(req, res));
        break;

      // --- NEW: Pending Allocations (POS shortage resolution) ---
      case 'listPendingAllocations':
        await requireAuth(req, res, async () => allocations.listPendingAllocations(req, res));
        break;
      case 'getPendingAllocationDetails':
        await requireAuth(req, res, async () => allocations.getPendingAllocationDetails(req, res));
        break;
      case 'resolvePendingAllocation':
        await requireAuth(req, res, async () => allocations.resolvePendingAllocation(req, res));
        break;

      // Not yet implemented
      case 'getConfig':
      case 'resetStock':
      case 'initializeDatabase':
      case 'seedDatabase':
      case 'exportInventory':
        res.json({ ok: false, code: 'NOT_IMPLEMENTED', error: 'Endpoint will be added in a later phase.' });
        break;

      default:
        res.status(400).json({ ok: false, code: 'UNKNOWN_ACTION', error: `Unknown action: ${action}` });
    }
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await runMigrations();
    app.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();