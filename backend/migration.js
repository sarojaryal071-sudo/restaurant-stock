const { query, transaction } = require('./database');

async function runMigrations() {
  console.log('Running database migrations...');

  await transaction(async (tx) => {
    // --- Restaurants ---
    await tx(`
      CREATE TABLE IF NOT EXISTS restaurants (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        display_name TEXT,
        logo_url TEXT,
        theme_color TEXT,
        address TEXT,
        phone TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    

    // --- Users ---
    await tx(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT,
        role TEXT NOT NULL DEFAULT 'staff',
        restaurant_id UUID REFERENCES restaurants(id),
        password_hash TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await tx(`CREATE INDEX IF NOT EXISTS idx_users_password_hash ON users(password_hash);`);

    // --- Sessions ---
    await tx(`
      CREATE TABLE IF NOT EXISTS sessions (
        id UUID PRIMARY KEY,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        restaurant_id UUID REFERENCES restaurants(id),
        token TEXT UNIQUE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      );
    `);
    await tx(`CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);`);

    // --- Categories ---
    await tx(`
      CREATE TABLE IF NOT EXISTS categories (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        restaurant_id UUID REFERENCES restaurants(id),
        sort_order INTEGER DEFAULT 0,
        is_deleted BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await tx(`CREATE INDEX IF NOT EXISTS idx_categories_restaurant ON categories(restaurant_id, sort_order);`);

    // --- Items ---
    await tx(`
      CREATE TABLE IF NOT EXISTS items (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        category_id UUID REFERENCES categories(id),
        unit TEXT,
        default_quantity DECIMAL(10,2) DEFAULT 0,
        restaurant_id UUID REFERENCES restaurants(id),
        is_default BOOLEAN DEFAULT TRUE,
        is_deleted BOOLEAN DEFAULT FALSE,
        container_volume INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await tx(`CREATE INDEX IF NOT EXISTS idx_items_category_restaurant ON items(category_id, restaurant_id);`);

    // --- Stocks ---
    await tx(`
      CREATE TABLE IF NOT EXISTS stocks (
        id UUID PRIMARY KEY,
        item_id UUID REFERENCES items(id) ON DELETE CASCADE,
        restaurant_id UUID REFERENCES restaurants(id),
        quantity DECIMAL(10,2) DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await tx(`CREATE INDEX IF NOT EXISTS idx_stocks_item_restaurant ON stocks(item_id, restaurant_id);`);

    // --- Recipes ---
    await tx(`
      CREATE TABLE IF NOT EXISTS recipes (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        glass TEXT,
        method TEXT,
        garnish TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    // Add restaurant_id if missing (migration for existing databases)
    await tx(`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS restaurant_id UUID REFERENCES restaurants(id);`);
    await tx(`CREATE INDEX IF NOT EXISTS idx_recipes_restaurant ON recipes(restaurant_id);`);

    // --- Recipe Ingredients ---
    await tx(`
      CREATE TABLE IF NOT EXISTS recipe_ingredients (
        id UUID PRIMARY KEY,
        recipe_id UUID REFERENCES recipes(id) ON DELETE CASCADE,
        inventory_item_id UUID REFERENCES items(id),
        ingredient_name TEXT,
        amount DECIMAL(10,2),
        unit TEXT
      );
    `);
    await tx(`CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe ON recipe_ingredients(recipe_id);`);

    // --- Logs ---
    await tx(`
      CREATE TABLE IF NOT EXISTS logs (
        id UUID PRIMARY KEY,
        action TEXT,
        details TEXT,
        user_id UUID REFERENCES users(id),
        restaurant_id UUID REFERENCES restaurants(id),
        timestamp TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await tx(`CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);`);

    // --- Settings ---
    await tx(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    // Insert default settings if missing
    await tx(
      `INSERT INTO settings (key, value)
       VALUES ($1, $2)
       ON CONFLICT (key) DO NOTHING`,
      ['requireAuth', 'false']
    );

    // -----------------------------------------------------------------
    // FIX: allow recipe_ingredients.inventory_item_id to be set to NULL
    // -----------------------------------------------------------------
    const constraintCheck = await tx(`
      SELECT confdeltype
      FROM pg_constraint
      WHERE conname = 'recipe_ingredients_inventory_item_id_fkey'
    `);
    if (constraintCheck.rows.length > 0 && constraintCheck.rows[0].confdeltype !== 'n') {
      await tx(`ALTER TABLE recipe_ingredients DROP CONSTRAINT recipe_ingredients_inventory_item_id_fkey`);
      await tx(`ALTER TABLE recipe_ingredients ADD CONSTRAINT recipe_ingredients_inventory_item_id_fkey
                FOREIGN KEY (inventory_item_id) REFERENCES items(id) ON DELETE SET NULL`);
    }

    // =================================================================
    // NEW TABLES for POS shortage resolution
    // =================================================================
    await tx(`
      CREATE TABLE IF NOT EXISTS pending_allocations (
        id UUID PRIMARY KEY,
        restaurant_id UUID REFERENCES restaurants(id),
        recipe_id UUID REFERENCES recipes(id),
        recipe_name TEXT,
        inventory_category_id UUID REFERENCES categories(id),
        inventory_category_name TEXT,
        required_quantity DECIMAL(10,2),
        unit TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        resolved BOOLEAN DEFAULT FALSE,
        resolved_at TIMESTAMPTZ,
        resolved_by UUID REFERENCES users(id)
      );
    `);
    await tx(`CREATE INDEX IF NOT EXISTS idx_pending_allocations_restaurant ON pending_allocations(restaurant_id, resolved);`);

    await tx(`
      CREATE TABLE IF NOT EXISTS pending_allocation_details (
        id UUID PRIMARY KEY,
        pending_allocation_id UUID REFERENCES pending_allocations(id) ON DELETE CASCADE,
        recipe_id UUID REFERENCES recipes(id),
        recipe_name TEXT,
        inventory_item_id UUID REFERENCES items(id),
        inventory_item_name TEXT,
        quantity DECIMAL(10,2),
        unit TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await tx(`CREATE INDEX IF NOT EXISTS idx_pending_alloc_details_parent ON pending_allocation_details(pending_allocation_id);`);

    await tx(`
      CREATE TABLE IF NOT EXISTS allocation_logs (
        id UUID PRIMARY KEY,
        pending_allocation_id UUID REFERENCES pending_allocations(id) ON DELETE CASCADE,
        old_inventory_item_id UUID REFERENCES items(id),
        new_inventory_item_id UUID REFERENCES items(id),
        quantity DECIMAL(10,2),
        resolved_by UUID REFERENCES users(id),
        resolved_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await tx(`CREATE INDEX IF NOT EXISTS idx_allocation_logs_parent ON allocation_logs(pending_allocation_id);`);

    // -----------------------------------------------------------------
    // RBAC: upgrade existing admin roles to manager, ensure default is 'staff'
    // -----------------------------------------------------------------
    await tx(`ALTER TABLE users ALTER COLUMN role SET DEFAULT 'staff'`);
    await tx(`UPDATE users SET role = 'manager' WHERE role = 'admin'`);

    // -----------------------------------------------------------------
    // Staff Management: is_active column
    // -----------------------------------------------------------------
    await tx(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`);

    // Remove old global PIN uniqueness constraint if present
    await tx(`ALTER TABLE users DROP CONSTRAINT IF EXISTS unique_user_pin`);

    // Add username column (unique, indexed)
    await tx(`ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT`);
    await tx(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`);

    // Add restaurant_code column (unique)
    await tx(`ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS restaurant_code TEXT`);
    await tx(`CREATE INDEX IF NOT EXISTS idx_restaurants_code ON restaurants(restaurant_code)`);

    // Generate restaurant_code for existing restaurants – ensure uniqueness
    const restRows = await tx(`SELECT id, name FROM restaurants WHERE restaurant_code IS NULL`);
    for (const row of restRows.rows) {
      const base = row.name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30) || 'restaurant';
      let code = base;
      let counter = 1;
      while (true) {
        const exists = await tx(`SELECT id FROM restaurants WHERE restaurant_code = $1 AND id <> $2`, [code, row.id]);
        if (exists.rows.length === 0) break;
        code = base + counter;
        counter++;
      }
      await tx(`UPDATE restaurants SET restaurant_code = $1 WHERE id = $2`, [code, row.id]);
    }

    // Now all codes are unique – safe to add the constraint
    const restCodeCon = await tx(`
      SELECT 1 FROM pg_constraint
      WHERE conname = 'unique_restaurant_code' AND conrelid = 'restaurants'::regclass
    `);
    if (restCodeCon.rows.length === 0) {
      await tx(`ALTER TABLE restaurants ADD CONSTRAINT unique_restaurant_code UNIQUE (restaurant_code)`);
    }

    // Generate username for existing users
    const userRows = await tx(`
      SELECT u.id, u.name, r.restaurant_code
      FROM users u
      JOIN restaurants r ON u.restaurant_id = r.id
      WHERE u.username IS NULL
    `);
    for (const user of userRows.rows) {
      const base = user.name.toLowerCase().replace(/[^a-z0-9]/g, '') + '@' + user.restaurant_code;
      let username = base;
      let counter = 1;
      while (true) {
        const exists = await tx(`SELECT id FROM users WHERE username = $1 AND id <> $2`, [username, user.id]);
        if (exists.rows.length === 0) break;
        username = base.replace('@', counter + '@');
        counter++;
      }
      await tx(`UPDATE users SET username = $1 WHERE id = $2`, [username, user.id]);
    }

    // Make username NOT NULL and add unique constraint (safe check)
    await tx(`ALTER TABLE users ALTER COLUMN username SET NOT NULL`);

    const usernameCon = await tx(`
      SELECT 1 FROM pg_constraint
      WHERE conname = 'unique_username' AND conrelid = 'users'::regclass
    `);
    if (usernameCon.rows.length === 0) {
      await tx(`ALTER TABLE users ADD CONSTRAINT unique_username UNIQUE (username)`);
    }
    
    // --- Restaurant Settings ---
    await tx(`
      CREATE TABLE IF NOT EXISTS restaurant_settings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        restaurant_id UUID REFERENCES restaurants(id),
        key TEXT NOT NULL,
        value JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (restaurant_id, key)
      );
    `);
    await tx(`CREATE INDEX IF NOT EXISTS idx_restaurant_settings_restaurant ON restaurant_settings(restaurant_id);`);

    // =================================================================
    // POS Integration table (simplified schema)
    // =================================================================
    await tx(`
      CREATE TABLE IF NOT EXISTS pos_integrations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
        provider TEXT DEFAULT 'None',
        status TEXT DEFAULT 'Disconnected',
        last_sync TIMESTAMPTZ,
        configuration JSONB DEFAULT '{}',
        statistics JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(restaurant_id)
      );
    `);
    await tx(`CREATE INDEX IF NOT EXISTS idx_pos_integrations_restaurant ON pos_integrations(restaurant_id);`);

    // Migrate old columns if they still exist
    const posCols = await tx(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'pos_integrations'
        AND column_name IN ('provider_id','provider_name','connection_status','connect_status')
    `);
    if (posCols.rows.length > 0) {
      await tx(`ALTER TABLE pos_integrations ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'None'`);
      await tx(`ALTER TABLE pos_integrations ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Disconnected'`);
      await tx(`UPDATE pos_integrations SET provider = COALESCE(provider_name, provider_id, 'None')`);
      await tx(`UPDATE pos_integrations SET status = COALESCE(connection_status, 'Disconnected')`);
      await tx(`ALTER TABLE pos_integrations DROP COLUMN IF EXISTS provider_id`);
      await tx(`ALTER TABLE pos_integrations DROP COLUMN IF EXISTS provider_name`);
      await tx(`ALTER TABLE pos_integrations DROP COLUMN IF EXISTS connection_status`);
      await tx(`ALTER TABLE pos_integrations DROP COLUMN IF EXISTS connect_status`);
    }

    // Seed default POS integration for every restaurant
    const restaurantsForPos = await tx(`SELECT id FROM restaurants`);
    for (const rest of restaurantsForPos.rows) {
      await tx(
        `INSERT INTO pos_integrations (restaurant_id, provider, status, statistics)
         VALUES ($1, 'None', 'Disconnected', '{"totalSales":0,"lastSaleAt":null}')
         ON CONFLICT (restaurant_id) DO NOTHING`,
        [rest.id]
      );
    }

    // =================================================================
    // NEW PERMISSION SYSTEM
    // =================================================================

    // --- Permission Definitions (master list) ---
    await tx(`
      CREATE TABLE IF NOT EXISTS permission_definitions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        module TEXT NOT NULL,
        permission TEXT NOT NULL,
        label TEXT NOT NULL,
        description TEXT DEFAULT '',
        sort_order INTEGER DEFAULT 0,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(module, permission)
      );
    `);
    await tx(`ALTER TABLE permission_definitions ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE`);

    // Seed definitions
    const seedDefinitions = [
      ['inventory','view','View Inventory','Ability to view inventory items',1],
      ['inventory','save','Save Inventory','Ability to save stock quantities',2],
      ['inventory','add','Add Inventory Item','Ability to add new inventory items',3],
      ['inventory','edit','Edit Inventory Item','Ability to edit existing items',4],
      ['inventory','delete','Delete Inventory Item','Ability to delete items',5],
      ['recipes','view','View Recipes','Ability to view recipes',6],
      ['recipes','create','Create Recipe','Ability to create new recipes',7],
      ['recipes','edit','Edit Recipe','Ability to edit existing recipes',8],
      ['recipes','delete','Delete Recipe','Ability to delete recipes',9],
      ['categories','add','Add Category','Ability to add new categories',10],
      ['categories','edit','Edit Category','Ability to rename/reorder categories',11],
      ['categories','delete','Delete Category','Ability to delete categories',12],
      ['allocations','list','List Pending Allocations','Ability to view pending shortage allocations',13],
      ['allocations','details','View Allocation Details','Ability to see per‑cocktail details',14],
      ['allocations','resolve','Resolve Pending Allocations','Ability to resolve shortages',15],
      ['pos','sale','Record Sale','Ability to record a sale (POS)',16],
      ['settings','manage','Manage Settings','Ability to modify restaurant settings',17],
      ['staff','view','View Staff','Ability to view staff members',18],
      ['staff','create','Create Staff','Ability to create new staff accounts',19],
      ['staff','edit','Edit Staff','Ability to edit staff details',20]
    ];
    for (const def of seedDefinitions) {
      await tx(
        `INSERT INTO permission_definitions (module, permission, label, description, sort_order)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (module, permission) DO NOTHING`,
        def
      );
    }

    // --- Role Permissions (per restaurant, per role) ---
    await tx(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('manager','staff')),
        module TEXT NOT NULL,
        permission TEXT NOT NULL,
        allowed BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(restaurant_id, role, module, permission)
      );
    `);

    // Seed default permissions for each restaurant
    const restaurants = await tx(`SELECT id FROM restaurants`);
    for (const rest of restaurants.rows) {
      const restId = rest.id;
      // Manager → all true
      const defs = await tx(`SELECT module, permission FROM permission_definitions`);
      for (const d of defs.rows) {
        await tx(
          `INSERT INTO role_permissions (restaurant_id, role, module, permission, allowed)
           VALUES ($1, 'manager', $2, $3, true)
           ON CONFLICT (restaurant_id, role, module, permission) DO NOTHING`,
          [restId, d.module, d.permission]
        );
      }
      // Staff → current production defaults
      const staffDefaults = {
        inventory:   ['view','save'],
        recipes:     ['view'],
        allocations: ['list','details','resolve'],
        pos:         ['sale']
      };
      for (const module of Object.keys(staffDefaults)) {
        for (const perm of staffDefaults[module]) {
          await tx(
            `INSERT INTO role_permissions (restaurant_id, role, module, permission, allowed)
             VALUES ($1, 'staff', $2, $3, true)
             ON CONFLICT (restaurant_id, role, module, permission) DO NOTHING`,
            [restId, module, perm]
          );
        }
      }
      // Ensure all other permissions for staff are explicitly false
      for (const d of defs.rows) {
        if (!staffDefaults[d.module] || !staffDefaults[d.module].includes(d.permission)) {
          await tx(
            `INSERT INTO role_permissions (restaurant_id, role, module, permission, allowed)
             VALUES ($1, 'staff', $2, $3, false)
             ON CONFLICT (restaurant_id, role, module, permission) DO NOTHING`,
            [restId, d.module, d.permission]
          );
        }
      }
    }

        // =================================================================
    // POS Sales table (aggregate sales summaries)
    // =================================================================
    await tx(`
      CREATE TABLE IF NOT EXISTS pos_sales (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
        provider TEXT,
        product_name TEXT NOT NULL,
        quantity NUMERIC NOT NULL DEFAULT 1,
        sold_at TIMESTAMPTZ NOT NULL,
        external_sale_id TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await tx(`CREATE INDEX IF NOT EXISTS idx_pos_sales_restaurant ON pos_sales(restaurant_id);`);
    await tx(`CREATE INDEX IF NOT EXISTS idx_pos_sales_sold_at ON pos_sales(sold_at);`);

        // =================================================================
    // Inventory Adjustments (header + detail)
    // =================================================================
    await tx(`
      CREATE TABLE IF NOT EXISTS inventory_adjustments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await tx(`CREATE INDEX IF NOT EXISTS idx_inv_adj_restaurant ON inventory_adjustments(restaurant_id);`);

    await tx(`
      CREATE TABLE IF NOT EXISTS inventory_adjustment_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        adjustment_id UUID REFERENCES inventory_adjustments(id) ON DELETE CASCADE,
        item_id UUID REFERENCES items(id) ON DELETE CASCADE,
        old_quantity DECIMAL(10,2) NOT NULL,
        new_quantity DECIMAL(10,2) NOT NULL,
        difference DECIMAL(10,2) NOT NULL,
        reason TEXT NOT NULL,
        note TEXT
      );
    `);
    await tx(`CREATE INDEX IF NOT EXISTS idx_inv_adj_items_adjustment ON inventory_adjustment_items(adjustment_id);`);

    // =================================================================
    // Stock Intakes (header + detail)
    // =================================================================
    await tx(`
      CREATE TABLE IF NOT EXISTS stock_intakes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id),
        intake_type TEXT NOT NULL DEFAULT 'purchase',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await tx(`CREATE INDEX IF NOT EXISTS idx_stock_intakes_restaurant ON stock_intakes(restaurant_id);`);

    await tx(`
      CREATE TABLE IF NOT EXISTS stock_intake_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        intake_id UUID REFERENCES stock_intakes(id) ON DELETE CASCADE,
        item_id UUID REFERENCES items(id) ON DELETE CASCADE,
        quantity_added DECIMAL(10,2) NOT NULL
      );
    `);
    await tx(`CREATE INDEX IF NOT EXISTS idx_stock_intake_items_intake ON stock_intake_items(intake_id);`);


        // =================================================================
    // Configuration tables – inventory units & adjustment reasons
    // =================================================================
    await tx(`
      CREATE TABLE IF NOT EXISTS inventory_units (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        value TEXT NOT NULL,
        display_name TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        UNIQUE(value)
      );
    `);
    await tx(`
      INSERT INTO inventory_units (value, display_name, sort_order)
      VALUES
        ('ml', 'ml', 1),
        ('cl', 'cl', 2),
        ('L', 'L', 3),
        ('pcs', 'pcs', 4),
        ('slice', 'slice', 5),
        ('wedge', 'wedge', 6),
        ('dash', 'dash', 7),
        ('drop', 'drop', 8),
        ('sprig', 'sprig', 9),
        ('leaf', 'leaf', 10),
        ('pinch', 'pinch', 11)
      ON CONFLICT (value) DO NOTHING;
    `);

    await tx(`
      CREATE TABLE IF NOT EXISTS inventory_adjustment_reasons (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        value TEXT NOT NULL,
        display_name TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        UNIQUE(value)
      );
    `);
    await tx(`
      INSERT INTO inventory_adjustment_reasons (value, display_name, sort_order)
      VALUES
        ('Broken', 'Broken', 1),
        ('Spillage', 'Spillage', 2),
        ('Staff Consumption', 'Staff Consumption', 3),
        ('Expired', 'Expired', 4),
        ('Inventory Count Correction', 'Inventory Count Correction', 5),
        ('Other', 'Other', 6)
      ON CONFLICT (value) DO NOTHING;
    `);

        // =================================================================
    // Sales Import tables (CSV import + product mappings)
    // =================================================================
    await tx(`
      CREATE TABLE IF NOT EXISTS sales_imports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
        imported_by UUID REFERENCES users(id),
        source TEXT NOT NULL DEFAULT 'flatpay',
        period_start TIMESTAMPTZ,
        period_end TIMESTAMPTZ,
        file_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(restaurant_id, file_hash)
      );
    `);

    await tx(`
      CREATE TABLE IF NOT EXISTS sales_import_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        import_id UUID NOT NULL REFERENCES sales_imports(id) ON DELETE CASCADE,
        item_id UUID NOT NULL REFERENCES items(id),
        source_product_name TEXT NOT NULL,
        quantity_sold DECIMAL(10,2) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await tx(`
      CREATE TABLE IF NOT EXISTS sales_product_mappings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
        source TEXT NOT NULL DEFAULT 'flatpay',
        source_product_name TEXT NOT NULL,
        item_id UUID NOT NULL REFERENCES items(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(restaurant_id, source, source_product_name)
      );
    `);

    console.log('Migrations completed successfully.');
  });
}

module.exports = { runMigrations };