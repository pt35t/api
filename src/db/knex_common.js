/**
 * Copyright (c) 2018, 2019 National Digital ID COMPANY LIMITED
 *
 * This file is part of NDID software.
 *
 * NDID is the free software: you can redistribute it and/or modify it under
 * the terms of the Affero GNU General Public License as published by the
 * Free Software Foundation, either version 3 of the License, or any later
 * version.
 *
 * NDID is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the Affero GNU General Public License for more details.
 *
 * You should have received a copy of the Affero GNU General Public License
 * along with the NDID source code. If not, see https://www.gnu.org/licenses/agpl.txt.
 *
 * Please contact info@ndid.co.th for any further questions
 *
 */

import * as cacheDb from './cache/knex';
import * as longTermDb from './long_term/knex';

import CustomError from '../error/custom_error';
import errorType from '../error/type';

function getDB(dbName) {
  switch (dbName) {
    case 'cache':
      return cacheDb;
    case 'long-term':
      return longTermDb;
    default:
      throw new CustomError({ message: 'Unknown database name' });
  }
}

export async function getList({ dbName, name, keyName, key, valueName }) {
  try {
    const { knex, init, getJsonFields } = getDB(dbName);
    await init;
    const rows = await knex
      .select(valueName)
      .from(name)
      .where(keyName, key);

    const jsonFields = getJsonFields(name);
    if (jsonFields.indexOf(valueName) >= 0) {
      return rows.map((row) => JSON.parse(row[valueName]));
    }
    return rows.map((row) => row[valueName]);
  } catch (error) {
    throw new CustomError({
      errorType: errorType.DB_ERROR,
      cause: error,
      details: { operation: 'getList', dbName, table: name },
    });
  }
}

export async function count({ dbName, name, keyName, key }) {
  try {
    const { knex, init } = getDB(dbName);
    await init;
    const count = await knex
      .count()
      .from(name)
      .where(keyName, key);

    return count;
  } catch (error) {
    throw new CustomError({
      errorType: errorType.DB_ERROR,
      cause: error,
      details: { operation: 'count', dbName, table: name },
    });
  }
}

export async function getListRange({
  dbName,
  name,
  keyName,
  keyRange,
  valueName,
}) {
  try {
    const { knex, init, getJsonFields } = getDB(dbName);
    await init;
    const rows = await knex
      .select(valueName)
      .from(name)
      .whereBetween(keyName, [keyRange.gte, keyRange.lte]);

    const jsonFields = getJsonFields(name);
    if (jsonFields.indexOf(valueName) >= 0) {
      return rows.map((row) => JSON.parse(row[valueName]));
    }
    return rows.map((row) => row[valueName]);
  } catch (error) {
    throw new CustomError({
      errorType: errorType.DB_ERROR,
      cause: error,
      details: { operation: 'getListRange', dbName, table: name },
    });
  }
}

export async function pushToList({
  dbName,
  name,
  keyName,
  key,
  valueName,
  value,
}) {
  try {
    const { knex, init, getJsonFields } = getDB(dbName);

    const jsonFields = getJsonFields(name);
    if (jsonFields.length > 0) {
      if (jsonFields.indexOf(keyName) >= 0) {
        key = JSON.stringify(key);
      }
      if (jsonFields.indexOf(valueName) >= 0) {
        value = JSON.stringify(value);
      }
    }

    await init;
    await knex
      .insert({
        [keyName]: key,
        [valueName]: value,
      })
      .into(name);
  } catch (error) {
    throw new CustomError({
      errorType: errorType.DB_ERROR,
      cause: error,
      details: { operation: 'pushToList', dbName, table: name },
    });
  }
}

export async function removeFromList({
  dbName,
  name,
  keyName,
  key,
  valueName,
  valuesToRemove,
}) {
  try {
    const { knex, init } = getDB(dbName);
    await init;
    await knex
      .delete()
      .from(name)
      .whereIn(valueName, valuesToRemove)
      .andWhere(keyName, key);
  } catch (error) {
    throw new CustomError({
      errorType: errorType.DB_ERROR,
      cause: error,
      details: { operation: 'removeFromList', dbName, table: name },
    });
  }
}

