const { v4: uuidv4 } = require('uuid');
const { query, transaction } = require('./database');
const { writeLog } = require('./inventory');  // reuse log helper

// -------------------------------------------------------------------
// createRecipe
// -------------------------------------------------------------------
async function createRecipe(req, res) {
  const { restaurantId, userId } = req.auth;
  const { name, description, glass, method, garnish, ingredients } = req.body;
  if (!name || !String(name).trim()) {
    return res.json({ ok: false, code: 'VALIDATION_ERROR', error: 'Recipe name is required' });
  }

  const recipeId = uuidv4();
  try {
    await transaction(async (tx) => {
      await tx(
        `INSERT INTO recipes (id, restaurant_id, name, description, glass, method, garnish, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, NOW(), NOW())`,
        [recipeId, restaurantId, String(name).trim(), description || '', glass || '', method || '', garnish || '']
      );
      if (Array.isArray(ingredients)) {
        for (const ing of ingredients) {
          const invItemId = ing.inventoryItemId || null;
          if (invItemId) {
            const itemCheck = await tx(`SELECT id FROM items WHERE id = $1 AND restaurant_id = $2`, [invItemId, restaurantId]);
            if (itemCheck.rows.length === 0) {
              throw { code: 'NOT_FOUND', error: `Inventory item not found: ${invItemId}` };
            }
          }
          await tx(
            `INSERT INTO recipe_ingredients (id, recipe_id, inventory_item_id, ingredient_name, amount, unit)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              uuidv4(),
              recipeId,
              invItemId,
              ing.name || '',
              parseFloat(ing.amount) || 0,
              ing.unit || 'ml'
            ]
          );
        }
      }
    });

    await writeLog('CREATE_RECIPE', `Recipe "${name}" created`, restaurantId, userId);
    res.json({ ok: true, recipe: { id: recipeId, name: String(name).trim() } });
  } catch (err) {
    console.error('createRecipe error:', err);
    if (err.code) {
      return res.json({ ok: false, code: err.code, error: err.error });
    }
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

// -------------------------------------------------------------------
// updateRecipe
// -------------------------------------------------------------------
async function updateRecipe(req, res) {
  const { restaurantId, userId } = req.auth;
  const { recipeId, name, description, glass, method, garnish, isActive, ingredients } = req.body;
  if (!recipeId) return res.json({ ok: false, code: 'VALIDATION_ERROR', error: 'Missing recipeId' });

  try {
    const existing = await query(`SELECT id FROM recipes WHERE id = $1 AND restaurant_id = $2`, [recipeId, restaurantId]);
    if (existing.rows.length === 0) return res.json({ ok: false, code: 'NOT_FOUND', error: 'Recipe not found' });

    await transaction(async (tx) => {
      await tx(
        `UPDATE recipes SET
           name = COALESCE($1, name),
           description = COALESCE($2, description),
           glass = COALESCE($3, glass),
           method = COALESCE($4, method),
           garnish = COALESCE($5, garnish),
           is_active = COALESCE($6, is_active),
           updated_at = NOW()
         WHERE id = $7 AND restaurant_id = $8`,
        [
          name ? String(name).trim() : null,
          description !== undefined ? description : null,
          glass !== undefined ? glass : null,
          method !== undefined ? method : null,
          garnish !== undefined ? garnish : null,
          isActive !== undefined ? !!isActive : null,
          recipeId,
          restaurantId
        ]
      );

      if (Array.isArray(ingredients)) {
        await tx(`DELETE FROM recipe_ingredients WHERE recipe_id = $1`, [recipeId]);
        for (const ing of ingredients) {
          const invItemId = ing.inventoryItemId || null;
          if (invItemId) {
            const itemCheck = await tx(`SELECT id FROM items WHERE id = $1 AND restaurant_id = $2`, [invItemId, restaurantId]);
            if (itemCheck.rows.length === 0) {
              throw { code: 'NOT_FOUND', error: `Inventory item not found: ${invItemId}` };
            }
          }
          await tx(
            `INSERT INTO recipe_ingredients (id, recipe_id, inventory_item_id, ingredient_name, amount, unit)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              uuidv4(),
              recipeId,
              invItemId,
              ing.name || '',
              parseFloat(ing.amount) || 0,
              ing.unit || 'ml'
            ]
          );
        }
      }
    });

    await writeLog('UPDATE_RECIPE', `Recipe "${recipeId}" updated`, restaurantId, userId);
    res.json({ ok: true });
  } catch (err) {
    console.error('updateRecipe error:', err);
    if (err.code) {
      return res.json({ ok: false, code: err.code, error: err.error });
    }
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

// -------------------------------------------------------------------
// deleteRecipe
// -------------------------------------------------------------------
async function deleteRecipe(req, res) {
  const { restaurantId, userId } = req.auth;
  const { recipeId } = req.body;
  if (!recipeId) return res.json({ ok: false, code: 'VALIDATION_ERROR', error: 'Missing recipeId' });

  try {
    const existing = await query(`SELECT id FROM recipes WHERE id = $1 AND restaurant_id = $2`, [recipeId, restaurantId]);
    if (existing.rows.length === 0) return res.json({ ok: false, code: 'NOT_FOUND', error: 'Recipe not found' });

    await query(`DELETE FROM recipes WHERE id = $1 AND restaurant_id = $2`, [recipeId, restaurantId]);

    await writeLog('DELETE_RECIPE', `Recipe "${recipeId}" deleted`, restaurantId, userId);
    res.json({ ok: true });
  } catch (err) {
    console.error('deleteRecipe error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

// -------------------------------------------------------------------
// getRecipe – returns full recipe with ingredients
// -------------------------------------------------------------------
async function getRecipe(req, res) {
  const { restaurantId } = req.auth;
  const recipeId = req.body.recipeId || req.query.recipeId;
  if (!recipeId) return res.json({ ok: false, code: 'VALIDATION_ERROR', error: 'Missing recipeId' });

  try {
    const recipe = await query(`SELECT * FROM recipes WHERE id = $1 AND restaurant_id = $2`, [recipeId, restaurantId]);
    if (recipe.rows.length === 0) return res.json({ ok: false, code: 'NOT_FOUND', error: 'Recipe not found' });

    const ingredients = await query(
      `SELECT id, recipe_id AS "recipeId", inventory_item_id AS "inventoryItemId", ingredient_name AS name, amount, unit
       FROM recipe_ingredients WHERE recipe_id = $1`,
      [recipeId]
    );

    res.json({
      ok: true,
      recipe: {
        id: recipe.rows[0].id,
        name: recipe.rows[0].name,
        description: recipe.rows[0].description,
        glass: recipe.rows[0].glass,
        method: recipe.rows[0].method,
        garnish: recipe.rows[0].garnish,
        isActive: recipe.rows[0].is_active,
        createdAt: recipe.rows[0].created_at,
        updatedAt: recipe.rows[0].updated_at,
        ingredients: ingredients.rows
      }
    });
  } catch (err) {
    console.error('getRecipe error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

// -------------------------------------------------------------------
// listRecipes – returns summary list (no ingredients), scoped to restaurant
// -------------------------------------------------------------------
async function listRecipes(req, res) {
  const { restaurantId } = req.auth;
  try {
    const recipes = await query(
      `SELECT id, name, description, glass, method, garnish, is_active AS "isActive", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM recipes WHERE restaurant_id = $1 ORDER BY name ASC`,
      [restaurantId]
    );
    res.json({ ok: true, recipes: recipes.rows });
  } catch (err) {
    console.error('listRecipes error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

// -------------------------------------------------------------------
// recordSale – fractional bottle deduction with container_volume
// -------------------------------------------------------------------
async function recordSale(req, res) {
  const { restaurantId, userId } = req.auth;
  const { recipeId, quantity } = req.body;
  const quantitySold = parseInt(quantity, 10);

  if (!recipeId || isNaN(quantitySold) || quantitySold <= 0) {
    return res.json({ ok: false, code: 'VALIDATION_ERROR', error: 'recipeId and positive quantity are required' });
  }

  try {
    await transaction(async (tx) => {
      // Verify recipe exists and belongs to this restaurant
      const recipe = await tx(`SELECT id, name FROM recipes WHERE id = $1 AND restaurant_id = $2`, [recipeId, restaurantId]);
      if (recipe.rows.length === 0) {
        throw { code: 'NOT_FOUND', error: 'Recipe not found' };
      }

      const ingredients = await tx(
        `SELECT ri.inventory_item_id, ri.amount, i.name AS item_name, i.container_volume
         FROM recipe_ingredients ri
         JOIN items i ON ri.inventory_item_id = i.id
         WHERE ri.recipe_id = $1 AND ri.inventory_item_id IS NOT NULL AND i.restaurant_id = $2`,
        [recipeId, restaurantId]
      );

      const deductions = [];
      for (const ing of ingredients.rows) {
        const itemId = ing.inventory_item_id;
        const containerVolume = ing.container_volume || 0;

        const stock = await tx(
          `SELECT quantity FROM stocks WHERE item_id = $1 AND restaurant_id = $2`,
          [itemId, restaurantId]
        );
        const currentBottles = stock.rows.length > 0 ? parseFloat(stock.rows[0].quantity) : 0;

        let deductBottles;
        if (containerVolume > 0) {
          deductBottles = (parseFloat(ing.amount) * quantitySold) / containerVolume;
        } else {
          deductBottles = parseFloat(ing.amount) * quantitySold;
        }

        if (currentBottles < deductBottles) {
          throw {
            code: 'INSUFFICIENT_STOCK',
            error: `Not enough stock for "${ing.item_name}". Required: ${deductBottles.toFixed(2)}, have: ${currentBottles.toFixed(2)}`
          };
        }

        deductions.push({ itemId, newBottles: currentBottles - deductBottles });
      }

      for (const ded of deductions) {
        await tx(
          `UPDATE stocks SET quantity = $1, updated_at = NOW() WHERE item_id = $2 AND restaurant_id = $3`,
          [ded.newBottles, ded.itemId, restaurantId]
        );
      }

      await tx(
        `INSERT INTO logs (id, action, details, user_id, restaurant_id, timestamp)
         VALUES ($1, 'RECORD_SALE', $2, $3, $4, NOW())`,
        [uuidv4(), `Recipe "${recipe.rows[0].name}" sold x${quantitySold}`, userId, restaurantId]
      );
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('recordSale error:', err);
    if (err.code) {
      return res.json({ ok: false, code: err.code, error: err.error });
    }
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

module.exports = { createRecipe, updateRecipe, deleteRecipe, getRecipe, listRecipes, recordSale };