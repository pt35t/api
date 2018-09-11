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

import path from 'path';
import Knex from 'knex';

import * as config from '../../config';

const dbPath = path.join(
  config.dataDirectoryPath,
  `db-long-term-api-${config.nodeId}.sqlite`
);

export const knex = Knex({
  client: 'sqlite3',
  connection: {
    filename: dbPath,
  },
  useNullAsDefault: true,
});

const rpIdpEntities = [
  {
    tableName: 'challengeRequestMessage',
    schemaFn: (table) => {
      table.string('requestId');
      table.text('message');
    },
  },
  {
    tableName: 'idpResponseMessage',
    schemaFn: (table) => {
      table.string('requestId');
      table.text('message');
    },
  },
];

const rpEntities = [
  {
    tableName: 'asDataResponseMessage',
    schemaFn: (table) => {
      table.string('requestId');
      table.text('message');
    },
  },
];

const idpEntities = [
  {
    tableName: 'challengeResponseMessage',
    schemaFn: (table) => {
      table.string('requestId');
      table.text('message');
    },
  },
  {
    tableName: 'consentRequestMessage',
    schemaFn: (table) => {
      table.string('requestId');
      table.text('message');
    },
  },
];

const asEntities = [
  {
    tableName: 'dataRequestMessage',
    schemaFn: (table) => {
      table.string('requestId');
      table.text('message');
    },
  },
];

let entities;

export function getJsonFields(tableName) {
  const entity = entities.find((entity) => entity.tableName === tableName);
  if (entity.jsonFields != null) {
    return entity.jsonFields;
  }
  return [];
}

async function createTableIfNotExist(tableName, schemaFn) {
  const hasTable = await knex.schema.hasTable(tableName);
  if (!hasTable) {
    await knex.schema.createTable(tableName, schemaFn);
  }
}

async function initialize() {
  if (config.role === 'rp') {
    entities = [...rpIdpEntities, ...rpEntities];
  } else if (config.role === 'idp') {
    entities = [...rpIdpEntities, ...idpEntities];
  } else if (config.role === 'as') {
    entities = [...asEntities];
  }

  await Promise.all(
    entities.map((entity) =>
      createTableIfNotExist(entity.tableName, entity.schemaFn)
    )
  );
}

export const init = initialize();

export function close() {
  return knex.destroy();
}