export async function removeList({ dbName, name, keyName, key }) {
  try {
    const { knex, init } = getDB(dbName);
    await init;
    await knex
      .delete()
      .from(name)
      .where(keyName, key);
  } catch (error) {
    throw new CustomError({
      errorType: errorType.DB_ERROR,
      cause: error,
      details: { operation: 'removeList', dbName, table: name },
    });
  }
}

export async function removeListRange({ dbName, name, keyName, keyRange }) {
  try {
    const { knex, init } = getDB(dbName);
    await init;
    await knex
      .delete()
      .from(name)
      .whereBetween(keyName, [keyRange.gte, keyRange.lte]);
  } catch (error) {
    throw new CustomError({
      errorType: errorType.DB_ERROR,
      cause: error,
      details: { operation: 'removeListRange', dbName, table: name },
    });
  }
}

export async function removeAllLists({ dbName, name }) {
  try {
    const { knex, init } = getDB(dbName);
    await init;
    await knex.delete().from(name);
  } catch (error) {
    throw new CustomError({
      errorType: errorType.DB_ERROR,
      cause: error,
      details: { operation: 'removeAllLists', dbName, table: name },
    });
  }
}

export async function get({ dbName, name, keyName, key, valueName }) {
  try {
    const { knex, init, getJsonFields } = getDB(dbName);
    await init;
    const row = await knex
      .select(valueName)
      .from(name)
      .where(keyName, key)
      .first();

    if (row == null) {
      return null;
    }

    const jsonFields = getJsonFields(name);
    if (jsonFields.indexOf(valueName) >= 0) {
      return JSON.parse(row[valueName]);
    }
    return row[valueName];
  } catch (error) {
    throw new CustomError({
      errorType: errorType.DB_ERROR,
      cause: error,
      details: { operation: 'get', dbName, table: name },
    });
  }
}

export async function set({ dbName, name, keyName, key, valueName, value }) {
  try {
    const { knex, init, getJsonFields } = getDB(dbName);

    const jsonFields = getJsonFields(name);
    if (jsonFields.length > 0) {
      if (jsonFields.indexOf(keyName) >= 0) {
        key = JSON.stringify(key);
      }
      if (jsonFields.indexOf(valueName) >= 0) {
        value = JSON.stringify(value);
      }
    }

    await init;
    try {
      await knex
        .insert({
          [keyName]: key,
          [valueName]: value,
        })
        .into(name);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT') {
        await knex
          .update({
            [valueName]: value,
          })
          .table(name)
          .where(keyName, key);
      } else {
        throw error;
      }
    }
  } catch (error) {
    throw new CustomError({
      errorType: errorType.DB_ERROR,
      cause: error,
      details: { operation: 'set', dbName, table: name },
    });
  }
}

export async function remove({ dbName, name, keyName, key }) {
  try {
    const { knex, init } = getDB(dbName);
    await init;
    await knex
      .delete()
      .from(name)
      .where(keyName, key);
  } catch (error) {
    throw new CustomError({
      errorType: errorType.DB_ERROR,
      cause: error,
      details: { operation: 'remove', dbName, table: name },
    });
  }
}

export async function getAll({ dbName, name }) {
  try {
    const { knex, init, getJsonFields } = getDB(dbName);
    await init;
    const rows = await knex.select('*').from(name);

    const jsonFields = getJsonFields(name);
    if (jsonFields.length > 0) {
      return rows.map((row) => {
        for (let key in row) {
          if (jsonFields.indexOf(key) >= 0) {
            row[key] = JSON.parse(row[key]);
          }
        }
        return row;
      });
    }
    return rows;
  } catch (error) {
    throw new CustomError({
      errorType: errorType.DB_ERROR,
      cause: error,
      details: { operation: 'getAll', dbName, table: name },
    });
  }
}
