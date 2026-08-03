require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { runMigrations } = require('./migration');
const { pool } = require('./database');
const { login, logout, requireAuth, validateSession, getRestaurant } = require('./auth');
const requirePermission = require('./src/middleware/requirePermission');
const inventory = require('./inventory');
const recipes = require('./recipes');
const allocations = require('./allocations');
const { simulateSale } = require('./src/pos/simulator');
const settingsController = require('./src/settings/settings.controller');

const app = express();

// ---------------------------------------------------------------
// CORS
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

app.use(express.json());

// ---------------------------------------------------------------
// Health endpoint
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
          user: user ? { id: user.id, name: user.name, role: user.role || 'staff' } : null,
          restaurant
        });
      } else {
        return res.json({ ok: false, code: 'UNAUTHORIZED', error: 'Invalid or expired token.' });
      }
    }
    res.json({ ok: true, initialized: true });
  } catch (err) {
    res.status(500).json({ ok: false, initialized: false, error: 'Database unavailable' });
  }
});

// ---------------------------------------------------------------
// getConfig
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
// Auth routes
// ---------------------------------------------------------------
app.post('/api/login', login);
app.post('/api/logout', logout);

// ---------------------------------------------------------------
// Main API router
// ---------------------------------------------------------------
app.all('/api', async (req, res, next) => {
  try {
    const action = req.body.action || req.query.action || '';
    switch (action) {
      // ---------- Inventory (staff accessible) ----------
      case 'loadStock':
        requireAuth(req, res, () => inventory.loadStock(req, res));
        break;
      case 'saveStock':
        requireAuth(req, res, () => {
          requirePermission('inventory', 'save')(req, res, () => inventory.saveStock(req, res));
        });
        break;

      // ---------- Inventory management (manager only) ----------
      case 'addCustomItem':
        requireAuth(req, res, () => {
          requirePermission('inventory', 'add')(req, res, () => inventory.addCustomItem(req, res));
        });
        break;
      case 'updateItem':
        requireAuth(req, res, () => {
          requirePermission('inventory', 'edit')(req, res, () => inventory.updateItem(req, res));
        });
        break;
      case 'deleteItem':
        requireAuth(req, res, () => {
          requirePermission('inventory', 'delete')(req, res, () => inventory.deleteItem(req, res));
        });
        break;
      case 'restoreItem':
        requireAuth(req, res, () => {
          requirePermission('inventory', 'edit')(req, res, () => inventory.restoreItem(req, res));
        });
        break;

      // ---------- Category management (manager only) ----------
      case 'addCategory':
        requireAuth(req, res, () => {
          requirePermission('categories', 'add')(req, res, () => inventory.addCategory(req, res));
        });
        break;
      case 'updateCategory':
        requireAuth(req, res, () => {
          requirePermission('categories', 'edit')(req, res, () => inventory.updateCategory(req, res));
        });
        break;
      case 'deleteCategory':
        requireAuth(req, res, () => {
          requirePermission('categories', 'delete')(req, res, () => inventory.deleteCategory(req, res));
        });
        break;
      case 'restoreCategory':
        requireAuth(req, res, () => {
          requirePermission('categories', 'edit')(req, res, () => inventory.restoreCategory(req, res));
        });
        break;

      // ---------- Recipes ----------
      case 'listRecipes':
        requireAuth(req, res, () => recipes.listRecipes(req, res));
        break;
      case 'getRecipe':
        requireAuth(req, res, () => recipes.getRecipe(req, res));
        break;
      case 'createRecipe':
        requireAuth(req, res, () => {
          requirePermission('recipes', 'create')(req, res, () => recipes.createRecipe(req, res));
        });
        break;
      case 'updateRecipe':
        requireAuth(req, res, () => {
          requirePermission('recipes', 'edit')(req, res, () => recipes.updateRecipe(req, res));
        });
        break;
      case 'deleteRecipe':
        requireAuth(req, res, () => {
          requirePermission('recipes', 'delete')(req, res, () => recipes.deleteRecipe(req, res));
        });
        break;
      case 'recordSale':
        requireAuth(req, res, () => {
          requirePermission('pos', 'sale')(req, res, () => recipes.recordSale(req, res));
        });
        break;

      // ---------- Allocations (staff accessible) ----------
      case 'listPendingAllocations':
        requireAuth(req, res, () => allocations.listPendingAllocations(req, res));
        break;
      case 'getPendingAllocationDetails':
        requireAuth(req, res, () => allocations.getPendingAllocationDetails(req, res));
        break;
      case 'resolvePendingAllocation':
        requireAuth(req, res, () => allocations.resolvePendingAllocation(req, res));
        break;

      // ---------- Admin only (use requirePermission) ----------
      case 'resetStock':
      case 'initializeDatabase':
      case 'seedDatabase':
        requireAuth(req, res, () => {
          requirePermission('settings', 'manage')(req, res, () => {
            res.json({ ok: false, code: 'NOT_IMPLEMENTED', error: 'Endpoint will be added in a later phase.' });
          });
        });
        break;

      case 'getConfig':
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
// POS test endpoint
// ---------------------------------------------------------------
app.post('/api/pos/testSale', (req, res, next) => {
  requireAuth(req, res, () => {
    const { productId, productName, quantity } = req.body;
    if (!productId || !quantity) {
      return res.json({ ok: false, code: 'VALIDATION_ERROR', error: 'productId and quantity are required' });
    }
    simulateSale(productId, productName, quantity, new Date().toISOString(), req, res);
  });
});

const settingsController = require('./src/settings/settings.controller');

// ---------- Settings (manager only) ----------
app.get('/api/settings', (req, res, next) => {
  requireAuth(req, res, () => {
    requirePermission('settings', 'manage')(req, res, () => settingsController.getAll(req, res));
  });
});

app.patch('/api/settings/:section', (req, res, next) => {
  requireAuth(req, res, () => {
    requirePermission('settings', 'manage')(req, res, () => settingsController.patchSection(req, res));
  });
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
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();