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
  `db-cache-api-${config.nodeId}.sqlite`
);

export const knex = Knex({
  client: 'sqlite3',
  connection: {
    filename: dbPath,
  },
  useNullAsDefault: true,
});

const commonEntities = [
  {
    tableName: 'expectedTx',
    schemaFn: (table) => {
      table.string('tx').primary();
      table.json('metadata');
    },
    jsonFields: ['metadata'],
  },
  {
    tableName: 'callbackUrl',
    schemaFn: (table) => {
      table.string('referenceId').primary();
      table.text('url');
    },
  },
  {
    tableName: 'callbackWithRetry',
    schemaFn: (table) => {
      table.string('cbId').primary();
      table.json('data');
    },
    jsonFields: ['data'],
  },
];

const rpIdpAsEntities = [
  {
    tableName: 'rawReceivedMessageFromMQ',
    schemaFn: (table) => {
      table.string('messageId').primary();
      table.binary('messageBuffer');
    },
  },
  {
    tableName: 'duplicateMessageTimeout',
    schemaFn: (table) => {
      table.string('id').primary();
      table.integer('unixTimeout');
    },
  },
];

const rpIdpEntites = [
  {
    tableName: 'requestIdReferenceIdMapping',
    schemaFn: (table) => {
      table.text('referenceId').primary();
      table.string('requestId').primary();
    },
  },
  {
    tableName: 'requestCallbackUrl',
    schemaFn: (table) => {
      table.string('requestId').primary();
      table.text('url');
    },
  },
  {
    tableName: 'requestData',
    schemaFn: (table) => {
      table.string('requestId').primary();
      table.json('request');
    },
    jsonFields: ['request'],
  },
  {
    tableName: 'timeoutScheduler',
    schemaFn: (table) => {
      table.string('requestId');
      table.integer('unixTimeout');
    },
  },
  {
    tableName: 'idpResponseValid',
    schemaFn: (table) => {
      table.string('requestId');
      table.json('validInfo');
    },
    jsonFields: ['validInfo'],
  },
  {
    tableName: 'publicProofReceivedFromMQ',
    schemaFn: (table) => {
      table.string('responseId').primary();
      table.json('publicProofArray');
    },
    jsonFields: ['publicProofArray'],
  },
  {
    tableName: 'privateProofReceivedFromMQ',
    schemaFn: (table) => {
      table.string('responseId').primary();
      table.json('privateProofObject');
    },
    jsonFields: ['privateProofObject'],
  },
  {
    tableName: 'challengeFromRequestId',
    schemaFn: (table) => {
      table.string('requestId').primary();
      table.json('challenge');
    },
    jsonFields: ['challenge'],
  },
];

const idpAsEntities = [
  {
    tableName: 'requestIdExpectedInBlock',
    schemaFn: (table) => {
      table.integer('expectedBlockHeight');
      table.string('requestId');
    },
  },
  {
    tableName: 'requestReceivedFromMQ',
    schemaFn: (table) => {
      table.string('requestId').primary();
      table.json('request');
    },
    jsonFields: ['request'],
  },
];

const rpEntities = [
  {
    tableName: 'expectedIdpResponseNodeIdInBlock',
    schemaFn: (table) => {
      table.integer('expectedBlockHeight');
      table.json('responseMetadata');
    },
    jsonFields: ['responseMetadata'],
  },
  {
    tableName: 'expectedIdpPublicProofInBlock',
    schemaFn: (table) => {
      table.integer('expectedBlockHeight');
      table.json('responseMetadata');
    },
    jsonFields: ['responseMetadata'],
  },
  {
    tableName: 'dataFromAs',
    schemaFn: (table) => {
      table.string('requestId');
      table.json('data');
    },
    jsonFields: ['data'],
  },
  {
    tableName: 'expectedDataSignInBlock',
    schemaFn: (table) => {
      table.integer('expectedBlockHeight');
      table.json('metadata');
    },
    jsonFields: ['metadata'],
  },
  {
    tableName: 'dataResponseFromAs',
    schemaFn: (table) => {
      table.string('asResponseId').primary();
      table.json('dataResponse');
    },
    jsonFields: ['dataResponse'],
  },
];

const idpEntities = [
  {
    tableName: 'requestToProcessReceivedFromMQ',
    schemaFn: (table) => {
      table.string('requestId').primary();
      table.json('request');
    },
    jsonFields: ['request'],
  },
  {
    tableName: 'responseDataFromRequestId',
    schemaFn: (table) => {
      table.string('requestId').primary();
      table.json('response');
    },
    jsonFields: ['response'],
  },
  {
    tableName: 'rpIdFromRequestId',
    schemaFn: (table) => {
      table.string('requestId').primary();
      table.string('rp_id');
    },
  },
  {
    tableName: 'identityRequestIdMapping',
    schemaFn: (table) => {
      table.string('requestId').primary();
      table.json('identity');
    },
    jsonFields: ['identity'],
  },
  {
    tableName: 'createIdentityDataReferenceIdMapping',
    schemaFn: (table) => {
      table.text('referenceId').primary();
      table.json('createIdentityData');
    },
    jsonFields: ['createIdentityData'],
  },
  {
    tableName: 'requestMessage',
    schemaFn: (table) => {
      table.string('requestId').primary();
      table.json('requestMessageAndSalt');
    },
    jsonFields: ['requestMessageAndSalt'],
  },
];

const asEntities = [
  {
    tableName: 'initialSalt',
    schemaFn: (table) => {
      table.string('requestId').primary();
      table.string('initialSalt');
    },
  },
  {
    tableName: 'rpIdFromDataRequestId',
    schemaFn: (table) => {
      table.string('dataRequestId').primary();
      table.string('rpId');
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
    entities = [
      ...commonEntities,
      ...rpIdpAsEntities,
      ...rpIdpEntites,
      ...rpEntities,
    ];
  } else if (config.role === 'idp') {
    entities = [
      ...commonEntities,
      ...rpIdpAsEntities,
      ...rpIdpEntites,
      ...idpAsEntities,
      ...idpEntities,
    ];
  } else if (config.role === 'as') {
    entities = [
      ...commonEntities,
      ...rpIdpAsEntities,
      ...idpAsEntities,
      ...asEntities,
    ];
  } else if (config.role === 'ndid') {
    entities = [...commonEntities];
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
