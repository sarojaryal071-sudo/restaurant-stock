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
    await tx(`
      INSERT INTO settings (key, value)
      VALUES ('requireAuth', 'false')
      ON CONFLICT (key) DO NOTHING;
    `);

    // -----------------------------------------------------------------
    // FIX: allow recipe_ingredients.inventory_item_id to be set to NULL
    //      when the referenced item is deleted (instead of blocking deletion).
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

    // --- Pending Allocations (grouped shortages) ---
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

    // --- Pending Allocation Details (per cocktail) ---
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

    // --- Allocation Logs (audit trail) ---
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
    
    console.log('Migrations completed successfully.');
  });
}

module.exports = { runMigrations };